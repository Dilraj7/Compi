import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cleanFact, FACT_MAX, sameFact, searchFacts, upgradeItem } from '../src/shared/memory'
import type { MemoryItem } from '../src/shared/types'

const dir = mkdtempSync(join(tmpdir(), 'compi-memory-'))
const forgetWarmPrompt = vi.fn()
const emit = vi.fn()

vi.mock('electron', () => ({ app: { getPath: () => dir } }))
vi.mock('../src/main/brains/gateway', () => ({ forgetWarmPrompt: () => forgetWarmPrompt() }))
vi.mock('../src/main/bus', () => ({ emit: (...a: unknown[]) => emit(...a) }))

const store = await import('../src/main/memory/store')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const item = (fact: string, extra: Partial<MemoryItem> = {}): MemoryItem => ({ id: fact, fact, createdAt: 1, source: 'chat', ...extra })

describe('souvenirs : fonctions pures', () => {
  it('nettoie : une ligne, longueur bornée', () => {
    expect(cleanFact('  Préfère\n  le   thé  ')).toBe('Préfère le thé')
    expect(cleanFact('x'.repeat(FACT_MAX + 50))).toHaveLength(FACT_MAX)
  })

  it('reconnaît un doublon malgré accents, casse et ponctuation', () => {
    expect(sameFact('Préfère le thé.', 'prefere le THE')).toBe(true)
    expect(sameFact('Préfère le thé', 'Préfère le café')).toBe(false)
  })

  it('cherche tous les mots, sans accents, y compris dans le titre de la discussion', () => {
    const items = [item('Habite à Lyon'), item('Réunion le lundi', { conversation: 'Organisation équipe' }), item('Aime le vélo')]
    expect(searchFacts(items, 'lyon').map((i) => i.fact)).toEqual(['Habite à Lyon'])
    expect(searchFacts(items, 'reunion equipe').map((i) => i.fact)).toEqual(['Réunion le lundi'])
    expect(searchFacts(items, '')).toHaveLength(3)
  })

  it('reprend l’ancien format (date ISO, sans source)', () => {
    const up = upgradeItem({ id: 'a', fact: ' Aime  le jazz ', createdAt: '2026-01-02T10:00:00.000Z' } as never)
    expect(up).toEqual({ id: 'a', fact: 'Aime le jazz', createdAt: Date.parse('2026-01-02T10:00:00.000Z'), source: 'chat' })
    expect(upgradeItem({ id: 'b', fact: '   ' })).toBeNull()
    expect(upgradeItem({ fact: 'sans id' })).toBeNull()
  })
})

describe('« Ce que je sais de toi » : enregistrement', () => {
  it('ajoute, refuse un doublon, corrige, oublie, efface tout', () => {
    const a = store.addMemory('Habite à Lyon', 'chat', 'Présentations')
    expect(a.duplicate).toBe(false)
    expect(store.addMemory('habite a lyon !', 'manual').duplicate).toBe(true)
    store.addMemory('Préfère le thé', 'manual')
    expect(store.listMemory()).toHaveLength(2)
    expect(emit).toHaveBeenCalledWith('memory:changed', expect.any(Array))

    forgetWarmPrompt.mockClear()
    const list = store.updateMemory(a.item.id, 'Habite à Lyon, près de la gare')
    expect(list[0].fact).toBe('Habite à Lyon, près de la gare')
    expect(list[0].updatedAt).toBeGreaterThan(0)
    // Les consignes gardées pour le cache du modèle local contenaient l'ancien souvenir.
    expect(forgetWarmPrompt).toHaveBeenCalled()

    expect(store.memoryForPrompt()).toContain('- Préfère le thé')
    expect(store.searchMemory('gare')).toHaveLength(1)

    store.deleteMemory(a.item.id)
    expect(store.listMemory().map((m) => m.fact)).toEqual(['Préfère le thé'])
    // Corriger en vide, c'est oublier.
    store.updateMemory(store.listMemory()[0].id, '   ')
    expect(store.listMemory()).toHaveLength(0)

    store.addMemory('Un', 'chat')
    store.addMemory('Deux', 'chat')
    forgetWarmPrompt.mockClear()
    store.clearMemory()
    expect(store.listMemory()).toHaveLength(0)
    expect(forgetWarmPrompt).toHaveBeenCalled()
  })

  it('refuse un souvenir vide', () => {
    expect(() => store.addMemory('   ', 'manual')).toThrow()
  })
})
