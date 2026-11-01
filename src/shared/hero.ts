// Accueil du plein écran : des propositions selon le moment (matin, réunion qui
// approche, retour d'absence, fin ou début de semaine, e-mails non lus). Rien n'est
// demandé à un cerveau tant que l'utilisateur ne clique pas. Pur, testé dans tests/hero.test.ts.

export type HeroAction = 'prep' | 'missed' | 'week'

export interface HeroSuggestion {
  id: string
  label: string
  /** Question envoyée à Compi au clic. */
  prompt?: string
  /** Action sur place (préparer, montrer « Ce que tu as manqué », passer à 7 jours). */
  action?: HeroAction
  /** Rendez-vous concerné (`prepKey`). */
  prepKey?: string
}

export interface HeroContext {
  now: Date
  /** Prochaine réunion préparable (« Préparer ma réunion » activé). */
  nextMeeting?: { title: string; start: number; prepKey: string }
  missed: number
  unread: number
}

const clip = (s: string, n = 32): string => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Propositions du moment, les plus utiles d'abord (3 au plus). */
export function heroSuggestions(c: HeroContext): HeroSuggestion[] {
  const out: HeroSuggestion[] = []
  const h = c.now.getHours()
  const day = c.now.getDay()
  const t = c.now.getTime()
  const m = c.nextMeeting
  if (m && m.start > t && m.start - t <= 30 * 60_000)
    out.push({ id: 'prep', label: `Prépare « ${clip(m.title)} »`, action: 'prep', prepKey: m.prepKey })
  if (c.missed > 0) out.push({ id: 'missed', label: 'Ce que j’ai manqué', action: 'missed' })
  if ((day === 5 && h >= 14) || (day === 1 && h < 12))
    out.push({
      id: 'week',
      label: day === 5 ? 'Ma semaine prochaine' : 'Ma semaine',
      action: 'week',
      prompt: 'Fais le point sur mes 7 prochains jours : rendez-vous, tâches et échéances, en quelques lignes.'
    })
  if (h >= 5 && h < 11)
    out.push({ id: 'morning', label: 'Fais le point sur ma journée', prompt: 'Fais le point sur ma journée : rendez-vous, tâches et e-mails importants, en quelques lignes.' })
  if (c.unread > 0) out.push({ id: 'mail', label: 'Résume mes e-mails non lus', prompt: 'Résume mes e-mails non lus, les plus importants d’abord.' })
  return out.slice(0, 3)
}
