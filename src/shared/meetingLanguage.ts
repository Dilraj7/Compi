// Langue des phrases d'une réunion. Parakeet choisit la langue tout seul, phrase par phrase,
// et ne peut pas recevoir de langue imposée : une phrase française mal partie (au milieu d'un
// mot, pleine de termes anglais) est parfois écrite en anglais phonétique (« donation » pour
// « données »). On repère ces phrases par leurs petits mots, sans rien envoyer nulle part.

import type { MeetingLanguage, MeetingLine } from './types'

export const MEETING_LANGUAGES: { id: MeetingLanguage; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'Anglais' }
]

export const isMeetingLanguage = (v: unknown): v is MeetingLanguage => v === 'auto' || v === 'fr' || v === 'en'

// Mots courts propres à chaque langue (ceux des deux, comme « on » ou « a », sont exclus).
const FR = new Set(
  'le la les de des du au aux et est un une que qui je tu il elle nous vous ils elles ce cette ces pour dans avec sur pas mais très aussi être avoir ça sont comme plus tout tous votre notre vos nos leur leurs fait faire peut donc alors bien où quand c qu j l'.split(
    ' '
  )
)
const EN = new Set(
  'the and you to of is that it for we this with are be have can so what they our your just do not at all from will there was which would about how if or my me i don t these those been were their them its into'.split(
    ' '
  )
)

/** Langue d'une phrase d'après ses petits mots ; `null` si elle est trop courte ou mêlée. */
export function lineLanguage(text: string): 'fr' | 'en' | null {
  let fr = 0
  let en = 0
  for (const w of text.toLocaleLowerCase('fr').split(/[^\p{L}]+/u)) {
    if (FR.has(w)) fr++
    else if (EN.has(w)) en++
  }
  if (en >= 2 && en >= fr * 2) return 'en'
  if (fr >= 2 && fr >= en * 2) return 'fr'
  return null
}

/**
 * Langue attendue des phrases : celle choisie, ou, en automatique, celle d'au moins 60 %
 * des phrases reconnues (6 au moins). Une réunion vraiment bilingue n'en a pas : rien n'est repris.
 */
export function expectedLanguage(lines: MeetingLine[], setting: MeetingLanguage): 'fr' | 'en' | null {
  if (setting !== 'auto') return setting
  let fr = 0
  let en = 0
  for (const l of lines) {
    const lang = lineLanguage(l.text)
    if (lang === 'fr') fr++
    else if (lang === 'en') en++
  }
  if (fr + en < 6) return null
  if (fr / (fr + en) >= 0.6) return 'fr'
  if (en / (fr + en) >= 0.6) return 'en'
  return null
}

/**
 * Phrases presque vides : 5 s de parole ou plus, mais moins d'un mot toutes les deux
 * secondes. Parakeet perd parfois la fin d'un long morceau (banc du 01/11 : 12 s de
 * parole rendues en « Bonne question. »).
 */
export function sparseLines(lines: MeetingLine[]): number[] {
  return lines.flatMap((l, i) => {
    const seconds = l.end - l.start
    const count = l.text.split(/\s+/).filter(Boolean).length
    return seconds >= 5 && count / seconds < 0.5 ? [i] : []
  })
}

/** Position des phrases écrites dans l'autre langue. */
export function wrongLanguageLines(lines: MeetingLine[], expected: 'fr' | 'en' | null): number[] {
  if (!expected) return []
  const other = expected === 'fr' ? 'en' : 'fr'
  return lines.flatMap((l, i) => (lineLanguage(l.text) === other ? [i] : []))
}
