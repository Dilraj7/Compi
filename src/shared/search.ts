// Recherche universelle du plein écran : classement, extraits, et appariement des
// applis du menu Démarrer avec leurs raccourcis (pour l'icône). Fonctions pures,
// testées dans tests/search.test.ts. Sans accents ni casse, comme la palette.

import { foldText } from './memory'

/** Mots utiles de la recherche (une lettre seule ne compte pas, sauf si c'est tout ce qu'il y a). */
export function searchTerms(query: string): string[] {
  const all = foldText(query).split(' ').filter(Boolean)
  const long = all.filter((t) => t.length > 1)
  return (long.length ? long : all).slice(0, 8)
}

/**
 * Note d'un texte pour la recherche : 0 s'il manque un mot ; sinon 3 (le titre commence
 * par la recherche), 2 (un mot du titre commence par le premier mot), 1 (ailleurs).
 */
export function matchScore(title: string, query: string, more = ''): number {
  const terms = searchTerms(query)
  if (!terms.length) return 0
  const t = foldText(title)
  const hay = `${t} ${foldText(more)}`
  if (!terms.every((w) => hay.includes(w))) return 0
  if (t.startsWith(terms.join(' '))) return 3
  if (t.split(' ').some((w) => w.startsWith(terms[0]))) return 2
  return 1
}

/** Les meilleurs d'abord, `limit` au plus ; à note égale, l'ordre d'arrivée (souvent le plus récent). */
export function rank<T>(items: T[], score: (x: T) => number, limit: number): T[] {
  return items
    .map((x, i) => ({ x, s: score(x), i }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.x)
}

/** Extrait autour du premier mot trouvé, sur une ligne, `len` caractères environ. */
export function snippet(text: string, query: string, len = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const terms = searchTerms(query)
  // Repère la position sur le texte replié (sans accents) : mêmes longueurs si l'on ne retire que les accents.
  const folded = flat
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
  const same = folded.length === flat.length
  const at = same ? Math.min(...terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0), Infinity) : Infinity
  if (!Number.isFinite(at) || flat.length <= len) return flat.length > len ? `${flat.slice(0, len - 1).trimEnd()}…` : flat
  const start = Math.max(0, at - Math.round(len / 3))
  const end = Math.min(flat.length, start + len)
  return `${start > 0 ? '…' : ''}${flat.slice(start, end).trim()}${end < flat.length ? '…' : ''}`
}

/** Nom d'un raccourci : « C:\…\Programs\Microsoft Excel.lnk » → clé « microsoft excel ». */
export const shortcutKey = (path: string): string => foldText((path.split(/[\\/]/).pop() ?? '').replace(/\.lnk$/i, ''))

/** Index des raccourcis par nom ; le premier trouvé gagne (menu de l'utilisateur avant celui de tous). */
export function shortcutIndex(paths: string[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const p of paths) {
    if (!/\.lnk$/i.test(p)) continue
    const k = shortcutKey(p)
    if (k && !out.has(k)) out.set(k, p)
  }
  return out
}
