// Voix naturelle (Supertonic 3, sur le PC) : ses dix voix, et la langue dans
// laquelle lire chaque morceau. Ce qu'elle ne sait pas lire (le tamoul, les
// écritures non latines) passe par la voix de Windows, comme avant.

/** Les dix voix, dans l'ordre du fichier voice.bin (femmes 0 à 4, hommes 5 à 9 ; vérifié à la hauteur de voix). */
export const NATURAL_VOICES = [
  { id: 'F1', label: 'Féminine 1' },
  { id: 'F2', label: 'Féminine 2' },
  { id: 'F3', label: 'Féminine 3' },
  { id: 'F4', label: 'Féminine 4' },
  { id: 'F5', label: 'Féminine 5' },
  { id: 'M1', label: 'Masculine 1' },
  { id: 'M2', label: 'Masculine 2' },
  { id: 'M3', label: 'Masculine 3' },
  { id: 'M4', label: 'Masculine 4' },
  { id: 'M5', label: 'Masculine 5' }
] as const

export const DEFAULT_NATURAL_VOICE = 'F1'

/** Numéro de la voix pour le moteur ; une voix inconnue (fichier modifié à la main) prend la première. */
export function naturalVoiceSid(id: string): number {
  return Math.max(
    0,
    NATURAL_VOICES.findIndex((v) => v.id === id)
  )
}

/** Langues lues par la voix naturelle ici (elle en connaît 31). */
export type NaturalLang = 'fr' | 'en'

const FR_WORDS = new Set(
  'le la les un une des du de et est sont pas pour que qui dans sur avec ce cette ces il elle ils elles je tu nous vous au aux en ne se mais où très plus ton ta tes mon ma mes son sa ses leur ça demain aujourd’hui oui non bonjour merci voici'.split(
    ' '
  )
)
const EN_WORDS = new Set(
  'the an and is are was were of to in for with that this it you we they not be have has your my at by from but what which will can do does there here yes no hello thanks today tomorrow'.split(
    ' '
  )
)
/** « l’heure », « qu’il » : l'élision est française ; « don’t », « it’s » ne la déclenchent pas. */
const ELISION = /^(qu|[ldjnmtsc])’\p{L}/u

/**
 * Langue d'un morceau à lire : français ou anglais selon les petits mots, français
 * en cas de doute. `null` : surtout une autre écriture (tamoul…), lue par Windows.
 */
export function naturalLang(text: string): NaturalLang | null {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (!letters) return 'fr'
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0
  if (latin / letters < 0.6) return null
  let fr = /[àâçéèêëîïôûùüÿœ]/iu.test(text) ? 1 : 0
  let en = 0
  for (const w of text
    .toLowerCase()
    .replace(/'/g, '’')
    .split(/[^\p{L}’]+/u)) {
    if (ELISION.test(w) || FR_WORDS.has(w)) fr++
    else if (EN_WORDS.has(w)) en++
  }
  return en > fr ? 'en' : 'fr'
}
