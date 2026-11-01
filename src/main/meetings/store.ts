// Réunions enregistrées, sur le PC : userData/meetings/index.json (la liste) et,
// par réunion, un dossier avec meeting.json (transcription, résumé, noms des
// voix) et, le temps de la transcription, le son des deux pistes (16 bits,
// 16 kHz). Écritures atomiques ; rien n'est envoyé ailleurs.

import { existsSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Meeting, MeetingMeta, MeetingTrack } from '../../shared/types'
import { emit } from '../bus'
import { readJson, writeJson } from '../store/jsonFile'

const root = (): string => join(app.getPath('userData'), 'meetings')
const indexPath = (): string => join(root(), 'index.json')

/** Identifiant sûr (jamais de chemin) : celui que Compi a créé. */
export const isMeetingId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id)

export const meetingDir = (id: string): string => join(root(), id)
export const audioPath = (id: string, track: MeetingTrack): string => join(meetingDir(id), `${track}.pcm`)

export function hasAudio(id: string): boolean {
  return (['me', 'others'] as const).some((t) => existsSync(audioPath(id, t)) && statSync(audioPath(id, t)).size > 0)
}

export const metaOf = (m: Meeting): MeetingMeta => ({
  id: m.id,
  title: m.title,
  startedAt: m.startedAt,
  durationMs: m.durationMs,
  status: m.status,
  engine: m.engine,
  others: m.others,
  speakers: m.speakers,
  hasSummary: Boolean(m.summary),
  audio: m.audio,
  ...(m.audioUntil ? { audioUntil: m.audioUntil } : {}),
  ...(m.event ? { event: m.event } : {})
})

export function listMeetings(): MeetingMeta[] {
  const list = readJson<MeetingMeta[]>(indexPath(), [])
  return Array.isArray(list) ? list.filter((m) => isMeetingId(m?.id)) : []
}

export function getMeeting(id: string): Meeting | null {
  if (!isMeetingId(id)) return null
  const m = readJson<Meeting | null>(join(meetingDir(id), 'meeting.json'), null)
  return m && m.id === id ? { ...m, lines: Array.isArray(m.lines) ? m.lines : [], names: m.names ?? {} } : null
}

/** Enregistre la réunion et met la liste à jour (la plus récente d'abord). */
export function saveMeeting(m: Meeting): void {
  writeJson(join(meetingDir(m.id), 'meeting.json'), m)
  const list = [metaOf(m), ...listMeetings().filter((x) => x.id !== m.id)].sort((a, b) => b.startedAt - a.startedAt)
  writeJson(indexPath(), list)
  emit(IPC.meetingsChanged, list)
}

export function deleteMeeting(id: string): MeetingMeta[] {
  if (!isMeetingId(id)) return listMeetings()
  rmSync(meetingDir(id), { recursive: true, force: true })
  const list = listMeetings().filter((x) => x.id !== id)
  writeJson(indexPath(), list)
  emit(IPC.meetingsChanged, list)
  return list
}

/** Efface le son (la transcription reste) : les deux pistes, ou celles indiquées. */
export function deleteAudio(id: string, tracks: MeetingTrack[] = ['me', 'others']): void {
  for (const t of tracks) rmSync(audioPath(id, t), { force: true })
}

export function updateMeeting(id: string, patch: (m: Meeting) => Meeting): Meeting | null {
  const m = getMeeting(id)
  if (!m) return null
  const next = patch(m)
  saveMeeting(next)
  return next
}
