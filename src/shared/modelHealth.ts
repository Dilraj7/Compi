// Fiabilité de chaque modèle local avec les outils : le vrai essai du bouton « Tester »
// (un appel d'outil factice) et, en usage, les appels écrits en texte au lieu d'être faits.
// Sert à conseiller seulement des modèles installés qui ont réussi l'essai. Rien n'est
// téléchargé. Fonctions pures, testées dans tests/modelHealth.test.ts.

export interface ModelHealth {
  /** Dernier vrai essai d'outil (bouton « Tester »). */
  tested?: { at: number; tools: boolean }
  /** Réponses locales comptées. */
  runs: number
  /** Appels écrits en texte, rattrapés en vrais appels par la passerelle. */
  repaired: number
  /** Appels écrits en texte qui n'ont pas pu être faits. */
  failed: number
  lastFailAt?: number
}

export type HealthBook = Record<string, ModelHealth>

/** Une semaine sans nouvel échec : le conseil s'efface. */
export const FAIL_MEMORY_MS = 7 * 24 * 3_600_000

/** « gemma4:12b-compi » est « gemma4:12b ». */
export const healthKey = (model: string): string => model.trim().replace(/-compi$/, '')

const empty = (): ModelHealth => ({ runs: 0, repaired: 0, failed: 0 })

export function recordRun(book: HealthBook, model: string, stats: { toolTextRepaired?: number; toolTextFailed?: number }, now: number): HealthBook {
  const key = healthKey(model)
  if (!key) return book
  const h = { ...empty(), ...book[key] }
  h.runs++
  h.repaired += stats.toolTextRepaired ?? 0
  if (stats.toolTextFailed) {
    h.failed += stats.toolTextFailed
    h.lastFailAt = now
  }
  return { ...book, [key]: h }
}

export function recordTest(book: HealthBook, model: string, tools: boolean, now: number): HealthBook {
  const key = healthKey(model)
  if (!key) return book
  return { ...book, [key]: { ...empty(), ...book[key], tested: { at: now, tools } } }
}

/** Ce modèle fait mal ses actions : un échec récent en usage, ou l'essai d'outil raté. */
export function unreliable(h: ModelHealth | undefined, now: number): boolean {
  if (!h) return false
  return h.tested?.tools === false || (h.failed > 0 && now - (h.lastFailAt ?? 0) < FAIL_MEMORY_MS)
}

/** Modèles à conseiller : installés, essai d'outil réussi, aucun échec récent ; les plus utilisés d'abord. */
export function reliableModels(book: HealthBook, installed: string[], current: string, now: number): string[] {
  const cur = healthKey(current)
  return installed
    .map(healthKey)
    .filter((m, i, all) => m !== cur && all.indexOf(m) === i)
    .filter((m) => book[m]?.tested?.tools === true && !unreliable(book[m], now))
    .sort((a, b) => (book[b]?.runs ?? 0) - (book[a]?.runs ?? 0))
}
