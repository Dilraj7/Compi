// Les 7 prochains jours du plein écran (aujourd'hui compris) : rendez-vous, rappels,
// tâches à échéance et météo, rangés jour par jour. Fonctions pures, testées dans
// tests/week.test.ts. Les jours sont locaux ; les calculs de jours passent par
// `addDays` (UTC), sans piège d'heure d'été.

import { addDays } from './tasks'
import type { DayEvent, DayWeather, Reminder, TaskItem, WeekDay } from './types'

export const WEEK_DAYS = 7

/** Minuit local du jour « AAAA-MM-JJ », en millisecondes. */
export const dayStartMs = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

/** Le rendez-vous touche-t-il ce jour ? Journée entière : fin exclue. Échéance (sans durée) : son jour. */
export function onDay(e: Pick<DayEvent, 'start' | 'end' | 'allDay'>, day: string): boolean {
  if (e.allDay) {
    const start = e.start.slice(0, 10)
    const end = e.end.slice(0, 10)
    return start <= day && (day < end || (end <= start && day === start))
  }
  const from = dayStartMs(day)
  const to = dayStartMs(addDays(day, 1))
  const s = new Date(e.start).getTime()
  const en = new Date(e.end).getTime()
  if (!(en > s)) return s >= from && s < to
  return s < to && en > from
}

export interface WeekInput {
  events: DayEvent[]
  /** Une entrée par échéance (les répétitions déjà déroulées). */
  reminders: Reminder[]
  tasks: TaskItem[]
  weather: Array<DayWeather & { date: string }>
}

/**
 * Range les éléments sur `days` jours à partir de `today`. Ce qui est en retard (rappel
 * passé, tâche échue) apparaît aujourd'hui : c'est encore à faire.
 */
export function groupWeek(input: WeekInput, today: string, days = WEEK_DAYS): WeekDay[] {
  const out: WeekDay[] = []
  const end = dayStartMs(addDays(today, days))
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i)
    const from = dayStartMs(date)
    const to = dayStartMs(addDays(date, 1))
    const events = input.events
      .filter((e) => onDay(e, date))
      .sort((a, b) => Number(b.allDay) - Number(a.allDay) || new Date(a.start).getTime() - new Date(b.start).getTime())
    const reminders = input.reminders
      .filter((r) => (i === 0 ? r.dueAt < to : r.dueAt >= from && r.dueAt < to) && r.dueAt < end)
      .sort((a, b) => a.dueAt - b.dueAt)
    const tasks = input.tasks.filter((t) => !t.done && t.due && (i === 0 ? t.due <= date : t.due === date))
    const weather = input.weather.find((w) => w.date === date)
    out.push({ date, events, reminders, tasks, ...(weather ? { weather: stripDate(weather) } : {}) })
  }
  return out
}

const stripDate = ({ date: _d, ...w }: DayWeather & { date: string }): DayWeather => w

/**
 * Échéances d'un rappel entre `now` et `until` : la sienne, puis les suivantes s'il se
 * répète (`next` = prochaine échéance après un instant). Un rappel en retard garde la sienne.
 */
export function reminderOccurrences(r: Reminder, until: number, next: (after: number) => number, max = 20): Reminder[] {
  const out: Reminder[] = []
  let at = r.dueAt
  while (at < until && out.length < max) {
    out.push({ ...r, dueAt: at })
    if (!r.repeat) break
    try {
      const n = next(at)
      if (!(n > at)) break
      at = n
    } catch {
      break
    }
  }
  return out
}

export type WeatherKind = 'sun' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm'

/** Codes météo de l'OMM → famille d'icône. */
export function weatherKind(code: number | undefined): WeatherKind {
  if (code === undefined) return 'partly'
  if (code === 0 || code === 1) return 'sun'
  if (code === 2) return 'partly'
  if (code === 3) return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  if (code >= 51 && code <= 57) return 'drizzle'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 95) return 'storm'
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain'
  return 'partly'
}

/** « Aujourd'hui », « Demain », puis « samedi 2 ». */
export function weekDayLabel(day: string, today: string): string {
  if (day === today) return 'Aujourd’hui'
  if (day === addDays(today, 1)) return 'Demain'
  const [y, m, d] = day.split('-').map(Number)
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric' }).format(new Date(y, m - 1, d))
}
