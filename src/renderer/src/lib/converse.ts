// Micro de la conversation vocale : le son (16 kHz) est découpé en phrases sur
// place ; seule la phrase entendue part à la transcription, rien n'est écrit sur
// le disque. Le micro n'est ouvert que pendant l'écoute (et pendant la lecture si
// l'on peut la couper en parlant).

// Fichier à part (jamais en data: dans le code) : la politique de sécurité de la page n'accepte que ses propres fichiers.
import tapUrl from './pcmTap.worklet.js?url&no-inline'
import { CONVERSE_SEGMENT, isOnset, READING_SEGMENT, type MicMode } from '@shared/converse'
import { newSegmenter, segmentChunk } from '@shared/meetings'

export interface ConverseCallbacks {
  level: (v: number) => void
  /** Assez de voix pour une phrase. */
  onset: () => void
  /** Phrase terminée, en 16 kHz. */
  phrase: (audio: Float32Array) => void
  /** Micro coupé ou refusé. */
  error: (message: string) => void
}

export interface ConverseCapture {
  setMode(mode: MicMode): void
  stop(): void
}

/** Son gardé : la plus longue phrase, plus la marge d'avant. */
const KEEP = CONVERSE_SEGMENT.max + CONVERSE_SEGMENT.preRoll + 16_000

export function micError(e: unknown): string {
  const name = (e as DOMException).name
  return name === 'NotAllowedError'
    ? 'Micro refusé : autorise les applications de bureau à utiliser le micro (Paramètres Windows › Confidentialité › Microphone).'
    : name === 'NotFoundError'
      ? 'Aucun micro trouvé : branche un micro ou un casque.'
      : `Micro indisponible : ${(e as Error).message}`
}

export async function startConverseCapture(cb: ConverseCallbacks, initial: MicMode): Promise<ConverseCapture> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const ctx = new AudioContext({ sampleRate: 16_000 })
  try {
    await ctx.audioWorklet.addModule(tapUrl)
    await ctx.resume()
  } catch (e) {
    mic.getTracks().forEach((t) => t.stop())
    void ctx.close()
    throw e
  }
  let mode = initial
  let seg = newSegmenter()
  /** Morceaux récents et leur position (en échantillons depuis l'ouverture). */
  const kept: Array<{ at: number; data: Float32Array }> = []
  let onsetFired = false
  let stopped = false

  const extract = (from: number, to: number): Float32Array => {
    const out = new Float32Array(Math.max(0, to - from))
    for (const k of kept) {
      const a = Math.max(from, k.at)
      const b = Math.min(to, k.at + k.data.length)
      if (a < b) out.set(k.data.subarray(a - k.at, b - k.at), a - from)
    }
    return out
  }

  // Le processeur doit être relié à la sortie pour tourner : un volume à zéro, rien n'est joué.
  const mute = ctx.createGain()
  mute.gain.value = 0
  mute.connect(ctx.destination)
  // Morceaux de 0,1 s : parler coupe la lecture sans attendre.
  const node = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { chunk: 1600 } })
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (stopped) return
    const chunk = e.data
    kept.push({ at: seg.pos + seg.carry.length, data: chunk })
    while (kept.length && kept[0].at + kept[0].data.length < seg.pos - KEEP) kept.shift()
    let sum = 0
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
    cb.level(Math.min(1, Math.sqrt(sum / chunk.length) * 4))
    const r = segmentChunk(seg, chunk, mode === 'reading' ? READING_SEGMENT : CONVERSE_SEGMENT)
    seg = r.state
    if (!onsetFired && seg.speechStart !== null && isOnset(seg.voiced, mode)) {
      onsetFired = true
      cb.onset()
    }
    for (const span of r.spans) {
      // Une phrase sans assez de voix (bruit, clic) est ignorée.
      if (onsetFired) cb.phrase(extract(span.from, span.to))
      onsetFired = false
    }
    if (seg.speechStart === null) onsetFired = false
  }
  const source = ctx.createMediaStreamSource(mic)
  source.connect(node)
  node.connect(mute)

  const stop = (): void => {
    if (stopped) return
    stopped = true
    source.disconnect()
    node.disconnect()
    mic.getTracks().forEach((t) => t.stop())
    void ctx.close()
    cb.level(0)
  }
  for (const t of mic.getAudioTracks()) t.addEventListener('ended', () => !stopped && (stop(), cb.error('Le micro a été coupé.')))
  return {
    setMode: (m) => {
      mode = m
    },
    stop
  }
}
