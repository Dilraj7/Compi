// Transcription flottante d'un appel : réglages vérifiés et place de la fenêtre (toujours
// visible sur un écran, même après avoir débranché celui où elle était). Fonctions pures,
// testées dans tests/floating.test.ts.

import type { FloatingSettings } from './types'

export const DEFAULT_FLOATING: FloatingSettings = { auto: true, compact: false, opacity: 0.94 }

export const FLOAT_SIZE = { width: 380, height: 300 }
export const FLOAT_COMPACT_HEIGHT = 140
export const FLOAT_MIN = { width: 280, height: 110 }

type Rect = { x: number; y: number; width: number; height: number }

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)

export function cleanBounds(raw: unknown): Rect | undefined {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Rect>
  const [x, y, width, height] = [num(r.x), num(r.y), num(r.width), num(r.height)]
  if (x === null || y === null || width === null || height === null) return undefined
  return { x, y, width: Math.max(FLOAT_MIN.width, Math.min(width, 2000)), height: Math.max(FLOAT_MIN.height, Math.min(height, 2000)) }
}

export function cleanFloating(raw: unknown): FloatingSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<FloatingSettings>
  const opacity = typeof r.opacity === 'number' && Number.isFinite(r.opacity) ? Math.min(1, Math.max(0.5, r.opacity)) : DEFAULT_FLOATING.opacity
  const bounds = cleanBounds(r.bounds)
  return { auto: r.auto !== false, compact: r.compact === true, opacity, ...(bounds ? { bounds } : {}) }
}

/** Par défaut : en bas à droite de l'écran principal, au-dessus de la barre des tâches. */
export function defaultFloatBounds(work: Rect, compact = false): Rect {
  const height = compact ? FLOAT_COMPACT_HEIGHT : FLOAT_SIZE.height
  return { x: work.x + work.width - FLOAT_SIZE.width - 24, y: work.y + work.height - height - 24, width: FLOAT_SIZE.width, height }
}

/**
 * Place gardée, ramenée sur un écran si elle n'en touche plus aucun (écran débranché) ou
 * si elle déborde : au moins la barre du haut reste attrapable.
 */
export function placeFloat(saved: Rect | undefined, works: Rect[], compact = false): Rect {
  const primary = works[0]
  if (!saved || !primary) return defaultFloatBounds(primary ?? { x: 0, y: 0, width: 1280, height: 720 }, compact)
  const overlap = (w: Rect): number =>
    Math.max(0, Math.min(saved.x + saved.width, w.x + w.width) - Math.max(saved.x, w.x)) *
    Math.max(0, Math.min(saved.y + saved.height, w.y + w.height) - Math.max(saved.y, w.y))
  const best = works.reduce((a, b) => (overlap(b) > overlap(a) ? b : a), primary)
  if (overlap(best) === 0) return defaultFloatBounds(primary, compact)
  const width = Math.min(saved.width, best.width)
  const height = Math.min(saved.height, best.height)
  return {
    x: Math.min(Math.max(saved.x, best.x), best.x + best.width - width),
    y: Math.min(Math.max(saved.y, best.y), best.y + best.height - height),
    width,
    height
  }
}
