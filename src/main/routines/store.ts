// Routines : une demande à Compi, exécutée sans l'utilisateur à heure fixe
// (« chaque lundi à 9 h, résume mes e-mails »). Même planification que les
// rappels ; une seule routine tourne à la fois. Enregistrées dans
// userData/routines.json, replanifiées au démarrage.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import { cleanDraft, missedAction, ROUTINES_MAX, routinePreview, validRepeat } from '../../shared/routines'
import type { Routine, RoutineDraft, RoutineRun } from '../../shared/types'
import { emit } from '../bus'
import { nextOccurrence } from '../day/reminders'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'
import { toastSilent } from '../store/settings'

export type RoutineRunner = (r: Routine, onStart: (conversationId: string) => void) => Promise<{ conversationId?: string; text: string; error?: string }>

const file = (): string => join(app.getPath('userData'), 'routines.json')
const timers = new Map<string, NodeJS.Timeout>()
const running = new Set<string>()
/** Routine en cours → sa discussion (pour pouvoir l'arrêter). */
const active = new Map<string, string>()
const stopped = new Set<string>()
const queue: string[] = []
let runner: RoutineRunner | null = null
let stopper: ((conversationId: string) => void) | null = null
let draining = false

const load = (): Routine[] => {
  const raw = readJson<unknown>(file(), [])
  return Array.isArray(raw) ? (raw as Routine[]).filter((r) => r && typeof r.id === 'string' && typeof r.prompt === 'string' && validRepeat(r.repeat)) : []
}

export const listRoutines = (): Routine[] =>
  load()
    .map((r) => (running.has(r.id) ? { ...r, running: true } : r))
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nextAt - b.nextAt)

const changed = (): void => emit(IPC.routinesChanged, listRoutines())

function persist(list: Routine[]): void {
  writeJson(file(), list)
  changed()
}

/** Branché au démarrage par l'agent (évite une dépendance circulaire). */
export function setRoutineRunner(fn: RoutineRunner, stop: (conversationId: string) => void): void {
  runner = fn
  stopper = stop
}

export function saveRoutine(d: RoutineDraft): Routine {
  const clean = cleanDraft(d)
  const list = load()
  const now = Date.now()
  if (clean.id) {
    const r = list.find((x) => x.id === clean.id)
    if (!r) throw new Error('Routine introuvable.')
    const timing = JSON.stringify(r.repeat) !== JSON.stringify(clean.repeat) || r.enabled !== clean.enabled
    Object.assign(r, { title: clean.title, prompt: clean.prompt, repeat: clean.repeat, enabled: clean.enabled ?? true })
    if (timing) r.nextAt = nextOccurrence(r.repeat, now)
    persist(list)
    schedule(r)
    return r
  }
  if (list.length >= ROUTINES_MAX) throw new Error(`${ROUTINES_MAX} routines au maximum : supprimes-en une d’abord.`)
  const r: Routine = {
    id: randomUUID(),
    title: clean.title,
    prompt: clean.prompt,
    repeat: clean.repeat,
    enabled: true,
    nextAt: nextOccurrence(clean.repeat, now),
    createdAt: now
  }
  persist([...list, r])
  schedule(r)
  return r
}

export function deleteRoutine(id: string): boolean {
  const list = load()
  if (!list.some((r) => r.id === id)) return false
  clearTimeout(timers.get(id))
  timers.delete(id)
  const i = queue.indexOf(id)
  if (i >= 0) queue.splice(i, 1)
  persist(list.filter((r) => r.id !== id))
  return true
}

function schedule(r: Routine): void {
  clearTimeout(timers.get(r.id))
  timers.delete(r.id)
  if (!r.enabled) return
  // setTimeout est limité à ~24,8 jours : on replanifie par étapes.
  const step = Math.min(Math.max(0, r.nextAt - Date.now()), 2 ** 31 - 1)
  timers.set(
    r.id,
    setTimeout(() => {
      timers.delete(r.id)
      const current = load().find((x) => x.id === r.id)
      if (!current?.enabled) return
      if (Date.now() >= current.nextAt) enqueue(current.id)
      else schedule(current)
    }, step)
  )
}

function enqueue(id: string): void {
  if (running.has(id) || queue.includes(id)) return
  queue.push(id)
  void drain()
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length) await execute(queue.shift()!)
  } finally {
    draining = false
  }
}

async function execute(id: string): Promise<void> {
  const r = load().find((x) => x.id === id)
  if (!r || !runner) return
  running.add(id)
  changed()
  let run: RoutineRun
  try {
    const res = await runner(r, (conversationId) => active.set(id, conversationId))
    run = {
      at: Date.now(),
      ok: !res.error,
      conversationId: res.conversationId,
      ...(res.error ? { error: res.error } : { preview: routinePreview(res.text) || '(réponse vide)' })
    }
  } catch (e) {
    run = { at: Date.now(), ok: false, error: (e as Error).message }
  } finally {
    running.delete(id)
    active.delete(id)
  }
  const byUser = stopped.delete(id)
  log(run.ok ? 'info' : 'warn', `routine « ${r.title} » : ${run.ok ? 'terminée' : `échec : ${run.error}`}`)
  // La routine a pu être modifiée ou supprimée pendant l'exécution.
  const list = load()
  const current = list.find((x) => x.id === id)
  if (current) {
    current.lastRun = run
    if (current.nextAt <= Date.now()) current.nextAt = nextOccurrence(current.repeat, Date.now())
    persist(list)
    schedule(current)
  } else {
    changed()
  }
  // Arrêtée par l'utilisateur : il le sait déjà, pas de notification.
  if (!byUser) announce(r, run)
}

function announce(r: Routine, run: RoutineRun): void {
  const text = run.ok ? `${r.title} : ${run.preview}` : `${r.title} : ${run.error}`
  const n = new Notification({
    title: run.ok ? `Routine prête : ${r.title}` : `Routine en échec : ${r.title}`,
    body: run.ok ? (run.preview ?? '') : (run.error ?? ''),
    silent: toastSilent()
  })
  if (run.conversationId) n.on('click', () => emit(IPC.openConversation, run.conversationId))
  n.show()
  emit(IPC.islandNotify, {
    pill: run.ok ? 'routine' : 'error',
    text,
    duration: 12_000,
    ...(run.conversationId ? { conversationId: run.conversationId } : { view: 'today' })
  })
}

/** « Lancer maintenant » (n'avance pas la prochaine échéance). */
export function runRoutineNow(id: string): Routine[] {
  if (load().some((r) => r.id === id)) enqueue(id)
  return listRoutines()
}

/** Arrête la routine en cours (bouton « Arrêter »), ou la retire de la file d'attente. */
export function stopRoutineRun(id: string): Routine[] {
  const i = queue.indexOf(id)
  if (i >= 0) queue.splice(i, 1)
  const conversationId = active.get(id)
  if (conversationId && stopper) {
    stopped.add(id)
    stopper(conversationId)
  }
  return listRoutines()
}

/** Au démarrage : replanifie, et rattrape une fois ce qui a été manqué pendant que le PC était éteint. */
export function restoreRoutines(): void {
  const now = Date.now()
  const list = load()
  let late = 0
  for (const r of list) {
    if (!r.enabled) continue
    const action = missedAction(r.nextAt, now)
    if (action === 'catch-up') {
      // Laisse Compi (et le cerveau local) démarrer avant de lancer quoi que ce soit.
      setTimeout(() => enqueue(r.id), 90_000 + late++ * 5_000)
    } else {
      if (action === 'skip') r.nextAt = nextOccurrence(r.repeat, now)
      schedule(r)
    }
  }
  writeJson(file(), list)
}

export function stopRoutines(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  queue.length = 0
}

/** Liste lisible pour le modèle. */
export function formatRoutines(list: Routine[], label: (r: Routine['repeat']) => string): string {
  if (!list.length) return 'Aucune routine.'
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return list
    .map(
      (r) =>
        `- [${r.id}] « ${r.title} » · ${label(r.repeat)}${r.enabled ? ` · prochaine : ${fmt.format(new Date(r.nextAt))}` : ' · en pause'} · demande : ${r.prompt.slice(0, 160)}`
    )
    .join('\n')
}
