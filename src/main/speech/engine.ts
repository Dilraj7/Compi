// Moteur de la dictée partout : lance le processus annexe sherpa-onnx à la
// première dictée, y charge le modèle (pendant que l'utilisateur parle), puis
// l'arrête après 10 minutes sans dictée pour rendre la mémoire (~800 Mo).
// Chaque demande a un délai : au-delà, le processus est arrêté et la dictée
// échoue proprement, sans jamais bloquer Compi.

import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { SPEECH_MODELS } from '../../shared/speechModels'
import type { SpeechModelId } from '../../shared/types'
import { log } from '../log'
import { speechModelFiles } from './models'
import type { SpeechRequest, SpeechResponse } from './protocol'

const IDLE_MS = 10 * 60_000
const LOAD_TIMEOUT_MS = 90_000

let child: UtilityProcess | null = null
let loaded: SpeechModelId | null = null
let loading: { model: SpeechModelId; promise: Promise<void> } | null = null
let nextId = 1
let idleTimer: NodeJS.Timeout | undefined
const pending = new Map<number, { resolve: (r: SpeechResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

type NoId<T> = T extends unknown ? Omit<T, 'id'> : never

function failAll(message: string): void {
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(new Error(message))
  }
  pending.clear()
}

function ensureChild(): UtilityProcess {
  if (child) return child
  const c = utilityProcess.fork(join(__dirname, 'speechWorker.js'), [], { serviceName: 'Compi - dictée', stdio: 'ignore' })
  c.on('message', (r: SpeechResponse) => {
    const p = pending.get(r.id)
    if (!p) return
    pending.delete(r.id)
    clearTimeout(p.timer)
    if (r.type === 'error') p.reject(new Error(r.message))
    else p.resolve(r)
  })
  c.on('exit', (code) => {
    if (child !== c) return
    child = null
    loaded = null
    loading = null
    if (code !== 0 || pending.size) log('warn', `dictée partout : moteur arrêté (code ${code})`)
    failAll('Le moteur de dictée s’est arrêté. Réessaie.')
  })
  child = c
  return c
}

function request(msg: NoId<SpeechRequest>, timeoutMs: number): Promise<SpeechResponse> {
  const c = ensureChild()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('La dictée met trop de temps : moteur relancé, réessaie.'))
      // Un moteur muet est arrêté : la prochaine dictée repart sur un processus neuf.
      unloadSpeech()
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    c.postMessage({ ...msg, id } as SpeechRequest)
  })
}

function touch(): void {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (pending.size) return touch()
    log('info', 'dictée partout : moteur libéré (10 min sans dictée)')
    unloadSpeech()
  }, IDLE_MS)
}

/** Charge le modèle (au premier usage, ou après une pause) ; sans effet s'il l'est déjà. */
export function prepareSpeech(model: SpeechModelId): Promise<void> {
  touch()
  if (loaded === model && child) return Promise.resolve()
  if (loading?.model === model) return loading.promise
  const files = speechModelFiles(model)
  if (!files) return Promise.reject(new Error(`Le modèle ${SPEECH_MODELS[model].label} n’est pas téléchargé : Réglages › Me parler.`))
  const promise = request({ type: 'load', model, kind: SPEECH_MODELS[model].kind, files }, LOAD_TIMEOUT_MS).then(
    (r) => {
      loaded = model
      if (loading?.promise === promise) loading = null
      if (r.type === 'ok' && r.ms) log('info', `dictée partout : ${SPEECH_MODELS[model].label} chargé en ${r.ms} ms`)
    },
    (e: Error) => {
      if (loading?.promise === promise) loading = null
      throw e
    }
  )
  loading = { model, promise }
  return promise
}

/** Transcrit un son en 16 kHz mono. Le texte n'est jamais journalisé. */
export async function transcribeSpeech(model: SpeechModelId, samples: Float32Array): Promise<string> {
  await prepareSpeech(model)
  const seconds = samples.length / 16_000
  const r = await request({ type: 'transcribe', samples }, 20_000 + seconds * 1000)
  touch()
  if (r.type !== 'text') return ''
  log('info', `dictée partout : ${seconds.toFixed(1)} s de parole transcrites en ${r.ms} ms`)
  return r.text
}

/** Arrête le processus annexe (mémoire rendue). */
export function unloadSpeech(): void {
  clearTimeout(idleTimer)
  const c = child
  child = null
  loaded = null
  loading = null
  failAll('Dictée interrompue.')
  c?.kill()
}
