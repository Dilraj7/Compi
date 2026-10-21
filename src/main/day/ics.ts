// Agendas au format iCalendar (.ics) : Outlook, iCloud, Proton, agendas d'école
// ou de club… Lecture avec ical.js (fuseaux horaires, répétitions, exceptions),
// limitée à la période demandée. Testé dans tests/agenda.test.ts.

import ICAL from 'ical.js'
import { findMeetingUrl, localDay } from '../../shared/agenda'
import type { DayEvent } from '../../shared/types'

/** Répétitions examinées au plus par événement (un événement quotidien depuis 1990 en compte ~13 000). */
const MAX_OCCURRENCES = 20_000

function validZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Heure murale d'un fuseau IANA (« Europe/Paris ») → instant. */
function zonedToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
  const offset = (ms: number): number => {
    const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms
  }
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const first = wall - offset(wall)
  return new Date(wall - offset(first))
}

/** Instant d'une heure iCalendar : fuseau défini dans le fichier, UTC, fuseau IANA nommé seul, ou heure locale. */
function instant(t: ICAL.Time): Date {
  const tzid = t.zone?.tzid
  if (tzid && tzid !== 'floating') return t.toJSDate()
  // Fuseau nommé sans sa définition (TZID=Europe/Paris) : ical.js le prendrait pour l'heure du PC.
  // (`timezone` existe bien à l'exécution, mais pas dans les types d'ical.js.)
  const named = (t as unknown as { timezone?: string }).timezone
  if (named && validZone(named)) return zonedToDate(t.year, t.month, t.day, t.hour, t.minute, t.second, named)
  return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
}

const dateOf = (t: ICAL.Time): string => `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`

function toDayEvent(e: ICAL.Event, start: ICAL.Time, end: ICAL.Time | null, label?: string): DayEvent | null {
  const status = String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase()
  if (status === 'CANCELLED') return null
  const allDay = start.isDate
  const s = allDay ? dateOf(start) : instant(start).toISOString()
  let finish: string
  if (allDay) {
    const endDay = end?.isDate ? dateOf(end) : ''
    const d = new Date(`${s}T12:00:00`)
    finish = endDay > s ? endDay : localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
  } else finish = end ? instant(end).toISOString() : s
  const url = String(e.component.getFirstPropertyValue('url') ?? '')
  const location = e.location?.trim() || undefined
  return {
    id: `${e.uid}|${s}`,
    title: e.summary?.trim() || '(sans titre)',
    start: s,
    end: finish,
    allDay,
    ...(location ? { location } : {}),
    ...(label ? { calendar: label } : {}),
    meetUrl: findMeetingUrl([url], [location, e.description]),
    ...(/^https:\/\//i.test(url) ? { htmlLink: url } : {})
  }
}

const startMs = (e: DayEvent): number => (e.allDay ? new Date(`${e.start}T00:00:00`).getTime() : Date.parse(e.start))
const endMs = (e: DayEvent): number => (e.allDay ? new Date(`${e.end}T00:00:00`).getTime() : Date.parse(e.end))

/** Événements d'un fichier .ics qui touchent la période [from, to[, du plus tôt au plus tard. */
export function parseIcs(text: string, from: Date, to: Date, label?: string): DayEvent[] {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)
  const masters = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Event[] = []
  for (const v of root.getAllSubcomponents('vevent')) {
    const e = new ICAL.Event(v)
    if (e.isRecurrenceException()) exceptions.push(e)
    else masters.set(`${e.uid}|${masters.size}`, e)
  }
  const byUid = new Map([...masters.values()].map((e) => [e.uid, e]))
  for (const x of exceptions) byUid.get(x.uid)?.relateException(x)

  const out: DayEvent[] = []
  const inRange = (ev: DayEvent): boolean => startMs(ev) < to.getTime() && Math.max(endMs(ev), startMs(ev) + 1) > from.getTime()
  for (const e of masters.values()) {
    if (!e.startDate) continue
    if (!e.isRecurring()) {
      const ev = toDayEvent(e, e.startDate, e.endDate, label)
      if (ev && inRange(ev)) out.push(ev)
      continue
    }
    const it = e.iterator()
    for (let n = 0, next = it.next(); next && n < MAX_OCCURRENCES; n++, next = it.next()) {
      if (instant(next).getTime() >= to.getTime() && !next.isDate) break
      if (next.isDate && new Date(`${dateOf(next)}T00:00:00`).getTime() >= to.getTime()) break
      const d = e.getOccurrenceDetails(next)
      const ev = toDayEvent(d.item, d.startDate, d.endDate, label)
      if (ev && inRange(ev)) out.push(ev)
    }
  }
  return out.sort((a, b) => startMs(a) - startMs(b))
}
