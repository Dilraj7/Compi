import { describe, expect, it } from 'vitest'
import { judgeReread, mainReread, REREAD_LABEL, REREAD_MIN, rereadText, withColdStart, type RequestChange } from '../src/shared/reread'
import type { RereadCause } from '../src/shared/types'

const change = (patch: Partial<RequestChange> = {}): RequestChange => ({ change: null, newTokens: 200, promptTokens: 9000, ...patch })

describe('relecture du modèle local', () => {
  it('peu de jetons lus, ou seulement ce qui est nouveau : rien à expliquer', () => {
    expect(judgeReread(REREAD_MIN - 1, change(), true)).toBeNull()
    // Un document de 5 000 jetons tout juste lu par un outil : c'est nouveau, pas relu.
    expect(judgeReread(5200, change({ newTokens: 5000 }), false)).toBeNull()
  })

  it('cause repérée avant l’envoi, premier appel marqué', () => {
    expect(judgeReread(8800, change({ change: 'tools' }), true)).toEqual({ tokens: 8800, promptTokens: 9000, cause: 'tools', first: true })
    expect(judgeReread(8800, change({ change: 'other-chat' }), false)).toEqual({ tokens: 8800, promptTokens: 9000, cause: 'other-chat' })
  })

  it('rien n’a changé : fenêtre presque pleine, sinon ce qu’il avait lu a été remplacé', () => {
    expect(judgeReread(28_000, change({ promptTokens: 29_000, contextTokens: 32_768 }), false)?.cause).toBe('full')
    expect(judgeReread(8800, change({ contextTokens: 32_768 }), false)?.cause).toBe('cache')
    expect(judgeReread(8800, change(), false)?.cause).toBe('cache')
  })

  it('la plus grosse relecture de la réponse ; un modèle rechargé explique celle du premier appel', () => {
    const a = { tokens: 9000, promptTokens: 9000, cause: 'start' as const, first: true }
    const b = { tokens: 4000, promptTokens: 12_000, cause: 'tools' as const }
    expect(mainReread([null, a, undefined, b])).toBe(a)
    expect(mainReread([])).toBeUndefined()
    expect(withColdStart(a, true)?.cause).toBe('reload')
    expect(withColdStart(b, true)?.cause).toBe('tools')
    expect(withColdStart(a, false)).toBe(a)
  })

  it('chaque cause a un mot court et une explication avec les jetons relus', () => {
    const causes: RereadCause[] = ['reload', 'start', 'tools', 'system', 'other-chat', 'summary', 'full', 'cache']
    for (const cause of causes) {
      expect(REREAD_LABEL[cause]).toBeTruthy()
      expect(rereadText({ tokens: 12_345, promptTokens: 13_000, cause })).toContain('12 345 jetons')
    }
  })
})
