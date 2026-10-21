// Recherche plein texte dans les dossiers que l'utilisateur a confiés à Compi,
// y compris à l'intérieur des PDF, Word, Excel et PowerPoint (ce que Grep ne
// sait pas faire). Le texte extrait est gardé en cache tant que le fichier ne
// change pas.

import { readdir, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { DOCUMENT_EXTENSIONS, extractDocument } from './documents'

const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'appdata'])
const MAX_FILES = 3000
const searchable = new Set(DOCUMENT_EXTENSIONS)

const cache = new Map<string, { mtime: number; text: string }>()

/** Vrai si `path` est `root` ou se trouve dedans (insensible à la casse sous Windows). */
export function isInside(path: string, root: string): boolean {
  const norm = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))
  const rel = relative(norm(root), norm(path))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Documents lisibles des dossiers donnés (3 000 au plus). */
export async function listDocuments(roots: string[]): Promise<string[]> {
  const files: string[] = []
  for (const root of roots) await walk(root, files)
  return files
}

async function walk(dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // dossier illisible : on l'ignore
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!e.name.startsWith('.') && !SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, out)
    } else if (e.isFile() && searchable.has(extname(e.name).toLowerCase()) && !e.name.startsWith('~$')) {
      out.push(full)
    }
  }
}

async function textOf(file: string): Promise<string> {
  const { mtimeMs, size } = await stat(file)
  const hit = cache.get(file)
  if (hit && hit.mtime === mtimeMs) return hit.text
  const text = size > 30 * 1024 * 1024 ? '' : (await extractDocument(file).catch(() => ({ text: '' }))).text
  cache.set(file, { mtime: mtimeMs, text })
  return text
}

export interface SearchHit {
  file: string
  score: number
  snippets: string[]
}

const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/**
 * Cherche `query` dans les documents de `roots`. Chaque mot compte : un fichier
 * qui contient tous les mots (ou dont le nom les contient) passe devant.
 */
export async function searchDocuments(roots: string[], query: string, limit = 15): Promise<{ hits: SearchHit[]; scanned: number }> {
  const terms = fold(query)
    .split(/\s+/)
    .filter((t) => t.length > 1)
  if (!terms.length) return { hits: [], scanned: 0 }

  const files: string[] = []
  for (const root of roots) await walk(root, files)

  const hits: SearchHit[] = []
  for (const file of files) {
    const text = await textOf(file)
    const name = fold(file)
    const body = fold(text)
    let score = 0
    for (const t of terms) {
      if (name.includes(t)) score += 3
      if (body.includes(t)) score += 1 + Math.min(4, body.split(t).length - 2)
    }
    if (!score) continue
    const snippets: string[] = []
    const covered: Array<[number, number]> = []
    for (const t of terms) {
      const i = body.indexOf(t)
      if (i < 0 || snippets.length >= 3) continue
      // Mot déjà visible dans un extrait précédent : pas de doublon.
      if (covered.some(([a, b]) => i >= a && i + t.length <= b)) continue
      const start = Math.max(0, i - 90)
      const end = i + t.length + 140
      covered.push([start, end])
      // Les accents sont retirés pour comparer, mais l'extrait garde le texte d'origine.
      snippets.push(text.slice(start, end).replace(/\s+/g, ' ').trim())
    }
    hits.push({ file, score, snippets })
  }
  hits.sort((a, b) => b.score - a.score)
  return { hits: hits.slice(0, limit), scanned: files.length }
}
