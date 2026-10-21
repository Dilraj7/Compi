// Réfs courtes des événements Google (« e12 ») : calendar_events les affiche, la
// modification et la suppression les reçoivent, et les cartes y lisent l'événement
// réellement visé. Un petit modèle recopie mal un identifiant Google de 26 caractères
// ou plus : les réfs sont numérotées dans l'ordre (aucune collision), stables tant que
// Compi tourne, et oubliées au redémarrage (il suffit alors de relire l'agenda).

import type { DayEvent } from '../../shared/types'

/** Événement Google tel que lu par calendar_events. */
export interface EventRef {
  ref: string
  calendarId: string
  eventId: string
  title: string
  start: string
  end: string
  allDay: boolean
}

const MAX_REFS = 500
const refByKey = new Map<string, string>()
const eventByRef = new Map<string, EventRef>()
let lastRef = 0

const keyOf = (calendarId: string, eventId: string): string => `${calendarId}\n${eventId}`

/** Retient un événement Google et renvoie sa réf (`undefined` pour une autre source). */
export function rememberEvent(e: DayEvent): string | undefined {
  if (!e.calendarId) return undefined
  const key = keyOf(e.calendarId, e.id)
  let ref = refByKey.get(key)
  if (!ref) {
    ref = `e${++lastRef}`
    refByKey.set(key, ref)
  }
  // Réinséré à la fin : les plus anciens sont oubliés en premier.
  eventByRef.delete(ref)
  eventByRef.set(ref, { ref, calendarId: e.calendarId, eventId: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay })
  while (eventByRef.size > MAX_REFS) {
    const [oldest, old] = eventByRef.entries().next().value as [string, EventRef]
    eventByRef.delete(oldest)
    refByKey.delete(keyOf(old.calendarId, old.eventId))
  }
  return ref
}

/** Événement retenu sous cette réf (« e12 », « réf e12 », « E12 »…). */
export function eventByReference(ref: unknown): EventRef | undefined {
  const m = typeof ref === 'string' ? /e\s*(\d+)/i.exec(ref) : null
  return m ? eventByRef.get(`e${m[1]}`) : undefined
}

/** Oublie un événement supprimé. */
export function forgetEvent(r: EventRef): void {
  eventByRef.delete(r.ref)
  refByKey.delete(keyOf(r.calendarId, r.eventId))
}
