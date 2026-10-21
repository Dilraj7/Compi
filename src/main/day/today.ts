// « Ta journée » : agenda, e-mails non lus, rappels et météo du jour. Calculé
// sur le PC, sans modèle : rien n'est envoyé à un cerveau en ligne pour ça.
// Le résumé du matin est une notification qui ouvre cette vue.

import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import type { TodayInfo } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'
import { settings } from '../store/settings'
import { unreadInbox } from '../google/gmail'
import { agendaActive, agendaEvents } from './agenda'
import { listReminders } from './reminders'
import { forecast } from './weather'
import { pendingCount } from '../messages/watch'

const pad = (n: number): string => String(n).padStart(2, '0')
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export async function buildToday(now = new Date()): Promise<TodayInfo> {
  const s = settings.get()
  const errors: string[] = []
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const fail = (what: string) => (e: unknown) => {
    errors.push(`${what} : ${(e as Error).message}`)
    return undefined
  }
  const [agenda, unread, weather] = await Promise.all([
    agendaEvents({ from: start, to: end }),
    s.google.mail ? unreadInbox(5).catch(fail('E-mails')) : Promise.resolve(undefined),
    s.day.city && s.day.cityLat != null && s.day.cityLon != null
      ? forecast({ label: s.day.city, lat: s.day.cityLat, lon: s.day.cityLon })
          .then((d) => d[0])
          .catch(fail('Météo'))
      : Promise.resolve(undefined)
  ])
  errors.unshift(...agenda.errors)
  return {
    date: localDate(now),
    google: { email: s.google.email, calendar: s.google.calendar, mail: s.google.mail },
    agenda: agendaActive(),
    events: agenda.events,
    unread: unread && {
      count: unread.total,
      latest: unread.mails.map((m) => ({ id: m.id, from: m.from, subject: m.subject, date: m.date, important: m.important }))
    },
    reminders: listReminders().filter((r) => r.dueAt < end.getTime()),
    weather: weather && { city: weather.city, label: weather.label, min: weather.min, max: weather.max, rain: weather.rain },
    errors
  }
}

/** Phrase du résumé du matin (pure, testée). */
export function morningLine(t: TodayInfo, name: string, now = new Date(), waiting = 0): string {
  const nowMs = now.getTime()
  const upcoming = t.events.filter((e) => e.allDay || new Date(e.end).getTime() > nowMs)
  const bits = [
    t.agenda ? (upcoming.length ? `${upcoming.length} rendez-vous` : 'aucun rendez-vous') : '',
    t.unread ? `${t.unread.count} e-mail${t.unread.count > 1 ? 's' : ''} non lu${t.unread.count > 1 ? 's' : ''}` : '',
    t.reminders.length ? `${t.reminders.length} rappel${t.reminders.length > 1 ? 's' : ''}` : '',
    // Messages en attente : seulement le nombre (l'îlot est visible de tous).
    waiting ? `${waiting} message${waiting > 1 ? 's' : ''} en attente` : '',
    t.weather ? `${t.weather.label.toLowerCase()}, ${t.weather.max} °C` : ''
  ].filter(Boolean)
  return `Bonjour${name ? ` ${name}` : ''} ! ${bits.length ? bits.join(' · ') : 'Rien de prévu aujourd’hui.'}`
}

// ─── Résumé du matin ─────────────────────────────────────────────────────────

const stateFile = (): string => join(app.getPath('userData'), 'day-state.json')
let morningTimer: NodeJS.Timeout | undefined

async function checkMorning(): Promise<void> {
  const s = settings.get()
  const configured = agendaActive() || s.google.mail || Boolean(s.day.city)
  if (!s.day.morning || !configured) return
  const now = new Date()
  const [h, m] = s.day.morningTime.split(':').map(Number)
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
  // Entre l'heure choisie et midi, une fois par jour (le PC peut s'allumer plus tard).
  if (now < at || now.getHours() >= 12) return
  const state = readJson<{ lastMorning?: string }>(stateFile(), {})
  const today = localDate(now)
  if (state.lastMorning === today) return
  writeJson(stateFile(), { ...state, lastMorning: today })
  try {
    const t = await buildToday(now)
    emit(IPC.islandNotify, { pill: 'today', text: morningLine(t, s.userName, now, s.messages.enabled ? pendingCount() : 0), duration: 15_000, view: 'today' })
  } catch (e) {
    log('warn', `Résumé du matin : ${(e as Error).message}`)
  }
}

/** Vérifie chaque minute s'il est l'heure du résumé du matin. */
export function startMorning(): void {
  clearInterval(morningTimer)
  setTimeout(() => void checkMorning(), 20_000)
  morningTimer = setInterval(() => void checkMorning(), 60_000)
}
