// Préparer une réunion : la logique pure (qui est en face, quand proposer la
// préparation, quelle recherche Gmail, quelle réunion d'avant), sans Electron,
// pour être testée. Tout se calcule sur le PC : rien n'est envoyé à un cerveau.

import { isTimedMeeting } from './agenda'
import { similarity } from './meetings'
import type { DayEvent, EventAttendee, MeetingEventLink, MeetingMeta } from './types'

/** Participants gardés par réunion. */
export const MAX_ATTENDEES = 30
/** Adresses cherchées dans Gmail : la requête reste courte. */
const MAX_MAIL_PEOPLE = 10
/** Fenêtre des derniers échanges, en jours. */
export const PREP_MAIL_DAYS = 30
export const PREP_MAILS = 5

/** Adresse simple, sans rien qui puisse changer une recherche Gmail. */
export const isEmail = (s: unknown): s is string => typeof s === 'string' && s.length <= 254 && /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)

const clip = (s: unknown, n: number): string | undefined => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : undefined)

/** Participants lus dans un agenda → les autres (sans toi, sans les salles, sans ceux qui ont décliné), une fois chacun. */
export function otherAttendees(
  list: Array<{ email?: string; name?: string; organizer?: boolean; self?: boolean; resource?: boolean; declined?: boolean }>,
  me = ''
): EventAttendee[] {
  const mine = me.trim().toLowerCase()
  const out: EventAttendee[] = []
  const seen = new Map<string, EventAttendee>()
  for (const a of list) {
    if (a.self || a.resource || a.declined) continue
    const email = isEmail(a.email) ? a.email.toLowerCase() : undefined
    if (email && email === mine) continue
    const name = clip(a.name, 100)
    const key = email ?? name?.toLowerCase()
    if (!key) continue
    const known = seen.get(key)
    if (known) {
      // Organisateur aussi invité : une seule ligne, marquée organisateur.
      if (a.organizer) known.organizer = true
      known.name ??= name
      continue
    }
    if (out.length >= MAX_ATTENDEES) continue
    const item: EventAttendee = { ...(email ? { email } : {}), ...(name ? { name } : {}), ...(a.organizer ? { organizer: true } : {}) }
    seen.set(key, item)
    out.push(item)
  }
  return out
}

export const prepKey = (e: Pick<DayEvent, 'id' | 'start'>): string => `${e.id}|${e.start}`

/** Une réunion à préparer : avec horaire et au moins une autre personne. */
export const isPreparable = (e: DayEvent): boolean => isTimedMeeting(e) && Boolean(e.attendees?.length)

/** Délai avant de proposer la préparation (`null` : rien à préparer, ou déjà commencée). */
export function prepDelay(e: DayEvent, minutesBefore: number, now = Date.now()): number | null {
  if (!isPreparable(e)) return null
  const start = Date.parse(e.start)
  if (!(start > now)) return null
  return Math.max(0, start - minutesBefore * 60_000 - now)
}

/** Recherche Gmail des derniers échanges avec eux (`null` : aucune adresse utilisable). */
export function prepMailQuery(emails: string[], days = PREP_MAIL_DAYS): string | null {
  const list = [...new Set(emails.filter(isEmail).map((e) => e.toLowerCase()))].slice(0, MAX_MAIL_PEOPLE)
  if (!list.length) return null
  return `{${list.flatMap((e) => [`from:${e}`, `to:${e}`, `cc:${e}`]).join(' ')}} newer_than:${days}d`
}

/** Ce que l'enregistrement garde du rendez-vous. */
export function eventLink(e: DayEvent): MeetingEventLink {
  return {
    id: e.id,
    ...(e.seriesId ? { seriesId: e.seriesId } : {}),
    title: e.title,
    start: e.start,
    attendees: (e.attendees ?? []).map((a) => a.email).filter(isEmail)
  }
}

/** Lien venu de l'îlot, vérifié (tailles bornées, adresses valides) ; `undefined` s'il est inutilisable. */
export function cleanEventLink(raw: unknown): MeetingEventLink | undefined {
  const r = raw as Partial<MeetingEventLink> | null
  const id = clip(r?.id, 300)
  const title = clip(r?.title, 200)
  const start = clip(r?.start, 40)
  if (!id || !title || !start || Number.isNaN(Date.parse(start))) return undefined
  const seriesId = clip(r?.seriesId, 300)
  const attendees = Array.isArray(r?.attendees) ? [...new Set(r.attendees.filter(isEmail).map((a) => a.toLowerCase()))].slice(0, MAX_ATTENDEES) : []
  return { id, ...(seriesId ? { seriesId } : {}), title, start, attendees }
}

const norm = (t: string): string => t.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Titre donné par Compi à un appel jamais renommé : ne dit rien de la réunion. */
const generic = (t: string): boolean => /^appel du /i.test(t.trim())
const wordCount = (t: string): number =>
  norm(t)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1).length

/**
 * La réunion d'avant, la plus récente : même série (ou même rendez-vous) d'abord,
 * sinon même titre avec quelqu'un en commun, sinon un titre très proche.
 */
export function pickPrevious(ev: MeetingEventLink, meetings: MeetingMeta[]): MeetingMeta | null {
  const before = Date.parse(ev.start) - 5 * 60_000
  const done = meetings.filter((m) => m.status === 'done' && m.startedAt < before).sort((a, b) => b.startedAt - a.startedAt)
  const people = new Set(ev.attendees.map((a) => a.toLowerCase()))
  return (
    done.find((m) => m.event && ((ev.seriesId && m.event.seriesId === ev.seriesId) || m.event.id === ev.id)) ??
    done.find((m) => m.event && norm(m.event.title) === norm(ev.title) && m.event.attendees.some((a) => people.has(a.toLowerCase()))) ??
    done.find((m) => !generic(m.title) && wordCount(ev.title) >= 2 && wordCount(m.title) >= 2 && similarity(ev.title, m.title) >= 0.75) ??
    null
  )
}

/** « Claire Martin », sinon l'adresse. */
export const attendeeLabel = (a: EventAttendee): string => a.name ?? a.email ?? ''
