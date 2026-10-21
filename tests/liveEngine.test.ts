import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { closeAllEngines, LiveEngine, openEngines, registerEngine, reusableEngine } from '../src/main/agent/liveEngine'

const msg = (type: string, extra: object = {}): SDKMessage => ({ type, ...extra }) as unknown as SDKMessage

/** Faux moteur : pour chaque message reçu, les messages du script, puis (sauf erreur) un résultat. */
function fakeStart(script: (text: string) => SDKMessage[] | Error = (t) => [msg('assistant', { text: `réponse à ${t}` })]) {
  const calls = { start: 0, close: 0 }
  const start = (input: AsyncIterable<SDKUserMessage>): Query => {
    calls.start++
    const gen = (async function* () {
      for await (const m of input) {
        const out = script(String(m.message.content))
        if (out instanceof Error) throw out
        yield* out
        yield msg('result', { subtype: 'success' })
      }
    })()
    return Object.assign(gen, { close: () => calls.close++ }) as unknown as Query
  }
  return { start, calls }
}

const engine = (
  conversationId: string,
  start: (input: AsyncIterable<SDKUserMessage>) => Query,
  more: Partial<{ fingerprint: string; dirs: string[]; idleMs: number; onClose: () => void }> = {}
) =>
  new LiveEngine({ conversationId, fingerprint: more.fingerprint ?? 'fp', dirs: more.dirs ?? [], extra: {}, start, idleMs: more.idleMs, onClose: more.onClose })

afterEach(() => closeAllEngines())

describe('moteur gardé ouvert', () => {
  it('un seul démarrage pour plusieurs messages ; chaque tour ne voit que ses messages', async () => {
    const { start, calls } = fakeStart()
    const e = engine('a', start)
    const seen: string[][] = [[], []]
    await e.send('un', (m) => seen[0].push(m.type))
    await e.send('deux', (m) => seen[1].push(m.type))
    expect(calls.start).toBe(1)
    expect(seen).toEqual([
      ['assistant', 'result'],
      ['assistant', 'result']
    ])
    expect(e.alive).toBe(true)
    expect(e.busy).toBe(false)
  })

  it('refuse un deuxième message pendant un tour', async () => {
    const { start } = fakeStart()
    const e = engine('a', start)
    const first = e.send('un', () => {})
    await expect(e.send('deux', () => {})).rejects.toThrow('occupé')
    await first
  })

  it('erreur du moteur : le tour échoue, le moteur se ferme une seule fois', async () => {
    const onClose = vi.fn()
    const { start, calls } = fakeStart(() => new Error('processus arrêté'))
    const e = engine('a', start, { onClose })
    await expect(e.send('un', () => {})).rejects.toThrow('processus arrêté')
    expect(e.alive).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(calls.close).toBe(1)
    await expect(e.send('deux', () => {})).rejects.toThrow('fermé')
  })

  it('erreur dans le traitement d’un message (réponse en erreur) : le tour échoue et le moteur se ferme', async () => {
    const { start } = fakeStart()
    const e = engine('a', start)
    await expect(
      e.send('un', (m) => {
        if (m.type === 'result') throw new Error('error_max_turns')
      })
    ).rejects.toThrow('error_max_turns')
    expect(e.alive).toBe(false)
  })

  it('fermé pendant un tour (réponse arrêtée) : le tour échoue', async () => {
    const { start } = fakeStart(() => [])
    const e = engine('a', start)
    const turn = e.send('un', () => {
      e.close(new Error('arrêté'))
    })
    await expect(turn).rejects.toThrow('arrêté')
  })

  it('se ferme seul après un temps sans message', async () => {
    vi.useFakeTimers()
    try {
      const { start } = fakeStart()
      const e = engine('a', start, { idleMs: 1000 })
      await e.send('un', () => {})
      vi.advanceTimersByTime(999)
      expect(e.alive).toBe(true)
      vi.advanceTimersByTime(1)
      expect(e.alive).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('moteurs ouverts', () => {
  it('réutilisé si même discussion, même empreinte et dossiers déjà lisibles ; sinon fermé', async () => {
    const { start } = fakeStart()
    const e = engine('a', start, { fingerprint: 'v1', dirs: ['D:/Docs'] })
    registerEngine(e)
    expect(reusableEngine('a', 'v1', [])).toBe(e)
    expect(reusableEngine('a', 'v1', ['D:/Docs'])).toBe(e)
    expect(reusableEngine('b', 'v1', [])).toBeUndefined()
    // Pièce jointe d'un autre dossier : nouveau moteur.
    expect(reusableEngine('a', 'v1', ['E:/Autre'])).toBeUndefined()
    expect(e.alive).toBe(false)
    expect(openEngines()).toBe(0)
  })

  it('réglage changé (empreinte) : l’ancien moteur est fermé', () => {
    const { start } = fakeStart()
    const e = engine('a', start, { fingerprint: 'v1' })
    registerEngine(e)
    expect(reusableEngine('a', 'v2', [])).toBeUndefined()
    expect(e.alive).toBe(false)
  })

  it('un nouveau moteur ferme ceux des autres discussions au repos, pas celui qui répond', async () => {
    const idle = fakeStart()
    const a = engine('a', idle.start)
    registerEngine(a)
    await a.send('un', () => {})
    let release: () => void = () => {}
    const slow = fakeStart(() => [])
    const b = engine('b', (input) => {
      const q = slow.start(input)
      const gen = (async function* () {
        for await (const m of q) {
          if (m.type === 'result') await new Promise<void>((r) => (release = r))
          yield m
        }
      })()
      return Object.assign(gen, { close: () => q.close() }) as unknown as Query
    })
    registerEngine(b)
    expect(a.alive).toBe(false)
    const turn = b.send('long', () => {})
    await new Promise((r) => setTimeout(r, 10))
    registerEngine(engine('c', fakeStart().start))
    expect(b.alive).toBe(true)
    release()
    await turn
    expect(openEngines()).toBe(2)
  })
})
