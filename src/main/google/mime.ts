// Construction d'un brouillon d'e-mail (RFC 5322 / MIME), en texte brut UTF-8.
// Fonctions pures, testées dans tests/google.test.ts. Aucun envoi ici : le
// brouillon est seulement déposé dans le dossier Brouillons de Gmail.

/** Retire retours à la ligne et caractères de contrôle : pas d'injection d'en-tête. */
export function cleanHeader(s: string): string {
  // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const ASCII_PRINTABLE = /^[\x20-\x7e]*$/

/** Mot encodé RFC 2047 si besoin (accents…), découpé en morceaux de 45 octets au plus. */
export function encodeWord(s: string): string {
  if (ASCII_PRINTABLE.test(s)) return s
  const words: string[] = []
  let chunk = ''
  for (const ch of s) {
    if (Buffer.byteLength(chunk + ch, 'utf8') > 45) {
      words.push(chunk)
      chunk = ''
    }
    chunk += ch
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ')
}

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/

/** « claire@exemple.fr, Paul <paul@exemple.fr> » → adresses validées et encodées. */
export function parseAddresses(raw: string): string[] {
  const parts = cleanHeader(raw)
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean)
  return parts.map((p) => {
    const named = /^(.*)<([^<>]+)>$/.exec(p)
    const addr = (named ? named[2] : p).trim()
    if (!EMAIL.test(addr)) throw new Error(`Adresse e-mail invalide : « ${p} ».`)
    const name = named?.[1].trim().replace(/^"|"$/g, '')
    if (!name) return addr
    return ASCII_PRINTABLE.test(name) ? `"${name.replace(/["\\]/g, '')}" <${addr}>` : `${encodeWord(name)} <${addr}>`
  })
}

/** Identifiant de message (« <…@…> »), sinon rien. */
const messageId = (v: string | undefined): string | undefined => {
  const c = v ? cleanHeader(v) : ''
  return /^<[^<>\s]+>$/.test(c) ? c : undefined
}

export interface DraftParts {
  to: string[]
  cc?: string[]
  subject: string
  body: string
  /** Réponse : Message-ID de l'e-mail d'origine et références du fil. */
  inReplyTo?: string
  references?: string
}

/** Message MIME complet (fins de ligne CRLF). */
export function buildMime(d: DraftParts): string {
  const refs = (d.references ?? '')
    .split(/\s+/)
    .map((r) => messageId(r))
    .filter((r): r is string => Boolean(r))
  const inReplyTo = messageId(d.inReplyTo)
  if (inReplyTo && !refs.includes(inReplyTo)) refs.push(inReplyTo)
  const headers = [
    ...(d.to.length ? [`To: ${d.to.join(', ')}`] : []),
    ...(d.cc?.length ? [`Cc: ${d.cc.join(', ')}`] : []),
    `Subject: ${encodeWord(cleanHeader(d.subject))}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(refs.length ? [`References: ${refs.join(' ')}`] : [])
  ]
  const body = Buffer.from(d.body.replace(/\r?\n/g, '\r\n'), 'utf8').toString('base64')
  const lines = body.match(/.{1,76}/g) ?? ['']
  return `${headers.join('\r\n')}\r\n\r\n${lines.join('\r\n')}\r\n`
}

/** Objet d'une réponse : « Re: » une seule fois. */
export const replySubject = (subject: string): string => (/^\s*(re|réf|ref)\s*:/i.test(subject) ? subject.trim() : `Re: ${subject.trim()}`)
