// Où Ollama range ses modèles, et réparation quand il ne les voit plus
// (serveur lancé avant un changement de dossier). Compi ne télécharge pas les
// modèles lui-même : il demande à Ollama, qui les met dans ce dossier.
// Lecture seule, sauf « Redémarrer Ollama » sur un clic de l'utilisateur.

import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { lastServerModelsDir, needsRestart, parseRegValue, pickModelsDir, sameDir, type OllamaFolder } from '../../shared/ollamaFolder'
import { log } from '../log'
import { ollamaVersion, startOllama } from './ollama'

const GB = 1024 ** 3
const CACHE_MS = 20_000
const ollamaData = (): string => join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Ollama')

const run = (file: string, args: string[], timeout = 5000): Promise<string> =>
  new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout }, (err, stdout) => resolve(err ? '' : String(stdout))))

const expand = (v: string | undefined): string | undefined => v?.replace(/%([^%]+)%/g, (all, k: string) => process.env[k] ?? all)

/**
 * Réglage « Model location » de l'application Ollama, lu dans sa base, sur une
 * copie temporaire (la base d'Ollama n'est jamais ouverte, seulement copiée).
 */
function appSetting(): string | undefined {
  const src = ollamaData()
  if (!existsSync(join(src, 'db.sqlite'))) return undefined
  const dir = mkdtempSync(join(tmpdir(), 'compi-ollama-'))
  try {
    for (const f of ['db.sqlite', 'db.sqlite-wal', 'db.sqlite-shm']) if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dir, f))
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const db = new DatabaseSync(join(dir, 'db.sqlite'))
    try {
      const row = db.prepare('select models from settings limit 1').get() as { models?: unknown } | undefined
      return typeof row?.models === 'string' ? row.models : undefined
    } finally {
      db.close()
    }
  } catch {
    // Ancienne version d'Ollama (sans application) ou base illisible : la variable d'environnement décide.
    return undefined
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

let cached: { at: number; value: { dir: string; source: OllamaFolder['source'] } } | null = null

/** Dossier réglé pour les modèles d'Ollama (réglage de l'application, variable OLLAMA_MODELS, ou ~/.ollama/models). */
export async function resolveModelsDir(): Promise<{ dir: string; source: OllamaFolder['source'] }> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value
  let value: { dir: string; source: OllamaFolder['source'] }
  if (process.platform !== 'win32') {
    value = pickModelsDir({ envUser: process.env.OLLAMA_MODELS, home: homedir() })
    value = { ...value, dir: value.dir.replace(/\\/g, '/') }
  } else {
    // La variable se relit dans le registre : elle a pu changer depuis le démarrage de Compi.
    const [user, machine] = await Promise.all([
      run('reg', ['query', 'HKCU\\Environment', '/v', 'OLLAMA_MODELS']),
      run('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', '/v', 'OLLAMA_MODELS'])
    ])
    value = pickModelsDir({
      appSetting: appSetting(),
      envUser: expand(parseRegValue(user, 'OLLAMA_MODELS')),
      envMachine: expand(parseRegValue(machine, 'OLLAMA_MODELS')),
      home: homedir()
    })
  }
  cached = { at: Date.now(), value }
  return value
}

/** Dernier dossier connu, sans attendre (place libre du conseiller). */
export const knownModelsDir = (): string => cached?.value.dir ?? (process.env.OLLAMA_MODELS || join(homedir(), '.ollama', 'models'))

function folderSize(dir: string): number {
  try {
    const blobs = join(dir, 'blobs')
    return readdirSync(blobs).reduce((n, f) => {
      try {
        return n + statSync(join(blobs, f)).size
      } catch {
        return n
      }
    }, 0)
  } catch {
    return 0
  }
}

function runningDir(): string | null {
  try {
    return lastServerModelsDir(readFileSync(join(ollamaData(), 'server.log'), 'utf8'))
  } catch {
    return null
  }
}

async function apiModels(base: string): Promise<{ running: boolean; count: number }> {
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { running: false, count: 0 }
    const data = (await res.json()) as { models?: Array<{ name: string }> }
    return { running: true, count: (data.models ?? []).filter((m) => !/-compi$/.test(m.name)).length }
  } catch {
    return { running: false, count: 0 }
  }
}

/** Dossier des modèles, sa taille, la place libre, et s'il faut redémarrer Ollama. */
export async function ollamaFolder(base: string): Promise<OllamaFolder> {
  const { dir, source } = await resolveModelsDir()
  const exists = existsSync(dir)
  const sizeGb = exists ? folderSize(dir) / GB : 0
  let freeGb: number | undefined
  try {
    const s = await statfs(exists ? dir : homedir())
    freeGb = (s.bavail * s.bsize) / GB
  } catch {
    freeGb = undefined
  }
  const api = await apiModels(base)
  const running = process.platform === 'win32' ? runningDir() : null
  return {
    dir,
    source,
    exists,
    sizeGb,
    freeGb,
    models: api.count,
    runningDir: running && !sameDir(running, dir) ? running : undefined,
    restartNeeded: needsRestart({ running: api.running, apiModels: api.count, folderSizeGb: sizeGb, runningDir: running, dir })
  }
}

/**
 * « Redémarrer Ollama » : arrête ses serveurs (ollama.exe, pas l'application),
 * puis attend que l'application Ollama en relance un, ou le relance soi-même.
 * Les modèles ne sont pas touchés.
 */
export async function restartOllama(base: string): Promise<OllamaFolder> {
  if (process.platform === 'win32') {
    const out = await run('tasklist', ['/FI', 'IMAGENAME eq ollama.exe', '/FO', 'CSV', '/NH'])
    const pids = [...out.matchAll(/^"ollama\.exe","(\d+)"/gim)].map((m) => Number(m[1]))
    for (const pid of pids) {
      try {
        process.kill(pid)
      } catch (e) {
        log('warn', `serveur Ollama ${pid} non arrêté`, (e as Error).message)
      }
    }
    log('info', `Ollama redémarré : ${pids.length} serveur(s) arrêté(s)`)
  }
  // L'application Ollama relance son serveur d'elle-même en quelques secondes.
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (i > 2 && (await ollamaVersion(base))) break
  }
  if (!(await ollamaVersion(base))) await startOllama(base)
  cached = null
  return ollamaFolder(base)
}
