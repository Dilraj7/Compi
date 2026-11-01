// Ce que le plein écran partage avec ce qu'il affiche au centre (l'accueil de la
// discussion) : le contexte des propositions du moment et deux actions sur place.
// Petit module à part : la discussion de l'encoche l'importe sans charger le plein écran.

import { createContext, useContext } from 'react'
import type { HeroContext } from '@shared/hero'

export interface FullContextValue {
  hero: HeroContext | null
  /** Fait défiler jusqu'à « Ce que tu as manqué ». */
  showMissed(): void
  /** Passe l'agenda sur les 7 prochains jours. */
  showWeek(): void
}

export const FullContext = createContext<FullContextValue | null>(null)

/** `null` hors du plein écran. */
export const useFull = (): FullContextValue | null => useContext(FullContext)
