import { describe, expect, it } from 'vitest'
import { cacheChoice, parseCacheEnv, parseCacheLog } from '../src/shared/ollamaCache'
import { groupRamTop, keepAliveCost, memoryAlertText, modelFootprint, perfAdvice, type PerfSnapshot } from '../src/shared/perf'

const GB = 1024 ** 3

// Lignes réelles du journal d'Ollama 0.40 (chemins raccourcis).
const RUNNER =
  'time=… level=INFO msg="starting runner" cmd="C:\\\\Ollama\\\\lib\\\\ollama\\\\llama-server.exe --model C:\\\\models\\\\blobs\\\\sha256-bb72 --port 51234"'
const EMBED =
  'time=… level=INFO msg="starting runner" cmd="C:\\\\Ollama\\\\lib\\\\ollama\\\\llama-server.exe --model C:\\\\models\\\\blobs\\\\sha256-0650 --embedding --port 51240"'
const LIMIT = (mb: number) => `srv    load_model: prompt cache is enabled, size limit: ${mb} MiB`
const STATE = (n: number, mib: number, limit = 8192) =>
  `srv        update:  - cache state: ${n} prompts, ${mib.toFixed(3)} MiB (limits: ${limit}.000 MiB, 32768 tokens, 58249 est)`

describe('cache des conversations d’Ollama', () => {
  it('lit la taille et la limite du serveur de discussion', () => {
    const log = [RUNNER, LIMIT(8192), STATE(0, 0), STATE(4, 3908.009), STATE(6, 6705.551)].join('\n')
    expect(parseCacheLog(log)).toEqual({ prompts: 6, usedMb: 6705.551, limitMb: 8192 })
  })

  it('un nouveau serveur de discussion remet le compte à zéro', () => {
    const log = [RUNNER, LIMIT(8192), STATE(5, 5041.5), RUNNER, LIMIT(2048)].join('\r\n')
    expect(parseCacheLog(log)).toEqual({ prompts: 0, usedMb: 0, limitMb: 2048 })
  })

  it('le serveur des vecteurs ne remet pas à zéro celui de la discussion', () => {
    const log = [RUNNER, LIMIT(8192), STATE(3, 2900), EMBED, LIMIT(8192), STATE(0, 0)].join('\n')
    expect(parseCacheLog(log)).toEqual({ prompts: 3, usedMb: 2900, limitMb: 8192 })
  })

  it('journal sans ce cache (autre moteur) : rien', () => {
    expect(parseCacheLog('time=… level=INFO msg="server config"\n')).toBeNull()
  })

  it('début du journal coupé : la limite vient de la ligne d’état', () => {
    expect(parseCacheLog(STATE(2, 1500.5, 2048))).toEqual({ prompts: 2, usedMb: 1500.5, limitMb: 2048 })
  })

  it('valeur de la variable', () => {
    expect(parseCacheEnv('2048')).toBe(2048)
    expect(parseCacheEnv(' 0 ')).toBe(0)
    expect(parseCacheEnv('-1')).toBe(-1)
    expect(parseCacheEnv('-5')).toBeUndefined()
    expect(parseCacheEnv('2 Go')).toBeUndefined()
    expect(parseCacheEnv('')).toBeUndefined()
    expect(parseCacheEnv(undefined)).toBeUndefined()
  })

  it('propose de limiter, de rétablir, ou de redémarrer', () => {
    expect(cacheChoice({ canSet: true, configuredMb: undefined, limitMb: 8192 })).toEqual({ suggest: 'limit', restartPending: false })
    expect(cacheChoice({ canSet: true, configuredMb: -1 })).toEqual({ suggest: 'limit', restartPending: false })
    expect(cacheChoice({ canSet: true, configuredMb: 2048, limitMb: 2048 })).toEqual({ suggest: 'restore', restartPending: false })
    expect(cacheChoice({ canSet: true, configuredMb: 2048, limitMb: 8192 })).toEqual({ suggest: 'restore', restartPending: true })
    expect(cacheChoice({ canSet: true, configuredMb: undefined, limitMb: 2048 })).toEqual({ suggest: 'limit', restartPending: true })
    // Un choix de l'utilisateur (1 Go, cache coupé) est respecté.
    expect(cacheChoice({ canSet: true, configuredMb: 1024, limitMb: 1024 })).toEqual({ suggest: null, restartPending: false })
    expect(cacheChoice({ canSet: true, configuredMb: 0 })).toEqual({ suggest: null, restartPending: false })
    // Ollama sur un autre PC : rien à proposer.
    expect(cacheChoice({ canSet: false, configuredMb: undefined, limitMb: 8192 })).toEqual({ suggest: null, restartPending: false })
  })
})

const snapshot = (patch: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  at: 0,
  cpu: 20,
  ram: { usedGb: 8, totalGb: 16, top: [], modelGb: 1.2 },
  gpu: { name: 'RX 6800', util: 10, vramUsedGb: 9, vramTotalGb: 16, vram: [{ label: 'Modèle local', gb: 7.9, kind: 'model' }] },
  local: {
    engine: 'ollama',
    chatModel: 'gemma4:12b',
    keepAlive: '30m',
    models: [{ name: 'gemma4:12b', sizeGb: 7, gpuShare: 1, role: 'chat' }],
    cache: { prompts: 1, usedMb: 300, limitMb: 8192, canSet: true }
  },
  runs: [],
  ...patch
})

describe('ce que prend le modèle local', () => {
  it('réunit ses processus et le compte avec les autres applications', () => {
    const r = groupRamTop([
      { name: 'llama-server', bytes: 6.2 * GB },
      { name: 'ollama', bytes: 0.3 * GB },
      { name: 'ollama app', bytes: 0.1 * GB },
      { name: 'Claude', bytes: 2.5 * GB },
      { name: 'chrome', bytes: 1.5 * GB },
      { name: 'explorer', bytes: 0.2 * GB },
      { name: '', bytes: 9 * GB }
    ])
    expect(r.top.map((t) => t.name)).toEqual(['Modèle local', 'Claude', 'Chrome'])
    expect(r.modelGb).toBeCloseTo(6.6)
  })

  it('mémoire mesurée et coût de « Garder le modèle prêt »', () => {
    const s = snapshot({
      ram: { usedGb: 12, totalGb: 16, top: [], modelGb: 6.6 },
      local: { ...snapshot().local!, cache: { prompts: 4, usedMb: 5120, canSet: true } }
    })
    const f = modelFootprint(s)!
    expect(f).toEqual({ vramGb: 7.9, ramGb: 6.6, cacheGb: 5 })
    expect(keepAliveCost(f, '2h')).toBe(
      'Pendant 2 h après ta dernière question, le modèle garde 7,9 Go de mémoire vidéo et 6,6 Go de mémoire du PC, dont 5 Go de discussions gardées.'
    )
    expect(modelFootprint(snapshot({ local: { ...snapshot().local!, models: [] } }))).toBeNull()
  })

  it('alerte de l’îlot : la mémoire, puis la cause', () => {
    const full = snapshot({ ram: { usedGb: 15.1, totalGb: 16, top: [{ name: 'Modèle local', gb: 7.2 }], modelGb: 7.2 } })
    full.local!.cache = { prompts: 4, usedMb: 6250, canSet: true }
    expect(memoryAlertText(full)).toBe(
      'Mémoire presque pleine : 15,1 Go sur 16 Go. Le modèle local en prend 7,2 Go, dont 6,1 Go de discussions gardées. Touche pour voir quoi faire.'
    )
    const others = snapshot({
      ram: {
        usedGb: 15,
        totalGb: 16,
        top: [
          { name: 'Chrome', gb: 4 },
          { name: 'Modèle local', gb: 0.4 },
          { name: 'Claude', gb: 2 }
        ],
        modelGb: 0.4
      }
    })
    expect(memoryAlertText(others)).toBe(
      'Mémoire presque pleine : 15 Go sur 16 Go. Les plus gourmands : Chrome (4 Go), Claude (2 Go). Touche pour voir quoi faire.'
    )
  })

  it('conseil : limiter le cache quand il pèse, ou redémarrer Ollama quand la limite attend', () => {
    expect(perfAdvice(snapshot()).find((a) => a.id.startsWith('cache'))).toBeUndefined()
    const big = snapshot({ local: { ...snapshot().local!, cache: { prompts: 4, usedMb: 4096, limitMb: 8192, canSet: true } } })
    expect(perfAdvice(big).find((a) => a.id === 'cache')).toMatchObject({ level: 'info', action: 'limit-cache' })
    const tight = snapshot({ ram: { usedGb: 14, totalGb: 16, top: [] }, local: { ...snapshot().local!, cache: { prompts: 1, usedMb: 600, canSet: true } } })
    expect(perfAdvice(tight).find((a) => a.id === 'cache')).toMatchObject({ level: 'warn' })
    const pending = snapshot({ local: { ...snapshot().local!, cache: { prompts: 0, usedMb: 0, limitMb: 8192, configuredMb: 2048, canSet: true } } })
    expect(perfAdvice(pending).find((a) => a.id === 'cache-restart')).toMatchObject({ action: 'restart-ollama' })
    const limited = snapshot({ local: { ...snapshot().local!, cache: { prompts: 2, usedMb: 1900, limitMb: 2048, configuredMb: 2048, canSet: true } } })
    expect(perfAdvice(limited).find((a) => a.id.startsWith('cache'))).toBeUndefined()
  })
})
