// Routines : fonctions pures partagées (testées dans tests/routines.test.ts).

import type { ReminderRepeat, RoutineDraft } from './types'

export const ROUTINE_TITLE_MAX = 60
export const ROUTINE_PROMPT_MAX = 2000
export const ROUTINES_MAX = 30
/** Une exécution manquée (PC éteint) est rattrapée au démarrage si elle date de moins de 12 h. */
export const ROUTINE_CATCH_UP_MS = 12 * 3600_000

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

/** Règle de répétition valide (heure « HH:MM », jours de 0 à 6, jour du mois de 1 à 31). */
export function validRepeat(r: unknown): r is ReminderRepeat {
  if (!r || typeof r !== 'object') return false
  const o = r as Record<string, unknown>
  if (typeof o.time !== 'string' || !TIME.test(o.time)) return false
  switch (o.every) {
    case 'day':
    case 'weekdays':
      return true
    case 'week':
      return Array.isArray(o.days) && o.days.length > 0 && o.days.every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    case 'month':
      return Number.isInteger(o.day) && (o.day as number) >= 1 && (o.day as number) <= 31
    default:
      return false
  }
}

/** Brouillon nettoyé et vérifié ; lève une erreur lisible sinon. */
export function cleanDraft(d: RoutineDraft): RoutineDraft {
  const title = String(d.title ?? '').replace(/\s+/g, ' ').trim().slice(0, ROUTINE_TITLE_MAX)
  const prompt = String(d.prompt ?? '').trim().slice(0, ROUTINE_PROMPT_MAX)
  if (!prompt) throw new Error('Dis-moi ce que la routine doit faire.')
  if (!validRepeat(d.repeat)) throw new Error('Moment de la routine invalide.')
  const repeat: ReminderRepeat =
    d.repeat.every === 'week'
      ? { every: 'week', days: [...new Set(d.repeat.days)].sort(), time: d.repeat.time }
      : d.repeat.every === 'month'
        ? { every: 'month', day: d.repeat.day, time: d.repeat.time }
        : { every: d.repeat.every, time: d.repeat.time }
  return { ...(d.id ? { id: d.id } : {}), title: title || prompt.slice(0, 40), prompt, repeat, enabled: d.enabled ?? true }
}

/** Aperçu d'une réponse, sans Markdown, pour une notification. */
export function routinePreview(text: string, max = 160): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[ \t]*(#{1,6}|[-*+]|\d+\.)[ \t]+/gm, '')
    .replace(/[*_`>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}

export const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'] as const
/** Valeurs du paramètre `repeat` de l'outil routine_create. */
export const REPEAT_KINDS = ['chaque_jour', 'jours_ouvres', 'chaque_semaine', 'chaque_mois'] as const
export type RepeatKind = (typeof REPEAT_KINDS)[number]

/** Paramètres de l'outil routine_create → règle de répétition. */
export function routineRepeat(kind: RepeatKind, time: string, days?: string[], dayOfMonth?: number, now = new Date()): ReminderRepeat {
  switch (kind) {
    case 'chaque_jour':
      return { every: 'day', time }
    case 'jours_ouvres':
      return { every: 'weekdays', time }
    case 'chaque_semaine': {
      const picked = (days ?? []).map((d) => DAY_NAMES.indexOf(d.toLowerCase() as (typeof DAY_NAMES)[number])).filter((d) => d >= 0)
      return { every: 'week', days: picked.length ? [...new Set(picked)] : [now.getDay()], time }
    }
    case 'chaque_mois':
      return { every: 'month', day: dayOfMonth ?? now.getDate(), time }
  }
}

/** Au démarrage : rattraper une exécution manquée, ou passer à la suivante. */
export function missedAction(nextAt: number, now: number): 'wait' | 'catch-up' | 'skip' {
  if (nextAt > now) return 'wait'
  return now - nextAt <= ROUTINE_CATCH_UP_MS ? 'catch-up' : 'skip'
}
