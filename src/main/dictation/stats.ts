// Temps gagné (Activité) : dictées, mots et temps de parole par jour et par
// application, sur le PC. Jamais le texte dicté ni le titre des fenêtres.

import { join } from 'node:path'
import { app } from 'electron'
import { addDictation } from '../../shared/dictation'
import { IPC } from '../../shared/ipc'
import type { DictationStatRow } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'

const file = (): string => join(app.getPath('userData'), 'dictation-stats.json')

export function dictationStats(): DictationStatRow[] {
  const rows = readJson<DictationStatRow[]>(file(), [])
  return Array.isArray(rows) ? rows : []
}

export function recordDictation(d: { app: string; words: number; speakingMs: number }): void {
  try {
    const next = addDictation(dictationStats(), { ...d, at: Date.now() })
    writeJson(file(), next)
    emit(IPC.dictationStatsChanged, next)
  } catch (e) {
    log('warn', 'temps gagné non enregistré', (e as Error).message)
  }
}

export function clearDictationStats(): DictationStatRow[] {
  writeJson(file(), [])
  emit(IPC.dictationStatsChanged, [])
  return []
}
