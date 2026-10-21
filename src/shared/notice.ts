// Notifications de l'îlot : un texte trop long défile, et la notification reste
// affichée le temps de le lire jusqu'au bout (testé).

/** Durée d'une notification sans durée précisée. */
export const NOTICE_DEFAULT_MS = 4800
/** Plafond de la prolongation : un texte plus long se lit dans le panneau. */
export const NOTICE_MAX_MS = 20_000
/** Temps laissé pour lire la fin, une fois le défilement terminé. */
export const NOTICE_END_PAUSE_MS = 2000
/** Délai avant que le texte commence à défiler (le début se lit d'abord). */
export const TICKER_DELAY_MS = 1200
/** Vitesse du défilement, en pixels par seconde : environ 7 caractères par seconde. */
export const TICKER_PX_PER_S = 45

/** Temps du défilement pour un texte qui dépasse de `overflowPx` pixels (0 s'il tient). */
export function tickerMs(overflowPx: number): number {
  return overflowPx > 0 ? Math.round(TICKER_DELAY_MS + (overflowPx / TICKER_PX_PER_S) * 1000) : 0
}

/**
 * Durée d'affichage : celle demandée, prolongée si le texte défile pour qu'on le lise
 * en entier. Une durée demandée plus longue que le plafond (réunion…) est gardée.
 */
export function noticeDuration(duration: number | undefined, scrollMs = 0): number {
  const base = duration ?? NOTICE_DEFAULT_MS
  if (scrollMs <= 0) return base
  return Math.max(base, Math.min(NOTICE_MAX_MS, scrollMs + NOTICE_END_PAUSE_MS))
}
