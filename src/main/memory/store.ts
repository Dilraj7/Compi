// « Ce que je sais de toi » : les souvenirs de Compi, dans userData/memory.json.
// L'utilisateur peut tout voir, corriger et effacer. Effacer, c'est vraiment
// effacer : la copie des consignes gardée pour le cache du modèle local
// (warm-prompt.json) part aussi.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import { cleanFact, MEMORY_MAX, sameFact, searchFacts, upgradeItem } from '../../shared/memory'
import type { MemoryItem } from '../../shared/types'
import { forgetWarmPrompt } from '../brains/gateway'
import { emit } from '../bus'
import { readJson, writeJson } from '../store/jsonFile'

const file = (): string => join(app.getPath('userData'), 'memory.json')

function load(): MemoryItem[] {
  const raw = readJson<unknown>(file(), [])
  return Array.isArray(raw) ? raw.map((r) => upgradeItem(r as Partial<MemoryItem>)).filter((m): m is MemoryItem => m !== null) : []
}

function save(items: MemoryItem[]): MemoryItem[] {
  writeJson(file(), items)
  const list = listMemory()
  emit(IPC.memoryChanged, list)
  return list
}

/** Du plus récent au plus ancien. */
export const listMemory = (): MemoryItem[] => load().sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))

/** Retient un fait ; un doublon n'est pas ajouté deux fois (renvoie l'existant). */
export function addMemory(fact: string, source: MemoryItem['source'], conversation?: string): { item: MemoryItem; duplicate: boolean } {
  const text = cleanFact(fact)
  if (!text) throw new Error('Souvenir vide.')
  const items = load()
  const existing = items.find((i) => sameFact(i.fact, text))
  if (existing) return { item: existing, duplicate: true }
  const item: MemoryItem = { id: randomUUID(), fact: text, createdAt: Date.now(), source, ...(conversation ? { conversation: conversation.slice(0, 80) } : {}) }
  // Au-delà du maximum, les plus anciens partent.
  const next = [...items, item].sort((a, b) => a.createdAt - b.createdAt).slice(-MEMORY_MAX)
  save(next)
  return { item, duplicate: false }
}

export function updateMemory(id: string, fact: string): MemoryItem[] {
  const text = cleanFact(fact)
  const items = load()
  const item = items.find((i) => i.id === id)
  if (!item) throw new Error('Souvenir introuvable.')
  if (!text) return deleteMemory(id)
  item.fact = text
  item.updatedAt = Date.now()
  forgetWarmPrompt()
  return save(items)
}

export function deleteMemory(id: string): MemoryItem[] {
  const items = load()
  forgetWarmPrompt()
  return save(items.filter((i) => i.id !== id))
}

export function clearMemory(): MemoryItem[] {
  forgetWarmPrompt()
  return save([])
}

export const searchMemory = (query?: string): MemoryItem[] => searchFacts(listMemory(), query)

/** Souvenirs mis dans les consignes du cerveau (les plus récents d'abord retenus). */
export function memoryForPrompt(max = 40): string {
  return load()
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(-max)
    .map((m) => `- ${m.fact}`)
    .join('\n')
}
