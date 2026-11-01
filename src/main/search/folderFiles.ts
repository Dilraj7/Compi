// Fichiers des dossiers confiés, que Windows les indexe ou non. Windows Search n'indexe
// par défaut que les dossiers de l'utilisateur (Documents, Bureau…) : un dossier confié
// sur D:\ n'y est pas. Ces dossiers-là sont parcourus directement (noms et dates
// seulement, 3 000 fichiers au plus), avec un cache de 2 minutes.

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { matchScore, rank } from '../../shared/search'
import type { FileSearchHit } from '../../shared/types'
import { searchFiles } from '../windows/search'

const SKIP_DIRS = new Set(['node_modules', '.git', '$recycle.bin', 'system volume information', 'appdata'])
const MAX_FILES = 3000
const indexed = new Map<string, { at: number; yes: boolean }>()
const walked = new Map<string, { at: number; files: FileSearchHit[] }>()

/** Le dossier est-il dans l'index de Windows ? (une requête, gardée 10 min) */
export async function isIndexed(root: string): Promise<boolean> {
  const hit = indexed.get(root)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.yes
  let yes: boolean
  try {
    yes = (await searchFiles({ query: '', modifiedWithinDays: 36_500, limit: 1, scopes: [root] })).length > 0
  } catch {
    yes = false
  }
  indexed.set(root, { at: Date.now(), yes })
  return yes
}

/** Sépare les dossiers indexés par Windows de ceux à parcourir. */
export async function splitIndexed(roots: string[]): Promise<{ indexed: string[]; walk: string[] }> {
  const flags = await Promise.all(roots.map(isIndexed))
  return { indexed: roots.filter((_, i) => flags[i]), walk: roots.filter((_, i) => !flags[i]) }
}

async function walk(dir: string, out: FileSearchHit[]): Promise<void> {
  if (out.length >= MAX_FILES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // dossier illisible : on l'ignore
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.') || e.name.startsWith('~$')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name.toLowerCase())) await walk(full, out)
    } else if (e.isFile()) {
      try {
        out.push({ path: full, name: e.name, modified: new Date((await stat(full)).mtimeMs).toISOString() })
      } catch {
        // fichier disparu entre-temps
      }
    }
  }
}

/** Tous les fichiers d'un dossier (noms et dates), relus au plus toutes les 2 minutes. */
export async function filesIn(root: string): Promise<FileSearchHit[]> {
  const hit = walked.get(root)
  if (hit && Date.now() - hit.at < 2 * 60_000) return hit.files
  const files: FileSearchHit[] = []
  await walk(root, files)
  walked.set(root, { at: Date.now(), files })
  return files
}

/** Modifiés depuis `days` jours, le plus récent d'abord. */
export async function recentWalked(roots: string[], days: number, limit: number, now = Date.now()): Promise<FileSearchHit[]> {
  const since = now - days * 86_400_000
  const all = (await Promise.all(roots.map(filesIn))).flat()
  return all
    .filter((f) => f.modified && Date.parse(f.modified) >= since)
    .sort((a, b) => Date.parse(b.modified!) - Date.parse(a.modified!))
    .slice(0, limit)
}

/** Par le nom seulement (le contenu de ces dossiers passe par la recherche par le sens). */
export async function nameSearch(roots: string[], query: string, limit: number): Promise<FileSearchHit[]> {
  const all = (await Promise.all(roots.map(filesIn))).flat()
  return rank(all, (f) => matchScore(f.name.replace(/\.[^.]+$/, ''), query), limit)
}

/** Récents des deux sortes, fusionnés par date. */
export function byDate(lists: FileSearchHit[][], limit: number): FileSearchHit[] {
  const seen = new Set<string>()
  return lists
    .flat()
    .filter((f) => !seen.has(f.path.toLowerCase()) && seen.add(f.path.toLowerCase()))
    .sort((a, b) => (b.modified ? Date.parse(b.modified) : 0) - (a.modified ? Date.parse(a.modified) : 0))
    .slice(0, limit)
}
