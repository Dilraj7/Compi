// Notes de réunion : la note Markdown d'une réunion, écrite dans le dossier de notes choisi
// (Réglages › Voix › Appels et réunions), toujours parmi les dossiers confiés. Par le
// bouton « Ajouter à mes notes » (le clic vaut accord) ou par Compi (carte avec les
// changements). Comme write_text_file : l'ancienne version est gardée pour Annuler.

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { shell } from 'electron'
import { noteRelativePath, noteVariables, numberedPath, obsidianUri, renderNote } from '../../shared/meetingNotes'
import type { MeetingNoteResult } from '../../shared/types'
import { allowedFolders, insideAny } from '../agent/folders'
import { applyTextEdit, planTextEdit, type TextEditPlan } from '../agent/textEdits'
import { editsDir } from '../agent/textTools'
import { log } from '../log'
import { settings } from '../store/settings'
import { getMeeting } from './store'

export const NOTES_SETUP =
  "Aucun dossier de notes n'est choisi : l'utilisateur le règle dans Réglages › Voix › Appels et réunions › Notes de réunion (un coffre Obsidian, par exemple)."

/** Ce qui sera écrit, sans rien écrire (le sous-dossier du modèle de nom est créé s'il manque). */
export async function planMeetingNote(id: string, extra = ''): Promise<{ plan: TextEditPlan; title: string } | { error: string; needsSetup?: boolean }> {
  const m = getMeeting(String(id ?? ''))
  if (!m) return { error: 'Réunion introuvable : elle a peut-être été supprimée.' }
  if (m.status === 'recording') return { error: 'Cette réunion est encore en cours d’enregistrement.' }
  const n = settings.get().meetings.notes
  if (!n.folder) return { error: NOTES_SETUP, needsSetup: true }
  const roots = allowedFolders()
  if (!insideAny(n.folder, roots))
    return { error: `Le dossier de notes ${n.folder} n'est pas parmi les dossiers confiés : confie-le dans Réglages.`, needsSetup: true }
  if (!existsSync(n.folder)) return { error: `Le dossier de notes ${n.folder} n'existe plus.`, needsSetup: true }
  const rel = noteRelativePath(n.fileName, noteVariables(m))
  if (!rel) return { error: 'Le nom de fichier des notes ne donne rien d’utilisable : vérifie-le dans Réglages.', needsSetup: true }
  let path = join(n.folder, rel)
  if (!insideAny(path, [n.folder])) return { error: 'Le nom de fichier des notes sort du dossier de notes.', needsSetup: true }
  // Une note déjà écrite pour cette réunion n'est jamais écrasée : « … (2).md ».
  for (let i = 2; existsSync(path) && i < 100; i++) path = numberedPath(join(n.folder, rel), i)
  try {
    await mkdir(dirname(path), { recursive: true })
  } catch (e) {
    return { error: `Dossier impossible à créer : ${(e as Error).message}` }
  }
  const plan = await planTextEdit(path, renderNote(m, n.template, extra), 'replace', roots)
  if ('error' in plan) return plan
  return { plan, title: m.title }
}

/** Écrit la note (après l'accord : clic ou carte). */
export async function saveMeetingNote(id: string, extra = ''): Promise<MeetingNoteResult> {
  const r = await planMeetingNote(id, extra)
  if ('error' in r) return { ok: false, error: r.error, ...(r.needsSetup ? { needsSetup: true } : {}) }
  try {
    const edit = await applyTextEdit(r.plan, editsDir())
    log('info', 'note de réunion écrite')
    return { ok: true, path: r.plan.path, editId: edit.id }
  } catch (e) {
    return { ok: false, error: `Écriture impossible : ${(e as Error).message}` }
  }
}

/** Dossier dans un coffre Obsidian (un `.obsidian` dans lui ou un parent proche). */
export function isObsidianVault(folder: string): boolean {
  let dir = folder
  for (let i = 0; i < 4; i++) {
    if (existsSync(join(dir, '.obsidian'))) return true
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return false
}

/** Ouvre une note du dossier de notes, avec Obsidian ou l'appli par défaut. */
export async function openMeetingNote(path: string): Promise<boolean> {
  const n = settings.get().meetings.notes
  const p = String(path ?? '')
  if (!n.folder || !insideAny(p, [n.folder]) || !insideAny(p, allowedFolders()) || !/\.(md|markdown|txt)$/i.test(p)) return false
  if (n.openWith === 'obsidian') {
    try {
      await shell.openExternal(obsidianUri(p))
      return true
    } catch {
      // Obsidian absent : l'appli par défaut
    }
  }
  return (await shell.openPath(p)) === ''
}
