// Lecture à voix haute : transforme une réponse en Markdown en texte à dire,
// puis la découpe en morceaux courts pour que la voix démarre vite. Pendant que
// la réponse s'écrit, seules les phrases terminées partent à la voix (testé).

/** Morceau le plus long envoyé d'un coup à la voix de Windows. */
export const SPEECH_CHUNK = 320
/** Au-delà, on ne lit pas tout : la réponse est à l'écran. */
export const SPEECH_MAX = 4000

/** Le texte à dire : sans code, sans liens ni balises Markdown, sans émojis. */
export function speechText(markdown: string): string {
  const t = cleanSpeech(markdown)
  return t.length > SPEECH_MAX ? capSpeech(t, SPEECH_MAX) : t
}

/** Coupe au dernier mot avant `max` caractères, et prévient que la suite est à l'écran. */
export function capSpeech(text: string, max: number): string {
  return `${text.slice(0, Math.max(0, max)).replace(/\s+\S*$/, '')}… La suite est à l’écran.`
}

/** Le Markdown nettoyé pour la voix, sans plafond de longueur. */
export function cleanSpeech(markdown: string): string {
  let t = markdown.replace(/\r\n?/g, '\n')
  t = t.replace(/```[\s\S]*?(```|$)/g, '\n(Le code est à l’écran.)\n')
  t = t.replace(/`([^`\n]+)`/g, '$1')
  // Images, puis liens : on garde le texte du lien.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  t = t.replace(/<?https?:\/\/[^\s>)]+>?/g, 'ce lien')
  // Tableaux : les séparateurs disparaissent, les cellules deviennent une liste.
  // (Sur une ligne : [ \t] plutôt que \s, qui avalerait les retours à la ligne.)
  t = t.replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '')
  t = t.replace(
    /^[ \t]*\|(.*)\|[ \t]*$/gm,
    (_, row: string) =>
      `${row
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(', ')}.`
  )
  t = t.replace(/^[ \t]{0,3}#{1,6}[ \t]+(.*)$/gm, '$1.')
  t = t.replace(/^[ \t]{0,3}>[ \t]?/gm, '')
  t = t.replace(/^[ \t]*([-*+]|\d+[.)])[ \t]+/gm, '')
  t = t.replace(/^[ \t]*([-*_][ \t]*){3,}$/gm, '')
  t = t.replace(/(\*\*|__)(.+?)\1/g, '$2')
  t = t.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
  t = t.replace(/~~(.+?)~~/g, '$1')
  // Restes d'une mise en forme coupée (la voix dirait « astérisque »).
  t = t.replace(/\*{2,}|_{2,}|~~/g, '')
  t = t.replace(/<[^>\n]+>/g, '')
  t = t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
  t = t.replace(/\.{2,}\./g, '.')
  t = t.replace(/[ \t]+/g, ' ')
  return t.replace(/\n{2,}/g, '\n').trim()
}

/** Ligne qui se lit seulement entière : tableau, titre, citation, liste, bloc de code. */
const WHOLE_LINE = /^[ \t]*(\||#{1,6}[ \t]|>|[-*+][ \t]|\d+[.)][ \t]|```|~~~)/
/** Fin de phrase suivie d'un espace : on peut couper juste après. */
const SENTENCE_END = /[.!?…](?=[ \t])/g

/** Mise en forme équilibrée : couper ici ne laisse ni gras, ni code, ni lien à moitié. */
function balanced(text: string): boolean {
  const count = (re: RegExp): number => text.match(re)?.length ?? 0
  return count(/\*\*/g) % 2 === 0 && count(/__/g) % 2 === 0 && count(/`/g) % 2 === 0 && count(/\[/g) === count(/\]/g) && count(/\(/g) === count(/\)/g)
}

/**
 * Réponse en cours d'écriture : position jusqu'où le texte peut déjà être lu, à partir
 * de `from`. On coupe à la fin d'une ligne complète, ou après une phrase terminée dans
 * un paragraphe ; jamais dans un bloc de code ouvert, ni au milieu d'un tableau, d'un
 * titre ou d'une liste. Renvoie `from` s'il faut attendre la suite.
 */
export function speakableEnd(markdown: string, from = 0): number {
  let best = from
  let inFence = false
  let lineStart = 0
  while (lineStart < markdown.length) {
    const nl = markdown.indexOf('\n', lineStart)
    const complete = nl !== -1
    const line = markdown.slice(lineStart, complete ? nl : markdown.length)
    if (/^[ \t]*(```|~~~)/.test(line)) inFence = !inFence
    if (complete) {
      if (!inFence && nl + 1 > best) best = nl + 1
    } else if (!inFence && !WHOLE_LINE.test(line)) {
      // Dernière ligne, encore en train de s'écrire : jusqu'à la dernière phrase terminée.
      for (const m of line.matchAll(SENTENCE_END)) {
        const end = m.index + 1
        if (lineStart + end > best && balanced(line.slice(0, end))) best = lineStart + end
      }
    }
    if (!complete) break
    lineStart = nl + 1
  }
  return best
}

/**
 * Découpe en morceaux d'au plus `max` caractères, en coupant de préférence
 * entre deux phrases, sinon entre deux mots. Le premier morceau est plus
 * court (`first`) : la voix commence pendant que la suite se prépare.
 */
export function speechChunks(text: string, max = SPEECH_CHUNK, first = 160): string[] {
  const sentences = text
    .split(/(?<=[.!?…:;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  let cur = ''
  const limit = (): number => (out.length ? max : Math.min(first, max))
  const push = (): void => {
    if (cur) out.push(cur)
    cur = ''
  }
  for (const s of sentences) {
    if (cur && cur.length + 1 + s.length > limit()) push()
    let rest = s
    while (!cur && rest.length > limit()) {
      const lim = limit()
      const cut = rest.lastIndexOf(' ', lim)
      const at = cut > lim / 2 ? cut : lim
      out.push(rest.slice(0, at).trim())
      rest = rest.slice(at).trim()
    }
    cur = cur ? `${cur} ${rest}` : rest
  }
  push()
  return out.filter(Boolean)
}
