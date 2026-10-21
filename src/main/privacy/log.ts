// Journal local de ce qui est parti vers un cerveau en ligne (vue Activité).
// Il reste sur le PC : seulement la destination, le type de données et la
// discussion, jamais le contenu.

import { join } from 'node:path'
import { app } from 'electron'
import type { SentLogEntry, SentTo } from '../../shared/types'
import { readJson, writeJson } from '../store/jsonFile'

const MAX_ENTRIES = 100
const file = (): string => join(app.getPath('userData'), 'privacy-log.json')

export function listSent(): SentLogEntry[] {
  return readJson<SentLogEntry[]>(file(), [])
}

export function logSent(sent: SentTo, conversationTitle: string): SentLogEntry[] {
  if (!sent.destination) return listSent()
  const entry: SentLogEntry = { at: Date.now(), destination: sent.destination, categories: sent.categories, masked: sent.masked, conversation: conversationTitle.slice(0, 80) }
  const next = [entry, ...listSent()].slice(0, MAX_ENTRIES)
  writeJson(file(), next)
  return next
}

export function clearSent(): void {
  writeJson(file(), [])
}
