// Mémoire de Compi : petites fonctions pures (testées dans tests/memory.test.ts).

import type { MemoryItem } from './types'

/** Longueur maximale d'un souvenir, et nombre maximal de souvenirs. */
export const FACT_MAX = 500
export const MEMORY_MAX = 300

/** Minuscules, sans accents ni ponctuation : pour comparer et chercher. */
export const foldText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Nettoie un souvenir : une ligne, sans espaces superflus, longueur bornée. */
export function cleanFact(fact: string): string {
  return fact.replace(/\s+/g, ' ').trim().slice(0, FACT_MAX)
}

/** Deux souvenirs disent la même chose (au mot près). */
export const sameFact = (a: string, b: string): boolean => foldText(a) === foldText(b)

/** Souvenirs qui contiennent tous les mots de la requête (tous si elle est vide). */
export function searchFacts(items: MemoryItem[], query?: string): MemoryItem[] {
  const terms = foldText(query ?? '')
    .split(' ')
    .filter((t) => t.length > 1)
  if (!terms.length) return items
  return items.filter((i) => {
    const f = foldText(`${i.fact} ${i.conversation ?? ''}`)
    return terms.every((t) => f.includes(t))
  })
}

/** Ancien format (date ISO, sans source) → format actuel. */
export function upgradeItem(raw: Partial<MemoryItem> & { createdAt?: number | string }): MemoryItem | null {
  if (typeof raw.fact !== 'string' || !raw.fact.trim() || typeof raw.id !== 'string') return null
  const created = typeof raw.createdAt === 'string' ? Date.parse(raw.createdAt) : raw.createdAt
  return {
    id: raw.id,
    fact: cleanFact(raw.fact),
    createdAt: Number.isFinite(created) ? (created as number) : Date.now(),
    ...(raw.updatedAt ? { updatedAt: raw.updatedAt } : {}),
    source: raw.source === 'manual' ? 'manual' : 'chat',
    ...(raw.conversation ? { conversation: raw.conversation } : {})
  }
}
