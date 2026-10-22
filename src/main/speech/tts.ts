// Voix naturelle : lit les réponses à voix haute avec Supertonic 3, sur le PC,
// dans un processus à part (« Compi - lecture ») lancé au premier morceau et
// arrêté après 3 minutes sans lecture pour rendre la mémoire. Un morceau à la
// fois ; un moteur muet est arrêté, et l'appelant repasse par la voix de
// Windows. Le texte n'est jamais journalisé.

import { join } from 'node:path'
import { utilityProcess, type UtilityProcess } from 'electron'
import { naturalLang, naturalVoiceSid } from '../../shared/naturalVoice'
import { log } from '../log'
import { speechModelFiles } from './models'
import type { SpeechRequest, SpeechResponse } from './protocol'
import { wavFromSamples } from './wav'

const IDLE_MS = 3 * 60_000
/** Premier morceau : le moteur se charge (~1 s) en plus du calcul. */
const FIRST_TIMEOUT_MS = 45_000
const TIMEOUT_MS = 30_000

type Audio = Extract<SpeechResponse, { type: 'audio' }>

let child: UtilityProcess | null = null
let warm = false
let nextId = 1
let idleTimer: NodeJS.Timeout | undefined
let pending: { id: number; resolve: (r: Audio) => void; reject: (e: Error) => void; timer: NodeJS.Timeout } | null = null
/** Les morceaux passent l'un après l'autre (le suivant se prépare pendant la lecture du précédent). */
let queue: Promise<unknown> = Promise.resolve()

function fail(message: string): void {
  const p = pending
  pending = null
  if (!p) return
  clearTimeout(p.timer)
  p.reject(new Error(message))
}

function ensureChild(): UtilityProcess {
  if (child) return child
  const c = utilityProcess.fork(join(__dirname, 'speechWorker.js'), [], { serviceName: 'Compi - lecture', stdio: 'ignore' })
  c.on('message', (r: SpeechResponse) => {
    const p = pending
    if (!p || p.id !== r.id) return
    pending = null
    clearTimeout(p.timer)
    if (r.type === 'audio') p.resolve(r)
    else p.reject(new Error(r.type === 'error' ? r.message : 'Réponse inattendue du moteur.'))
  })
  c.on('exit', (code) => {
    if (child !== c) return
    child = null
    warm = false
    if (code !== 0 || pending) log('warn', `voix naturelle : moteur arrêté (code ${code})`)
    fail('Le moteur de la voix naturelle s’est arrêté.')
  })
  child = c
  return c
}

function send(msg: Omit<Extract<SpeechRequest, { type: 'speak' }>, 'id'>): Promise<Audio> {
  const c = ensureChild()
  const id = nextId++
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending = null
        reject(new Error('La voix naturelle met trop de temps.'))
        // Un moteur muet est arrêté : le prochain morceau repart sur un processus neuf.
        unloadNaturalSpeech()
      },
      warm ? TIMEOUT_MS : FIRST_TIMEOUT_MS
    )
    pending = { id, resolve, reject, timer }
    c.postMessage({ ...msg, id } as SpeechRequest)
  })
}

function touch(): void {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (pending) return touch()
    log('info', 'voix naturelle : moteur libéré (3 min sans lecture)')
    unloadNaturalSpeech()
  }, IDLE_MS)
}

/**
 * Un morceau dit par la voix naturelle (fichier WAV en mémoire), ou `null` si elle
 * ne peut pas le lire (pack pas téléchargé, tamoul…) : la voix de Windows prend le relais.
 */
export function naturalSpeech(text: string, voice: string, rate: number): Promise<Buffer | null> {
  const t = text.trim().slice(0, 1000)
  if (!t) return Promise.resolve(Buffer.alloc(0))
  const lang = naturalLang(t)
  const files = speechModelFiles('supertonic')
  if (!lang || !files) return Promise.resolve(null)
  const speed = Number.isFinite(rate) && rate >= 0.5 && rate <= 2 ? rate : 1
  const run = async (): Promise<Buffer> => {
    touch()
    const r = await send({ type: 'speak', files, text: t, sid: naturalVoiceSid(voice), lang, speed })
    warm = true
    if (r.loadMs !== undefined) log('info', `voix naturelle : moteur chargé en ${r.loadMs} ms`)
    touch()
    return wavFromSamples(r.samples, r.sampleRate)
  }
  const result = queue.then(run, run)
  queue = result.catch(() => undefined)
  return result
}

/** Arrête le processus de la voix naturelle (mémoire rendue, fichiers libérés). */
export function unloadNaturalSpeech(): void {
  clearTimeout(idleTimer)
  const c = child
  child = null
  warm = false
  fail('Lecture interrompue.')
  c?.kill()
}
