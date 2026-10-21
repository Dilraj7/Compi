// Lecture de documents en texte, sans rien installer sur le PC : PDF, Word,
// Excel, PowerPoint, OpenDocument, CSV, HTML et fichiers texte. Les images
// sont gérées à part (outil read_document, via nativeImage).
// Aucune dépendance à Electron : testé dans tests/documents.test.ts.

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']

const TEXT_EXTENSIONS = new Set(
  (
    '.txt .md .markdown .log .json .jsonl .xml .yaml .yml .toml .ini .cfg .conf .env .eml .vtt .srt .tex ' +
    '.js .mjs .cjs .ts .tsx .jsx .py .rb .go .rs .java .kt .cs .cpp .c .h .hpp .php .swift .sql .sh .ps1 .bat .css .scss .vue .svelte'
  ).split(' ')
)

/** Extensions lisibles en texte par extractDocument (hors images). */
export const DOCUMENT_EXTENSIONS = [
  '.pdf', '.docx', '.xlsx', '.xlsm', '.pptx', '.odt', '.ods', '.odp', '.csv', '.tsv', '.html', '.htm', ...TEXT_EXTENSIONS
]

const LEGACY_OFFICE: Record<string, string> = { '.doc': '.docx', '.xls': '.xlsx', '.ppt': '.pptx' }

/** Au-delà, le fichier est refusé (protection mémoire). */
export const MAX_FILE_BYTES = 60 * 1024 * 1024

export interface ExtractedDocument {
  text: string
  /** Résumé du format, ex. « PDF · 12 pages ». */
  info: string
  /** PDF sans couche texte (scan) : le contenu est probablement dans les images. */
  scanned?: boolean
  pages?: number
}

export class UnsupportedDocumentError extends Error {}

// ─── HTML → texte lisible (titres, listes, tableaux conservés) ──────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      // Une cellule de tableau tient sur une ligne, même si elle contient des paragraphes.
      .replace(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner: string) => `${inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()} | `)
      .replace(/<h([1-6])[^>]*>/gi, (_m, n: string) => `\n\n${'#'.repeat(Number(n))} `)
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<tr[^>]*>/gi, '\n| ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|table|ul|ol|section|article)>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Texte d'un fichier XML Office/OpenDocument : un paragraphe par ligne. */
function xmlParagraphs(xml: string, paragraphEnd: RegExp, textRun: RegExp): string {
  return xml
    .split(paragraphEnd)
    .map((p) => decodeEntities([...p.matchAll(textRun)].map((m) => m[1]).join('')).trim())
    .filter(Boolean)
    .join('\n')
}

// ─── Formats ─────────────────────────────────────────────────────────────────

async function readPdf(buf: Buffer): Promise<ExtractedDocument> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buf))
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const pages = text.map((t, i) => `--- Page ${i + 1} ---\n${t.trim()}`)
  const chars = text.reduce((n, t) => n + t.trim().length, 0)
  return {
    text: pages.join('\n\n'),
    info: `PDF · ${totalPages} page${totalPages > 1 ? 's' : ''}`,
    pages: totalPages,
    scanned: chars < Math.max(40, totalPages * 25)
  }
}

async function readDocx(buf: Buffer): Promise<ExtractedDocument> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.convertToHtml({ buffer: buf })
  return { text: htmlToText(value), info: 'Document Word' }
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().replace(/T00:00:00\.000Z$/, '')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('result' in o) return cellText(o.result) // formule : on garde la valeur calculée
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('')
    if ('text' in o) return cellText(o.text)
    if ('error' in o) return String(o.error)
    return ''
  }
  return String(v).replace(/\r?\n/g, ' ')
}

const MAX_ROWS_PER_SHEET = 5000

async function readXlsx(buf: Buffer): Promise<ExtractedDocument> {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf as unknown as ArrayBuffer)
  const parts: string[] = []
  for (const ws of wb.worksheets) {
    const rows: string[] = []
    let truncated = false
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (rows.length >= MAX_ROWS_PER_SHEET) {
        truncated = true
        return
      }
      const values = (row.values as unknown[]).slice(1).map(cellText)
      while (values.length && !values.at(-1)) values.pop()
      if (values.length) rows.push(`${n} | ${values.join(' | ')}`)
    })
    parts.push(
      `### Feuille « ${ws.name} » (${ws.rowCount} lignes × ${ws.columnCount} colonnes)\n` +
        (rows.join('\n') || '(vide)') +
        (truncated ? `\n… (limité aux ${MAX_ROWS_PER_SHEET} premières lignes)` : '')
    )
  }
  return { text: parts.join('\n\n'), info: `Classeur Excel · ${wb.worksheets.length} feuille(s)` }
}

const slideNumber = (path: string): number => Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0)

async function readPptx(buf: Buffer): Promise<ExtractedDocument> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buf)
  const slides = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b))
  const parts: string[] = []
  for (const [i, path] of slides.entries()) {
    const xml = await zip.file(path)!.async('string')
    let body = xmlParagraphs(xml, /<\/a:p>/, /<a:t>([\s\S]*?)<\/a:t>/g)
    // Notes de l'orateur : liées à la diapositive par son fichier de relations.
    const rels = await zip.file(path.replace('slides/', 'slides/_rels/') + '.rels')?.async('string')
    const notesTarget = rels && /Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/.exec(rels)?.[1]
    const notesXml = notesTarget ? await zip.file(`ppt/notesSlides/${notesTarget}`)?.async('string') : undefined
    const notes = notesXml ? xmlParagraphs(notesXml, /<\/a:p>/, /<a:t>([\s\S]*?)<\/a:t>/g).replace(/^\d+$/m, '').trim() : ''
    if (notes) body += `\n[Notes] ${notes}`
    parts.push(`--- Diapositive ${i + 1} ---\n${body || '(sans texte)'}`)
  }
  return { text: parts.join('\n\n'), info: `Présentation PowerPoint · ${slides.length} diapositive(s)`, pages: slides.length }
}

async function readOpenDocument(buf: Buffer, ext: string): Promise<ExtractedDocument> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buf)
  const xml = (await zip.file('content.xml')?.async('string')) ?? ''
  const text = decodeEntities(
    xml
      .replace(/<text:tab\/>/g, '\t')
      .replace(/<text:line-break\/>/g, '\n')
      .replace(/<\/table:table-cell>/g, ' | ')
      .replace(/<\/(text:p|text:h|table:table-row)>/g, '\n')
      .replace(/<draw:page [^>]*draw:name="([^"]*)"[^>]*>/g, '\n--- $1 ---\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const kind = ext === '.ods' ? 'Classeur' : ext === '.odp' ? 'Présentation' : 'Document'
  return { text, info: `${kind} OpenDocument` }
}

// ─── Point d'entrée ──────────────────────────────────────────────────────────

export async function extractDocument(path: string): Promise<ExtractedDocument> {
  const ext = extname(path).toLowerCase()
  if (LEGACY_OFFICE[ext])
    throw new UnsupportedDocumentError(
      `Ancien format Office (${ext}) non pris en charge : enregistre le fichier en ${LEGACY_OFFICE[ext]} depuis Word, Excel ou PowerPoint.`
    )

  const { size } = await stat(path)
  if (size > MAX_FILE_BYTES) throw new UnsupportedDocumentError(`Fichier trop volumineux (${Math.round(size / 1e6)} Mo, maximum 60 Mo).`)
  const buf = await readFile(path)

  switch (ext) {
    case '.pdf':
      return readPdf(buf)
    case '.docx':
      return readDocx(buf)
    case '.xlsx':
    case '.xlsm':
      return readXlsx(buf)
    case '.pptx':
      return readPptx(buf)
    case '.odt':
    case '.ods':
    case '.odp':
      return readOpenDocument(buf, ext)
    case '.html':
    case '.htm':
      return { text: htmlToText(buf.toString('utf8')), info: 'Page HTML' }
    case '.csv':
    case '.tsv':
      return { text: buf.toString('utf8'), info: ext === '.csv' ? 'Tableau CSV' : 'Tableau TSV' }
  }
  if (TEXT_EXTENSIONS.has(ext) || !ext) {
    if (buf.subarray(0, 8000).includes(0)) throw new UnsupportedDocumentError(`${basename(path)} semble être un fichier binaire.`)
    return { text: buf.toString('utf8'), info: 'Fichier texte' }
  }
  throw new UnsupportedDocumentError(`Format ${ext} non pris en charge.`)
}

/** Découpe un long texte en parties pour ne pas saturer la conversation. */
export function paginate(text: string, part: number, size = 40_000): { chunk: string; part: number; parts: number } {
  const parts = Math.max(1, Math.ceil(text.length / size))
  const p = Math.min(Math.max(1, part), parts)
  return { chunk: text.slice((p - 1) * size, p * size), part: p, parts }
}
