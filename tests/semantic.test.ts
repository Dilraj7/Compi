import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chunkText, dot, embedPrefix, IDLE_SEC, indexPace, MAX_PASSAGES_PER_FILE, toUnit, topK } from '../src/main/semantic/vectors'

describe('recherche par le sens : rythme de l’indexation', () => {
  it('à fond au repos, doucement pendant qu’on travaille, en pause sur batterie', () => {
    expect(indexPace({ idleSec: IDLE_SEC, onBattery: false })).toBe('full')
    expect(indexPace({ idleSec: 5, onBattery: false })).toBe('gentle')
    expect(indexPace({ idleSec: 3600, onBattery: true })).toBe('wait')
  })
})

describe('recherche par le sens : découpage', () => {
  it('regroupe les petits paragraphes jusqu’à environ 900 caractères', () => {
    const para = 'Une phrase de test assez longue pour compter. '.repeat(5).trim()
    const text = Array.from({ length: 6 }, () => para).join('\n\n')
    const out = chunkText(text, 900)
    expect(out.length).toBeGreaterThan(1)
    for (const p of out) expect(p.text.length).toBeLessThanOrEqual(900)
    expect(
      out
        .map((p) => p.text)
        .join('\n\n')
        .replace(/\s+/g, ' ')
    ).toBe(text.replace(/\s+/g, ' '))
  })

  it('coupe un très long paragraphe entre deux phrases, avec recouvrement', () => {
    const long = Array.from({ length: 60 }, (_, i) => `Phrase numéro ${i} du contrat de bail.`).join(' ')
    const out = chunkText(long, 300)
    expect(out.length).toBeGreaterThan(5)
    for (const p of out) expect(p.text.length).toBeLessThanOrEqual(300)
    expect(out[0].text.endsWith('.')).toBe(true)
    // Le début d'un morceau reprend la fin du précédent.
    expect(out[0].text.slice(-60)).toContain(out[1].text.slice(0, 20).trim().split(' ')[0])
  })

  it('garde la page des PDF', () => {
    const text = '--- Page 1 ---\nPréambule du contrat, signé par les deux parties.\n--- Page 2 ---\nArticle 9 : résiliation avec un préavis de trois mois.'
    expect(chunkText(text)).toEqual([
      { page: 1, text: 'Préambule du contrat, signé par les deux parties.' },
      { page: 2, text: 'Article 9 : résiliation avec un préavis de trois mois.' }
    ])
  })

  it('ignore les miettes et borne le nombre de passages', () => {
    expect(chunkText('ok\n\n\n   \n\nfin')).toEqual([])
    const huge = Array.from({ length: MAX_PASSAGES_PER_FILE + 50 }, (_, i) => `Paragraphe ${i} `.repeat(70)).join('\n\n')
    expect(chunkText(huge)).toHaveLength(MAX_PASSAGES_PER_FILE)
  })
})

describe('recherche par le sens : vecteurs', () => {
  it('raccourcit puis normalise', () => {
    const v = toUnit([3, 4, 100, 100], 2)
    expect(Array.from(v)).toEqual([expect.closeTo(0.6), expect.closeTo(0.8)])
    expect(Array.from(toUnit([0, 0], 2))).toEqual([0, 0])
  })

  it('le produit scalaire de vecteurs normalisés est leur similarité', () => {
    const a = toUnit([1, 0], 2)
    expect(dot(a, a)).toBeCloseTo(1)
    expect(dot(a, toUnit([0, 1], 2))).toBeCloseTo(0)
  })

  it('garde les meilleurs, au plus 2 par fichier, au-dessus du seuil', () => {
    const items = [
      { f: 'a', s: 0.9 },
      { f: 'a', s: 0.85 },
      { f: 'a', s: 0.8 },
      { f: 'b', s: 0.7 },
      { f: 'c', s: 0.2 }
    ]
    const out = topK(
      items,
      (i) => i.s,
      5,
      (i) => i.f
    )
    expect(out.map((o) => `${o.item.f}${o.score}`)).toEqual(['a0.9', 'a0.85', 'b0.7'])
  })

  it('consignes propres à chaque famille de modèles', () => {
    expect(embedPrefix('qwen3-embedding:0.6b', 'query')).toMatch(/^Instruct: .*\nQuery:$/)
    expect(embedPrefix('qwen3-embedding:0.6b', 'passage')).toBe('')
    expect(embedPrefix('nomic-embed-text', 'passage')).toBe('search_document: ')
    expect(embedPrefix('embeddinggemma', 'query')).toBe('task: search result | query: ')
    expect(embedPrefix('bge-m3', 'query')).toBe('')
  })
})

// ─── Index sur le disque, avec un faux Ollama ────────────────────────────────

const home = mkdtempSync(join(tmpdir(), 'compi-semantic-'))
const docs = join(home, 'docs')
const settingsState = { semantic: { enabled: true, model: 'qwen3-embedding:0.6b' }, local: { engine: 'ollama', baseUrl: '' } }
const embedCalls: string[][] = []

/** Faux vecteurs : un axe par thème, pour que le sens soit vérifiable. */
function fakeVector(text: string): number[] {
  const t = text.toLowerCase()
  return [/résili|préavis|fin du contrat/.test(t) ? 1 : 0, /loyer|paiement|euros/.test(t) ? 1 : 0, /chat|animal/.test(t) ? 1 : 0, 0.05]
}

// PC au repos et sur secteur : l'indexation va à fond (le rythme est testé à part, indexPace).
vi.mock('electron', () => ({ app: { getPath: () => home }, powerMonitor: { getSystemIdleTime: () => 3600, isOnBatteryPower: () => false } }))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/bus', () => ({ emit: vi.fn() }))
vi.mock('../src/main/store/settings', () => ({
  OLLAMA_URL: 'http://127.0.0.1:11434',
  settings: { get: () => settingsState, update: (p: Record<string, unknown>) => Object.assign(settingsState, p) }
}))
vi.mock('../src/main/agent/folders', async () => {
  const { isInside } = await import('../src/main/agent/docSearch')
  return { allowedFolders: () => [docs], insideAny: (p: string, roots: string[]) => roots.some((r) => isInside(p, r)) }
})
vi.mock('../src/main/brains/ollama', () => ({
  ollamaVersion: async () => '0.32.1',
  ollamaInstalled: () => true,
  startOllama: async () => true,
  hasModel: async () => true,
  embedTexts: async (_base: string, _model: string, input: string[]) => {
    embedCalls.push(input)
    return input.map(fakeVector)
  }
}))

const semantic = await import('../src/main/semantic')

describe('recherche par le sens : index', () => {
  beforeAll(() => {
    mkdirSync(docs, { recursive: true })
    writeFileSync(
      join(docs, 'bail.txt'),
      'Article 3 : le loyer est de 800 euros, payable le 5 du mois.\n\nArticle 9 : fin du contrat avec un préavis de trois mois.'
    )
    writeFileSync(join(docs, 'notes.md'), 'Penser à nourrir le chat pendant les vacances.')
  })
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('indexe les documents des dossiers confiés, puis trouve le bon passage par le sens', async () => {
    await semantic.syncSemantic()
    expect(semantic.semanticStatus()).toMatchObject({ state: 'ready', files: 2, indexed: 2 })
    const hits = await semantic.semanticSearch('Comment résilier mon bail ?', [docs])
    expect(hits?.[0].file).toBe(join(docs, 'bail.txt'))
    expect(hits?.[0].text).toContain('préavis')
    // La question porte la consigne du modèle ; les passages, non.
    expect(embedCalls.at(-1)?.[0]).toMatch(/^Instruct: .*\nQuery:Comment résilier/)
  })

  it('ne relit que ce qui a changé', async () => {
    const before = embedCalls.length
    await semantic.syncSemantic()
    expect(embedCalls.length).toBe(before)
    writeFileSync(join(docs, 'notes.md'), 'Le chat a rendez-vous chez le vétérinaire. Penser au carnet de santé de l’animal.')
    await semantic.syncSemantic()
    expect(embedCalls.length).toBe(before + 1)
  })

  it('pendant une réponse : l’indexation attend, la recherche répond tout de suite, le rattrapage vient après', async () => {
    const release = semantic.holdSemantic()
    writeFileSync(join(docs, 'notes.md'), 'Le chat dort sur le canapé du salon.')
    const before = embedCalls.length
    const sync = semantic.syncSemantic()
    await new Promise((r) => setTimeout(r, 50))
    expect(embedCalls.length).toBe(before)
    // Seule la question est calculée : pas de rattrapage avant de chercher.
    expect((await semantic.semanticSearch('animal', [docs]))?.[0].file).toBe(join(docs, 'notes.md'))
    expect(embedCalls.length).toBe(before + 1)
    release()
    await sync
    expect(embedCalls.length).toBe(before + 2)
    expect(embedCalls.at(-1)?.[0]).toContain('canapé')
  })

  it('ne cherche que dans les dossiers demandés', async () => {
    expect(await semantic.semanticSearch('animal', [join(home, 'ailleurs')])).toEqual([])
  })

  it('au redémarrage, l’index du disque sert tout de suite', async () => {
    vi.resetModules()
    const fresh = await import('../src/main/semantic')
    fresh.startSemantic(60_000)
    expect(fresh.semanticStatus()).toMatchObject({ state: 'ready', files: 2 })
    expect((await fresh.semanticSearch('animal', [docs]))?.[0].file).toBe(join(docs, 'notes.md'))
    fresh.stopSemantic()
  })

  it('désactiver efface l’index du disque', async () => {
    settingsState.semantic.enabled = false
    semantic.clearSemantic()
    expect(semantic.semanticStatus().state).toBe('off')
    expect(await semantic.semanticSearch('bail', [docs])).toBeNull()
  })
})
