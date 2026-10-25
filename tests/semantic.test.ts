import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { chunkText, dot, embedPrefix, IDLE_SEC, indexPace, MAX_PASSAGES_PER_FILE, toUnit, topK } from '../src/main/semantic/vectors'
import * as store from '../src/main/semantic/store'

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

// ─── Stockage sur le disque (store.ts) ───────────────────────────────────────

describe('recherche par le sens : stockage hors de la mémoire', () => {
  const base = mkdtempSync(join(tmpdir(), 'compi-semstore-'))
  afterAll(() => rmSync(base, { recursive: true, force: true }))
  const unit = (...v: number[]): Float32Array => toUnit(v, 4)
  const v1Entries = [
    { file: 'C:\\docs\\bail.txt', text: 'Article 3 : le loyer est de 800 euros.', vec: unit(0, 1, 0, 0) },
    { file: 'C:\\docs\\bail.txt', text: 'Article 9 : fin du contrat, préavis de trois mois.', vec: unit(1, 0, 0, 0) },
    { file: 'C:\\docs\\notes.md', page: 2, text: 'Nourrir le chat – « vacances » été.', vec: unit(0, 0, 1, 0) }
  ]
  const writeV1 = (dir: string): void => {
    mkdirSync(dir, { recursive: true })
    const all = new Float32Array(v1Entries.length * 4)
    v1Entries.forEach((e, i) => all.set(e.vec, i * 4))
    writeFileSync(join(dir, 'vectors.bin'), Buffer.from(all.buffer))
    writeFileSync(
      join(dir, 'index.json'),
      JSON.stringify({
        version: 1,
        model: 'm',
        dims: 4,
        files: { 'C:\\docs\\bail.txt': { mtime: 1, size: 2 }, 'C:\\docs\\notes.md': { mtime: 3, size: 4 } },
        entries: v1Entries.map(({ file, page, text }) => ({ file, ...(page ? { page } : {}), text }))
      })
    )
  }
  const search = async (dir: string, m: store.IndexMeta, q: Float32Array): Promise<Array<{ file: string; page?: number; text: string }>> => {
    const found = await store.scanVectors(dir, m, q, () => false, 0.5)
    const texts = await store.readTexts(
      dir,
      m,
      found.map((f) => f.row)
    )
    return found.map((f) => ({ file: store.rowPath(m, f.row), page: store.rowPage(m, f.row), text: texts.get(f.row)! }))
  }

  it('convertit l’ancien index sans rien recalculer, avec les mêmes résultats', async () => {
    const dir = join(base, 'v1')
    writeV1(dir)
    const m = store.readIndex(dir, 'm')!
    expect(m).not.toBeNull()
    expect(store.rowCount(m)).toBe(3)
    expect(m.paths).toEqual(['C:\\docs\\bail.txt', 'C:\\docs\\notes.md'])
    expect(await search(dir, m, unit(1, 0, 0, 0))).toEqual([{ file: 'C:\\docs\\bail.txt', page: undefined, text: v1Entries[1].text }])
    expect(await search(dir, m, unit(0, 0, 1, 0))).toEqual([{ file: 'C:\\docs\\notes.md', page: 2, text: v1Entries[2].text }])
    // Nouveau format sur le disque ; relu tel quel ensuite.
    expect(existsSync(join(dir, 'vectors.bin'))).toBe(false)
    expect(JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')).version).toBe(2)
    expect(store.readIndex(dir, 'm')?.rows).toEqual(m.rows)
    // Autre modèle : pas d'index.
    expect(store.readIndex(dir, 'autre')).toBeNull()
  })

  it('reprend une conversion interrompue après le changement de nom des vecteurs', () => {
    const dir = join(base, 'v1-reprise')
    writeV1(dir)
    renameSync(join(dir, 'vectors.bin'), join(dir, 'vectors.1.bin'))
    expect(store.rowCount(store.readIndex(dir, 'm')!)).toBe(3)
  })

  it('enregistre une nouvelle génération : documents retirés ôtés, les autres intacts, passages frais ajoutés', async () => {
    const dir = join(base, 'v1')
    const m1 = store.readIndex(dir, 'm')!
    const m2 = store.writeIndex(dir, m1, {
      model: 'm',
      dims: 4,
      files: { 'C:\\docs\\notes.md': { mtime: 3, size: 4 }, 'C:\\docs\\neuf.txt': { mtime: 5, size: 6 } },
      removed: new Set(['C:\\docs\\bail.txt']),
      fresh: [{ file: 'C:\\docs\\neuf.txt', text: 'Le loyer augmente en janvier.', vec: unit(0, 1, 0, 0) }]
    })
    expect(m2.gen).toBe(m1.gen + 1)
    expect(store.rowCount(m2)).toBe(2)
    expect(await search(dir, m2, unit(0, 0, 1, 0))).toEqual([{ file: 'C:\\docs\\notes.md', page: 2, text: v1Entries[2].text }])
    expect(await search(dir, m2, unit(0, 1, 0, 0))).toEqual([{ file: 'C:\\docs\\neuf.txt', page: undefined, text: 'Le loyer augmente en janvier.' }])
    expect(await search(dir, m2, unit(1, 0, 0, 0))).toEqual([])
    store.removeOtherGenerations(dir, m2.gen)
    expect(readdirSync(dir).sort()).toEqual(['index.json', `texts.${m2.gen}.bin`, `vectors.${m2.gen}.bin`])
    expect(store.readIndex(dir, 'm')?.gen).toBe(m2.gen)
  })

  it('fichiers incomplets (Compi fermé pendant l’écriture) : l’index n’est pas utilisé', () => {
    const dir = join(base, 'v1')
    const m = store.readIndex(dir, 'm')!
    const file = join(dir, `vectors.${m.gen}.bin`)
    writeFileSync(file, readFileSync(file).subarray(0, 8))
    expect(store.readIndex(dir, 'm')).toBeNull()
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
