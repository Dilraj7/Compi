// Modèles de la dictée partout (sherpa-onnx) : téléchargés une seule fois,
// après un clic de l'utilisateur, dans userData/models. Même chemin vérifié
// que la dictée Whisper (voice/model.ts) : révision figée, empreinte de chaque
// fichier contrôlée avant usage, rien de gardé en cas d'annulation.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { SPEECH_MODELS } from '../../shared/speechModels'
import type { SpeechModelId, SpeechModelStatus } from '../../shared/types'
import { log } from '../log'
import { downloadFile, hfBase, tree, type TreeEntry } from '../voice/model'

const root = (): string => join(app.getPath('userData'), 'models')
const modelDir = (id: SpeechModelId): string => join(root(), SPEECH_MODELS[id].dir)
const manifestPath = (id: SpeechModelId): string => join(modelDir(id), 'compi-model.json')

interface Manifest {
  repo: string
  revision: string
  files: { path: string; size: number }[]
  installedAt: number
}

function readManifest(id: SpeechModelId): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(id), 'utf8')) as Manifest
    if (m.revision !== SPEECH_MODELS[id].revision) return null
    const dir = modelDir(id)
    for (const f of m.files) if (!existsSync(join(dir, f.path)) || statSync(join(dir, f.path)).size !== f.size) return null
    return m
  } catch {
    return null
  }
}

/** Fichiers du modèle installé (chemins complets), ou `null` s'il n'est pas prêt. */
export function speechModelFiles(id: SpeechModelId): Record<string, string> | null {
  if (!readManifest(id)) return null
  const dir = modelDir(id)
  return Object.fromEntries(SPEECH_MODELS[id].files.map((f) => [f, join(dir, f)]))
}

let job: { id: SpeechModelId; abort: AbortController; received: number; total: number } | null = null

export function speechModelStatus(id: SpeechModelId): SpeechModelStatus {
  const m = readManifest(id)
  return {
    model: id,
    installed: Boolean(m),
    sizeBytes: m?.files.reduce((n, f) => n + f.size, 0),
    downloading: job ? { model: job.id, received: job.received, total: job.total } : undefined
  }
}

/** Télécharge le modèle (après l'accord de l'utilisateur, demandé par l'interface). */
export async function downloadSpeechModel(id: SpeechModelId, onProgress: (s: SpeechModelStatus) => void): Promise<SpeechModelStatus> {
  if (job) throw new Error('Un téléchargement est déjà en cours.')
  const def = SPEECH_MODELS[id]
  if (!def) throw new Error('Modèle inconnu.')
  const abort = new AbortController()
  job = { id, abort, received: 0, total: 0 }
  let last = 0
  const tick = (force = false): void => {
    if (!force && Date.now() - last < 200) return
    last = Date.now()
    onProgress(speechModelStatus(id))
  }
  try {
    const entries = new Map<string, TreeEntry>((await tree(def.repo, def.revision, '', abort.signal)).map((e) => [e.path, e]))
    const wanted = def.files.map((f) => {
      const e = entries.get(f)
      if (!e) throw new Error(`Fichier absent du modèle : ${f}.`)
      return e
    })
    job.total = wanted.reduce((n, e) => n + e.size, 0)
    rmSync(manifestPath(id), { force: true })
    const dir = modelDir(id)
    for (const e of wanted) {
      const dest = join(dir, e.path)
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
    const manifest: Manifest = { repo: def.repo, revision: def.revision, files: wanted.map((e) => ({ path: e.path, size: e.size })), installedAt: Date.now() }
    mkdirSync(dir, { recursive: true })
    const tmp = `${manifestPath(id)}.tmp`
    writeFileSync(tmp, JSON.stringify(manifest, null, 2))
    renameSync(tmp, manifestPath(id))
    log('info', `dictée partout : modèle ${def.repo} installé, ${(job.total / 1e6).toFixed(0)} Mo`)
  } catch (e) {
    if (abort.signal.aborted) {
      rmSync(modelDir(id), { recursive: true, force: true })
      throw new Error('Téléchargement annulé.', { cause: e })
    }
    log('warn', 'dictée partout : téléchargement du modèle impossible', (e as Error).message)
    throw e
  } finally {
    job = null
    tick(true)
  }
  return speechModelStatus(id)
}

export function cancelSpeechDownload(): void {
  job?.abort.abort()
}

/** Supprime le modèle du PC (bouton « Supprimer » des réglages). */
export function deleteSpeechModel(id: SpeechModelId): SpeechModelStatus {
  if (job?.id === id) job.abort.abort()
  rmSync(modelDir(id), { recursive: true, force: true })
  return speechModelStatus(id)
}

/** Fichiers .part laissés par un téléchargement interrompu (fermeture de Compi). */
export function cleanPartialSpeechDownloads(): void {
  for (const id of Object.keys(SPEECH_MODELS) as SpeechModelId[]) {
    for (const f of SPEECH_MODELS[id].files) {
      const part = join(modelDir(id), `${f}.part`)
      if (existsSync(part)) unlinkSync(part)
    }
  }
}
