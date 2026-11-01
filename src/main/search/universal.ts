// Recherche universelle du plein écran : applis du menu Démarrer, réunions, discussions,
// rappels, tâches, souvenirs (rapide), puis fichiers des dossiers confiés (index de
// Windows Search, ou par le nom pour les dossiers qu'il n'indexe pas). Tout reste sur
// le PC ; rien n'est envoyé à un cerveau.

import { readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { matchScore, rank, shortcutIndex, shortcutKey, snippet } from '../../shared/search'
import type { FileSearchHit, LocalSearch } from '../../shared/types'
import { allowedFolders, insideAny } from '../agent/folders'
import { listReminders } from '../day/reminders'
import { cachedTasks } from '../google/tasks'
import { log } from '../log'
import { getMeeting, listMeetings } from '../meetings/store'
import { searchMemory } from '../memory/store'
import { conversations } from '../store/conversations'
import { searchFiles } from '../windows/search'
import { nameSearch, splitIndexed } from './folderFiles'
import { launchApp, matchApps, startApps, type StartApp } from '../windows/system'

const MAX_QUERY = 120

// ─── Icônes des applis ──────────────────────────────────────────────────────

let shortcuts: { at: number; index: Map<string, string> } | null = null
const icons = new Map<string, string | null>()

/** Raccourcis des deux menus Démarrer (l'utilisateur d'abord), relus toutes les 10 min. */
async function shortcutMap(): Promise<Map<string, string>> {
  if (shortcuts && Date.now() - shortcuts.at < 10 * 60_000) return shortcuts.index
  const roots = [join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
  if (process.env.ProgramData) roots.push(join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'))
  const paths: string[] = []
  for (const root of roots) {
    try {
      const names = await readdir(root, { recursive: true })
      for (const n of names.slice(0, 3000)) if (/\.lnk$/i.test(n)) paths.push(join(root, n))
    } catch {
      // dossier absent ou illisible : pas d'icônes de ce côté
    }
  }
  shortcuts = { at: Date.now(), index: shortcutIndex(paths) }
  return shortcuts.index
}

/** Icône d'une appli : celle du programme visé par son raccourci, sinon celle du raccourci. */
async function iconFor(a: StartApp): Promise<string | undefined> {
  if (icons.has(a.id)) return icons.get(a.id) ?? undefined
  let icon: string | null = null
  try {
    const lnk = (await shortcutMap()).get(shortcutKey(a.name))
    if (lnk) {
      let file = lnk
      try {
        const target = shell.readShortcutLink(lnk).target
        if (target && /\.exe$/i.test(target) && existsSync(target)) file = target
      } catch {
        // raccourci illisible : son icône à lui
      }
      icon = (await app.getFileIcon(file, { size: 'normal' })).toDataURL()
    }
  } catch {
    icon = null
  }
  icons.set(a.id, icon)
  return icon ?? undefined
}

// ─── Réunions : résumés gardés en mémoire (la transcription n'en sort pas) ──

const summaries = new Map<string, string>()

function meetingText(id: string, hasSummary: boolean): string {
  if (!hasSummary) return ''
  const hit = summaries.get(id)
  if (hit !== undefined) return hit
  const s = getMeeting(id)?.summary
  const text = s ? [s.summary, ...s.points, ...s.tasks.map((t) => t.text)].join(' ') : ''
  summaries.set(id, text)
  return text
}

// ─── Recherche ──────────────────────────────────────────────────────────────

const clean = (q: unknown): string =>
  String(q ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY)

export async function searchLocal(query: unknown): Promise<LocalSearch> {
  const q = clean(query)
  const empty: LocalSearch = { apps: [], meetings: [], chats: [], reminders: [], tasks: [], memory: [] }
  // Sans recherche : on prépare seulement les listes (première ouverture plus rapide ensuite).
  if (!q) {
    // Nouvelle ouverture de la recherche : les résumés changés depuis seront relus.
    summaries.clear()
    void startApps()
      .then(() => shortcutMap())
      .catch(() => undefined)
    return empty
  }
  const apps = await startApps().catch((e: Error) => {
    log('info', `recherche : applis indisponibles (${e.message})`)
    return [] as StartApp[]
  })
  const found = matchApps(apps, q).slice(0, 6)
  const withIcons = await Promise.all(found.map(async (a) => ({ id: a.id, name: a.name, icon: await iconFor(a) })))

  const meetings = rank(
    listMeetings().filter((m) => m.status !== 'recording'),
    (m) => matchScore(m.title, q, meetingText(m.id, m.hasSummary)),
    5
  ).map((m) => {
    const text = meetingText(m.id, m.hasSummary)
    return { id: m.id, title: m.title, startedAt: m.startedAt, ...(text && matchScore(m.title, q) === 0 ? { snippet: snippet(text, q) } : {}) }
  })

  const chats = rank(
    [...conversations.all()],
    (c) => {
      const title = matchScore(c.title, q)
      if (title) return title + 1
      return c.messages.some((m) => matchScore('', q, m.text) > 0) ? 1 : 0
    },
    5
  ).map((c) => {
    const msg = matchScore(c.title, q) ? undefined : c.messages.find((m) => matchScore('', q, m.text) > 0)
    return { id: c.id, title: c.title, updatedAt: c.updatedAt, ...(msg ? { snippet: snippet(msg.text, q) } : {}) }
  })

  return {
    apps: withIcons,
    meetings,
    chats,
    reminders: rank(listReminders(), (r) => matchScore(r.message, q), 4),
    tasks: rank(cachedTasks(), (t) => matchScore(t.title, q, `${t.notes ?? ''} ${t.list}`), 4),
    memory: rank(searchMemory(q), (m) => matchScore(m.fact, q) || 1, 3).map((m) => ({ id: m.id, fact: m.fact }))
  }
}

/** Fichiers des dossiers confiés seulement, par le nom et le contenu (index de Windows). */
export async function searchConfidedFiles(query: unknown): Promise<FileSearchHit[]> {
  const q = clean(query)
  const roots = allowedFolders()
  if (q.length < 2 || !roots.length) return []
  // Les dossiers que Windows n'indexe pas sont cherchés par le nom, en les parcourant.
  const { indexed, walk } = await splitIndexed(roots)
  const fromIndex = async (): Promise<FileSearchHit[]> => {
    if (!indexed.length) return []
    try {
      return (await searchFiles({ query: q, limit: 10, scopes: indexed })).map((h) => ({
        path: h.path,
        name: h.name,
        ...(h.modified ? { modified: h.modified } : {})
      }))
    } catch (e) {
      log('info', `recherche : index de Windows indisponible (${(e as Error).message})`)
      return []
    }
  }
  const [a, b] = await Promise.all([fromIndex(), walk.length ? nameSearch(walk, q, 8) : []])
  const seen = new Set<string>()
  return [...a, ...b]
    .filter((h) => insideAny(h.path, roots) && !seen.has(h.path.toLowerCase()) && seen.add(h.path.toLowerCase()))
    .slice(0, 8)
}

/** Lance une appli choisie dans la recherche : seulement une appli de la liste du menu Démarrer. */
export async function launchStartApp(id: unknown): Promise<boolean> {
  const found = (await startApps()).find((a) => a.id === String(id ?? ''))
  if (!found) return false
  await launchApp(found)
  return true
}
