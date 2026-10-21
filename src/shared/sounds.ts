// Sons discrets de Compi : quel son pour quel évènement, et quand se taire.
// Fonctions pures, testées dans tests/sounds.test.ts. Les sons eux-mêmes sont
// créés par le panneau (Web Audio), sans fichier.

import { inQuietHours } from './messages'
import type { PillId } from './pills'
import type { SoundSettings, SoundVolume } from './types'

export type SoundKind = 'attention' | 'reminder' | 'message' | 'ok' | 'done'

export const SOUND_KINDS: SoundKind[] = ['attention', 'reminder', 'message', 'done', 'ok']

/** Son d'une notification de l'îlot, ou `null` pour rester muet. */
export function soundFor(pill: PillId): SoundKind | null {
  switch (pill) {
    case 'reminder':
    case 'timer':
    case 'meeting':
    case 'today':
      return 'reminder'
    case 'message':
      return 'message'
    case 'routine':
    case 'claude-done':
      return 'done'
    case 'approval':
    case 'question':
      return 'attention'
    default:
      return null
  }
}

/** Interrupteur des réglages qui commande chaque son. */
export const SOUND_SETTING: Record<SoundKind, 'approvals' | 'reminders' | 'messages' | 'routines'> = {
  attention: 'approvals',
  ok: 'approvals',
  reminder: 'reminders',
  message: 'messages',
  done: 'routines'
}

export const SOUND_GAIN: Record<SoundVolume, number> = { 'very-low': 0.05, low: 0.1, medium: 0.2 }

export interface SoundContext {
  settings: SoundSettings
  now: number
  /** Pomodoro en cours (concentration). */
  focus: boolean
  /** Réunion en cours (agenda). */
  meeting: boolean
  /** Une application est en plein écran (jeu, vidéo, présentation). */
  fullscreen: boolean
  /** Pastille de la notification, s'il y en a une. */
  pill?: PillId
}

/**
 * Jouer ce son maintenant ?
 * « ok » répond à une touche que l'on vient de presser : il suit seulement
 * l'interrupteur général et celui des autorisations.
 */
export function shouldPlay(kind: SoundKind, ctx: SoundContext): boolean {
  const s = ctx.settings
  if (!s.enabled || !s[SOUND_SETTING[kind]]) return false
  if (kind === 'ok') return true
  // Pendant un pomodoro, seule sa fin (le minuteur) sonne.
  if (ctx.fullscreen || (ctx.focus && ctx.pill !== 'timer')) return false
  // En réunion, seule l'alerte de la réunion sonne.
  if (ctx.meeting && ctx.pill !== 'meeting') return false
  return !inQuietHours(ctx.now, s.quietStart, s.quietEnd)
}
