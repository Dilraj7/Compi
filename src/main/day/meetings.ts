// Alerte avant chaque réunion de l'agenda (Google et les sources ajoutées), avec
// un bouton « Rejoindre » quand l'événement a un lien de visio reconnu, et, si
// l'utilisateur l'a choisi, « Préparer » un peu avant (réunion avec d'autres
// personnes). Signale aussi la fin de chaque rendez-vous aux routines qui l'attendent.
// L'agenda est relu toutes les 5 minutes ; rien n'est envoyé à un cerveau.

import { Notification, shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { DayEvent } from '../../shared/types'
import { emit } from '../bus'
import { events as pcEvents } from '../events'
import { log } from '../log'
import { wantsTrigger } from '../routines/store'
import { sendIslandCommand } from '../notchWindow'
import { settings, toastSilent } from '../store/settings'
import { isTimedMeeting } from '../../shared/agenda'
import { isPreparable, prepDelay, prepKey } from '../../shared/meetingPrep'
import { agendaActive, agendaEvents } from './agenda'

const POLL_MS = 5 * 60_000
const timers = new Map<string, NodeJS.Timeout>()
/** Réunions déjà annoncées (id + début), pour ne pas répéter l'alerte. */
const alerted = new Set<string>()
/** Préparations proposées, et leurs minuteurs. */
const prepTimers = new Map<string, NodeJS.Timeout>()
const prepared = new Set<string>()
/** Fins de rendez-vous attendues par une routine, et celles déjà signalées. */
const endTimers = new Map<string, NodeJS.Timeout>()
const ended = new Set<string>()
let poll: NodeJS.Timeout | undefined
/** Rendez-vous lus au dernier passage (pour savoir si une réunion est en cours). */
let known: DayEvent[] = []

/** Une réunion (pas un événement « journée entière ») est en cours. */
export function inMeeting(now = Date.now()): boolean {
  return known.some((e) => isTimedMeeting(e) && Date.parse(e.start) <= now && now < Date.parse(e.end))
}

const keyOf = prepKey

function whenOf(e: DayEvent): string {
  const minutes = Math.max(0, Math.round((new Date(e.start).getTime() - Date.now()) / 60_000))
  return minutes <= 0 ? 'commence maintenant' : `dans ${minutes} min`
}

/** Réunion avec d'autres personnes, un peu avant : « Préparer » ouvre ce qu'il faut savoir (Aujourd'hui). */
function prepare(e: DayEvent): void {
  const key = keyOf(e)
  prepTimers.delete(key)
  if (prepared.has(key)) return
  prepared.add(key)
  emit(IPC.islandNotify, { pill: 'meeting', text: `${e.title} ${whenOf(e)}`, duration: 60_000, view: 'today', action: { label: 'Préparer', prep: key } })
}

function alert(e: DayEvent): void {
  const key = keyOf(e)
  timers.delete(key)
  if (alerted.has(key)) return
  alerted.add(key)
  const text = `${e.title} ${whenOf(e)}`
  // Sans lien de visio, l'alerte peut porter « Préparer » (quand les deux tombent au même moment).
  const action = e.meetUrl
    ? { label: 'Rejoindre', url: e.meetUrl }
    : settings.get().day.meetingPrep && isPreparable(e)
      ? { label: 'Préparer', prep: key }
      : undefined
  emit(IPC.islandNotify, { pill: 'meeting', text, duration: 60_000, view: 'today', ...(action ? { action } : {}) })
  const n = new Notification({ title: 'Réunion', body: e.meetUrl ? `${text} · clique pour rejoindre` : text, silent: toastSilent() })
  n.on('click', () => {
    if (e.meetUrl) void shell.openExternal(e.meetUrl)
    else sendIslandCommand('open-today')
  })
  n.show()
}

/** Fin d'un rendez-vous (une minute après) : délai, ou `null` s'il est déjà fini ou pas une réunion. */
export function endDelay(e: DayEvent, now = Date.now()): number | null {
  if (!isTimedMeeting(e)) return null
  const end = Date.parse(e.end) + 60_000
  return end > now ? end - now : null
}

function meetingEnded(e: DayEvent): void {
  const key = keyOf(e)
  endTimers.delete(key)
  if (ended.has(key)) return
  ended.add(key)
  pcEvents.emit('meeting-end', { key, title: e.title, start: e.start, end: e.end })
}

/** Le suivi de l'agenda sert à quelque chose : alertes, préparation ou routine « fin de rendez-vous ». */
const watching = (): boolean => {
  const s = settings.get()
  return agendaActive() && (s.day.meetingAlerts || s.day.meetingPrep || wantsTrigger('meeting-end'))
}

/** Prochaines réunions → minuteurs (pur dans son calcul : testé via `alertDelay`). */
export function alertDelay(e: DayEvent, minutesBefore: number, now = Date.now()): number | null {
  // Journée entière ou échéance ponctuelle (une tâche à rendre) : pas une réunion.
  if (!isTimedMeeting(e)) return null
  const start = new Date(e.start).getTime()
  if (start <= now - 60_000) return null
  return Math.max(0, start - minutesBefore * 60_000 - now)
}

async function refresh(): Promise<void> {
  const s = settings.get()
  if (!watching()) return
  const endings = wantsTrigger('meeting-end')
  const now = Date.now()
  const r = await agendaEvents({ from: new Date(now - 60_000), to: new Date(now + 3 * 3600_000) })
  // Connexion Google perdue et aucune autre source : on arrête (l'interface propose de se reconnecter).
  if (r.googleAuthLost && !s.agenda.sources.some((x) => x.enabled)) {
    stopMeetings()
    return
  }
  if (r.errors.length && !r.events.length) log('warn', `Alertes de réunion : ${r.errors.join(' ; ')}`)
  const events: DayEvent[] = r.events
  known = events
  const wanted = new Set<string>()
  const wantedPrep = new Set<string>()
  const wantedEnd = new Set<string>()
  for (const e of events) {
    const key = keyOf(e)
    const end = endings ? endDelay(e, now) : null
    if (end !== null && !ended.has(key)) {
      wantedEnd.add(key)
      clearTimeout(endTimers.get(key))
      endTimers.set(
        key,
        setTimeout(() => meetingEnded(e), end)
      )
    }
    const delay = s.day.meetingAlerts ? alertDelay(e, s.day.meetingMinutes) : null
    if (delay !== null && !alerted.has(key)) {
      wanted.add(key)
      clearTimeout(timers.get(key))
      timers.set(
        key,
        setTimeout(() => alert(e), delay)
      )
    }
    // Préparation : sauf si l'alerte tombe au même moment (elle garde « Rejoindre » ; « Préparer » reste dans Aujourd'hui).
    const prep = s.day.meetingPrep ? prepDelay(e, s.day.prepMinutes, now) : null
    if (prep === null || prepared.has(key) || (delay !== null && Math.abs(prep - delay) < 2 * 60_000)) continue
    wantedPrep.add(key)
    clearTimeout(prepTimers.get(key))
    prepTimers.set(
      key,
      setTimeout(() => prepare(e), prep)
    )
  }
  // Réunions déplacées ou supprimées : on oublie leur minuteur.
  for (const [list, keep] of [
    [timers, wanted],
    [prepTimers, wantedPrep],
    [endTimers, wantedEnd]
  ] as const) {
    for (const [key, t] of list) {
      if (!keep.has(key)) {
        clearTimeout(t)
        list.delete(key)
      }
    }
  }
}

export function startMeetings(): void {
  stopMeetings()
  if (!watching()) return
  setTimeout(() => void refresh(), 15_000)
  poll = setInterval(() => void refresh(), POLL_MS)
}

export function stopMeetings(): void {
  clearInterval(poll)
  poll = undefined
  known = []
  for (const t of [...timers.values(), ...prepTimers.values(), ...endTimers.values()]) clearTimeout(t)
  timers.clear()
  prepTimers.clear()
  endTimers.clear()
}
