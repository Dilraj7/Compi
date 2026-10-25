// Recherche par le sens dans les dossiers confiés : « le passage de mon contrat
// sur la résiliation » trouve aussi « fin du contrat, préavis de trois mois ».
// Chaque document est découpé en passages ; Ollama calcule sur le PC un vecteur
// par passage (rien ne part en ligne). L'index vit dans userData/semantic et se
// met à jour tout seul quand un document change. Il reste sur le disque (store.ts) :
// en mémoire, seulement une petite table par passage.

import { rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app, powerMonitor } from 'electron'
import { IPC } from '../../shared/ipc'
import type { SemanticStatus } from '../../shared/types'
import { listDocuments } from '../agent/docSearch'
import { noteSemanticReady } from '../agent/labels'
import { extractDocument } from '../agent/documents'
import { allowedFolders, insideAny } from '../agent/folders'
import { embedTexts, hasModel, ollamaInstalled, ollamaVersion, startOllama } from '../brains/ollama'
import { emit } from '../bus'
import { log } from '../log'
import { OLLAMA_URL, settings } from '../store/settings'
import { chunkText, dot, embedPrefix, GENTLE_PAUSE_MS, indexPace, MIN_SCORE, toUnit, topK } from './vectors'
import {
  readIndex,
  readTexts,
  removeOtherGenerations,
  rowCount,
  rowPage,
  rowPath,
  ROW,
  scanVectors,
  writeIndex,
  type FileMeta,
  type FreshEntry,
  type IndexMeta
} from './store'

/** Composantes gardées par vecteur : assez pour bien chercher, 2 Ko par passage. */
const DIMS = 512
const BATCH = 16
const FILE_MAX_BYTES = 30 * 1024 * 1024
const RESYNC_MS = 30 * 60_000

const dir = (): string => join(app.getPath('userData'), 'semantic')
const ollamaBase = (): string => {
  const l = settings.get().local
  return l.engine === 'ollama' && l.baseUrl ? l.baseUrl : OLLAMA_URL
}

/** Index enregistré (null : aucun). */
let saved: IndexMeta | null = null
/** Nombre de passages enregistrés par chemin (saved.paths). */
let perPath = new Int32Array(0)
/** Documents retirés ou relus depuis le dernier enregistrement : leurs anciens passages ne comptent plus. */
let removed = new Set<string>()
/** Passages des documents relus, pas encore enregistrés. */
let fresh: FreshEntry[] = []
let files: Record<string, FileMeta> = {}
let loadedModel = ''
/** Recherches en cours : les fichiers de leur génération restent sur le disque jusqu'à la fin. */
let searching = 0
let status: SemanticStatus = { state: 'off', model: '', files: 0, indexed: 0, passages: 0 }
let syncing: Promise<void> | null = null
let again = false
let abort: AbortController | null = null
let resyncTimer: NodeJS.Timeout | null = null
let lastEmit = 0
/** Réponses en cours : l'indexation attend, puis reprend où elle en était. */
let holds = 0
let freeWaiters: Array<() => void> = []
/** Une recherche pendant une réponse n'a pas rattrapé les documents modifiés : à faire après. */
let catchUp = false

/**
 * Met l'indexation en pause le temps d'une réponse : elle passe par le même
 * Ollama que le modèle local et le ralentissait (et prenait du PC à Claude).
 * Renvoie la fonction qui lève la pause.
 */
export function holdSemantic(): () => void {
  holds++
  let released = false
  return () => {
    if (released) return
    released = true
    holds = Math.max(0, holds - 1)
    if (holds) return
    const waiting = freeWaiters
    freeWaiters = []
    for (const resume of waiting) resume()
    if (catchUp) {
      catchUp = false
      void syncSemantic()
    }
  }
}

/** Attend qu'aucune réponse ne soit en cours (ou que l'indexation soit arrêtée). */
function whenFree(signal: AbortSignal): Promise<void> {
  if (!holds || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    freeWaiters.push(resolve)
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

const pause = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        resolve()
      },
      { once: true }
    )
  })

/** Sur batterie : vérifié de nouveau toutes les minutes. */
const BATTERY_RECHECK_MS = 60_000

/**
 * Attend le tour du prochain document ou lot : aucune réponse en cours, sur secteur, et
 * une pause entre deux lots tant que l'utilisateur se sert du PC (indexPace).
 */
async function pace(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    await whenFree(signal)
    const p = indexPace({ idleSec: powerMonitor.getSystemIdleTime(), onBattery: powerMonitor.isOnBatteryPower() })
    if (p === 'full' || signal.aborted) return
    await pause(p === 'wait' ? BATTERY_RECHECK_MS : GENTLE_PAUSE_MS, signal)
    if (p === 'gentle' && !holds) return
  }
}

/** Passages cherchables : enregistrés (sauf documents retirés ou relus) et frais. */
function passageCount(): number {
  let n = fresh.length
  if (saved) for (let i = 0; i < saved.paths.length; i++) if (!removed.has(saved.paths[i])) n += perPath[i]
  return n
}

function setStatus(patch: Partial<SemanticStatus>, force = true): void {
  const passages = passageCount()
  status = { ...status, ...patch, passages }
  noteSemanticReady(status.state === 'ready' && passages > 0)
  if (!force && Date.now() - lastEmit < 400) return
  lastEmit = Date.now()
  emit(IPC.semanticChanged, status)
}

export const semanticStatus = (): SemanticStatus => status

// ─── Stockage ────────────────────────────────────────────────────────────────

function useIndex(m: IndexMeta | null): void {
  saved = m
  files = m ? m.files : {}
  removed = new Set()
  fresh = []
  perPath = new Int32Array(m ? m.paths.length : 0)
  if (m) for (let i = 0; i < rowCount(m); i++) perPath[m.rows[i * ROW]]++
}

/** Index du disque pour ce modèle (seulement la table : vecteurs et textes restent sur le disque). */
function loadIndex(model: string): void {
  if (loadedModel === model) return
  loadedModel = model
  try {
    useIndex(readIndex(dir(), model))
    if (saved && !searching) removeOtherGenerations(dir(), saved.gen)
  } catch (e) {
    log('warn', 'index de recherche par le sens illisible', (e as Error).message)
    useIndex(null)
  }
}

function saveIndex(): void {
  try {
    const dims = saved && rowCount(saved) ? saved.dims : (fresh[0]?.vec.length ?? DIMS)
    useIndex(writeIndex(dir(), saved, { model: loadedModel, dims, files, removed, fresh }))
    if (saved && !searching) removeOtherGenerations(dir(), saved.gen)
  } catch (e) {
    log('warn', 'index de recherche par le sens non enregistré', (e as Error).message)
  }
}

// ─── Mise à jour ─────────────────────────────────────────────────────────────

async function embed(model: string, texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]> {
  const prefix = embedPrefix(model, kind)
  const raw = await embedTexts(ollamaBase(), model, prefix ? texts.map((t) => prefix + t) : texts)
  return raw.map((v) => toUnit(v, DIMS))
}

/** Ollama prêt et modèle présent ; sinon l'état dit ce qui manque. */
async function ready(model: string): Promise<boolean> {
  const base = ollamaBase()
  if (!(await ollamaVersion(base))) {
    if (!ollamaInstalled() || !(await startOllama(base))) {
      setStatus({ state: 'no-ollama', model })
      return false
    }
  }
  if (!(await hasModel(base, model))) {
    setStatus({ state: 'no-model', model })
    return false
  }
  return true
}

async function indexFile(model: string, file: string, meta: FileMeta, signal: AbortSignal): Promise<void> {
  let passages: ReturnType<typeof chunkText> = []
  if (meta.size <= FILE_MAX_BYTES) {
    const doc = await extractDocument(file).catch(() => null)
    if (doc?.text) passages = chunkText(doc.text)
  }
  const read: FreshEntry[] = []
  for (let i = 0; i < passages.length; i += BATCH) {
    await pace(signal)
    if (signal.aborted) return
    const batch = passages.slice(i, i + BATCH)
    const vecs = await embed(
      model,
      batch.map((p) => p.text),
      'passage'
    )
    batch.forEach((p, j) => read.push({ file, ...(p.page ? { page: p.page } : {}), text: p.text, vec: vecs[j] }))
  }
  fresh = fresh.filter((e) => e.file !== file).concat(read)
  removed.add(file)
  files[file] = meta
}

async function runSync(budgetMs = Infinity): Promise<void> {
  const s = settings.get().semantic
  if (!s.enabled) return
  loadIndex(s.model)
  if (!(await ready(s.model))) return
  const controller = (abort = new AbortController())
  const started = Date.now()
  try {
    const roots = allowedFolders()
    const list = roots.length ? await listDocuments(roots) : []
    const wanted = new Set(list)
    // Documents retirés ou sortis des dossiers confiés : oubliés.
    let dirty = false
    for (const p of saved?.paths ?? []) {
      if (!wanted.has(p) && !removed.has(p)) {
        removed.add(p)
        dirty = true
      }
    }
    const freshBefore = fresh.length
    fresh = fresh.filter((e) => wanted.has(e.file))
    if (fresh.length !== freshBefore) dirty = true
    for (const f of Object.keys(files)) {
      if (!wanted.has(f)) {
        delete files[f]
        dirty = true
      }
    }
    const todo: Array<{ file: string; meta: FileMeta }> = []
    for (const file of list) {
      try {
        const st = statSync(file)
        const meta = { mtime: Math.round(st.mtimeMs), size: st.size }
        const known = files[file]
        if (!known || known.mtime !== meta.mtime || known.size !== meta.size) todo.push({ file, meta })
      } catch {
        // illisible : ignoré
      }
    }
    setStatus({ state: todo.length ? 'indexing' : 'ready', model: s.model, files: list.length, indexed: list.length - todo.length, error: undefined })
    for (const { file, meta } of todo) {
      // Lire un document (PDF, OCR…) prend aussi du processeur : même rythme que les lots.
      await pace(controller.signal)
      if (controller.signal.aborted || Date.now() - started > budgetMs) break
      setStatus({ current: file.split(/[\\/]/).pop() }, false)
      await indexFile(s.model, file, meta, controller.signal)
      dirty = true
      setStatus({ indexed: status.indexed + 1 }, false)
      // Enregistre régulièrement : un gros dossier n'est pas à refaire si Compi se ferme.
      if (status.indexed % 25 === 0) saveIndex()
    }
    if (dirty) saveIndex()
    const done = status.indexed >= list.length
    setStatus({ state: done ? 'ready' : 'indexing', current: undefined, ...(done ? { updatedAt: Date.now() } : {}) })
    if (todo.length) log('info', `recherche par le sens : ${status.indexed}/${list.length} documents, ${passageCount()} passages`)
  } catch (e) {
    const message = (e as Error).message
    log('warn', `recherche par le sens : mise à jour impossible : ${message}`)
    setStatus({ state: 'error', current: undefined, error: /ECONNREFUSED|fetch failed/i.test(message) ? 'Ollama ne répond plus.' : message })
  } finally {
    if (abort === controller) abort = null
  }
}

/** Met l'index à jour (une seule mise à jour à la fois ; une demande pendant ce temps en relance une). */
export function syncSemantic(budgetMs?: number): Promise<void> {
  if (syncing) {
    again = true
    return syncing
  }
  syncing = runSync(budgetMs).finally(() => {
    syncing = null
    if (again) {
      again = false
      void syncSemantic()
    }
  })
  return syncing
}

/** Au démarrage, et quand l'utilisateur active la recherche par le sens. */
export function startSemantic(delayMs = 0): void {
  const s = settings.get().semantic
  if (resyncTimer) clearInterval(resyncTimer)
  resyncTimer = null
  if (!s.enabled) {
    setStatus({ state: 'off', model: s.model, files: 0, indexed: 0 })
    return
  }
  // L'index du disque sert tout de suite ; la mise à jour viendra ensuite.
  loadIndex(s.model)
  const known = Object.keys(files).length
  const ready = passageCount() > 0
  setStatus({
    state: ready ? 'ready' : 'indexing',
    model: s.model,
    modelInstalled: undefined,
    ...(ready ? { files: known, indexed: known } : {})
  })
  setTimeout(() => void syncSemantic(), delayMs)
  resyncTimer = setInterval(() => void syncSemantic(), RESYNC_MS)
}

export function stopSemantic(): void {
  abort?.abort()
  if (resyncTimer) clearInterval(resyncTimer)
  resyncTimer = null
}

let enabling = false

/**
 * Clic sur « Activer » : télécharge le modèle s'il manque (c'est ce clic qui vaut
 * accord ; la progression suit par brain:progress), puis lit les documents.
 * Téléchargement annulé ou impossible : la recherche par le sens reste désactivée.
 */
export async function enableSemantic(download: (model: string) => Promise<void>): Promise<void> {
  if (enabling) return
  enabling = true
  try {
    const { model } = settings.get().semantic
    settings.update({ semantic: { ...settings.get().semantic, enabled: true } })
    setStatus({ state: 'indexing', model, error: undefined })
    const base = ollamaBase()
    if (!(await ollamaVersion(base)) && !(ollamaInstalled() && (await startOllama(base)))) {
      settings.update({ semantic: { ...settings.get().semantic, enabled: false } })
      setStatus({ state: 'no-ollama' })
      return
    }
    if (!(await hasModel(base, model))) {
      setStatus({ state: 'no-model' })
      await download(model)
      if (!settings.get().semantic.enabled) return
      if (!(await hasModel(base, model))) {
        settings.update({ semantic: { ...settings.get().semantic, enabled: false } })
        setStatus({ state: 'off', modelInstalled: false, error: 'Téléchargement annulé ou impossible : rien n’a été activé.' })
        return
      }
    }
    startSemantic()
  } finally {
    enabling = false
  }
}

/** Désactiver : l'index est effacé du disque. */
export function clearSemantic(): void {
  stopSemantic()
  useIndex(null)
  loadedModel = ''
  rmSync(dir(), { recursive: true, force: true })
  setStatus({ state: 'off', files: 0, indexed: 0, current: undefined, updatedAt: undefined, error: undefined })
}

/** État à jour, sans rien lancer (vérifie Ollama et le modèle quand c'est désactivé). */
export async function checkSemantic(): Promise<SemanticStatus> {
  const s = settings.get().semantic
  if (s.enabled) return status
  const base = ollamaBase()
  const up = Boolean(await ollamaVersion(base))
  const state: SemanticStatus['state'] = !up && !ollamaInstalled() ? 'no-ollama' : 'off'
  setStatus({ state, model: s.model, modelInstalled: up ? await hasModel(base, s.model) : undefined })
  return status
}

export interface SemanticHit {
  file: string
  page?: number
  text: string
  score: number
}

/**
 * Passages les plus proches du sens de la question, dans les dossiers donnés.
 * `null` si la recherche par le sens n'est pas prête (on se rabat sur les mots).
 */
export async function semanticSearch(query: string, roots: string[], limit = 6): Promise<SemanticHit[] | null> {
  const s = settings.get().semantic
  if (!s.enabled || !passageCount()) return null
  // Documents modifiés depuis : rattrapés vite (15 s au plus) avant de chercher. Une
  // longue mise à jour déjà en route n'est pas attendue jusqu'au bout. Pendant une
  // réponse, on cherche tout de suite dans l'index (la recherche par mots, lancée en
  // même temps, trouve les nouveaux documents) et on rattrape après.
  if (holds) catchUp = true
  else await Promise.race([syncSemantic(15_000).catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))])
  searching++
  try {
    const [q] = await embed(s.model, [query], 'query')
    // L'état du moment : un enregistrement pendant la recherche n'y change rien.
    const ix = saved
    const gone = new Set(removed)
    const pending = fresh.filter((e) => insideAny(e.file, roots))
    const okPath = ix ? ix.paths.map((p) => !gone.has(p) && insideAny(p, roots)) : []
    const found = ix ? await scanVectors(dir(), ix, q, (row) => !okPath[ix.rows[row * ROW]], MIN_SCORE) : []
    type Hit = { file: string; page?: number; row?: number; text?: string; score: number }
    const pool: Hit[] = [
      ...found.map(({ row, score }) => ({ file: rowPath(ix!, row), page: rowPage(ix!, row), row, score })),
      ...pending.map((e) => ({ file: e.file, page: e.page, text: e.text, score: dot(q, e.vec) }))
    ]
    const best = topK(
      pool,
      (h) => h.score,
      limit,
      (h) => h.file
    ).map(({ item }) => item)
    const texts = ix ? await readTexts(dir(), ix, best.flatMap((h) => (h.row === undefined ? [] : [h.row]))) : new Map<number, string>()
    return best.map((h) => ({ file: h.file, page: h.page, text: h.text ?? texts.get(h.row!) ?? '', score: h.score }))
  } catch (e) {
    log('warn', `recherche par le sens impossible : ${(e as Error).message}`)
    return null
  } finally {
    if (--searching === 0 && saved) removeOtherGenerations(dir(), saved.gen)
  }
}
