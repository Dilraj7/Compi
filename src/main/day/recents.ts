// « Récents » du plein écran : les dernières réunions enregistrées et les fichiers
// modifiés cette semaine dans les dossiers confiés (index de Windows Search, ou lecture
// directe des dossiers qu'il n'indexe pas ; jamais ailleurs). Rien n'est envoyé à un cerveau.

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { shell } from 'electron'
import type { RecentFile, RecentMeeting, RecentsInfo } from '../../shared/types'
import { launchesProgram } from '../agent/folderTools'
import { allowedFolders, insideAny } from '../agent/folders'
import { log } from '../log'
import { getMeeting, listMeetings } from '../meetings/store'
import { byDate, recentWalked, splitIndexed } from '../search/folderFiles'
import { searchFiles } from '../windows/search'

const MEETINGS = 3
const FILES = 6

/** Première phrase du résumé, courte. */
export function firstSentence(text: string, max = 160): string {
  const t = text.replace(/\s+/g, ' ').trim()
  const end = t.search(/[.!?…](\s|$)/)
  const s = end > 0 ? t.slice(0, end + 1) : t
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s
}

function recentMeetings(): RecentMeeting[] {
  return listMeetings()
    .filter((m) => m.status !== 'recording')
    .slice(0, MEETINGS)
    .map((m) => {
      // Seulement le résumé : la transcription est lue avec le fichier, mais n'en sort pas.
      const summary = m.hasSummary ? getMeeting(m.id)?.summary : undefined
      return {
        id: m.id,
        title: m.title,
        startedAt: m.startedAt,
        durationMs: m.durationMs,
        ...(summary ? { summary: firstSentence(summary.summary), tasks: summary.tasks.length } : { tasks: 0 })
      }
    })
}

async function indexedRecent(roots: string[]): Promise<RecentFile[]> {
  if (!roots.length) return []
  try {
    const hits = await searchFiles({ query: '', modifiedWithinDays: 7, limit: FILES * 2, scopes: roots })
    return hits
      .filter((h) => insideAny(h.path, roots) && !/folder|dossier/i.test(h.kind ?? ''))
      .map((h) => ({ path: h.path, name: h.name, ...(h.modified ? { modified: h.modified } : {}) }))
  } catch (e) {
    log('info', `récents : index de Windows indisponible (${(e as Error).message})`)
    return []
  }
}

async function recentFiles(roots: string[]): Promise<RecentFile[]> {
  if (!roots.length) return []
  // Les dossiers que Windows n'indexe pas (souvent sur D:\) sont parcourus directement.
  const { indexed, walk } = await splitIndexed(roots)
  const [fromIndex, fromWalk] = await Promise.all([indexedRecent(indexed), recentWalked(walk, 7, FILES)])
  return byDate([fromIndex, fromWalk.filter((f) => insideAny(f.path, roots))], FILES)
}

export async function recents(): Promise<RecentsInfo> {
  const roots = allowedFolders()
  return { meetings: recentMeetings(), files: await recentFiles(roots), folders: roots.length > 0 }
}

/**
 * Ouvre un fichier choisi dans le plein écran (récents, recherche) : seulement dans les
 * dossiers confiés. Un programme n'est jamais lancé : il est montré dans l'Explorateur.
 */
/**
 * Fichier trouvé par la recherche de Windows (tout le PC) : montré dans l'Explorateur, jamais
 * ouvert ni lancé. Ouvrir passe par openConfidedFile (dossiers confiés seulement).
 */
export async function revealFile(file: string): Promise<boolean> {
  const f = String(file ?? '')
  if (!isAbsolute(f) || /^\\\\/.test(f)) return false
  try {
    await stat(f)
  } catch {
    return false
  }
  shell.showItemInFolder(f)
  return true
}

export async function openConfidedFile(file: string): Promise<'opened' | 'shown' | 'refused'> {
  const f = String(file ?? '')
  if (!insideAny(f, allowedFolders())) return 'refused'
  if (launchesProgram(f)) {
    shell.showItemInFolder(f)
    return 'shown'
  }
  return (await shell.openPath(f)) === '' ? 'opened' : 'refused'
}
