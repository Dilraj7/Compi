// Recherche de la palette (Ctrl+K) : sans accents, les débuts de mots d'abord.
// Fonction pure, testée dans tests/palette.test.ts.

import { foldText } from './memory'

export type PaletteGroup = 'Actions' | 'Vues' | 'Réglages' | 'Discussions'

export interface PaletteEntry {
  id: string
  label: string
  group: PaletteGroup
  /** Autres mots qui doivent trouver cette entrée (« sons » → « bip »…). */
  keywords?: string
}

const GROUP_ORDER: PaletteGroup[] = ['Actions', 'Vues', 'Réglages', 'Discussions']

/**
 * Entrées qui contiennent tous les mots tapés (dans le titre ou les mots-clés),
 * classées : titre qui commence par la recherche, puis un mot du titre qui
 * commence par le premier mot, puis le reste. Sans recherche : tout sauf les
 * vieilles discussions (les 5 plus récentes).
 */
export function searchPalette<T extends PaletteEntry>(items: T[], query: string, limit = 12): T[] {
  const q = foldText(query)
  if (!q) {
    const recent = items.filter((i) => i.group === 'Discussions').slice(0, 5)
    return [...items.filter((i) => i.group !== 'Discussions'), ...recent].slice(0, limit)
  }
  const terms = q.split(' ')
  const scored: Array<{ item: T; score: number; index: number }> = []
  items.forEach((item, index) => {
    const label = foldText(item.label)
    const hay = `${label} ${foldText(item.keywords ?? '')}`
    if (!terms.every((t) => hay.includes(t))) return
    const words = label.split(' ')
    let score = 0
    if (label.startsWith(q)) score = 3
    else if (words.some((w) => w.startsWith(terms[0]))) score = 2
    else if (label.includes(terms[0])) score = 1
    scored.push({ item, score, index })
  })
  return scored
    .sort((a, b) => b.score - a.score || GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.item)
}
