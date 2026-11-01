// Blocs du plein écran « Poste de pilotage », placés par l'utilisateur : colonne,
// ordre, masqué ou non. « À toi » (les cartes d'accord) n'en fait pas partie : il reste
// toujours en haut à droite. Fonctions pures, testées dans tests/fullBlocks.test.ts.

import type { FullBlockId, FullBlockPlace, FullColumn, FullSettings } from './types'

export const FULL_BLOCK_IDS: FullBlockId[] = [
  'missed',
  'agenda',
  'reminders',
  'timer',
  'mail',
  'call',
  'tasks',
  'recents',
  'messages',
  'routines'
]

export const DEFAULT_FULL_BLOCKS: FullBlockPlace[] = [
  { id: 'missed', col: 'left' },
  { id: 'agenda', col: 'left' },
  { id: 'reminders', col: 'left' },
  { id: 'timer', col: 'left' },
  { id: 'mail', col: 'left' },
  { id: 'call', col: 'right' },
  { id: 'tasks', col: 'right' },
  { id: 'recents', col: 'right' },
  { id: 'messages', col: 'right' },
  { id: 'routines', col: 'right' }
]

export const DEFAULT_FULL: FullSettings = { agenda: 'day', blocks: DEFAULT_FULL_BLOCKS }

const isId = (v: unknown): v is FullBlockId => typeof v === 'string' && (FULL_BLOCK_IDS as string[]).includes(v)

/**
 * Liste propre : identifiants connus, sans doublon. Un bloc absent (nouveau dans une
 * version suivante, ou fichier modifié à la main) reprend sa colonne par défaut, à la fin.
 */
export function normalizeBlocks(raw: unknown): FullBlockPlace[] {
  const out: FullBlockPlace[] = []
  for (const r of Array.isArray(raw) ? raw : []) {
    const b = (r ?? {}) as Partial<FullBlockPlace>
    if (!isId(b.id) || out.some((x) => x.id === b.id)) continue
    out.push({ id: b.id, col: b.col === 'right' ? 'right' : 'left', ...(b.hidden === true ? { hidden: true } : {}) })
  }
  for (const d of DEFAULT_FULL_BLOCKS) {
    if (out.some((x) => x.id === d.id)) continue
    const last = out.map((x) => x.col).lastIndexOf(d.col)
    out.splice(last < 0 ? out.length : last + 1, 0, { ...d })
  }
  return out
}

export function cleanFull(raw: Partial<FullSettings> | undefined): FullSettings {
  return { agenda: raw?.agenda === 'week' ? 'week' : 'day', blocks: normalizeBlocks(raw?.blocks) }
}

/** Blocs d'une colonne, dans l'ordre. */
export function columnBlocks(blocks: FullBlockPlace[], col: FullColumn): FullBlockPlace[] {
  return blocks.filter((b) => b.col === col)
}

/** Place `id` dans `col`, à la position `index` parmi les blocs de cette colonne. */
export function moveBlock(blocks: FullBlockPlace[], id: FullBlockId, col: FullColumn, index: number): FullBlockPlace[] {
  const moving = blocks.find((b) => b.id === id)
  if (!moving) return blocks
  const rest = blocks.filter((b) => b.id !== id)
  const inCol = rest.filter((b) => b.col === col)
  const at = Math.max(0, Math.min(inCol.length, Math.round(index)))
  const placed = { ...moving, col }
  // Avant le bloc qui occupe la place visée, ou après le dernier de la colonne.
  const before = inCol[at]
  if (before) {
    const i = rest.indexOf(before)
    return [...rest.slice(0, i), placed, ...rest.slice(i)]
  }
  const last = inCol[inCol.length - 1]
  const i = last ? rest.indexOf(last) + 1 : rest.length
  return [...rest.slice(0, i), placed, ...rest.slice(i)]
}

/** Déplacement au clavier : d'une place vers le haut ou le bas, ou vers l'autre colonne. */
export function shiftBlock(blocks: FullBlockPlace[], id: FullBlockId, dir: 'up' | 'down' | 'left' | 'right'): FullBlockPlace[] {
  const b = blocks.find((x) => x.id === id)
  if (!b) return blocks
  const index = columnBlocks(blocks, b.col).findIndex((x) => x.id === id)
  if (dir === 'up') return index > 0 ? moveBlock(blocks, id, b.col, index - 1) : blocks
  if (dir === 'down') return moveBlock(blocks, id, b.col, index + 1)
  const col: FullColumn = dir === 'left' ? 'left' : 'right'
  if (col === b.col) return blocks
  return moveBlock(blocks, id, col, Math.min(index, columnBlocks(blocks, col).length))
}

export function toggleBlock(blocks: FullBlockPlace[], id: FullBlockId): FullBlockPlace[] {
  return blocks.map((b) => (b.id !== id ? b : b.hidden ? { id: b.id, col: b.col } : { ...b, hidden: true }))
}
