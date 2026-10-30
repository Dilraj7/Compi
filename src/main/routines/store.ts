// Routines : une demande à Compi, exécutée sans l'utilisateur à heure fixe
// (« chaque lundi à 9 h, résume mes e-mails ») ou sur un événement (premier allumage
// du jour, fin d'un rendez-vous, nouveau message). Même planification que les
// rappels ; une seule routine tourne à la fois. Enregistrées dans
// userData/routines.json, replanifiées au démarrage.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import {
  canFire,
  cleanDraft,
  messageMatches,
  missedAction,
  recentFires,
  ROUTINES_MAX,
  routinePreview,
  triggerLabel,
  validRepeat,
  validTrigger
} from '../../shared/routines'
import type { Routine, RoutineDraft, RoutineRun, RoutineTrigger } from '../../shared/types'
import { emit } from '../bus'
import { nextOccurrence } from '../day/reminders'
import { events, type MeetingEnded, type MessageArrived } from '../events'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'
import { toastSilent } from '../store/settings'

/** Ce qui a lancé une routine sur événement : une phrase pour le modèle, et si elle vient d'ailleurs. */
export interface RoutineFiring {
  text: string
  /** Écrit par d'autres (titre d'un rendez-vous, nom d'un expéditeur) : rien ne sortira du PC ensuite. */
  external: boolean
}

export type RoutineRunner = (
  r: Routine,
  onStart: (conversationId: string) => void,
  firing?: RoutineFiring
) => Promise<{ conversationId?: string; text: string; error?: string }>

const file = (): string => join(app.getPath('userData'), 'routines.json')
const timers = new Map<string, NodeJS.Timeout>()
const running = new Set<string>()
/** Routine en cours → sa discussion (pour pouvoir l'arrêter). */
const active = new Map<string, string>()
const stopped = new Set<string>()
const queue: Array<{ id: string; firing?: RoutineFiring }> = []
let runner: RoutineRunner | null = null
let stopper: ((conversationId: string) => void) | null = null
let draining = false

const load = (): Routine[] => {
  const raw = readJson<unknown>(file(), [])
  return Array.isArray(raw)
    ? (raw as Routine[]).filter(
        (r) => r && typeof r.id === 'string' && typeof r.prompt === 'string' && (r.trigger ? validTrigger(r.trigger) : validRepeat(r.repeat))
      )
    : []
}

export const listRoutines = (): Routine[] =>
  load()
    .map((r) => (running.has(r.id) ? { ...r, running: true } : r))
    // Actives d'abord ; à heure fixe par prochaine échéance, puis celles sur événement.
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || Number(Boolean(a.trigger)) - Number(Boolean(b.trigger)) || a.nextAt - b.nextAt)

const changed = (): void => emit(IPC.routinesChanged, listRoutines())

function persist(list: Routine[]): void {
  writeJson(file(), list)
  changed()
  events.emit('routines-changed')
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
    Object.assign(r, { title: clean.title, prompt: clean.prompt, enabled: clean.enabled ?? true })
    if (clean.trigger) {
      if (JSON.stringify(r.trigger) !== JSON.stringify(clean.trigger)) delete r.fired
      r.trigger = clean.trigger
      delete r.repeat
      r.nextAt = 0
    } else if (clean.repeat) {
      r.repeat = clean.repeat
      delete r.trigger
      delete r.fired
      if (timing || !r.nextAt) r.nextAt = nextOccurrence(r.repeat, now)
    }
    if (clean.allow) {
      if (clean.allow.length) r.allow = clean.allow
      else delete r.allow
    }
    persist(list)
    schedule(r)
    return r
  }
  if (list.length >= ROUTINES_MAX) throw new Error(`${ROUTINES_MAX} routines au maximum : supprimes-en une d’abord.`)
  const r: Routine = {
    id: randomUUID(),
    title: clean.title,
    prompt: clean.prompt,
    ...(clean.trigger ? { trigger: clean.trigger } : { repeat: clean.repeat }),
    enabled: true,
    nextAt: clean.repeat ? nextOccurrence(clean.repeat, now) : 0,
    createdAt: now,
    ...(clean.allow?.length ? { allow: clean.allow } : {})
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
  const i = queue.findIndex((q) => q.id === id)
  if (i >= 0) queue.splice(i, 1)
  persist(list.filter((r) => r.id !== id))
  return true
}

function schedule(r: Routine): void {
  clearTimeout(timers.get(r.id))
  timers.delete(r.id)
  // Sur événement : pas de minuteur, ce sont les événements qui la lancent.
  if (!r.enabled || !r.repeat) return
  // setTimeout est limité à ~24,8 jours : on replanifie par étapes.
  const step = Math.min(Math.max(0, r.nextAt - Date.now()), 2 ** 31 - 1)
  timers.set(
    r.id,
    setTimeout(() => {
      timers.delete(r.id)
      const current = load().find((x) => x.id === r.id)
      if (!current?.enabled || !current.repeat) return
      if (Date.now() >= current.nextAt) enqueue(current.id)
      else schedule(current)
    }, step)
  )
}

function enqueue(id: string, firing?: RoutineFiring): void {
  if (running.has(id) || queue.some((q) => q.id === id)) return
  queue.push({ id, firing })
  void drain()
}

async function drain(): Promise<void> {
  if (draining) return
  draining = true
  try {
    while (queue.length) {
      const next = queue.shift()!
      await execute(next.id, next.firing)
    }
  } finally {
    draining = false
  }
}

async function execute(id: string, firing?: RoutineFiring): Promise<void> {
  const r = load().find((x) => x.id === id)
  if (!r || !runner) return
  running.add(id)
  changed()
  let run: RoutineRun
  try {
    const res = await runner(r, (conversationId) => active.set(id, conversationId), firing)
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
    if (current.repeat && current.nextAt <= Date.now()) current.nextAt = nextOccurrence(current.repeat, Date.now())
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

/** « Lancer maintenant » (n'avance pas la prochaine échéance, ne compte pas dans les limites). */
export function runRoutineNow(id: string): Routine[] {
  if (load().some((r) => r.id === id)) enqueue(id)
  return listRoutines()
}

/** Arrête la routine en cours (bouton « Arrêter »), ou la retire de la file d'attente. */
export function stopRoutineRun(id: string): Routine[] {
  const i = queue.findIndex((q) => q.id === id)
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
    if (!r.enabled || !r.repeat) continue
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

// ─── Routines sur événement ──────────────────────────────────────────────────

/** Une routine active attend cet événement (les sources ne suivent que ce qui sert). */
export const wantsTrigger = (on: RoutineTrigger['on']): boolean => load().some((r) => r.enabled && r.trigger?.on === on)

/** Lance les routines qui attendent cet événement, dans les limites de fréquence. */
function fire(on: RoutineTrigger['on'], matches: (t: RoutineTrigger) => boolean, firing: RoutineFiring): void {
  const list = load()
  const now = Date.now()
  const due = list.filter((r) => r.enabled && r.trigger?.on === on && matches(r.trigger) && !running.has(r.id) && canFire(r.trigger, r.fired, now))
  if (!due.length) return
  for (const r of due) r.fired = [...recentFires(r.fired, now), now]
  persist(list)
  for (const r of due) {
    log('info', `routine « ${r.title} » lancée : ${triggerLabel(r.trigger!)}`)
    enqueue(r.id, firing)
  }
}

const hhmm = (iso: string): string => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Écoute les événements du PC (une fois, au démarrage). */
export function startRoutineTriggers(): void {
  events.on('present', () =>
    fire('morning', () => true, {
      text: `Premier allumage du jour, à ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
      external: false
    })
  )
  events.on('meeting-end', (m: MeetingEnded) =>
    fire('meeting-end', () => true, {
      text: `Fin du rendez-vous « ${clip(m.title.replace(/\s+/g, ' '), 120)} » (${hhmm(m.start)}–${hhmm(m.end)}).`,
      external: true
    })
  )
  events.on('message', (m: MessageArrived) =>
    fire('message', (t) => messageMatches(t, m), {
      text: `Nouveau message de « ${clip(m.sender.replace(/\s+/g, ' '), 80)} » sur ${m.app}, à ${new Date(m.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`,
      external: true
    })
  )
}

/** Liste lisible pour le modèle. */
export function formatRoutines(list: Routine[], label: (r: NonNullable<Routine['repeat']>) => string): string {
  if (!list.length) return 'Aucune routine.'
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return list
    .map((r) => {
      const when = r.trigger ? triggerLabel(r.trigger) : r.repeat ? label(r.repeat) : ''
      const next = !r.enabled ? ' · en pause' : r.repeat ? ` · prochaine : ${fmt.format(new Date(r.nextAt))}` : ''
      return `- [${r.id}] « ${r.title} » · ${when}${next} · demande : ${r.prompt.slice(0, 160)}`
    })
    .join('\n')
}
