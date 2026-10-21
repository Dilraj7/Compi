// Recherche par le sens dans les dossiers confiés : « le passage de mon contrat
// sur la résiliation » trouve aussi « fin du contrat, préavis de trois mois ».
// Chaque document est découpé en passages ; Ollama calcule sur le PC un vecteur
// par passage (rien ne part en ligne). L'index vit dans userData/semantic et se
// met à jour tout seul quand un document change.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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
import { chunkText, dot, embedPrefix, GENTLE_PAUSE_MS, indexPace, toUnit, topK } from './vectors'

/** Composantes gardées par vecteur : assez pour bien chercher, 2 Ko par passage. */
const DIMS = 512
const BATCH = 16
const FILE_MAX_BYTES = 30 * 1024 * 1024
const RESYNC_MS = 30 * 60_000

interface Entry {
  file: string
  page?: number
  text: string
  vec: Float32Array
}

interface FileMeta {
  mtime: number
  size: number
}

interface Stored {
  version: 1
  model: string
  dims: number
  files: Record<string, FileMeta>
  entries: Array<{ file: string; page?: number; text: string }>
}

const dir = (): string => join(app.getPath('userData'), 'semantic')
const ollamaBase = (): string => {
  const l = settings.get().local
  return l.engine === 'ollama' && l.baseUrl ? l.baseUrl : OLLAMA_URL
}

let entries: Entry[] = []
let files: Record<string, FileMeta> = {}
let loadedModel = ''
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

function setStatus(patch: Partial<SemanticStatus>, force = true): void {
  status = { ...status, ...patch, passages: entries.length }
  noteSemanticReady(status.state === 'ready' && entries.length > 0)
  if (!force && Date.now() - lastEmit < 400) return
  lastEmit = Date.now()
  emit(IPC.semanticChanged, status)
}

export const semanticStatus = (): SemanticStatus => status

// ─── Stockage ────────────────────────────────────────────────────────────────

function loadIndex(model: string): void {
  if (loadedModel === model) return
  entries = []
  files = {}
  loadedModel = model
  try {
    const meta = JSON.parse(readFileSync(join(dir(), 'index.json'), 'utf8')) as Stored
    if (meta.version !== 1 || meta.model !== model) return
    const buf = readFileSync(join(dir(), 'vectors.bin'))
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    if (all.length !== meta.entries.length * meta.dims) return
    entries = meta.entries.map((e, i) => ({ ...e, vec: all.slice(i * meta.dims, (i + 1) * meta.dims) }))
    files = meta.files
  } catch {
    // pas encore d'index
  }
}

function saveIndex(): void {
  try {
    mkdirSync(dir(), { recursive: true })
    const dims = entries[0]?.vec.length ?? DIMS
    const all = new Float32Array(entries.length * dims)
    entries.forEach((e, i) => all.set(e.vec.subarray(0, dims), i * dims))
    const meta: Stored = {
      version: 1,
      model: loadedModel,
      dims,
      files,
      entries: entries.map(({ file, page, text }) => ({ file, ...(page ? { page } : {}), text }))
    }
    writeFileSync(join(dir(), 'vectors.bin'), Buffer.from(all.buffer))
    writeFileSync(join(dir(), 'index.json'), JSON.stringify(meta))
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
  const fresh: Entry[] = []
  for (let i = 0; i < passages.length; i += BATCH) {
    await pace(signal)
    if (signal.aborted) return
    const batch = passages.slice(i, i + BATCH)
    const vecs = await embed(
      model,
      batch.map((p) => p.text),
      'passage'
    )
    batch.forEach((p, j) => fresh.push({ file, ...(p.page ? { page: p.page } : {}), text: p.text, vec: vecs[j] }))
  }
  entries = entries.filter((e) => e.file !== file).concat(fresh)
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
    const before = entries.length
    entries = entries.filter((e) => wanted.has(e.file))
    for (const f of Object.keys(files)) if (!wanted.has(f)) delete files[f]
    let dirty = entries.length !== before
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
    if (todo.length) log('info', `recherche par le sens : ${status.indexed}/${list.length} documents, ${entries.length} passages`)
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
  setStatus({
    state: entries.length ? 'ready' : 'indexing',
    model: s.model,
    modelInstalled: undefined,
    ...(entries.length ? { files: known, indexed: known } : {})
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
  entries = []
  files = {}
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
  if (!s.enabled || !entries.length) return null
  // Documents modifiés depuis : rattrapés vite (15 s au plus) avant de chercher. Une
  // longue mise à jour déjà en route n'est pas attendue jusqu'au bout. Pendant une
  // réponse, on cherche tout de suite dans l'index (la recherche par mots, lancée en
  // même temps, trouve les nouveaux documents) et on rattrape après.
  if (holds) catchUp = true
  else await Promise.race([syncSemantic(15_000).catch(() => undefined), new Promise((r) => setTimeout(r, 15_000))])
  try {
    const [q] = await embed(s.model, [query], 'query')
    const pool = entries.filter((e) => insideAny(e.file, roots))
    return topK(
      pool,
      (e) => dot(q, e.vec),
      limit,
      (e) => e.file
    ).map(({ item, score }) => ({ file: item.file, page: item.page, text: item.text, score }))
  } catch (e) {
    log('warn', `recherche par le sens impossible : ${(e as Error).message}`)
    return null
  }
}
