// Historique du presse-papier : fonctions pures (testées dans tests/clipboard.test.ts).

import type { ClipItem } from './types'

export const CLIP_MAX = 200
export const CLIP_DAYS = 30
export const CLIP_TEXT_MAX = 20_000

/** Applications de mots de passe : ce qui en est copié n'est jamais gardé. */
export const PASSWORD_APPS = /1password|keepass|bitwarden|dashlane|nordpass|enpass|lastpass|roboform|keeper|proton ?pass|passwordsafe|kee(per|web)/i

/**
 * Ressemble à un mot de passe ou à une clé : un seul « mot » de 10 à 128
 * caractères, sans espace, qui mélange au moins trois sortes de caractères.
 * Une adresse web ou un chemin de fichier n'en est pas un.
 */
export function isPasswordLike(text: string): boolean {
  const t = text.trim()
  if (!/^\S{10,128}$/.test(t)) return false
  if (/^(https?:\/\/|www\.|[a-z]:\\|\\\\|\/)/i.test(t) || /^[\w.+-]+@[\w-]+\.[\w.]+$/.test(t)) return false
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(t)).length
  return kinds >= 3
}

/** Ajoute une copie en tête (un doublon remonte), puis applique durée et nombre maximum. */
export function addClip(items: ClipItem[], item: ClipItem, now = Date.now()): ClipItem[] {
  const existing = items.find((i) => i.text === item.text)
  const rest = items.filter((i) => i.text !== item.text)
  const merged: ClipItem = existing ? { ...existing, at: item.at, source: item.source ?? existing.source } : item
  return pruneClips([merged, ...rest], now)
}

/** Retire ce qui a plus de 30 jours et ce qui dépasse 200 éléments (les épinglés restent). */
export function pruneClips(items: ClipItem[], now = Date.now()): ClipItem[] {
  const fresh = items.filter((i) => i.pinned || now - i.at < CLIP_DAYS * 86_400_000)
  let unpinned = 0
  return fresh
    .sort((a, b) => b.at - a.at)
    .filter((i) => i.pinned || ++unpinned <= CLIP_MAX)
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** Copies qui contiennent tous les mots de la requête, les plus récentes d'abord. */
export function searchClips(items: ClipItem[], query?: string, limit = 50): ClipItem[] {
  const terms = fold(query ?? '')
    .split(/\s+/)
    .filter(Boolean)
  const hits = terms.length ? items.filter((i) => terms.every((t) => fold(`${i.text} ${i.source ?? ''}`).includes(t))) : items
  return hits.slice(0, limit)
}
