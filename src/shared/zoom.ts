// Taille du texte et de l'interface, réglée à part pour le panneau de l'encoche et pour le
// plein écran : sur un grand écran, on veut souvent plus grand en plein écran, alors que le
// panneau doit rester compact au-dessus des autres applications. C'est un zoom de toute la
// page (textes, icônes, marges), comme dans un navigateur. Fonctions pures, testées dans
// tests/zoom.test.ts.

import type { ZoomSettings } from './types'

/** Tailles proposées, en pour cent. */
export const ZOOM_STEPS = [80, 90, 100, 110, 125, 150, 175, 200]
/** Au-delà, le panneau de l'encoche couvrirait trop l'application en dessous. */
export const MAX_NOTCH_ZOOM = 150
export const DEFAULT_ZOOM: ZoomSettings = { notch: 100, full: 100 }
/** Le plein écran garde au moins cette place (en points de la page) : trois colonnes lisibles. */
export const FULL_MIN = { width: 960, height: 640 }

export type ZoomMode = keyof ZoomSettings
export interface Size {
  width: number
  height: number
}

/** La taille proposée la plus proche (fichier modifié à la main), 100 % sinon. */
export function nearestZoom(v: unknown, max = ZOOM_STEPS[ZOOM_STEPS.length - 1]): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 100
  return ZOOM_STEPS.filter((s) => s <= max).reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), 100)
}

export function cleanZoom(raw: Partial<ZoomSettings> | undefined): ZoomSettings {
  return { notch: nearestZoom(raw?.notch, MAX_NOTCH_ZOOM), full: nearestZoom(raw?.full) }
}

/** Taille suivante (+1), précédente (−1), ou 100 % (0). */
export function stepZoom(pct: number, dir: -1 | 0 | 1, mode: ZoomMode): number {
  if (dir === 0) return 100
  const steps = ZOOM_STEPS.filter((s) => mode === 'full' || s <= MAX_NOTCH_ZOOM)
  const i = steps.indexOf(nearestZoom(pct, steps[steps.length - 1]))
  return steps[Math.max(0, Math.min(steps.length - 1, i + dir))]
}

/**
 * Facteur vraiment appliqué. L'écran borne l'agrandissement, jamais la réduction : la
 * fenêtre de l'encoche doit tenir dans l'écran, et le plein écran garder au moins
 * `FULL_MIN`. Un petit écran reste donc à 100 % au moins.
 */
export function zoomFactor(mode: ZoomMode, pct: number, screen: Size, notchWindow: Size): number {
  const room = mode === 'full' ? FULL_MIN : notchWindow
  const fit = Math.min(screen.width / room.width, screen.height / room.height)
  return Math.min(pct / 100, Math.max(1, fit))
}
