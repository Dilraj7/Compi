// « Ta journée » : petites fonctions pures partagées entre le processus
// principal et l'interface. Testées dans tests/day.test.ts.

import type { ReminderRepeat } from './types'

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** « chaque lundi et jeudi à 9 h », « du lundi au vendredi à 7 h 30 ». */
export function repeatLabel(r: ReminderRepeat): string {
  const [hh, mm] = r.time.split(':')
  const at = `à ${Number(hh)} h${mm === '00' ? '' : ` ${mm}`}`
  switch (r.every) {
    case 'day':
      return `chaque jour ${at}`
    case 'weekdays':
      return `du lundi au vendredi ${at}`
    case 'week': {
      // Semaine à la française : du lundi au dimanche.
      const names = [...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAYS[d])
      const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names[0]
      return `chaque ${list} ${at}`
    }
    case 'month':
      return `le ${r.day === 1 ? '1er' : r.day} de chaque mois ${at}`
  }
}

/** Identifiant Gmail : lettres et chiffres seulement (il finit dans une adresse). */
export const isMailId = (id: string): boolean => /^[A-Za-z0-9_-]{6,64}$/.test(id)

/** Gmail sur le bon compte : dossier Brouillons, ou un e-mail précis. */
export function gmailWebUrl(email: string, target: { drafts: true } | { messageId: string }): string {
  const account = encodeURIComponent(email || '0')
  if ('drafts' in target) return `https://mail.google.com/mail/u/?authuser=${account}#drafts`
  return `https://mail.google.com/mail/u/?authuser=${account}#all/${isMailId(target.messageId) ? target.messageId : ''}`
}

/** « Jean Dupont <jean@x.fr> » → « Jean Dupont ». */
export function senderName(from: string): string {
  const named = /^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/.exec(from)
  return (named ? named[1] : from).trim() || from
}
