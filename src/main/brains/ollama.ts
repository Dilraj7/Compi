// Ollama : détection, liste des modèles et de leurs capacités, téléchargement,
// fenêtre de contexte, installation en un clic (winget) et démarrage.
// Doc : https://docs.ollama.com (API native) et /api/anthropic-compatibility.

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { LocalModelInfo } from '../../shared/types'

/** Première version compatible avec l'API de Claude (POST /v1/messages). */
export const MIN_OLLAMA = '0.14.0'

/** Suffixe des variantes créées par Compi (même modèle, contexte élargi). */
const VARIANT_SUFFIX = '-compi'

async function call<T>(base: string, path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 5000, ...rest } = init
  const res = await fetch(`${base}${path}`, { ...rest, signal: rest.signal ?? AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(`Ollama ${path} : HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`)
  return (await res.json()) as T
}

export async function ollamaVersion(base: string): Promise<string | null> {
  try {
    return (await call<{ version: string }>(base, '/api/version', { timeoutMs: 1500 })).version
  } catch {
    return null
  }
}

export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(/[.-]/).map((n) => parseInt(n, 10) || 0)
  const b = min.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  return true
}

interface ShowResponse {
  capabilities?: string[]
  model_info?: Record<string, unknown>
  details?: { parameter_size?: string }
  parameters?: string
}

/** Capacités d'un modèle d'après /api/show. */
export function parseShow(show: ShowResponse): Pick<LocalModelInfo, 'tools' | 'vision' | 'thinking' | 'contextLength' | 'params'> {
  const caps = show.capabilities ?? []
  const ctxKey = Object.keys(show.model_info ?? {}).find((k) => k.endsWith('.context_length'))
  const ctx = ctxKey ? Number(show.model_info?.[ctxKey]) : NaN
  return {
    tools: caps.includes('tools'),
    vision: caps.includes('vision'),
    thinking: caps.includes('thinking'),
    contextLength: Number.isFinite(ctx) ? ctx : undefined,
    params: show.details?.parameter_size
  }
}

/** Valeur de num_ctx dans le champ `parameters` (texte façon Modelfile) de /api/show. */
export function parseNumCtx(parameters?: string): number | undefined {
  const m = /^\s*num_ctx\s+(\d+)/m.exec(parameters ?? '')
  return m ? Number(m[1]) : undefined
}

export const isVariant = (name: string): boolean => name.endsWith(VARIANT_SUFFIX)

/** « qwen3.5:9b » → « qwen3.5:9b-compi » ; sans étiquette, « latest » est ajouté. */
export function variantName(model: string): string {
  const [name, tag] = model.includes(':') ? model.split(/:(?=[^:]*$)/) : [model, 'latest']
  return `${name}:${tag}${VARIANT_SUFFIX}`
}

export interface LoadedModel {
  name: string
  /** Part dans la carte graphique (0 à 1). */
  gpuShare: number
  sizeBytes: number
  contextLength?: number
  /** Heure à laquelle Ollama le déchargera. */
  expiresAt?: number
}

/** Modèles chargés en mémoire (/api/ps) et part de chacun dans la carte graphique. */
export async function loadedModels(base: string): Promise<LoadedModel[]> {
  const { models } = await call<{ models: Array<{ name: string; size: number; size_vram: number; context_length?: number; expires_at?: string }> }>(
    base,
    '/api/ps',
    {
      timeoutMs: 3000
    }
  )
  return (models ?? []).map((m) => {
    const expires = m.expires_at ? Date.parse(m.expires_at) : NaN
    return {
      name: m.name,
      gpuShare: m.size ? Math.min(1, m.size_vram / m.size) : 0,
      sizeBytes: m.size ?? 0,
      contextLength: m.context_length,
      expiresAt: Number.isFinite(expires) ? expires : undefined
    }
  })
}

/**
 * Charge le modèle (sans rien générer) et le garde en mémoire `keepAlive`. Le
 * chargement peut prendre plusieurs minutes quand la mémoire du PC est presque pleine.
 */
export async function preload(base: string, model: string, keepAlive = '30m'): Promise<void> {
  await call(base, '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: keepAlive }),
    timeoutMs: 600_000
  })
}

/** Décharge un modèle tout de suite (libère la mémoire vidéo). */
export async function unloadModel(base: string, model: string): Promise<void> {
  await call(base, '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
    timeoutMs: 30_000
  })
}

/** Vecteurs de plusieurs textes (/api/embed), pour la recherche par le sens. */
export async function embedTexts(base: string, model: string, input: string[], timeoutMs = 120_000): Promise<number[][]> {
  const { embeddings } = await call<{ embeddings: number[][] }>(base, '/api/embed', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, input, truncate: true, keep_alive: '10m' }),
    timeoutMs
  })
  if (!Array.isArray(embeddings) || embeddings.length !== input.length) throw new Error('Ollama a renvoyé des vecteurs incomplets.')
  return embeddings
}

/** Le modèle est présent dans Ollama. */
export async function hasModel(base: string, model: string): Promise<boolean> {
  return showModel(base, model).then(
    () => true,
    () => false
  )
}

/** Supprime un modèle d'Ollama (libère la place sur le disque). */
export async function deleteModel(base: string, model: string): Promise<void> {
  const res = await fetch(`${base}/api/delete`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(15_000)
  })
  if (!res.ok && res.status !== 404) throw new Error(`Ollama n’a pas supprimé le modèle (HTTP ${res.status}).`)
}

export async function showModel(base: string, model: string): Promise<ShowResponse> {
  return call<ShowResponse>(base, '/api/show', { method: 'POST', body: JSON.stringify({ model }), headers: { 'content-type': 'application/json' } })
}

export async function listOllamaModels(base: string): Promise<LocalModelInfo[]> {
  const { models } = await call<{ models: Array<{ name: string; size: number }> }>(base, '/api/tags')
  const visible = models.filter((m) => !isVariant(m.name))
  const listed = await Promise.all(
    visible.map(async (m) => {
      let info: ReturnType<typeof parseShow> = { tools: false, vision: false, thinking: false }
      let embeddingOnly = false
      try {
        const show = await showModel(base, m.name)
        info = parseShow(show)
        // Modèle de vecteurs (recherche par le sens) : il ne sait pas discuter.
        embeddingOnly = Boolean(show.capabilities?.includes('embedding') && !show.capabilities.includes('completion'))
      } catch {
        // Modèle illisible : on le montre sans capacités.
      }
      return embeddingOnly ? null : { name: m.name, sizeBytes: m.size, ...info }
    })
  )
  return listed.filter((m): m is LocalModelInfo => m !== null)
}

/**
 * Ollama limite le contexte à 4k sous 24 Go de VRAM : bien trop peu pour un
 * agent. On crée une variante du modèle avec la bonne fenêtre (instantané :
 * elle réutilise les mêmes fichiers). Renvoie le nom à utiliser.
 */
export async function ensureContext(base: string, model: string, numCtx: number): Promise<string> {
  const variant = variantName(model)
  try {
    if (parseNumCtx((await showModel(base, variant)).parameters) === numCtx) return variant
  } catch {
    // La variante n'existe pas encore.
  }
  await call(base, '/api/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: variant, from: model, parameters: { num_ctx: numCtx }, stream: false }),
    timeoutMs: 60_000
  })
  return variant
}

export interface PullUpdate {
  status: string
  progress?: number
  error?: string
}

/** Une ligne NDJSON de /api/pull, traduite pour l'interface. */
export function parsePullLine(line: string): PullUpdate | null {
  let data: { status?: string; total?: number; completed?: number; error?: string }
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  if (data.error) return { status: 'Erreur', error: data.error }
  const status = data.status ?? ''
  if (data.total && data.completed !== undefined) return { status: 'Téléchargement', progress: Math.min(1, data.completed / data.total) }
  if (status === 'success') return { status: 'Terminé', progress: 1 }
  if (status.startsWith('verifying')) return { status: 'Vérification' }
  if (status.startsWith('writing') || status.startsWith('removing')) return { status: 'Finalisation' }
  return { status: 'Préparation' }
}

export async function pullModel(base: string, model: string, onUpdate: (u: PullUpdate) => void, signal: AbortSignal): Promise<void> {
  const res = await fetch(`${base}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Téléchargement refusé par Ollama (HTTP ${res.status}).`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const u = line.trim() ? parsePullLine(line) : null
      if (u?.error) throw new Error(u.error)
      if (u) onUpdate(u)
    }
  }
}

// ─── Installation et démarrage ───────────────────────────────────────────────

const ollamaDir = (): string => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Ollama')
export const ollamaInstalled = (): boolean => existsSync(join(ollamaDir(), 'ollama.exe'))

/** Lance Ollama (icône dans la barre des tâches + serveur local) et attend qu'il réponde. */
export async function startOllama(base: string): Promise<boolean> {
  if (await ollamaVersion(base)) return true
  const app = join(ollamaDir(), 'ollama app.exe')
  const exe = existsSync(app) ? app : join(ollamaDir(), 'ollama.exe')
  if (!existsSync(exe)) return false
  const child = spawn(exe, exe === app ? [] : ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (await ollamaVersion(base)) return true
  }
  return false
}

export function wingetAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => execFile('winget', ['--version'], { windowsHide: true, timeout: 8000 }, (err) => resolve(!err)))
}

/** Progression lue dans la sortie de winget (« 150 MB / 1.04 GB » ou « 45% »). */
export function parseWingetLine(line: string): PullUpdate | null {
  const unit = (n: string, u: string): number => parseFloat(n) * ({ KB: 1e3, MB: 1e6, GB: 1e9 } as Record<string, number>)[u.toUpperCase()]
  const sizes = /([\d.]+)\s*(KB|MB|GB)\s*\/\s*([\d.]+)\s*(KB|MB|GB)/i.exec(line)
  if (sizes) return { status: 'Téléchargement', progress: Math.min(1, unit(sizes[1], sizes[2]) / unit(sizes[3], sizes[4])) }
  const pct = /(\d{1,3})\s*%/.exec(line)
  if (pct) return { status: 'Installation', progress: Number(pct[1]) / 100 }
  if (/installer hash|vérifi/i.test(line)) return { status: 'Vérification' }
  if (/starting package install|démarrage de l.installation/i.test(line)) return { status: 'Installation' }
  if (/successfully installed|installé correctement/i.test(line)) return { status: 'Terminé', progress: 1 }
  return null
}

/** Installe Ollama avec winget (installation par utilisateur, sans droits administrateur). */
export function installOllama(onUpdate: (u: PullUpdate) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'winget',
      ['install', '--id', 'Ollama.Ollama', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'],
      { windowsHide: true }
    )
    let tail = ''
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      tail = (tail + text).slice(-2000)
      for (const line of text.split(/[\r\n]+/)) {
        const u = parseWingetLine(line)
        if (u) onUpdate(u)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('close', (code) => {
      // 0 : installé ; 0x8A15002B : déjà installé et à jour.
      if (code === 0 || code === -1978335189 || ollamaInstalled()) resolve()
      else
        reject(
          new Error(
            `winget a échoué (code ${code}). ${tail
              .split(/[\r\n]+/)
              .filter(Boolean)
              .slice(-2)
              .join(' ')}`
          )
        )
    })
  })
}
