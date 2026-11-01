// Disposition du plein écran « Poste de pilotage » selon la largeur de l'écran.

export interface FullLayout {
  /** Colonne « Ta journée » à gauche ; sans elle, la journée reste dans l'onglet Aujourd'hui. */
  left: number | null
  /** Colonne « À toi » à droite. */
  right: number
  /** Largeur maximale du texte de la discussion, au centre. */
  center: number
}

/**
 * À partir de 2400 px (écran large, 3440 × 1440 à 100-125 %) : colonnes plus larges, pour
 * que l'agenda et les tâches respirent. À partir de 1600 px : trois colonnes. De 1280 à 1600 px : colonnes plus étroites.
 * Sous 1280 px : la colonne de gauche disparaît (même contenu dans Aujourd'hui).
 */
export function fullLayout(width: number): FullLayout {
  if (width >= 2400) return { left: 420, right: 460, center: 980 }
  if (width >= 1600) return { left: 340, right: 400, center: 860 }
  if (width >= 1280) return { left: 300, right: 340, center: 760 }
  return { left: null, right: Math.max(300, Math.min(360, Math.round(width * 0.3))), center: 720 }
}
