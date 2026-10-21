// Dictée partout : la touche (processus annexe), la fenêtre visée, la
// transcription, le style, le dictionnaire puis le collage. L'îlot enregistre
// le micro et montre la pastille, sans jamais prendre le focus. Désactivée
// par défaut ; si la touche ne peut pas être observée, le raccourci de « Me
// parler » reste disponible.

import { join } from 'node:path'
import type Anthropic from '@anthropic-ai/sdk'
import { powerMonitor, utilityProcess, type UtilityProcess } from 'electron'
import { defaultBrain } from '../../shared/brains'
import { acceptPolished, applyDictionary, cleanNatural, compiRequest, DICTATION_KEYS, POLISH_SYSTEM, styleFor, wordCount } from '../../shared/dictation'
import { IPC } from '../../shared/ipc'
import { isOnline } from '../../shared/privacy'
import { SPEECH_MODELS } from '../../shared/speechModels'
import type { DictationCommand, DictationKey, DictationOutcome, DictationSettings } from '../../shared/types'
import { clientFor } from '../brains/probe'
import { emit } from '../bus'
import { log } from '../log'
import { prepareSpeech, transcribeSpeech } from '../speech/engine'
import { speechModelFiles } from '../speech/models'
import { settings } from '../store/settings'
import { warmHost } from '../windows/host'
import { foregroundWindow, type WindowInfo } from '../windows/system'
import { copyDictation, pasteDictation } from './paste'
import { KEYCODES, type KeyWorkerRequest, type KeyWorkerResponse } from './protocol'
import { recordDictation } from './stats'

// ─── Touche (processus annexe uiohook) ───────────────────────────────────────

let worker: UtilityProcess | null = null
let watched = 0
let keyActive = false
let restarts = 0
let onActive: () => void = () => undefined

const post = (r: KeyWorkerRequest): void => worker?.postMessage(r)

function setKeyActive(v: boolean): void {
  if (keyActive === v) return
  keyActive = v
  onActive()
}

/** La touche est observée (sinon : module absent, refusé par Windows, ou dictée partout désactivée). */
export const dictationKeyActive = (): boolean => keyActive

/** Prévenu quand la touche devient (ou cesse d'être) observée : les réglages affichés changent. */
export function onDictationKeyActive(cb: () => void): void {
  onActive = cb
}

function watch(key: DictationKey): void {
  if (watched === KEYCODES[key]) return
  watched = KEYCODES[key]
  post({ type: 'watch', keycode: watched })
}

function startWorker(key: DictationKey): void {
  if (worker) return watch(key)
  let w: UtilityProcess
  try {
    w = utilityProcess.fork(join(__dirname, 'keyWorker.js'), [], { serviceName: 'Compi - touche de dictée', stdio: 'ignore' })
  } catch (e) {
    log('warn', 'dictée partout : processus de la touche impossible', (e as Error).message)
    return
  }
  worker = w
  watched = 0
  w.on('message', (r: KeyWorkerResponse) => {
    if (r.type === 'ready') {
      restarts = 0
      setKeyActive(true)
    } else if (r.type === 'error') {
      log('warn', `dictée partout : touche non observée (${r.message})`)
      stopWorker()
    } else onKeyAction(r.action)
  })
  w.on('exit', (code) => {
    if (worker !== w) return
    worker = null
    setKeyActive(false)
    log('warn', `dictée partout : observation de la touche arrêtée (code ${code})`)
    if (session?.phase === 'recording') cancelSession()
    // Relancée au plus 3 fois de suite ; au-delà, le raccourci de « Me parler » reste.
    if (restarts++ < 3)
      setTimeout(() => {
        const d = settings.get().dictation
        if (d.enabled && !worker) startWorker(d.key)
      }, 2000)
  })
  watch(key)
}

function stopWorker(): void {
  const w = worker
  worker = null
  watched = 0
  setKeyActive(false)
  w?.kill()
}

/** À chaque changement de réglages : la touche n'est observée que si la dictée partout est activée. */
export function applyDictationSettings(d: DictationSettings): void {
  if (!d.enabled) {
    if (session) cancelSession()
    stopWorker()
    return
  }
  // L'hôte Windows (fenêtre visée, collage) démarre d'avance.
  warmHost()
  startWorker(d.key)
}

export function stopDictationEverywhere(): void {
  cancelSession()
  stopWorker()
}

/** Écran verrouillé ou veille : rien ne doit continuer d'écouter. */
export function hookDictationPower(): void {
  powerMonitor.on('lock-screen', () => cancelSession())
  powerMonitor.on('suspend', () => cancelSession())
}

// ─── Une dictée ──────────────────────────────────────────────────────────────

interface Session {
  target: WindowInfo | null
  targetReady: Promise<void>
  startedAt: number
  stoppedAt: number
  phase: 'recording' | 'processing'
  watchdog?: NodeJS.Timeout
}

let session: Session | null = null

const notify = (text: string, error = false): void => emit(IPC.islandNotify, { pill: error ? 'error' : 'chat', text })
const command = (c: DictationCommand): void => emit(IPC.dictationCommand, c)

/** « OUTLOOK » → « Outlook » ; jamais le titre de la fenêtre (il peut être privé). */
function appLabel(w: WindowInfo | null): string | undefined {
  if (!w) return undefined
  if (w.pid === process.pid) return 'Compi'
  const p = w.process.replace(/\.exe$/i, '')
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : undefined
}

function onKeyAction(a: Exclude<KeyWorkerResponse, { type: 'ready' | 'error' }>['action']): void {
  if (a === 'start' || a === 'handsfree') begin(a === 'handsfree')
  else if (a === 'stop') stopSession()
  else cancelSession()
}

function begin(handsFree: boolean): void {
  if (session) {
    if (session.phase === 'processing') notify('J’écris encore la dictée précédente…')
    post({ type: 'reset' })
    return
  }
  const d = settings.get().dictation
  if (d.engine !== 'whisper' && !speechModelFiles(d.engine)) {
    post({ type: 'reset' })
    notify(`Pour dicter partout, télécharge d’abord le modèle ${SPEECH_MODELS[d.engine].label} : Réglages › Me parler.`, true)
    return
  }
  const s: Session = { target: null, targetReady: Promise.resolve(), startedAt: Date.now(), stoppedAt: 0, phase: 'recording' }
  session = s
  // Le micro d'abord : la fenêtre visée se lit pendant que l'utilisateur parle.
  command({ type: 'start', handsFree, engine: d.engine, keyLabel: DICTATION_KEYS.find((k) => k.id === d.key)?.label ?? 'la touche' })
  if (d.engine !== 'whisper') prepareSpeech(d.engine).catch(() => undefined) // erreur montrée à la transcription
  s.targetReady = foregroundWindow().then(
    (w) => {
      s.target = w
      if (session === s) command({ type: 'target', app: appLabel(w) })
    },
    () => undefined
  )
}

/** Fin de la prise de parole (touche relâchée, ou bouton de la pastille). */
export function stopSession(fromIsland = false): void {
  const s = session
  if (!s || s.phase !== 'recording') return
  s.stoppedAt = Date.now()
  s.phase = 'processing'
  if (fromIsland) post({ type: 'reset' })
  else command({ type: 'stop' })
  // L'îlot ne répond plus (rechargé) : la dictée suivante reste possible.
  s.watchdog = setTimeout(() => {
    if (session === s) session = null
  }, 60_000)
}

function cancelSession(message?: string): void {
  const s = session
  if (!s) return
  if (s.phase === 'recording') command({ type: 'cancel', message })
  clearTimeout(s.watchdog)
  session = null
  post({ type: 'reset' })
}

/** L'îlot n'a pas pu enregistrer ou transcrire (micro refusé, trop court…). */
export function dictationEnded(message?: string): void {
  const s = session
  if (!s) return
  clearTimeout(s.watchdog)
  session = null
  post({ type: 'reset' })
  if (message) notify(message, true)
}

/** Dictée vers Compi (Alt+Maj+V, micro du chat) : le modèle se charge pendant que l'utilisateur parle. */
export function prepareDictation(): void {
  const d = settings.get().dictation
  if (d.engine !== 'whisper' && speechModelFiles(d.engine)) prepareSpeech(d.engine).catch(() => undefined)
}

/** Transcription par sherpa-onnx (le moteur Whisper, lui, tourne dans l'îlot). */
export async function transcribeDictation(audio: Float32Array): Promise<string> {
  const d = settings.get().dictation
  if (d.engine === 'whisper') throw new Error('Moteur Whisper : transcription dans l’îlot.')
  if (!(audio instanceof Float32Array) || audio.length > 16_000 * 130) throw new Error('Son invalide.')
  return transcribeSpeech(d.engine, audio)
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`délai de ${ms / 1000} s`)), ms))])

/**
 * Style Soigné : le cerveau choisi réécrit le texte, sans outils. Un cerveau
 * en ligne seulement si l'utilisateur l'a autorisé. Au moindre doute (délai
 * de 4 s, réponse trop différente), on garde le texte Naturel.
 */
async function polish(text: string): Promise<string | null> {
  if (text.length < 25) return null
  const s = settings.get()
  const brain = defaultBrain(s)
  if (isOnline(brain.provider) && !s.dictation.polishOnline) return null
  const abort = new AbortController()
  try {
    const out = await withTimeout(
      (async () => {
        const { client, model, style } = await clientFor(brain, { effort: 'low' })
        const msg = await client.messages.create(
          { model, ...style(1024), system: POLISH_SYSTEM, messages: [{ role: 'user', content: text }] } as Anthropic.MessageCreateParamsNonStreaming,
          { signal: abort.signal }
        )
        return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      })(),
      4000
    )
    const ok = acceptPolished(text, out)
    if (!ok) log('info', 'dictée partout : style Soigné écarté par le garde-fou')
    return ok
  } catch (e) {
    abort.abort()
    log('info', `dictée partout : style Soigné indisponible (${(e as Error).message})`)
    return null
  }
}

/** Texte transcrit → style, dictionnaire, puis collage (ou demande à Compi). */
export async function deliverDictation(rawText: string): Promise<DictationOutcome> {
  const s = session
  // Annulée entre-temps (Échap, écran verrouillé) : rien n'est écrit.
  if (!s || s.phase !== 'processing') return { kind: 'empty' }
  try {
    const raw = String(rawText ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!raw) {
      notify('Je n’ai rien entendu. Parle un peu plus près du micro.')
      return { kind: 'empty' }
    }
    await withTimeout(s.targetReady, 3000).catch(() => undefined)
    const d = settings.get().dictation
    if (d.compiPrefix) {
      const request = compiRequest(raw)
      if (request) return { kind: 'compi', request }
    }
    const style = styleFor(s.target?.process, d.appStyles, d.style)
    let text = style === 'raw' ? raw : cleanNatural(raw)
    if (style === 'polished') text = (await polish(text)) ?? text
    text = applyDictionary(text, d.dictionary)
    const words = wordCount(text)
    const app = appLabel(s.target)
    recordDictation({
      app: (s.target?.process ?? '').replace(/\.exe$/i, '').toLowerCase() || 'autre',
      words,
      speakingMs: Math.max(0, s.stoppedAt - s.startedAt)
    })
    const r = await pasteDictation(s.target, text)
    if (r.ok) return { kind: 'pasted', words, app }
    if (r.reason === 'error' || !s.target) await copyDictation(text)
    const why = r.reason === 'keys' ? 'Des touches étaient encore enfoncées.' : r.reason === 'moved' ? 'La fenêtre a changé.' : 'Collage impossible.'
    notify(`${why} Texte copié : Ctrl+V pour le coller.`)
    if (r.reason === 'error') log('warn', `dictée partout : collage impossible (${r.message ?? ''})`)
    return { kind: 'copied', words, reason: why }
  } catch (e) {
    log('warn', 'dictée partout', (e as Error).message)
    return { kind: 'error', message: (e as Error).message }
  } finally {
    clearTimeout(s.watchdog)
    if (session === s) session = null
  }
}
