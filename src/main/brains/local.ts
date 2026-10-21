// Cerveau local : état du moteur (Ollama ou LM Studio), préparation d'un
// modèle avant une discussion, téléchargements et installation, avec leur
// progression envoyée à l'interface.

import { shell } from 'electron'
import { IPC } from '../../shared/ipc'
import { normalizeBaseUrl } from '../../shared/brains'
import { contextFor } from '../../shared/recommend'
import type { BrainProgress, LocalStatus } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { LMSTUDIO_URL, OLLAMA_URL, settings } from '../store/settings'
import { primeLocalCache } from './gateway'
import { hardwareInfo } from './hardware'
import { listLmStudioModels, lmstudioRunning, loadLmStudioModel } from './lmstudio'
import {
  ensureContext,
  installOllama,
  isVariant,
  listOllamaModels,
  loadedModels,
  MIN_OLLAMA,
  ollamaInstalled,
  ollamaVersion,
  parseShow,
  preload,
  pullModel,
  showModel,
  startOllama,
  variantName,
  versionAtLeast,
  wingetAvailable
} from './ollama'

const GB = 1024 ** 3

export const ollamaBase = (): string => {
  const l = settings.get().local
  return l.engine === 'ollama' && l.baseUrl ? l.baseUrl : OLLAMA_URL
}
export const lmstudioBase = (): string => {
  const l = settings.get().local
  return l.engine === 'lmstudio' && l.baseUrl ? l.baseUrl : LMSTUDIO_URL
}

let wingetCache: boolean | null = null

export async function localStatus(): Promise<LocalStatus> {
  const preferred = settings.get().local.engine
  const [version, lmUp, canInstall] = await Promise.all([
    ollamaVersion(ollamaBase()),
    lmstudioRunning(lmstudioBase()),
    wingetCache ?? wingetAvailable().then((v) => (wingetCache = v))
  ])
  const engine = preferred === 'lmstudio' && lmUp ? 'lmstudio' : version ? 'ollama' : lmUp ? 'lmstudio' : null
  const models =
    engine === 'ollama'
      ? await listOllamaModels(ollamaBase()).catch(() => [])
      : engine === 'lmstudio'
        ? await listLmStudioModels(lmstudioBase()).catch(() => [])
        : []
  const loaded = engine === 'ollama' ? (await loadedModels(ollamaBase()).catch(() => []))[0] : undefined
  return {
    loaded: loaded ? { name: loaded.name.replace(/-compi$/, ''), gpuShare: loaded.gpuShare } : undefined,
    engine: engine ?? (ollamaInstalled() ? 'ollama' : null),
    baseUrl: engine === 'lmstudio' ? lmstudioBase() : ollamaBase(),
    running: engine !== null,
    installed: ollamaInstalled() || Boolean(version),
    version: engine === 'ollama' ? (version ?? undefined) : undefined,
    outdated: Boolean(version && !versionAtLeast(version, MIN_OLLAMA)),
    canInstall,
    models
  }
}

export interface PreparedLocal {
  /** Nom à envoyer au moteur (variante avec le bon contexte pour Ollama). */
  model: string
  contextTokens?: number
  vision: boolean
  /** Le modèle sait réfléchir (sinon on ne lui demande pas de le faire). */
  thinking: boolean
}

/** Prépare le modèle local d'une discussion : moteur démarré, fenêtre de contexte suffisante. */
export async function prepareLocalBrain(model: string): Promise<PreparedLocal> {
  const hw = await hardwareInfo()
  if (settings.get().local.engine === 'lmstudio') {
    const info = (await listLmStudioModels(lmstudioBase())).find((m) => m.name === model)
    const ctx = contextFor((info?.sizeBytes ?? 0) / GB, hw)
    await loadLmStudioModel(lmstudioBase(), model, ctx)
    return { model, contextTokens: Math.min(ctx, info?.contextLength ?? ctx), vision: info?.vision ?? false, thinking: info?.thinking ?? false }
  }

  const base = ollamaBase()
  if (!(await ollamaVersion(base)) && !(await startOllama(base))) {
    throw new Error(`connect ECONNREFUSED ${base} : Ollama ne répond pas`)
  }
  const caps = parseShow(await showModel(base, model))
  const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5000) })
    .then((r) => r.json() as Promise<{ models: Array<{ name: string; size: number }> }>)
    .catch(() => ({ models: [] }))
  const sizeGb = (tags.models.find((m) => m.name === model)?.size ?? 0) / GB
  const ctx = Math.min(contextFor(sizeGb, hw), caps.contextLength ?? Infinity, ctxLimit.get(model) ?? Infinity)
  try {
    return { model: await ensureContext(base, model, ctx), contextTokens: ctx, vision: caps.vision, thinking: caps.thinking }
  } catch (e) {
    log('warn', `contexte élargi impossible pour ${model} : le modèle garde la fenêtre par défaut d'Ollama`, (e as Error).message)
    return { model, vision: caps.vision, thinking: caps.thinking }
  }
}

// ─── Garder le modèle prêt ───────────────────────────────────────────────────

/** Fenêtre réduite pour un modèle qui débordait de la carte graphique (jusqu'au redémarrage). */
const ctxLimit = new Map<string, number>()
const SMALL_CONTEXT = 32_768
let warming: Promise<void> | null = null

/**
 * Charge le modèle local et le garde en mémoire le temps choisi (30 min par
 * défaut, réglage `local.keepAlive`) : sans ça, Ollama le
 * décharge après 5 min et la question suivante attend ~15 s de chargement.
 * Vérifie au passage qu'il tient dans la carte graphique ; sinon, réduit sa
 * fenêtre de contexte pour la prochaine fois. Juste après un chargement, lui fait
 * lire les consignes d'avance (cache).
 */
export function keepWarm(model?: string): Promise<void> {
  return (warming ??= warm(model).finally(() => (warming = null)))
}

async function warm(model?: string): Promise<void> {
  const l = settings.get().local
  if (l.engine !== 'ollama' || !(model || l.model)) return
  const base = ollamaBase()
  try {
    if (!(await ollamaVersion(base))) return
    // Nom réellement utilisé par les discussions : la variante « -compi » si elle existe.
    let name = model ?? l.model
    if (
      !isVariant(name) &&
      (await showModel(base, variantName(name)).then(
        () => true,
        () => false
      ))
    )
      name = variantName(name)
    const wasLoaded = (await loadedModels(base)).some((m) => m.name === name)
    await preload(base, name, l.keepAlive ?? '30m')
    const loaded = (await loadedModels(base)).find((m) => m.name === name)
    if (loaded && loaded.gpuShare < 0.97 && (loaded.contextLength ?? 0) > SMALL_CONTEXT && isVariant(name)) {
      const original = name.slice(0, -'-compi'.length)
      log('info', `${name} déborde de la carte graphique (${Math.round(loaded.gpuShare * 100)} %) : fenêtre ramenée à ${SMALL_CONTEXT} jetons`)
      ctxLimit.set(original, SMALL_CONTEXT)
      await ensureContext(base, original, SMALL_CONTEXT)
      await preload(base, name, l.keepAlive ?? '30m')
    }
    // Modèle tout juste chargé : son cache est vide, on lui fait lire les consignes d'avance.
    if (!wasLoaded) await primeLocalCache(normalizeBaseUrl(base), name)
  } catch (e) {
    log('warn', 'préchargement du modèle local impossible', (e as Error).message)
  }
}

// ─── Téléchargements et installation ─────────────────────────────────────────

const progress = (p: BrainProgress): void => emit(IPC.brainProgress, p)

let pullAbort: AbortController | null = null

/** Télécharge un modèle Ollama ; la progression part vers l'interface. */
export async function startPull(model: string): Promise<void> {
  if (pullAbort) {
    progress({ kind: 'pull', model, status: 'Erreur', error: 'Un téléchargement est déjà en cours.', done: true })
    return
  }
  const controller = (pullAbort = new AbortController())
  progress({ kind: 'pull', model, status: 'Préparation', progress: 0 })
  try {
    const base = ollamaBase()
    if (!(await ollamaVersion(base)) && !(await startOllama(base))) throw new Error('Ollama ne répond pas.')
    let last = 0
    await pullModel(
      base,
      model,
      (u) => {
        const now = Date.now()
        if (now - last < 250 && u.progress !== 1) return
        last = now
        progress({ kind: 'pull', model, ...u })
      },
      controller.signal
    )
    log('info', `modèle local téléchargé : ${model}`)
    progress({ kind: 'pull', model, status: 'Terminé', progress: 1, done: true })
  } catch (e) {
    const cancelled = controller.signal.aborted
    if (!cancelled) log('error', `téléchargement de ${model}`, e)
    progress({ kind: 'pull', model, status: cancelled ? 'Annulé' : 'Erreur', error: cancelled ? undefined : (e as Error).message, done: true })
  } finally {
    pullAbort = null
  }
}

export function cancelPull(): void {
  pullAbort?.abort()
}

let installing = false

/** Installe (ou met à jour) Ollama en un clic ; sans winget, ouvre la page de téléchargement. */
export async function runInstall(): Promise<void> {
  if (installing) return
  installing = true
  try {
    progress({ kind: 'install', status: 'Préparation' })
    if (!(await wingetAvailable())) {
      await shell.openExternal('https://ollama.com/download/windows')
      progress({ kind: 'install', status: 'Page de téléchargement ouverte : installe Ollama, je le détecterai tout seul.', done: true })
      return
    }
    await installOllama((u) => progress({ kind: 'install', ...u }))
    progress({ kind: 'install', status: 'Démarrage d’Ollama' })
    const started = await startOllama(OLLAMA_URL)
    settings.update({ local: { ...settings.get().local, engine: 'ollama', baseUrl: OLLAMA_URL } })
    log('info', `Ollama installé${started ? ' et démarré' : ''}`)
    progress({ kind: 'install', status: started ? 'Prêt' : 'Installé', progress: 1, done: true })
  } catch (e) {
    log('error', 'installation d’Ollama', e)
    progress({ kind: 'install', status: 'Erreur', error: (e as Error).message, done: true })
  } finally {
    installing = false
  }
}

export async function startLocalEngine(): Promise<LocalStatus> {
  await startOllama(ollamaBase())
  return localStatus()
}
