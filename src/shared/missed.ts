// « Ce que tu as manqué » : après une concentration (pomodoro), une réunion ou une
// absence, une carte résume ce qui est arrivé pendant ce temps : messages en attente,
// e-mails non lus, rappels qui ont sonné. Calculé sur le PC, sans cerveau.
// Fonctions pures, testées dans tests/missed.test.ts.

import type { DayMail } from './types'
import type { PendingMessage } from './messages'

export type MissedCause = 'focus' | 'meeting' | 'away'

/** Une période où l'utilisateur n'a pas suivi ce qui arrivait. */
export interface MissedPeriod {
  cause: MissedCause
  from: number
  to: number
  /** Titre de la réunion. */
  title?: string
}

export interface MissedReminder {
  message: string
  at: number
}

export interface MissedInfo extends MissedPeriod {
  /** Moment où la carte a été faite. */
  at: number
  messages: PendingMessage[]
  /** `null` : Gmail pas connecté, ou illisible (`mailError`). */
  mails: DayMail[] | null
  /** Non lus arrivés pendant la période (estimation de Gmail). */
  mailTotal: number
  mailError?: string
  reminders: MissedReminder[]
}

/** En dessous, une concentration ou une réunion ne vaut pas une carte. */
export const MISSED_MIN_MS = 15 * 60_000
/** Une absence compte à partir de 30 min (comme le retour devant le PC des routines). */
export const MISSED_AWAY_MS = 30 * 60_000
/** E-mails montrés dans la carte. */
export const MISSED_MAILS = 5

/**
 * Partie de la période qui reste à résumer : ce qui a déjà été montré par une carte
 * précédente (réunion pendant un pomodoro…) ne l'est pas deux fois. `null` si trop court.
 */
export function periodToSummarize(p: MissedPeriod, lastTo: number): MissedPeriod | null {
  if (!(p.to > p.from)) return null
  const min = p.cause === 'away' ? MISSED_AWAY_MS : MISSED_MIN_MS
  // La durée de l'événement décide (une réunion d'une heure reste une réunion) ;
  // la carte ne reprend ensuite que ce qui n'a pas encore été montré.
  if (p.to - p.from < min) return null
  // Une absence qui passe 5 h du matin (la nuit) : le résumé du matin s'en charge.
  const d = new Date(p.to)
  const five = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 5).getTime()
  if (p.cause === 'away' && p.from < five && p.to >= five) return null
  const from = Math.max(p.from, lastTo)
  return from < p.to ? { ...p, from } : null
}

/** Messages arrivés pendant la période (et jusqu'à maintenant), du plus ancien au plus récent. */
export function messagesDuring(pending: PendingMessage[], from: number, now: number): PendingMessage[] {
  return pending.filter((m) => m.at >= from && m.at <= now).sort((a, b) => a.at - b.at)
}

export function remindersDuring(fired: MissedReminder[], from: number, now: number): MissedReminder[] {
  return fired.filter((r) => r.at >= from && r.at <= now).sort((a, b) => a.at - b.at)
}

/** Recherche Gmail des non lus arrivés depuis `from` (mêmes catégories écartées que « Ta journée »). */
export function missedMailQuery(from: number): string {
  return `is:unread in:inbox -category:promotions -category:social -category:forums after:${Math.floor(from / 1000)}`
}

/** Les importants d'abord, puis les plus récents. */
export function sortMails(mails: DayMail[]): DayMail[] {
  const time = (m: DayMail): number => (m.date ? Date.parse(m.date) || 0 : 0)
  return [...mails].sort((a, b) => Number(b.important) - Number(a.important) || time(b) - time(a))
}

export function missedCounts(i: Pick<MissedInfo, 'messages' | 'mails' | 'mailTotal' | 'reminders'>): { messages: number; mails: number; reminders: number } {
  return { messages: i.messages.length, mails: i.mails ? Math.max(i.mailTotal, i.mails.length) : 0, reminders: i.reminders.length }
}

export const isEmptyMissed = (i: Pick<MissedInfo, 'messages' | 'mails' | 'mailTotal' | 'reminders'>): boolean => {
  const c = missedCounts(i)
  return !c.messages && !c.mails && !c.reminders
}

const plural = (n: number, word: string): string => `${n} ${word}${n > 1 ? 's' : ''}`

export function causeLabel(cause: MissedCause): string {
  return cause === 'focus' ? 'Pendant ta concentration' : cause === 'meeting' ? 'Pendant ta réunion' : 'Pendant ton absence'
}

/**
 * Texte de l'îlot : seulement des nombres, l'îlot est visible de tous
 * (« Pendant ta réunion : 3 messages · 2 e-mails · 1 rappel »).
 */
export function missedNotice(i: MissedInfo): string {
  const c = missedCounts(i)
  const bits = [
    c.messages ? plural(c.messages, 'message') : '',
    c.mails ? plural(c.mails, 'e-mail') : '',
    c.reminders ? plural(c.reminders, 'rappel') : ''
  ].filter(Boolean)
  return `${causeLabel(i.cause)} : ${bits.join(' · ')}`
}
