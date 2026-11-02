// Cartes visuelles du chat (Lot W) : quand un outil de lecture sert (météo, agenda,
// tâches, rappels), l'interface montre ses données en carte, avec icônes et couleurs.
// Ce n'est jamais le modèle qui dessine : la carte vient des données de l'outil, donc
// les chiffres affichés sont toujours les vrais. Partie pure (sans Electron, testée).

import type { DayEvent, DayWeather, Reminder, TaskItem } from './types'

/** Lignes montrées au plus dans une carte ; le reste est compté (« et 4 autres »). */
export const CARD_MAX_EVENTS = 12
export const CARD_MAX_TASKS = 10
export const CARD_MAX_REMINDERS = 10
const MAX_TEXT = 140

/** Heures de la journée montrées par la carte météo (matin, midi, après-midi, soir). */
export const WEATHER_HOURS = [9, 12, 15, 18] as const

export interface WeatherHour {
  hour: number
  temp: number
  code?: number
  /** Probabilité de pluie (%). */
  rain?: number
}

export interface WeatherCardDay {
  /** « AAAA-MM-JJ ». */
  date: string
  label: string
  code?: number
  min: number
  max: number
  rain?: number
  hours?: WeatherHour[]
}

export interface AgendaCardEvent {
  title: string
  start: string
  end: string
  allDay: boolean
  location?: string
  calendar?: string
  meetUrl?: string
  /** Échéance lue chez un connecteur, pas un rendez-vous. */
  task?: true
}

/** Une tâche Google, avec ses identifiants : la cocher dans la carte est ton propre clic, comme dans Aujourd'hui. */
export type TaskCardItem = Pick<TaskItem, 'id' | 'listId' | 'list' | 'title' | 'due' | 'done' | 'link'>

export interface ReminderCardItem {
  message: string
  dueAt: number
  /** « chaque lundi à 9 h », déjà écrit. */
  repeat?: string
}

export type ChatCard =
  | { kind: 'weather'; place: string; days: WeatherCardDay[] }
  /** `from` : premier jour (« AAAA-MM-JJ ») ; `more` : rendez-vous non montrés. */
  | { kind: 'agenda'; from: string; days: number; events: AgendaCardEvent[]; more: number }
  /** `today` : jour où la carte a été faite, pour dire « en retard » sans dériver. */
  | { kind: 'tasks'; today: string; items: TaskCardItem[]; more: number }
  | { kind: 'reminders'; items: ReminderCardItem[]; more: number }

const clip = (s: string | undefined, n = MAX_TEXT): string | undefined => {
  const t = s?.replace(/\s+/g, ' ').trim()
  if (!t) return undefined
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function weatherCard(days: (DayWeather & { date: string; hours?: WeatherHour[] })[]): ChatCard | undefined {
  if (!days.length) return undefined
  return {
    kind: 'weather',
    place: clip(days[0].city, 80) ?? '',
    days: days.map((d) => ({
      date: d.date,
      label: d.label,
      ...(d.code !== undefined ? { code: d.code } : {}),
      min: d.min,
      max: d.max,
      ...(d.rain != null ? { rain: d.rain } : {}),
      ...(d.hours?.length ? { hours: d.hours } : {})
    }))
  }
}

/** Rendez-vous de l'agenda : jamais les participants (ils restent dans l'agenda), seulement ce qui s'affiche. */
export function agendaCard(from: string, days: number, events: DayEvent[]): ChatCard {
  const shown = events.slice(0, CARD_MAX_EVENTS)
  return {
    kind: 'agenda',
    from,
    days,
    events: shown.map((e) => ({
      title: clip(e.title) ?? '(sans titre)',
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      ...(clip(e.location) ? { location: clip(e.location) } : {}),
      ...(clip(e.calendar, 60) ? { calendar: clip(e.calendar, 60) } : {}),
      ...(e.meetUrl && /^https:\/\//i.test(e.meetUrl) ? { meetUrl: e.meetUrl } : {}),
      ...(e.kind === 'task' ? { task: true as const } : {})
    })),
    more: events.length - shown.length
  }
}

/** Tâches à faire : en retard, puis par échéance, puis sans échéance (comme le bloc Aujourd'hui). */
export function tasksCard(items: TaskItem[], today: string): ChatCard {
  const sorted = [...items].sort(
    (a, b) => Number(a.done) - Number(b.done) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.title.localeCompare(b.title)
  )
  const shown = sorted.slice(0, CARD_MAX_TASKS)
  return {
    kind: 'tasks',
    today,
    items: shown.map((t) => ({
      id: t.id,
      listId: t.listId,
      title: clip(t.title) ?? '(sans titre)',
      ...(t.due ? { due: t.due } : {}),
      list: clip(t.list, 60) ?? '',
      done: t.done,
      ...(t.link && /^https:\/\//i.test(t.link) ? { link: t.link } : {})
    })),
    more: sorted.length - shown.length
  }
}

export function remindersCard(list: Reminder[], repeatLabel: (r: Reminder) => string | undefined): ChatCard {
  const sorted = [...list].sort((a, b) => a.dueAt - b.dueAt)
  const shown = sorted.slice(0, CARD_MAX_REMINDERS)
  return {
    kind: 'reminders',
    items: shown.map((r) => ({ message: clip(r.message) ?? '', dueAt: r.dueAt, ...(repeatLabel(r) ? { repeat: repeatLabel(r) } : {}) })),
    more: sorted.length - shown.length
  }
}

/**
 * Clé d'un appel d'outil : son nom (sans le préfixe du serveur de Compi) et ses paramètres,
 * dans un ordre fixe. L'outil et la discussion la calculent chacun de leur côté pour
 * rattacher la carte à la bonne étape.
 */
export function cardKey(name: string, input: Record<string, unknown>): string {
  const keys = Object.keys(input)
    .filter((k) => input[k] !== undefined)
    .sort()
  return `${name.replace(/^mcp__compi__/, '')}|${JSON.stringify(keys.map((k) => [k, input[k]]))}`
}

/** Heures clés d'une journée, tirées des prévisions heure par heure (pure). */
export function keyHours(date: string, times: string[], temps: number[], codes: number[], rains: (number | null)[] | undefined): WeatherHour[] {
  const out: WeatherHour[] = []
  for (const h of WEATHER_HOURS) {
    const i = times.indexOf(`${date}T${String(h).padStart(2, '0')}:00`)
    if (i < 0 || typeof temps[i] !== 'number') continue
    const rain = rains?.[i]
    out.push({
      hour: h,
      temp: Math.round(temps[i]),
      ...(typeof codes[i] === 'number' ? { code: codes[i] } : {}),
      ...(typeof rain === 'number' ? { rain } : {})
    })
  }
  return out
}
