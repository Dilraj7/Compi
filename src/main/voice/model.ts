// Modèle Whisper de la dictée : téléchargé une seule fois, après l'accord de
// l'utilisateur, dans userData/models ; servi ensuite à l'interface par le
// protocole compi-model://, sans jamais repasser par Internet. La voix ne
// quitte pas le PC : seule la transcription (le texte) part au cerveau.
//
// Chaque fichier est vérifié (empreinte publiée par Hugging Face, à une
// révision figée) avant d'être utilisé.

import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, net, protocol } from 'electron'
import type { VoiceModelId, VoiceModelStatus, VoiceVariant } from '../../shared/types'
import { VOICE_MODELS } from '../../shared/voice'
import { log } from '../log'

export const MODEL_SCHEME = 'compi-model'

/**
 * Adresse de Hugging Face. Pour les tests de bout en bout seulement,
 * COMPI_HF_TEST_BASE peut la remplacer par un faux serveur local (jamais une
 * autre adresse que l'ordinateur lui-même).
 */
export function hfBase(testBase = process.env.COMPI_HF_TEST_BASE): string {
  if (testBase) {
    try {
      const u = new URL(testBase)
      if (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return testBase.replace(/\/+$/, '')
    } catch {
      // adresse invalide : Hugging Face
    }
  }
  return 'https://huggingface.co'
}

const root = (): string => join(app.getPath('userData'), 'models')
const modelDir = (id: VoiceModelId): string => join(root(), VOICE_MODELS[id].dir)
const manifestPath = (id: VoiceModelId): string => join(modelDir(id), 'compi-model.json')

interface Manifest {
  repo: string
  revision: string
  variant: VoiceVariant
  files: { path: string; size: number }[]
  installedAt: number
}

function readManifest(id: VoiceModelId): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(id), 'utf8')) as Manifest
    if (m.revision !== VOICE_MODELS[id].revision) return null
    const dir = modelDir(id)
    for (const f of m.files) if (!existsSync(join(dir, f.path)) || statSync(join(dir, f.path)).size !== f.size) return null
    return m
  } catch {
    return null
  }
}

// ─── Téléchargement ──────────────────────────────────────────────────────────

let job: { id: VoiceModelId; variant: VoiceVariant; abort: AbortController; received: number; total: number } | null = null

export function voiceModelStatus(id: VoiceModelId): VoiceModelStatus {
  const m = readManifest(id)
  return {
    model: id,
    installed: Boolean(m),
    variant: m?.variant,
    sizeBytes: m?.files.reduce((n, f) => n + f.size, 0),
    downloading: job ? { model: job.id, variant: job.variant, received: job.received, total: job.total } : undefined
  }
}

interface TreeEntry {
  path: string
  size: number
  oid: string
  lfs?: { oid: string; size: number }
}

/** Empreinte attendue : SHA-256 pour les gros fichiers (LFS), SHA-1 « blob » de Git sinon. */
export function expectedHash(e: TreeEntry): { algo: 'sha256' | 'git-sha1'; hex: string } {
  return e.lfs ? { algo: 'sha256', hex: e.lfs.oid } : { algo: 'git-sha1', hex: e.oid }
}

/** Empreinte « blob » de Git : sha1("blob <taille>\0" + contenu). */
export function gitBlobHasher(size: number): ReturnType<typeof createHash> {
  return createHash('sha1').update(`blob ${size}\0`)
}

async function tree(repo: string, revision: string, folder: string, signal: AbortSignal): Promise<TreeEntry[]> {
  const res = await net.fetch(`${hfBase()}/api/models/${repo}/tree/${revision}${folder ? `/${folder}` : ''}`, { signal })
  if (!res.ok) throw new Error(`Hugging Face a répondu ${res.status}.`)
  return (await res.json()) as TreeEntry[]
}

async function downloadFile(url: string, dest: string, entry: TreeEntry, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  mkdirSync(dirname(dest), { recursive: true })
  const part = `${dest}.part`
  const res = await net.fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Téléchargement refusé (${res.status}).`)
  const want = expectedHash(entry)
  const hash = want.algo === 'sha256' ? createHash('sha256') : gitBlobHasher(entry.size)
  const out = createWriteStream(part)
  let size = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      if (size > entry.size) throw new Error('Fichier plus gros que prévu.')
      hash.update(value)
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      onBytes(value.length)
    }
    await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())))
  } catch (e) {
    out.destroy()
    rmSync(part, { force: true })
    throw e
  }
  if (size !== entry.size || hash.digest('hex') !== want.hex) {
    rmSync(part, { force: true })
    throw new Error(`Fichier abîmé pendant le téléchargement : ${entry.path}. Réessaie.`)
  }
  renameSync(part, dest)
}

/**
 * Télécharge le modèle (après l'accord de l'utilisateur, demandé par
 * l'interface). `onProgress` reçoit les octets reçus et le total.
 */
export async function downloadVoiceModel(id: VoiceModelId, variant: VoiceVariant, onProgress: (s: VoiceModelStatus) => void): Promise<VoiceModelStatus> {
  if (job) throw new Error('Un téléchargement est déjà en cours.')
  const def = VOICE_MODELS[id]
  if (!def) throw new Error('Modèle inconnu.')
  const files = def.variants[variant]?.files
  if (!files) throw new Error('Variante inconnue.')
  const abort = new AbortController()
  job = { id, variant, abort, received: 0, total: 0 }
  let last = 0
  const tick = (force = false): void => {
    if (!force && Date.now() - last < 200) return
    last = Date.now()
    onProgress(voiceModelStatus(id))
  }
  try {
    const entries = new Map<string, TreeEntry>()
    for (const folder of new Set(files.map((f) => (f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')))) {
      for (const e of await tree(def.repo, def.revision, folder, abort.signal)) entries.set(e.path, e)
    }
    const wanted = files.map((f) => {
      const e = entries.get(f)
      if (!e) throw new Error(`Fichier absent du modèle : ${f}.`)
      return e
    })
    job.total = wanted.reduce((n, e) => n + e.size, 0)
    // Un précédent modèle (autre variante) laisse place au nouveau.
    rmSync(manifestPath(id), { force: true })
    const dir = modelDir(id)
    for (const e of wanted) {
      const dest = join(dir, ...e.path.split('/'))
      if (existsSync(dest) && statSync(dest).size === e.size) {
        job.received += e.size
        tick()
        continue
      }
      await downloadFile(`${hfBase()}/${def.repo}/resolve/${def.revision}/${e.path}`, dest, e, abort.signal, (n) => {
        job!.received += n
        tick()
      })
    }
    const manifest: Manifest = { repo: def.repo, revision: def.revision, variant, files: wanted.map((e) => ({ path: e.path, size: e.size })), installedAt: Date.now() }
    mkdirSync(dir, { recursive: true })
    const tmp = `${manifestPath(id)}.tmp`
    writeFileSync(tmp, JSON.stringify(manifest, null, 2))
    renameSync(tmp, manifestPath(id))
    // Fichiers d'une autre variante, devenus inutiles.
    const other = variant === 'gpu' ? 'cpu' : 'gpu'
    for (const f of def.variants[other].files) if (!files.includes(f)) rmSync(join(dir, ...f.split('/')), { force: true })
    log('info', `dictée : modèle ${def.repo} (${variant}) installé, ${(job.total / 1e6).toFixed(0)} Mo`)
  } catch (e) {
    if (abort.signal.aborted) {
      // Annulé : on ne laisse rien derrière soi.
      rmSync(modelDir(id), { recursive: true, force: true })
      throw new Error('Téléchargement annulé.', { cause: e })
    }
    log('warn', 'dictée : téléchargement du modèle impossible', (e as Error).message)
    throw e
  } finally {
    job = null
    tick(true)
  }
  return voiceModelStatus(id)
}

export function cancelVoiceDownload(): void {
  job?.abort.abort()
}

/** Supprime le modèle téléchargé (bouton « Supprimer » des réglages). */
export function deleteVoiceModel(id: VoiceModelId): VoiceModelStatus {
  if (job?.id === id) job.abort.abort()
  rmSync(modelDir(id), { recursive: true, force: true })
  return voiceModelStatus(id)
}

/** Fichiers .part laissés par un téléchargement interrompu (fermeture de Compi). */
export function cleanPartialDownloads(): void {
  for (const id of Object.keys(VOICE_MODELS) as VoiceModelId[]) {
    const dir = modelDir(id)
    if (!existsSync(dir)) continue
    for (const f of VOICE_MODELS[id].variants.gpu.files.concat(VOICE_MODELS[id].variants.cpu.files)) {
      const part = join(dir, ...f.split('/')) + '.part'
      if (existsSync(part)) unlinkSync(part)
    }
  }
}

// ─── Protocole compi-model:// ────────────────────────────────────────────────

/** À appeler avant `app.whenReady()`. */
export function registerModelScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MODEL_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])
}

const CORS = { 'access-control-allow-origin': '*' }

/**
 * Chemin local d'une adresse compi-model://models/<dossier>/<fichier>, ou
 * `null` si elle sort du dossier des modèles ou ne vise pas un fichier connu.
 */
export function modelFileFor(url: string, base: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${MODEL_SCHEME}:` || u.hostname !== 'models') return null
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '')
  if (!/\.(json|onnx|onnx_data|txt)$/i.test(rel) || rel.includes('\0')) return null
  // Seulement dans le dossier d'un modèle connu.
  const folder = rel.split(/[\\/]/)[0]
  if (!Object.values(VOICE_MODELS).some((m) => m.dir === folder)) return null
  const full = normalize(join(base, rel))
  return full.startsWith(normalize(base) + sep) ? full : null
}

/** Sert les fichiers des modèles installés, en lecture seule. */
export function handleModelScheme(): void {
  protocol.handle(MODEL_SCHEME, async (req) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response(null, { status: 405, headers: CORS })
    const file = modelFileFor(req.url, root())
    if (!file || !existsSync(file)) return new Response(null, { status: 404, headers: CORS })
    const res = await net.fetch(pathToFileURL(file).toString())
    const type = file.endsWith('.json') ? 'application/json' : 'application/octet-stream'
    return new Response(res.body, { status: 200, headers: { ...CORS, 'content-type': type, 'content-length': String(statSync(file).size) } })
  })
}
