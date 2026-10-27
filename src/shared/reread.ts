// Ce que le modèle local a dû relire avant de répondre, et pourquoi. Fonctions pures,
// testées dans tests/reread.test.ts. Rien n'est lu dans les journaux d'Ollama : les
// jetons relus viennent de sa réponse (input_tokens = jetons lus hors cache), le reste
// de la requête envoyée.

import type { Reread, RereadCause } from './types'

/** En dessous, relire ne coûte que quelques secondes : rien à expliquer. */
export const REREAD_MIN = 3000
/** Marge au-dessus de ce qui était vraiment nouveau (estimé un peu large) avant de parler de relecture. */
const NEW_MARGIN = 1500
/** Requête qui remplit au moins cette part de la fenêtre : le modèle en coupe le début. */
const FULL_SHARE = 0.8

/** Ce qui a changé depuis la dernière requête lue par le modèle, mesuré avant l'envoi. */
export interface RequestChange {
  /** Changement repéré au début de la requête ou dans la discussion (`null` : aucun). */
  change: Extract<RereadCause, 'start' | 'tools' | 'system' | 'other-chat' | 'summary'> | null
  /** Jetons vraiment nouveaux pour le modèle (estimés) : ce qui s'est ajouté depuis, ou la dernière question. */
  newTokens: number
  /** Taille estimée de toute la requête. */
  promptTokens: number
  /** Fenêtre du modèle, si connue. */
  contextTokens?: number
}

/** Relecture d'un appel, d'après les jetons que le modèle dit avoir lus ; `null` si elle n'a pas compté. */
export function judgeReread(inputTokens: number, c: RequestChange, first: boolean): Reread | null {
  if (inputTokens < REREAD_MIN || inputTokens <= c.newTokens + NEW_MARGIN) return null
  const full = c.contextTokens !== undefined && c.promptTokens >= c.contextTokens * FULL_SHARE
  const cause: RereadCause = c.change ?? (full ? 'full' : 'cache')
  return { tokens: inputTokens, promptTokens: c.promptTokens, cause, ...(first ? { first: true } : {}) }
}

/** La plus grosse relecture d'une réponse. */
export function mainReread(list: Array<Reread | null | undefined>): Reread | undefined {
  let best: Reread | undefined
  for (const r of list) if (r && (!best || r.tokens > best.tokens)) best = r
  return best
}

/** Un modèle rechargé au début de la réponse explique la relecture de son premier appel. */
export const withColdStart = (r: Reread | undefined, coldStart: boolean | undefined): Reread | undefined =>
  r && coldStart && r.first ? { ...r, cause: 'reload' } : r

const tokensText = (n: number): string => `${n.toLocaleString('fr-FR')} jetons`

/** Mot court sous la vitesse, dans la discussion. */
export const REREAD_LABEL: Record<RereadCause, string> = {
  reload: 'modèle rechargé',
  start: 'première lecture',
  tools: 'outils changés',
  system: 'consignes changées',
  'other-chat': 'autre discussion',
  summary: 'discussion résumée',
  full: 'fenêtre pleine',
  cache: 'tout relu'
}

/** L'explication complète (« Pourquoi ? »). */
export function rereadText(r: Reread): string {
  const read = tokensText(r.tokens)
  switch (r.cause) {
    case 'reload':
      return `Le modèle s’était déchargé : il a dû se recharger, puis tout relire (${read}).`
    case 'start':
      return `Premier passage de ce modèle sur les consignes et les outils de Compi (au démarrage, ou après un autre modèle) : il les a lus (${read}). Les questions suivantes en profitent.`
    case 'tools':
      return `Les outils envoyés au modèle ont changé depuis la question précédente (une extension chargée ou retirée) : il a relu les consignes, les outils et la discussion (${read}).`
    case 'system':
      return `Les consignes ont changé depuis la question précédente (mémoire, réglages ou niveau de réflexion) : le modèle a tout relu (${read}).`
    case 'other-chat':
      return `Tu reviens d’une autre discussion : le modèle a relu celle-ci en entier (${read}).`
    case 'summary':
      return `La discussion a été résumée ou réécrite pour tenir dans la fenêtre du modèle : il a relu la nouvelle version (${read}).`
    case 'full':
      return `La discussion remplit presque toute la fenêtre du modèle : il en coupe le début et relit tout à chaque question (${read}). Une nouvelle discussion répond bien plus vite.`
    case 'cache':
      return `Le modèle a tout relu (${read}) sans changement de ta part : ce qu’il avait déjà lu a été remplacé entre-temps (une autre tâche ou une autre application s’est servie du modèle).`
  }
}
