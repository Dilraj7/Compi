// Dictée : enregistre le micro, s'arrête après un silence (ou au relâchement
// du raccourci), puis transcrit avec Whisper sur le PC. Le son ne quitte
// jamais l'ordinateur ; seule la transcription est envoyée à Compi.

import { cleanTranscript, silenceStep, VOICE_MODELS, type SilenceState } from '@shared/voice'
import type { VoiceModelId, VoiceVariant } from '@shared/types'
import type { WorkerRequest, WorkerResponse } from './whisper.worker'

export type VoicePhase = 'idle' | 'starting' | 'recording' | 'transcribing'

export interface VoiceCallbacks {
  phase: (p: VoicePhase, detail?: string) => void
  level: (v: number) => void
  /** Texte transcrit (vide : rien compris). */
  result: (text: string) => void
  error: (message: string) => void
}

/** Ce PC peut-il faire tourner la dictée sur la carte graphique ? */
export async function detectVariant(): Promise<VoiceVariant> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<{ features: Set<string> } | null> } }).gpu
    const adapter = await gpu?.requestAdapter({ powerPreference: 'high-performance' })
    return adapter?.features.has('shader-f16') ? 'gpu' : 'cpu'
  } catch {
    return 'cpu'
  }
}

// ─── Fil de transcription ────────────────────────────────────────────────────

let worker: Worker | null = null
let workerKey = ''
let nextId = 1
let idleTimer: ReturnType<typeof setTimeout> | undefined
const waiting = new Map<number, { resolve: (t?: string) => void; reject: (e: Error) => void; progress?: (r: number) => void }>()

/** Libère la mémoire de la carte graphique 10 min après la dernière dictée. */
function touchWorker(): void {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    worker?.terminate()
    worker = null
    workerKey = ''
  }, 10 * 60_000)
}

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never

function call(req: NoId<WorkerRequest>, progress?: (r: number) => void): Promise<string | undefined> {
  if (!worker) {
    worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      if (e.data.type === 'progress') return w.progress?.(e.data.ratio)
      waiting.delete(e.data.id)
      if (e.data.type === 'done') w.resolve(e.data.text)
      else w.reject(new Error(e.data.message))
    }
    worker.onerror = (e) => {
      for (const w of waiting.values()) w.reject(new Error(e.message || 'La dictée a planté.'))
      waiting.clear()
      worker?.terminate()
      worker = null
      workerKey = ''
    }
  }
  touchWorker()
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, progress })
    worker!.postMessage({ ...req, id }, req.type === 'transcribe' ? [req.audio.buffer as ArrayBuffer] : [])
  })
}

/** Charge le modèle (au premier usage : quelques secondes de préparation). */
export async function loadModel(model: VoiceModelId, variant: VoiceVariant, progress?: (r: number) => void): Promise<void> {
  const v = VOICE_MODELS[model].variants[variant]
  const key = `${model}|${variant}`
  if (worker && workerKey === key) return
  await call({ type: 'load', model: VOICE_MODELS[model].dir, device: v.device, dtype: v.dtype }, progress)
  workerKey = key
}

export function unloadModel(): void {
  worker?.terminate()
  worker = null
  workerKey = ''
}

// ─── Enregistrement ──────────────────────────────────────────────────────────

interface Recording {
  stream: MediaStream
  recorder: MediaRecorder
  chunks: Blob[]
  ctx: AudioContext
  timer: ReturnType<typeof setInterval>
  cancelled: boolean
}

let rec: Recording | null = null

export const isRecording = (): boolean => rec !== null

/** Son enregistré → 16 kHz mono, le format de Whisper. */
async function toPcm16k(blob: Blob): Promise<Float32Array> {
  const ctx = new AudioContext({ sampleRate: 16_000 })
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
    if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
    const a = buf.getChannelData(0)
    const b = buf.getChannelData(1)
    return a.map((x, i) => (x + b[i]) / 2)
  } finally {
    void ctx.close()
  }
}

/**
 * Démarre l'écoute. `ready` (le chargement du modèle) se fait pendant que
 * l'utilisateur parle ; la transcription l'attend si besoin.
 */
export async function startListening(cb: VoiceCallbacks, ready: Promise<void>): Promise<void> {
  if (rec) return
  cb.phase('starting')
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  } catch (e) {
    cb.phase('idle')
    const name = (e as DOMException).name
    cb.error(
      name === 'NotAllowedError'
        ? 'Micro refusé : autorise les applications de bureau à utiliser le micro (Paramètres Windows › Confidentialité › Microphone).'
        : name === 'NotFoundError'
          ? 'Aucun micro trouvé : branche un micro ou un casque.'
          : `Micro indisponible : ${(e as Error).message}`
    )
    return
  }

  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  const samples = new Float32Array(analyser.fftSize)
  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data)

  let silence: SilenceState = { heard: false, quietSince: null, startedAt: Date.now() }
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const s of samples) sum += s * s
    const level = Math.min(1, Math.sqrt(sum / samples.length) * 4)
    cb.level(level)
    const step = silenceStep(silence, level, Date.now())
    silence = step.state
    if (step.stop === 'nothing') cancelListening('Je n’ai rien entendu.')
    else if (step.stop) stopListening()
  }, 50)

  rec = { stream, recorder, chunks, ctx, timer, cancelled: false }
  const current = rec
  recorder.onstop = async () => {
    clearInterval(timer)
    stream.getTracks().forEach((t) => t.stop())
    void ctx.close()
    cb.level(0)
    if (rec === current) rec = null
    if (current.cancelled) return
    cb.phase('transcribing')
    try {
      const audio = await toPcm16k(new Blob(chunks, { type: 'audio/webm' }))
      if (audio.length < 16_000 * 0.4) throw new Error('Trop court : maintiens le raccourci pendant que tu parles.')
      await ready
      const text = cleanTranscript((await call({ type: 'transcribe', audio, language: 'french' })) ?? '')
      cb.phase('idle')
      cb.result(text)
    } catch (e) {
      cb.phase('idle')
      cb.error((e as Error).message)
    }
  }
  recorder.start(250)
  cb.phase('recording')
  cancelHandler = (message) => {
    current.cancelled = true
    cb.phase('idle')
    if (message) cb.error(message)
  }
}

let cancelHandler: ((message?: string) => void) | null = null

/** Fin de la prise de parole : on transcrit. */
export function stopListening(): void {
  if (rec && rec.recorder.state !== 'inactive') rec.recorder.stop()
}

/** Abandon (Échap, ou personne n'a parlé) : rien n'est transcrit. */
export function cancelListening(message?: string): void {
  if (!rec) return
  cancelHandler?.(message)
  if (rec.recorder.state !== 'inactive') rec.recorder.stop()
}
