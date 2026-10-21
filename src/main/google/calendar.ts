// Google Agenda : lire les rendez-vous, en créer, en déplacer ou en supprimer
// (sans prévenir personne), et reconnaître les liens de visioconférence.

import { findMeetingUrl } from '../../shared/agenda'
import type { DayEvent, GoogleCalendarChoice } from '../../shared/types'
import { settings } from '../store/settings'
import { GoogleApiError, googleApi, googleEndpoints } from './connect'
import { forgetEvent, rememberEvent, type EventRef } from './eventRefs'

export { isMeetingUrl } from '../../shared/agenda'

interface RawEvent {
  id: string
  iCalUID?: string
  status?: string
  eventType?: string
  summary?: string
  location?: string
  description?: string
  hangoutLink?: string
  htmlLink?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] }
  attendees?: { self?: boolean; responseStatus?: string }[]
}

/** Lien de visio d'un événement : Meet, ou un lien reconnu dans le lieu ou la description. */
export function meetingLink(ev: Pick<RawEvent, 'hangoutLink' | 'conferenceData' | 'location' | 'description'>): string | undefined {
  return findMeetingUrl(
    [ev.hangoutLink, ...(ev.conferenceData?.entryPoints ?? []).filter((e) => e.entryPointType === 'video').map((e) => e.uri)],
    [ev.location, ev.description]
  )
}

/** Événement Google → événement de Compi (`null` : à ignorer). */
export function toDayEvent(ev: RawEvent, calendar?: string, calendarId?: string): DayEvent | null {
  if (ev.status === 'cancelled' || ev.eventType === 'workingLocation') return null
  if (ev.attendees?.some((a) => a.self && a.responseStatus === 'declined')) return null
  const start = ev.start?.dateTime ?? ev.start?.date
  const end = ev.end?.dateTime ?? ev.end?.date ?? start
  if (!start || !end) return null
  return {
    id: ev.id,
    title: ev.summary?.trim() || '(sans titre)',
    start,
    end,
    allDay: !ev.start?.dateTime,
    location: ev.location?.trim() || undefined,
    calendar,
    ...(calendarId ? { calendarId } : {}),
    meetUrl: meetingLink(ev),
    htmlLink: ev.htmlLink
  }
}

const startMs = (e: DayEvent): number => (e.allDay ? new Date(`${e.start}T00:00:00`).getTime() : new Date(e.start).getTime())

interface CalendarRef {
  id: string
  name: string
  primary: boolean
  /** Coché dans Google Agenda. */
  google: boolean
}

let calendarCache: { at: number; list: CalendarRef[] } | null = null

/** Tous les agendas du compte (50 au plus), relus toutes les 10 minutes. */
async function allCalendars(): Promise<CalendarRef[]> {
  if (calendarCache && Date.now() - calendarCache.at < 10 * 60_000) return calendarCache.list
  let list: CalendarRef[]
  try {
    const r = await googleApi<{
      items?: { id: string; summary?: string; summaryOverride?: string; primary?: boolean; selected?: boolean; hidden?: boolean }[]
    }>(`${googleEndpoints().calendar}/users/me/calendarList?minAccessRole=reader&maxResults=50`)
    list = (r.items ?? [])
      .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)))
      .map((c) => ({
        id: c.id,
        name: c.summaryOverride ?? c.summary ?? '',
        primary: Boolean(c.primary),
        google: Boolean(c.primary || (c.selected && !c.hidden))
      }))
  } catch {
    // Liste des agendas non accordée : l'agenda principal seulement.
    list = [{ id: 'primary', name: '', primary: true, google: true }]
  }
  if (!list.length) list = [{ id: 'primary', name: '', primary: true, google: true }]
  calendarCache = { at: Date.now(), list }
  return list
}

/** Affiché dans Compi : ceux choisis dans Réglages › Ta journée, sinon ceux cochés dans Google Agenda. */
const shownIn = (c: CalendarRef, chosen: string[] | null): boolean => (chosen ? chosen.includes(c.id) : c.google)

/** Agendas lus : choisis par l'utilisateur (ou comme dans Google Agenda), 10 au plus. */
async function calendars(): Promise<CalendarRef[]> {
  const chosen = settings.get().agenda.googleCalendars
  return (await allCalendars()).filter((c) => shownIn(c, chosen)).slice(0, 10)
}

/** Agendas du compte pour le choix dans les réglages. */
export async function calendarChoices(): Promise<GoogleCalendarChoice[]> {
  const chosen = settings.get().agenda.googleCalendars
  return (await allCalendars()).map((c) => ({
    id: c.id,
    name: c.name || (c.primary ? 'Agenda principal' : c.id),
    primary: c.primary,
    shown: shownIn(c, chosen)
  }))
}

/** Rendez-vous entre deux dates, tous agendas confondus, du plus tôt au plus tard. */
export async function listEvents(o: { from: Date; to: Date; query?: string; max?: number }): Promise<DayEvent[]> {
  const cals = await calendars()
  if (!cals.length) return []
  const params = new URLSearchParams({
    timeMin: o.from.toISOString(),
    timeMax: o.to.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(Math.min(o.max ?? 50, 100))
  })
  if (o.query?.trim()) params.set('q', o.query.trim())
  const results = await Promise.allSettled(
    cals.map(async (c) => {
      const r = await googleApi<{ items?: RawEvent[] }>(`${googleEndpoints().calendar}/calendars/${encodeURIComponent(c.id)}/events?${params}`)
      return (r.items ?? []).map((ev) => toDayEvent(ev, c.primary ? undefined : c.name || undefined, c.id)).filter((e): e is DayEvent => e !== null)
    })
  )
  const ok = results.filter((r): r is PromiseFulfilledResult<DayEvent[]> => r.status === 'fulfilled')
  if (!ok.length) throw (results[0] as PromiseRejectedResult).reason
  const seen = new Set<string>()
  return ok
    .flatMap((r) => r.value)
    .filter((e) => {
      const key = `${e.title}|${e.start}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => startMs(a) - startMs(b))
}

const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const OFFSET_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const pad = (n: number): string => String(n).padStart(2, '0')
const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localDateTime = (d: Date): string => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`

export interface NewEvent {
  title: string
  /** « AAAA-MM-JJTHH:MM » (heure locale) ou « AAAA-MM-JJ » (toute la journée). */
  start: string
  end?: string
  location?: string
  description?: string
}

/** Corps de l'événement pour l'API (pur, testé) : jamais d'invités. */
export function eventBody(e: NewEvent, timeZone: string): Record<string, unknown> {
  const title = e.title.trim()
  if (!title) throw new Error('Il faut un titre.')
  const base = {
    summary: title.slice(0, 300),
    ...(e.location?.trim() ? { location: e.location.trim().slice(0, 300) } : {}),
    ...(e.description?.trim() ? { description: e.description.trim().slice(0, 4000) } : {})
  }
  if (LOCAL_DATE.test(e.start)) {
    const end = e.end && LOCAL_DATE.test(e.end) ? e.end : addDays(e.start, 1)
    return { ...base, start: { date: e.start }, end: { date: end } }
  }
  const start = timed(e.start, timeZone)
  const end = e.end ? timed(e.end, timeZone) : timed(localDateTime(new Date(new Date(start.dateTime).getTime() + 60 * 60_000)), timeZone)
  if (new Date(end.dateTime).getTime() <= new Date(start.dateTime).getTime()) throw new Error('La fin doit être après le début.')
  return { ...base, start, end }
}

/** Heure demandée → champ de l'API : heure locale avec le fuseau, ou heure avec décalage. */
function timed(v: string, timeZone: string): { dateTime: string; timeZone?: string } {
  if (OFFSET_DATETIME.test(v)) return { dateTime: v }
  if (LOCAL_DATETIME.test(v)) return { dateTime: v.length === 16 ? `${v}:00` : v, timeZone }
  throw new Error(`Date invalide : « ${v} » (attendu AAAA-MM-JJTHH:MM).`)
}

const addDays = (day: string, n: number): string => localDate(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86_400_000))
const dayCount = (from: string, to: string): number => Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000)

/** Ajoute un événement dans l'agenda principal, sans prévenir personne. */
export async function createEvent(e: NewEvent): Promise<DayEvent> {
  const body = eventBody(e, Intl.DateTimeFormat().resolvedOptions().timeZone)
  const r = await googleApi<RawEvent>(`${googleEndpoints().calendar}/calendars/primary/events?sendUpdates=none`, { method: 'POST', body })
  const ev = toDayEvent(r, undefined, 'primary')
  if (!ev) throw new Error("Google n'a pas renvoyé l'événement créé.")
  return ev
}

// ─── Déplacer, modifier, supprimer ───────────────────────────────────────────

export interface EventChanges {
  title?: string
  /** « AAAA-MM-JJTHH:MM » (heure locale) ou « AAAA-MM-JJ » (toute la journée). */
  start?: string
  end?: string
  location?: string
  description?: string
}

/**
 * Corps d'une modification (pur, testé). Une nouvelle date de début sans fin garde
 * la durée d'origine ; passer d'un format à l'autre (journée entière ↔ horaire)
 * remplace aussi l'autre champ, que Google refuserait sinon.
 */
export function patchBody(old: Pick<EventRef, 'start' | 'end' | 'allDay'>, c: EventChanges, timeZone: string): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (c.title !== undefined) {
    const t = c.title.trim()
    if (!t) throw new Error('Il faut un titre.')
    body.summary = t.slice(0, 300)
  }
  if (c.location !== undefined) body.location = c.location.trim().slice(0, 300)
  if (c.description !== undefined) body.description = c.description.trim().slice(0, 4000)
  const start = c.start?.trim()
  const end = c.end?.trim()
  if (start || end) {
    const s = start ?? old.start
    if (LOCAL_DATE.test(s)) {
      if (end && !LOCAL_DATE.test(end)) throw new Error('Pour une journée entière, la fin est une date (AAAA-MM-JJ).')
      const days = old.allDay ? Math.max(1, dayCount(old.start, old.end)) : 1
      const e = end ?? addDays(s, days)
      if (e <= s) throw new Error('La fin doit être après le début.')
      body.start = { date: s, dateTime: null, timeZone: null }
      body.end = { date: e, dateTime: null, timeZone: null }
    } else {
      if (end && LOCAL_DATE.test(end)) throw new Error('Pour un rendez-vous à heure fixe, la fin est une heure (AAAA-MM-JJTHH:MM).')
      const st = timed(s, timeZone)
      const startMs = new Date(st.dateTime).getTime()
      const keep = !old.allDay && Date.parse(old.end) > Date.parse(old.start) ? Date.parse(old.end) - Date.parse(old.start) : 60 * 60_000
      const en = end
        ? timed(end, timeZone)
        : OFFSET_DATETIME.test(s)
          ? { dateTime: new Date(startMs + keep).toISOString() }
          : timed(localDateTime(new Date(startMs + keep)), timeZone)
      if (new Date(en.dateTime).getTime() <= startMs) throw new Error('La fin doit être après le début.')
      // Le fuseau reste renseigné : Google l'exige pour une occurrence d'événement répété.
      body.start = { date: null, dateTime: st.dateTime, timeZone: st.timeZone ?? timeZone }
      body.end = { date: null, dateTime: en.dateTime, timeZone: en.timeZone ?? timeZone }
    }
  }
  if (!Object.keys(body).length) throw new Error('Rien à modifier : donne un nouveau titre, une nouvelle date ou un nouveau lieu.')
  return body
}

const eventUrl = (r: EventRef): string =>
  `${googleEndpoints().calendar}/calendars/${encodeURIComponent(r.calendarId)}/events/${encodeURIComponent(r.eventId)}?sendUpdates=none`

/** Modifie l'événement lui-même (aucun doublon), sans prévenir personne. */
export async function updateEvent(ref: EventRef, c: EventChanges): Promise<DayEvent> {
  const body = patchBody(ref, c, Intl.DateTimeFormat().resolvedOptions().timeZone)
  const r = await googleApi<RawEvent>(eventUrl(ref), { method: 'PATCH', body })
  const ev = toDayEvent(r, undefined, ref.calendarId)
  if (!ev) throw new Error("Google n'a pas renvoyé l'événement modifié.")
  rememberEvent(ev)
  return ev
}

/** Supprime l'événement (il reste 30 jours dans la corbeille de Google Agenda). `false` : il n'existait déjà plus. */
export async function deleteEvent(ref: EventRef): Promise<boolean> {
  try {
    await googleApi<void>(eventUrl(ref), { method: 'DELETE' })
    return true
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return false
    throw e
  } finally {
    forgetEvent(ref)
  }
}

const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const TIME_FMT = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })

export const eventDay = (e: DayEvent): string => DAY_FMT.format(new Date(e.allDay ? `${e.start}T12:00:00` : e.start))

/** « 09:00–09:30 », « échéance 14:00 » (sans durée, une tâche par exemple) ou « toute la journée ». */
export function eventTime(e: DayEvent): string {
  if (e.allDay) return 'toute la journée'
  const start = TIME_FMT.format(new Date(e.start))
  return Date.parse(e.end) > Date.parse(e.start) ? `${start}–${TIME_FMT.format(new Date(e.end))}` : `échéance ${start}`
}

const meetingName = (url: string): string => {
  const host = new URL(url).hostname
  return host.includes('meet.google') ? 'Google Meet' : host.includes('zoom') ? 'Zoom' : host.includes('teams') ? 'Teams' : host
}

/**
 * Liste lisible pour le modèle, groupée par jour. Avec `refOf`, chaque événement
 * Google porte sa réf (pour le déplacer ou le supprimer) ; les autres disent où ils se modifient.
 */
export function formatEvents(events: DayEvent[], refOf?: (e: DayEvent) => string | undefined): string {
  const lines: string[] = []
  let day = ''
  for (const e of events) {
    const d = eventDay(e)
    if (d !== day) {
      if (day) lines.push('')
      lines.push(d)
      day = d
    }
    const bits = [eventTime(e), e.title, e.location, e.meetUrl ? `visio ${meetingName(e.meetUrl)}` : '', e.calendar ? `agenda ${e.calendar}` : ''].filter(
      Boolean
    )
    if (refOf) {
      const ref = refOf(e)
      bits.push(ref ? `réf ${ref}` : `se modifie dans ${e.calendar ?? 'sa source'}, pas ici`)
    }
    lines.push(`- ${bits.join(' · ')}`)
  }
  return lines.join('\n')
}
