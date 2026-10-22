// Journal local de ce qui est parti en ligne (vue Activité) : vers un cerveau en
// ligne, et les recherches web vers leur service. Il reste sur le PC : seulement
// la destination, le type de données et la discussion, jamais le contenu.

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
  const at = Date.now()
  const conversation = conversationTitle.slice(0, 80)
  const entries: SentLogEntry[] = [
    ...(sent.searched ? [{ at, destination: sent.searched, categories: ['web' as const], conversation }] : []),
    ...(sent.destination ? [{ at, destination: sent.destination, categories: sent.categories, masked: sent.masked, conversation }] : [])
  ]
  if (!entries.length) return listSent()
  const next = [...entries, ...listSent()].slice(0, MAX_ENTRIES)
  writeJson(file(), next)
  return next
}

export function clearSent(): void {
  writeJson(file(), [])
}
