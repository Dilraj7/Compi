import { describe, expect, it } from 'vitest'
import {
  cpuPercent,
  cpuTimes,
  friendlyName,
  gaugeLevel,
  groupVram,
  isModelProcess,
  localPhase,
  perfAdvice,
  pickGpu,
  sameModel,
  type PerfSnapshot
} from '../src/shared/perf'

const GB = 1024 ** 3

const snapshot = (patch: Partial<PerfSnapshot> = {}): PerfSnapshot => ({
  at: 0,
  cpu: 20,
  ram: { usedGb: 8, totalGb: 16, top: [] },
  gpu: { name: 'RX 6800', util: 10, vramUsedGb: 9, vramTotalGb: 16, vram: [{ label: 'Modèle local', gb: 7, kind: 'model' }] },
  local: { engine: 'ollama', chatModel: 'gemma4:12b', keepAlive: '30m', models: [{ name: 'gemma4:12b', sizeGb: 7, gpuShare: 1, role: 'chat' }] },
  runs: [],
  ...patch
})

describe('processeur', () => {
  it('charge entre deux mesures, tous cœurs confondus', () => {
    const core = (user: number, idle: number) => ({ times: { user, nice: 0, sys: 0, idle, irq: 0 } })
    const a = cpuTimes([core(100, 900), core(100, 900)])
    const b = cpuTimes([core(400, 1100), core(200, 1300)])
    // 400 de travail sur 1000 au total.
    expect(cpuPercent(a, b)).toBe(40)
    expect(cpuPercent(b, b)).toBe(0)
  })
})

describe('carte graphique', () => {
  it('la carte principale porte le plus de mémoire vidéo', () => {
    expect(
      pickGpu([
        { luid: 'igpu', dedicatedBytes: 0.2 * GB, util: 3 },
        { luid: 'rx', dedicatedBytes: 9 * GB, util: 40 }
      ])?.luid
    ).toBe('rx')
    expect(pickGpu([])).toBeUndefined()
  })

  it('noms lisibles, modèle local reconnu', () => {
    expect(friendlyName('llama-server')).toBe('Modèle local')
    expect(friendlyName('ollama')).toBe('Modèle local')
    expect(friendlyName('dwm')).toBe('Windows (affichage)')
    expect(friendlyName('steamwebhelper')).toBe('Steam')
    expect(friendlyName('obs64')).toBe('Obs64')
    expect(isModelProcess('ollama_llama_server')).toBe(true)
    expect(isModelProcess('chrome')).toBe(false)
  })

  it('mémoire vidéo par usage : modèle, Windows, 3 applications, puis le reste', () => {
    const p = (name: string, gb: number, pid = Math.random()) => ({ pid, name, dedicatedBytes: gb * GB, util: 0 })
    const out = groupVram([
      p('llama-server', 10.6),
      p('dwm', 1.8),
      p('steam', 0.6),
      p('steamwebhelper', 0.5),
      p('comet', 0.9),
      p('code', 0.3),
      p('discord', 0.2),
      p('tiny', 0.01)
    ])
    expect(out.map((v) => v.label)).toEqual(['Modèle local', 'Windows (affichage)', 'Steam', 'Comet', 'VS Code', 'Autres'])
    expect(out[2].gb).toBeCloseTo(1.1)
    expect(out.at(-1)?.gb).toBeCloseTo(0.2)
    expect(out[0].kind).toBe('model')
  })

  it('couleur des jauges', () => {
    expect(gaugeLevel(0.5)).toBe('ok')
    expect(gaugeLevel(0.75)).toBe('high')
    expect(gaugeLevel(0.95)).toBe('full')
  })
})

describe('modèle local', () => {
  it('le suffixe -compi désigne le même modèle', () => {
    expect(sameModel('gemma4:12b-compi', 'gemma4:12b')).toBe(true)
    expect(sameModel('gemma4:12b', 'gemma4:4b')).toBe(false)
  })

  it('avant le premier mot : chargement ou lecture de la demande', () => {
    expect(localPhase(null)).toBeNull()
    expect(localPhase(snapshot())).toBeNull()
    expect(localPhase(snapshot({ generating: { since: 0, model: 'gemma4:12b-compi' } }))).toBe('reading')
    expect(localPhase(snapshot({ generating: { since: 0, model: 'qwen3.5:9b' } }))).toBe('loading')
  })
})

describe('conseils', () => {
  it('tout va bien : aucun conseil', () => {
    expect(perfAdvice(snapshot())).toEqual([])
  })

  it('le modèle déborde : part sur le processeur et applications qui prennent la mémoire vidéo', () => {
    const s = snapshot({
      local: { engine: 'ollama', chatModel: 'gemma4:12b', keepAlive: '30m', models: [{ name: 'gemma4:12b', sizeGb: 11, gpuShare: 0.62, role: 'chat' }] },
      gpu: {
        name: 'RX',
        util: 40,
        vramUsedGb: 15.5,
        vramTotalGb: 16,
        vram: [
          { label: 'Modèle local', gb: 6.8, kind: 'model' },
          { label: 'Steam', gb: 1.1, kind: 'app' },
          { label: 'Comet', gb: 0.9, kind: 'app' }
        ]
      }
    })
    const [first] = perfAdvice(s)
    expect(first.id).toBe('spill')
    expect(first.level).toBe('warn')
    expect(first.action).toBe('smaller-model')
    expect(first.text).toContain('38 %')
    expect(first.text).toContain('Steam')
  })

  it('mémoire presque pleine : le chargement passe par le disque, avec les plus gourmands', () => {
    const a = perfAdvice(snapshot({ ram: { usedGb: 13.4, totalGb: 15.9, top: [{ name: 'Comet', gb: 3.2 }] } }))
    expect(a.map((x) => x.id)).toEqual(['ram'])
    expect(a[0].text).toContain('2,5 Go')
    expect(a[0].text).toContain('Comet (3,2 Go)')
  })

  it('le modèle de la recherche par le sens occupe aussi la carte', () => {
    const s = snapshot()
    s.local!.models.push({ name: 'qwen3-embedding:0.6b', sizeGb: 1.1, gpuShare: 1, role: 'embed' })
    expect(perfAdvice(s).map((x) => [x.id, x.action])).toEqual([['embed', 'unload-embed']])
  })

  it('rechargement lent : garder le modèle prêt plus longtemps (sauf déjà 8 h)', () => {
    const runs = [{ at: 0, model: 'gemma4:12b', firstTokenMs: 412_000, inputTokens: 3000, coldStart: true }]
    const a = perfAdvice(snapshot({ runs }))
    expect(a[0].id).toBe('cold')
    expect(a[0].action).toBe('keep-longer')
    expect(a[0].text).toContain('7 min')
    const s8 = snapshot({ runs })
    s8.local!.keepAlive = '8h'
    expect(perfAdvice(s8)[0].action).toBeUndefined()
  })

  it('longue discussion relue : nouvelle discussion', () => {
    const a = perfAdvice(snapshot({ runs: [{ at: 0, model: 'gemma4:12b', firstTokenMs: 45_000, inputTokens: 14_200, coldStart: false }] }))
    expect(a.map((x) => x.id)).toEqual(['long'])
    expect(a[0].action).toBe('new-chat')
  })

  it('une autre application occupe la carte graphique', () => {
    const s = snapshot()
    s.gpu!.busyApp = { name: 'Steam', util: 92 }
    expect(perfAdvice(s).map((x) => x.id)).toEqual(['busy'])
    s.gpu!.busyApp = { name: 'Steam', util: 40 }
    expect(perfAdvice(s)).toEqual([])
  })
})
