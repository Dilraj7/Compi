// Modèles de la dictée partout et pack des voix (sherpa-onnx) : téléchargés une
// seule fois, après un clic de l'utilisateur, dans userData/models. Même chemin
// vérifié que la dictée Whisper (voice/model.ts) : révision figée, empreinte de
// chaque fichier contrôlée avant usage, rien de gardé en cas d'annulation.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { packRevision, SPEECH_PACKS } from '../../shared/speechModels'
import type { SpeechModelStatus, SpeechPackId } from '../../shared/types'
import { log } from '../log'
import { downloadFile, hfBase, tree, type TreeEntry } from '../voice/model'

const root = (): string => join(app.getPath('userData'), 'models')
const modelDir = (id: SpeechPackId): string => join(root(), SPEECH_PACKS[id].dir)
const manifestPath = (id: SpeechPackId): string => join(modelDir(id), 'compi-model.json')

interface Manifest {
  repo: string
  revision: string
  files: { path: string; size: number }[]
  installedAt: number
}

function readManifest(id: SpeechPackId): Manifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(id), 'utf8')) as Manifest
    if (m.revision !== packRevision(SPEECH_PACKS[id])) return null
    const dir = modelDir(id)
    for (const f of m.files) if (!existsSync(join(dir, f.path)) || statSync(join(dir, f.path)).size !== f.size) return null
    return m
  } catch {
    return null
  }
}

const packFiles = (id: SpeechPackId): string[] => SPEECH_PACKS[id].sources.flatMap((s) => s.files)

/** Fichiers du modèle installé (chemins complets), ou `null` s'il n'est pas prêt. */
export function speechModelFiles(id: SpeechPackId): Record<string, string> | null {
  if (!readManifest(id)) return null
  const dir = modelDir(id)
  return Object.fromEntries(packFiles(id).map((f) => [f, join(dir, f)]))
}

let job: { id: SpeechPackId; abort: AbortController; received: number; total: number } | null = null

export function speechModelStatus(id: SpeechPackId): SpeechModelStatus {
  const m = readManifest(id)
  return {
    model: id,
    installed: Boolean(m),
    sizeBytes: m?.files.reduce((n, f) => n + f.size, 0),
    downloading: job ? { model: job.id, received: job.received, total: job.total } : undefined
  }
}

/** Télécharge le modèle (après l'accord de l'utilisateur, demandé par l'interface). */
export async function downloadSpeechModel(id: SpeechPackId, onProgress: (s: SpeechModelStatus) => void): Promise<SpeechModelStatus> {
  if (job) throw new Error('Un téléchargement est déjà en cours.')
  const def = SPEECH_PACKS[id]
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
    const wanted: { source: (typeof def.sources)[number]; entry: TreeEntry }[] = []
    for (const source of def.sources) {
      const entries = new Map<string, TreeEntry>((await tree(source.repo, source.revision, '', abort.signal)).map((e) => [e.path, e]))
      for (const f of source.files) {
        const entry = entries.get(f)
        if (!entry) throw new Error(`Fichier absent du modèle : ${f}.`)
        wanted.push({ source, entry })
      }
    }
    job.total = wanted.reduce((n, w) => n + w.entry.size, 0)
    rmSync(manifestPath(id), { force: true })
    const dir = modelDir(id)
    for (const { source, entry: e } of wanted) {
      const dest = join(dir, e.path)
      if (existsSync(dest) && statSync(dest).size === e.size) {
        job.received += e.size
        tick()
        continue
      }
      await downloadFile(`${hfBase()}/${source.repo}/resolve/${source.revision}/${e.path}`, dest, e, abort.signal, (n) => {
        job!.received += n
        tick()
      })
    }
    const manifest: Manifest = {
      repo: def.sources.map((s) => s.repo).join('+'),
      revision: packRevision(def),
      files: wanted.map((w) => ({ path: w.entry.path, size: w.entry.size })),
      installedAt: Date.now()
    }
    mkdirSync(dir, { recursive: true })
    const tmp = `${manifestPath(id)}.tmp`
    writeFileSync(tmp, JSON.stringify(manifest, null, 2))
    renameSync(tmp, manifestPath(id))
    log('info', `dictée partout : modèle ${manifest.repo} installé, ${(job.total / 1e6).toFixed(0)} Mo`)
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
export function deleteSpeechModel(id: SpeechPackId): SpeechModelStatus {
  if (job?.id === id) job.abort.abort()
  rmSync(modelDir(id), { recursive: true, force: true })
  return speechModelStatus(id)
}

/** Fichiers .part laissés par un téléchargement interrompu (fermeture de Compi). */
export function cleanPartialSpeechDownloads(): void {
  for (const id of Object.keys(SPEECH_PACKS) as SpeechPackId[]) {
    for (const f of packFiles(id)) {
      const part = join(modelDir(id), `${f}.part`)
      if (existsSync(part)) unlinkSync(part)
    }
  }
}
