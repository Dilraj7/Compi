import { describe, expect, it } from 'vitest'
import { FAIL_MEMORY_MS, recordRun, recordTest, reliableModels, unreliable, type HealthBook } from '../src/shared/modelHealth'
import { perfAdvice, type PerfSnapshot } from '../src/shared/perf'

const NOW = 1_800_000_000_000

describe('fiabilité des modèles locaux', () => {
  it('compte les réponses et les actions écrites en texte, sans la variante -compi', () => {
    let book: HealthBook = {}
    book = recordRun(book, 'qwen3:8b-compi', { toolTextFailed: 2 }, NOW)
    book = recordRun(book, 'qwen3:8b', { toolTextRepaired: 1 }, NOW + 1)
    expect(book['qwen3:8b']).toEqual({ runs: 2, repaired: 1, failed: 2, lastFailAt: NOW })
    book = recordTest(book, 'qwen3:8b', true, NOW + 2)
    expect(book['qwen3:8b'].tested).toEqual({ at: NOW + 2, tools: true })
    expect(book['qwen3:8b'].failed).toBe(2)
  })

  it('peu fiable : échec récent, ou essai d’outil raté ; l’échec s’oublie après une semaine', () => {
    expect(unreliable(undefined, NOW)).toBe(false)
    expect(unreliable({ runs: 3, repaired: 4, failed: 0 }, NOW)).toBe(false)
    expect(unreliable({ runs: 3, repaired: 0, failed: 1, lastFailAt: NOW - 1000 }, NOW)).toBe(true)
    expect(unreliable({ runs: 3, repaired: 0, failed: 1, lastFailAt: NOW - FAIL_MEMORY_MS - 1 }, NOW)).toBe(false)
    expect(unreliable({ runs: 0, repaired: 0, failed: 0, tested: { at: NOW, tools: false } }, NOW)).toBe(true)
  })

  it('ne conseille que des modèles installés qui ont réussi l’essai', () => {
    const book: HealthBook = {
      'qwen3:8b': { runs: 5, repaired: 0, failed: 3, lastFailAt: NOW, tested: { at: NOW, tools: true } },
      'gemma4:12b': { runs: 40, repaired: 0, failed: 0, tested: { at: NOW, tools: true } },
      'granite4:8b': { runs: 2, repaired: 0, failed: 0, tested: { at: NOW, tools: true } },
      'llama3.2:3b': { runs: 9, repaired: 0, failed: 0, tested: { at: NOW, tools: false } },
      'mistral:7b': { runs: 1, repaired: 0, failed: 0 },
      'phi5:4b': { runs: 1, repaired: 0, failed: 0, tested: { at: NOW, tools: true } }
    }
    const installed = ['qwen3:8b', 'gemma4:12b-compi', 'gemma4:12b', 'granite4:8b', 'llama3.2:3b', 'mistral:7b']
    // phi5 n'est pas installé : jamais conseillé (rien ne se télécharge).
    expect(reliableModels(book, installed, 'qwen3:8b', NOW)).toEqual(['gemma4:12b', 'granite4:8b'])
  })

  it('conseil de Ce PC : le modèle conseillé, ou l’essai à faire', () => {
    const base: PerfSnapshot = {
      at: 0,
      cpu: 10,
      ram: { usedGb: 8, totalGb: 16, top: [] },
      local: { engine: 'ollama', chatModel: 'qwen3:8b', keepAlive: '30m', models: [] },
      runs: []
    }
    const withAlt = {
      ...base,
      local: { ...base.local!, health: { model: 'qwen3:8b', repaired: 0, failed: 3, testFailed: false, alternatives: ['gemma4:12b'] } }
    }
    expect(perfAdvice(withAlt)[0]).toEqual({
      id: 'tools',
      level: 'warn',
      text: 'qwen3:8b a écrit 3 fois une action au lieu de la faire : rien n’a été exécuté. gemma4:12b a réussi l’essai et fait ses actions : je te conseille de l’utiliser.',
      action: 'use-model',
      model: 'gemma4:12b'
    })
    const noAlt = { ...base, local: { ...base.local!, health: { model: 'qwen3:8b', repaired: 0, failed: 0, testFailed: true, alternatives: [] } } }
    expect(perfAdvice(noAlt)[0]).toMatchObject({ id: 'tools', action: 'test-models' })
    expect(perfAdvice(noAlt)[0].text).toContain('n’a pas réussi l’essai d’outil')
  })
})
