// Alerte avant chaque réunion de l'agenda (Google et les sources ajoutées), avec
// un bouton « Rejoindre » quand l'événement a un lien de visio reconnu. L'agenda
// est relu toutes les 5 minutes ; rien n'est envoyé à un cerveau.

import { Notification, shell } from 'electron'
import { IPC } from '../../shared/ipc'
import type { DayEvent } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { sendIslandCommand } from '../notchWindow'
import { settings, toastSilent } from '../store/settings'
import { isTimedMeeting } from '../../shared/agenda'
import { agendaActive, agendaEvents } from './agenda'

const POLL_MS = 5 * 60_000
const timers = new Map<string, NodeJS.Timeout>()
/** Réunions déjà annoncées (id + début), pour ne pas répéter l'alerte. */
const alerted = new Set<string>()
let poll: NodeJS.Timeout | undefined
/** Rendez-vous lus au dernier passage (pour savoir si une réunion est en cours). */
let known: DayEvent[] = []

/** Une réunion (pas un événement « journée entière ») est en cours. */
export function inMeeting(now = Date.now()): boolean {
  return known.some((e) => isTimedMeeting(e) && Date.parse(e.start) <= now && now < Date.parse(e.end))
}

const keyOf = (e: DayEvent): string => `${e.id}|${e.start}`

function alert(e: DayEvent): void {
  const key = keyOf(e)
  timers.delete(key)
  if (alerted.has(key)) return
  alerted.add(key)
  const minutes = Math.max(0, Math.round((new Date(e.start).getTime() - Date.now()) / 60_000))
  const when = minutes <= 0 ? 'commence maintenant' : `dans ${minutes} min`
  const text = `${e.title} ${when}`
  emit(IPC.islandNotify, {
    pill: 'meeting',
    text,
    duration: 60_000,
    view: 'today',
    ...(e.meetUrl ? { action: { label: 'Rejoindre', url: e.meetUrl } } : {})
  })
  const n = new Notification({ title: 'Réunion', body: e.meetUrl ? `${text} · clique pour rejoindre` : text, silent: toastSilent() })
  n.on('click', () => {
    if (e.meetUrl) void shell.openExternal(e.meetUrl)
    else sendIslandCommand('open-today')
  })
  n.show()
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
  if (!agendaActive() || !s.day.meetingAlerts) return
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
  for (const e of events) {
    const delay = alertDelay(e, s.day.meetingMinutes)
    const key = keyOf(e)
    if (delay === null || alerted.has(key)) continue
    wanted.add(key)
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => alert(e), delay)
    )
  }
  // Réunions déplacées ou supprimées : on oublie leur minuteur.
  for (const [key, t] of timers) {
    if (!wanted.has(key)) {
      clearTimeout(t)
      timers.delete(key)
    }
  }
}

export function startMeetings(): void {
  stopMeetings()
  const s = settings.get()
  if (!agendaActive() || !s.day.meetingAlerts) return
  setTimeout(() => void refresh(), 15_000)
  poll = setInterval(() => void refresh(), POLL_MS)
}

export function stopMeetings(): void {
  clearInterval(poll)
  poll = undefined
  known = []
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
}
