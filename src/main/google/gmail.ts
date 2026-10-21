// Gmail : chercher et lire des e-mails, préparer des brouillons.
// Il n'y a volontairement AUCUNE fonction d'envoi : l'utilisateur relit et envoie
// lui-même depuis Gmail, Mailbird, Outlook… (vérifié par tests/google.test.ts).

import { gmailWebUrl, isMailId } from '../../shared/day'
import type { DayMail } from '../../shared/types'

export { gmailWebUrl, isMailId }
import { htmlToText } from '../agent/documents'
import { googleApi, googleEndpoints } from './connect'
import { buildMime, parseAddresses, replySubject } from './mime'

export interface MailSummary extends DayMail {
  threadId: string
  snippet: string
  unread: boolean
}

interface Header {
  name: string
  value: string
}

interface Part {
  mimeType?: string
  filename?: string
  headers?: Header[]
  body?: { data?: string; size?: number; attachmentId?: string }
  parts?: Part[]
}

interface RawMessage {
  id: string
  threadId: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: Part
}

const header = (headers: Header[] | undefined, name: string): string =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

const api = (): string => `${googleEndpoints().gmail}/users/me`

function summary(m: RawMessage): MailSummary {
  const h = m.payload?.headers
  return {
    id: m.id,
    threadId: m.threadId,
    from: header(h, 'From'),
    subject: header(h, 'Subject') || '(sans objet)',
    date: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : undefined,
    snippet: decodeEntities(m.snippet ?? ''),
    unread: m.labelIds?.includes('UNREAD') ?? false,
    important: m.labelIds?.includes('IMPORTANT') ?? false
  }
}

const decodeEntities = (s: string): string =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** Exécute au plus `n` tâches à la fois. */
async function limited<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i])
      }
    })
  )
  return out
}

/** Recherche avec la syntaxe de Gmail (« is:unread newer_than:2d », « from:claire »). */
export async function searchMail(query: string, max = 10): Promise<{ total: number; mails: MailSummary[] }> {
  const params = new URLSearchParams({ q: query, maxResults: String(Math.min(Math.max(max, 1), 20)) })
  const list = await googleApi<{ messages?: { id: string }[]; resultSizeEstimate?: number }>(`${api()}/messages?${params}`)
  const ids = (list.messages ?? []).map((m) => m.id).filter(isMailId)
  const meta = 'format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date'
  const mails = await limited(ids, 5, async (id) => summary(await googleApi<RawMessage>(`${api()}/messages/${id}?${meta}`)))
  return { total: list.resultSizeEstimate ?? mails.length, mails }
}

/** Non lus de la boîte de réception, hors promotions et réseaux sociaux. */
export const unreadInbox = (max = 5): Promise<{ total: number; mails: MailSummary[] }> =>
  searchMail('is:unread in:inbox -category:promotions -category:social -category:forums', max)

function decodeBody(part: Part): string {
  const data = part.body?.data
  if (!data) return ''
  const bytes = Buffer.from(data, 'base64url')
  const charset = /charset="?([\w-]+)/i.exec(header(part.headers, 'Content-Type'))?.[1] ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

/** Texte d'un e-mail : la partie texte, sinon la partie HTML convertie (pur, testé). */
export function messageText(payload: Part | undefined): { text: string; attachments: string[] } {
  const attachments: string[] = []
  let plain = ''
  let html = ''
  const walk = (p: Part | undefined): void => {
    if (!p) return
    if (p.filename) {
      attachments.push(p.filename)
      return
    }
    if (p.mimeType === 'text/plain' && !plain) plain = decodeBody(p)
    else if (p.mimeType === 'text/html' && !html) html = decodeBody(p)
    p.parts?.forEach(walk)
  }
  walk(payload)
  const text = (plain || htmlToText(html)).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, attachments }
}

const MAX_BODY = 15_000

/** Lit un e-mail entier, mis en forme pour le modèle. */
export async function readMail(id: string): Promise<string> {
  if (!isMailId(id)) throw new Error('Identifiant d’e-mail invalide.')
  const m = await googleApi<RawMessage>(`${api()}/messages/${id}?format=full`)
  const h = m.payload?.headers
  const { text, attachments } = messageText(m.payload)
  const body = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}\n[…suite tronquée]` : text
  return [
    `De : ${header(h, 'From')}`,
    `À : ${header(h, 'To')}`,
    header(h, 'Cc') ? `Cc : ${header(h, 'Cc')}` : '',
    `Date : ${header(h, 'Date')}`,
    `Objet : ${header(h, 'Subject') || '(sans objet)'}`,
    attachments.length ? `Pièces jointes : ${attachments.join(', ')}` : '',
    '',
    body || '(e-mail sans texte)'
  ]
    .filter((l, i) => l || i === 6)
    .join('\n')
}

export interface DraftRequest {
  to?: string
  cc?: string
  subject?: string
  body: string
  /** Répondre à cet e-mail : destinataire, objet et fil sont repris. */
  replyToId?: string
}

/** Dépose un brouillon dans Gmail. Rien n'est envoyé. */
export async function createDraft(d: DraftRequest): Promise<{ draftId: string; to: string[]; subject: string }> {
  let to = d.to?.trim() ? parseAddresses(d.to) : []
  const cc = d.cc?.trim() ? parseAddresses(d.cc) : []
  let subject = d.subject?.trim() ?? ''
  let threadId: string | undefined
  let inReplyTo: string | undefined
  let references: string | undefined
  if (d.replyToId) {
    if (!isMailId(d.replyToId)) throw new Error('Identifiant d’e-mail invalide.')
    const meta = 'format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References'
    const orig = await googleApi<RawMessage>(`${api()}/messages/${d.replyToId}?${meta}`)
    const h = orig.payload?.headers
    threadId = orig.threadId
    inReplyTo = header(h, 'Message-ID')
    references = header(h, 'References')
    if (!to.length) to = parseAddresses(header(h, 'Reply-To') || header(h, 'From'))
    if (!subject) subject = replySubject(header(h, 'Subject'))
  }
  if (!to.length) throw new Error('Il faut au moins un destinataire.')
  if (!d.body.trim()) throw new Error('Le brouillon est vide.')
  const raw = Buffer.from(buildMime({ to, cc, subject, body: d.body, inReplyTo, references }), 'utf8').toString('base64url')
  const r = await googleApi<{ id: string }>(`${api()}/drafts`, { method: 'POST', body: { message: { raw, ...(threadId ? { threadId } : {}) } } })
  return { draftId: r.id, to, subject }
}

/** Liste lisible pour le modèle. */
export function formatMails(r: { total: number; mails: MailSummary[] }): string {
  if (!r.mails.length) return 'Aucun e-mail ne correspond.'
  const fmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const head = r.total > r.mails.length ? `${r.mails.length} e-mails affichés sur environ ${r.total} :` : `${r.mails.length} e-mail(s) :`
  return [
    head,
    ...r.mails.map(
      (m) =>
        `- [${m.id}] ${m.date ? fmt.format(new Date(m.date)) : ''} · ${m.from} · « ${m.subject} »${m.unread ? ' · non lu' : ''}${m.important ? ' · important' : ''}\n  ${m.snippet}`
    )
  ].join('\n')
}
