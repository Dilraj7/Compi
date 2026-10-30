// Routines : fonctions pures partagées (testées dans tests/routines.test.ts).

import type { ReminderRepeat, RoutineDraft, RoutineGrant, RoutineTrigger } from './types'

export const ROUTINE_TITLE_MAX = 60
export const ROUTINE_PROMPT_MAX = 2000
export const ROUTINES_MAX = 30
/** Une exécution manquée (PC éteint) est rattrapée au démarrage si elle date de moins de 12 h. */
export const ROUTINE_CATCH_UP_MS = 12 * 3600_000

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const ROUTINE_GRANTS: readonly RoutineGrant[] = ['web', 'notes']

/** Libellés des droits (formulaire, carte de création). */
export const ROUTINE_GRANT_LABELS: Record<RoutineGrant, string> = {
  web: 'Chercher sur le web et lire des pages',
  notes: 'Créer des notes dans tes dossiers confiés'
}

/** Droits connus, sans doublon, dans l'ordre de ROUTINE_GRANTS. */
export function cleanGrants(v: unknown): RoutineGrant[] {
  return Array.isArray(v) ? ROUTINE_GRANTS.filter((g) => v.includes(g)) : []
}

/**
 * Outils couverts par le droit « web » d'une routine : chercher sur le web et lire des pages
 * (recherche de Compi, outils web du moteur, connecteurs de recherche branchés). Jamais
 * ouvrir un lien ni lancer une commande.
 */
export function webGrantCovers(toolName: string, searchServerKeys: readonly string[]): boolean {
  if (['WebSearch', 'WebFetch', 'mcp__compi__fetch_page', 'mcp__compi__web_search'].includes(toolName)) return true
  return searchServerKeys.some((k) => toolName.startsWith(`mcp__${k}__`))
}

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
  const title = String(d.title ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ROUTINE_TITLE_MAX)
  const prompt = String(d.prompt ?? '')
    .trim()
    .slice(0, ROUTINE_PROMPT_MAX)
  if (!prompt) throw new Error('Dis-moi ce que la routine doit faire.')
  const when = d.trigger !== undefined ? { trigger: cleanTrigger(d.trigger) } : { repeat: cleanRepeat(d.repeat) }
  return {
    ...(d.id ? { id: d.id } : {}),
    title: title || prompt.slice(0, 40),
    prompt,
    ...when,
    enabled: d.enabled ?? true,
    ...(d.allow !== undefined ? { allow: cleanGrants(d.allow) } : {})
  }
}

function cleanRepeat(r: unknown): ReminderRepeat {
  if (!validRepeat(r)) throw new Error('Moment de la routine invalide.')
  return r.every === 'week'
    ? { every: 'week', days: [...new Set(r.days)].sort(), time: r.time }
    : r.every === 'month'
      ? { every: 'month', day: r.day, time: r.time }
      : { every: r.every, time: r.time }
}

// ─── Routines sur événement ──────────────────────────────────────────────────

export const TRIGGER_SENDER_MAX = 60

/** Déclencheur valide (application et expéditeur facultatifs pour un message). */
export function validTrigger(t: unknown): t is RoutineTrigger {
  if (!t || typeof t !== 'object') return false
  const o = t as Record<string, unknown>
  if (o.on === 'morning' || o.on === 'meeting-end') return true
  return o.on === 'message' && (o.app === undefined || typeof o.app === 'string') && (o.sender === undefined || typeof o.sender === 'string')
}

function cleanTrigger(t: unknown): RoutineTrigger {
  if (!validTrigger(t)) throw new Error('Événement de la routine invalide.')
  if (t.on !== 'message') return { on: t.on }
  const app = t.app?.trim().slice(0, 200)
  const sender = t.sender?.replace(/\s+/g, ' ').trim().slice(0, TRIGGER_SENDER_MAX)
  return { on: 'message', ...(app ? { app } : {}), ...(sender ? { sender } : {}) }
}

/** Libellé du déclencheur (« à la fin de chaque rendez-vous »). `appLabel` : nom lisible d'une application suivie. */
export function triggerLabel(t: RoutineTrigger, appLabel?: (key: string) => string): string {
  switch (t.on) {
    case 'morning':
      return 'au premier allumage du jour'
    case 'meeting-end':
      return 'à la fin de chaque rendez-vous'
    case 'message': {
      const app = t.app ? ` sur ${appLabel?.(t.app) ?? t.app}` : ''
      return t.sender ? `à chaque message de « ${t.sender} »${app}` : `à chaque nouveau message${app}`
    }
  }
}

/**
 * Limites de fréquence : une fois par jour (après 5 h) au premier allumage ; au plus
 * 8 par jour à la fin des rendez-vous ; pour les messages, 30 min d'attente et 5 par jour.
 */
export const TRIGGER_LIMITS = {
  morningHour: 5,
  'meeting-end': { gapMs: 5 * 60_000, perDay: 8 },
  message: { gapMs: 30 * 60_000, perDay: 5 }
} as const

const DAY_MS = 24 * 3600_000

/** Lancements des dernières 24 h, du plus ancien au plus récent. */
export const recentFires = (fired: unknown, now: number): number[] =>
  Array.isArray(fired) ? fired.filter((t): t is number => typeof t === 'number' && t > now - DAY_MS && t <= now).sort((a, b) => a - b) : []

/** L'événement peut-il lancer la routine maintenant ? */
export function canFire(t: RoutineTrigger, fired: unknown, now: number): boolean {
  const recent = recentFires(fired, now)
  const d = new Date(now)
  if (t.on === 'morning') return d.getHours() >= TRIGGER_LIMITS.morningHour && !recent.some((x) => new Date(x).toDateString() === d.toDateString())
  const limit = TRIGGER_LIMITS[t.on]
  const last = recent.at(-1)
  return recent.length < limit.perDay && (last === undefined || now - last >= limit.gapMs)
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Le message (application, expéditeur affiché par Windows) correspond-il au déclencheur ? */
export function messageMatches(t: RoutineTrigger, m: { appKey: string; sender: string }): boolean {
  if (t.on !== 'message') return false
  if (t.app && t.app !== m.appKey) return false
  return !t.sender || fold(m.sender).includes(fold(t.sender))
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

/** Valeurs du paramètre `when` de l'outil routine_create. */
export const WHEN_KINDS = ['heure', 'premier_allumage', 'fin_rendez_vous', 'message'] as const
export type WhenKind = (typeof WHEN_KINDS)[number]

/**
 * Paramètres de l'outil routine_create → déclencheur (`undefined` : à heure fixe).
 * L'application est cherchée par son nom parmi celles suivies par Messages.
 */
export function toolTrigger(
  when: string | undefined,
  from: string | undefined,
  appName: string | undefined,
  apps: { key: string; label: string }[]
): RoutineTrigger | undefined {
  switch (when) {
    case 'premier_allumage':
      return { on: 'morning' }
    case 'fin_rendez_vous':
      return { on: 'meeting-end' }
    case 'message': {
      const name = appName ? fold(appName) : ''
      const app = name ? apps.find((a) => fold(a.label) === name || fold(a.label).includes(name) || name.includes(fold(a.label))) : undefined
      if (name && !app)
        throw new Error(`« ${appName} » n'est pas suivie par Messages. Applications suivies : ${apps.map((a) => a.label).join(', ') || 'aucune'}.`)
      const sender = from?.trim()
      return { on: 'message', ...(app ? { app: app.key } : {}), ...(sender ? { sender } : {}) }
    }
    default:
      return undefined
  }
}
