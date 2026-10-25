// Cache des conversations d'Ollama : taille lue dans la fin de son journal, limite réglée
// dans le compte Windows (variable LLAMA_ARG_CACHE_RAM) et appliquée en redémarrant Ollama.
// Rien n'est changé sans un clic de l'utilisateur ; « Rétablir » efface la variable.

import { execFile } from 'node:child_process'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_ENV, parseCacheEnv, parseCacheLog, SUGGESTED_CACHE_MB, type OllamaCache, type OllamaCacheLog } from '../../shared/ollamaCache'
import { parseRegValue } from '../../shared/ollamaFolder'
import { log } from '../log'
import { ollamaData } from './modelsDir'
import { ollamaInstalled, ollamaVersion, startOllama } from './ollama'

const TAIL_BYTES = 512 * 1024
const ENV_CACHE_MS = 20_000

const run = (file: string, args: string[], timeout = 8000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) =>
    execFile(file, args, { windowsHide: true, timeout }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || stderr || err?.message || '') }))
  )

let logRead: { size: number; mtime: number; value: OllamaCacheLog | null } | null = null

/** État du cache d'après la fin du journal, relu seulement quand le journal a changé. */
function readCacheLog(): OllamaCacheLog | null {
  const file = join(ollamaData(), 'server.log')
  try {
    const st = statSync(file)
    if (logRead && logRead.size === st.size && logRead.mtime === st.mtimeMs) return logRead.value
    const len = Math.min(st.size, TAIL_BYTES)
    const buf = Buffer.alloc(len)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, len, st.size - len)
    } finally {
      closeSync(fd)
    }
    const value = parseCacheLog(buf.toString('utf8'))
    logRead = { size: st.size, mtime: st.mtimeMs, value }
    return value
  } catch {
    return null
  }
}

let envRead: { at: number; value: number | undefined } | null = null

/**
 * Limite réglée dans le compte, relue dans le registre (elle a pu changer depuis le démarrage
 * de Compi). Compi la garde aussi dans son environnement : un Ollama qu'il lance en hérite.
 */
async function configuredMb(): Promise<number | undefined> {
  if (process.platform !== 'win32') return parseCacheEnv(process.env[CACHE_ENV])
  if (envRead && Date.now() - envRead.at < ENV_CACHE_MS) return envRead.value
  const r = await run('reg', ['query', 'HKCU\\Environment', '/v', CACHE_ENV], 3000)
  const value = parseCacheEnv(r.ok ? parseRegValue(r.out, CACHE_ENV) : undefined)
  if (value === undefined) delete process.env[CACHE_ENV]
  else process.env[CACHE_ENV] = String(value)
  envRead = { at: Date.now(), value }
  return value
}

const isLoopback = (base: string): boolean => {
  try {
    return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname)
  } catch {
    return false
  }
}

/** Compi peut régler la limite : Ollama installé sur ce PC (pas un serveur distant), sous Windows. */
export const canSetCache = (base: string): boolean => process.platform === 'win32' && isLoopback(base) && ollamaInstalled()

/** Cache des conversations ; `chatLoaded` : un modèle de discussion est chargé (sinon, rien n'est gardé). */
export async function ollamaCacheState(base: string, chatLoaded: boolean): Promise<OllamaCache | undefined> {
  const canSet = canSetCache(base)
  const fromLog = canSet || isLoopback(base) ? readCacheLog() : null
  const conf = await configuredMb()
  if (!fromLog && !canSet) return undefined
  const used = chatLoaded && fromLog ? fromLog : { prompts: 0, usedMb: 0 }
  return { prompts: used.prompts, usedMb: used.usedMb, limitMb: fromLog?.limitMb, configuredMb: conf, canSet }
}

/** Écrit (ou efface) la variable du compte ; Windows prévient les applications ouvertes. */
async function setUserEnv(value: string | null): Promise<void> {
  const v = value === null ? '$null' : `'${value}'`
  const r = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `[Environment]::SetEnvironmentVariable('${CACHE_ENV}', ${v}, 'User')`],
    15_000
  )
  if (!r.ok) throw new Error(`Réglage du compte impossible : ${r.out.trim().slice(0, 200)}`)
}

async function pidsOf(image: string): Promise<number[]> {
  const r = await run('tasklist', ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH'], 5000)
  const esc = image.replace(/[.]/g, '\\.')
  return [...r.out.matchAll(new RegExp(`^"${esc}","(\\d+)"`, 'gim'))].map((m) => Number(m[1]))
}

/**
 * Redémarre toute l'application Ollama (icône, serveur et modèles chargés) pour qu'elle relise
 * la limite : relancer seulement le serveur garderait l'ancienne, héritée de l'application.
 * Les modèles téléchargés ne sont pas touchés ; le modèle se recharge à la question suivante.
 */
async function restartOllamaApp(base: string): Promise<boolean> {
  let stopped = 0
  for (const image of ['ollama app.exe', 'ollama.exe', 'llama-server.exe']) {
    for (const pid of await pidsOf(image)) {
      try {
        process.kill(pid)
        stopped++
      } catch (e) {
        log('warn', `${image} ${pid} non arrêté`, (e as Error).message)
      }
    }
  }
  for (let i = 0; i < 10 && (await ollamaVersion(base)); i++) await new Promise((r) => setTimeout(r, 500))
  const ok = await startOllama(base)
  log(ok ? 'info' : 'warn', `Ollama redémarré pour la limite du cache : ${stopped} processus arrêté(s), ${ok ? 'il répond' : 'il ne répond pas'}`)
  return ok
}

/**
 * « Limiter à 2 Go » (`mb`), « Rétablir » (`null`) ou « Redémarrer Ollama » (`undefined` :
 * applique la limite déjà réglée). Toujours sur un clic confirmé de l'utilisateur.
 */
export async function setCacheLimit(base: string, mb: number | null | undefined): Promise<void> {
  if (!canSetCache(base)) throw new Error('Ollama n’est pas installé sur ce PC : sa mémoire des conversations se règle là où il tourne.')
  if (mb !== undefined) {
    if (mb !== null && mb !== SUGGESTED_CACHE_MB) throw new Error('Limite non prévue.')
    await setUserEnv(mb === null ? null : String(mb))
    if (mb === null) delete process.env[CACHE_ENV]
    else process.env[CACHE_ENV] = String(mb)
    envRead = null
    log('info', mb === null ? 'mémoire des conversations d’Ollama : limite par défaut rétablie' : `mémoire des conversations d’Ollama limitée à ${mb} Mo`)
  }
  if (!(await restartOllamaApp(base))) throw new Error('Ollama ne répond pas après le redémarrage : ouvre-le depuis le menu Démarrer.')
  logRead = null
}
