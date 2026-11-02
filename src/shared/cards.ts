// Cartes visuelles du chat (Lot W) : quand un outil de lecture sert (météo, agenda,
// tâches, rappels, e-mails, fichiers, recherche web, réunions, minuteur), l'interface
// montre ses données en carte, avec icônes et couleurs.
// Ce n'est jamais le modèle qui dessine : la carte vient des données de l'outil, donc
// les chiffres affichés sont toujours les vrais. Partie pure (sans Electron, testée).

import { senderName } from './day'
import type { ItemKind } from './folderPlan'
import type { DayEvent, DayWeather, MeetingMeta, MeetingSummary, Reminder, TaskItem, TimerState } from './types'

/** Lignes montrées au plus dans une carte ; le reste est compté (« et 4 autres »). */
export const CARD_MAX_EVENTS = 12
export const CARD_MAX_TASKS = 10
export const CARD_MAX_REMINDERS = 10
export const CARD_MAX_MAILS = 8
export const CARD_MAX_FILES = 10
export const CARD_MAX_MEETINGS = 8
export const CARD_MAX_SOURCES = 6
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

/** Un e-mail trouvé : le nom de l'expéditeur seulement (pas son adresse), l'objet et un court extrait. */
export interface MailCardItem {
  id: string
  from: string
  subject: string
  snippet?: string
  date?: string
  unread: boolean
  important: boolean
}

export interface FileCardItem {
  name: string
  path: string
  kind: ItemKind
  size?: number
  /** ms. */
  modified?: number
}

export interface SourceCardItem {
  title: string
  url: string
}

export type MeetingCardItem = Pick<MeetingMeta, 'id' | 'title' | 'startedAt' | 'durationMs' | 'hasSummary'>

export type ChatCard =
  | { kind: 'weather'; place: string; days: WeatherCardDay[] }
  /** `from` : premier jour (« AAAA-MM-JJ ») ; `more` : rendez-vous non montrés. */
  | { kind: 'agenda'; from: string; days: number; events: AgendaCardEvent[]; more: number }
  /** `today` : jour où la carte a été faite, pour dire « en retard » sans dériver. */
  | { kind: 'tasks'; today: string; items: TaskCardItem[]; more: number }
  | { kind: 'reminders'; items: ReminderCardItem[]; more: number }
  /** `total` : nombre d'e-mails trouvés selon Gmail (approximatif). */
  | { kind: 'mails'; query: string; items: MailCardItem[]; total: number }
  /** Fichiers trouvés (`path` absent) ou contenu d'un dossier (`path` : le dossier). */
  | { kind: 'files'; query?: string; path?: string; items: FileCardItem[]; more: number }
  | { kind: 'web'; query: string; sources: SourceCardItem[] }
  | { kind: 'meetings'; items: MeetingCardItem[]; more: number }
  /** Une réunion lue : résumé, points et tâches (jamais la transcription). */
  | { kind: 'meeting'; meeting: MeetingCardItem; summary?: string; points: string[]; tasks: Array<{ text: string; owner?: string; due?: string }> }
  /** Minuteur ou pomodoro au moment de l'étape ; la carte suit ensuite celui de l'îlot. */
  | { kind: 'timer'; timer: TimerState; at: number }

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

/** E-mails trouvés : nom de l'expéditeur, objet, extrait court ; jamais le corps ni les adresses. */
export function mailsCard(
  query: string,
  r: { total: number; mails: Array<{ id: string; from: string; subject: string; snippet?: string; date?: string; unread: boolean; important: boolean }> }
): ChatCard {
  return {
    kind: 'mails',
    query: clip(query, 80) ?? '',
    items: r.mails.slice(0, CARD_MAX_MAILS).map((m) => ({
      id: m.id,
      from: clip(senderName(m.from), 60) ?? '',
      subject: clip(m.subject) ?? '(sans objet)',
      ...(clip(m.snippet, 120) ? { snippet: clip(m.snippet, 120) } : {}),
      ...(m.date ? { date: m.date } : {}),
      unread: m.unread,
      important: m.important
    })),
    total: Math.max(r.total, r.mails.length)
  }
}

/** Fichiers trouvés par la recherche de Windows (date ISO), du plus récent au plus ancien. */
export function foundFilesCard(query: string, hits: Array<{ path: string; name: string; modified?: string | null; size?: number | null }>): ChatCard {
  const shown = hits.slice(0, CARD_MAX_FILES)
  return {
    kind: 'files',
    query: clip(query, 80) ?? '',
    items: shown.map((f) => {
      const modified = f.modified ? Date.parse(f.modified) : NaN
      return {
        name: clip(f.name, 120) ?? f.path,
        path: f.path,
        kind: 'file' as const,
        ...(typeof f.size === 'number' ? { size: f.size } : {}),
        ...(Number.isFinite(modified) ? { modified } : {})
      }
    }),
    more: hits.length - shown.length
  }
}

/** Contenu d'un dossier confié : dossiers d'abord, puis le plus récent ; sans les fichiers système. */
export function folderCard(
  path: string,
  items: Array<{ name: string; path: string; kind: ItemKind; size?: number; modified?: number; flags: string[] }>
): ChatCard {
  const visible = items
    .filter((i) => !i.flags.includes('system'))
    .sort((a, b) => Number(b.kind === 'folder') - Number(a.kind === 'folder') || (b.modified ?? 0) - (a.modified ?? 0))
  const shown = visible.slice(0, CARD_MAX_FILES)
  return {
    kind: 'files',
    path,
    items: shown.map((i) => ({
      name: clip(i.name, 120) ?? i.path,
      path: i.path,
      kind: i.kind,
      ...(typeof i.size === 'number' && i.kind !== 'folder' ? { size: i.size } : {}),
      ...(i.modified ? { modified: i.modified } : {})
    })),
    more: visible.length - shown.length
  }
}

/** Sources d'une recherche web (liens http(s) seulement, déjà extraits pour la scène). */
export function webCard(query: string, sources: SourceCardItem[]): ChatCard | undefined {
  const ok = sources.filter((s) => /^https?:\/\//i.test(s.url)).slice(0, CARD_MAX_SOURCES)
  return ok.length ? { kind: 'web', query: clip(query, 80) ?? '', sources: ok.map((s) => ({ title: clip(s.title) ?? s.url, url: s.url })) } : undefined
}

const meetingItem = (m: MeetingCardItem): MeetingCardItem => ({
  id: m.id,
  title: clip(m.title) ?? 'Réunion',
  startedAt: m.startedAt,
  durationMs: m.durationMs,
  hasSummary: m.hasSummary
})

export function meetingsCard(list: MeetingCardItem[]): ChatCard {
  const shown = list.slice(0, CARD_MAX_MEETINGS)
  return { kind: 'meetings', items: shown.map(meetingItem), more: list.length - shown.length }
}

/** Une réunion lue : son résumé s'il existe (5 points et 6 tâches au plus), jamais ce que les gens ont dit. */
export function meetingCard(m: MeetingCardItem & { summary?: MeetingSummary }): ChatCard {
  const s = m.summary
  return {
    kind: 'meeting',
    meeting: meetingItem(m),
    ...(clip(s?.summary, 400) ? { summary: clip(s?.summary, 400) } : {}),
    points: (s?.points ?? [])
      .slice(0, 5)
      .map((p) => clip(p, 200) ?? '')
      .filter(Boolean),
    tasks: (s?.tasks ?? []).slice(0, 6).map((t) => ({
      text: clip(t.text, 200) ?? '',
      ...(clip(t.owner, 40) ? { owner: clip(t.owner, 40) } : {}),
      ...(clip(t.due, 40) ? { due: clip(t.due, 40) } : {})
    }))
  }
}

export const timerCard = (timer: TimerState, at: number): ChatCard => ({ kind: 'timer', timer: { ...timer, label: clip(timer.label, 80) ?? '' }, at })

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
