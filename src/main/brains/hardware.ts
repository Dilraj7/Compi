// Matériel du PC, pour conseiller un modèle local : RAM, carte graphique et
// mémoire vidéo réelle (lue dans le registre : WMI plafonne à 4 Go), espace disque.

import { execFile } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { homedir, totalmem } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { HardwareInfo } from '../../shared/types'
import { log } from '../log'
import { knownModelsDir, resolveModelsDir } from './modelsDir'

const GPU_SCRIPT = String.raw`Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*' -ErrorAction SilentlyContinue | Where-Object { $_.DriverDesc } | ForEach-Object { [pscustomobject]@{ name = $_.DriverDesc; q = $_.'HardwareInformation.qwMemorySize'; m = $_.'HardwareInformation.MemorySize' } } | ConvertTo-Json -Compress`

interface RawGpu {
  name: string
  q?: number | null
  m?: number | number[] | null
}

const GB = 1024 ** 3

/** Choisit la carte graphique la mieux dotée dans la sortie du script. */
export function parseGpus(json: string): HardwareInfo['gpu'] {
  let list: RawGpu[]
  try {
    const parsed = JSON.parse(json) as RawGpu | RawGpu[]
    list = Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return undefined
  }
  const gpus = list
    .filter((g) => g?.name)
    .map((g) => {
      const bytes = typeof g.q === 'number' ? g.q : typeof g.m === 'number' ? g.m : 0
      const n = g.name.toLowerCase()
      const vendor = /nvidia|geforce|rtx|quadro/.test(n) ? 'nvidia' : /amd|radeon/.test(n) ? 'amd' : /intel/.test(n) ? 'intel' : 'other'
      return { name: g.name.trim(), vramGb: Math.round((bytes / GB) * 10) / 10, vendor } as const
    })
    .sort((a, b) => b.vramGb - a.vramGb)
  return gpus[0]
}

/** Dossier des modèles d'Ollama (réglage de l'application Ollama, variable OLLAMA_MODELS ou ~/.ollama/models). */
export const ollamaModelsDir = (): string => knownModelsDir()

let cached: HardwareInfo | null = null
/** Détection ratée (PC saturé au démarrage) : on réessaie après ce moment. */
let retryAt = 0
const RETRY_MS = 2 * 60_000

/** Dernière carte graphique détectée, gardée sur le disque. */
const gpuFile = (): string => join(app.getPath('userData'), 'hardware.json')

function lastGpu(): HardwareInfo['gpu'] {
  try {
    const g = (JSON.parse(readFileSync(gpuFile(), 'utf8')) as { gpu?: HardwareInfo['gpu'] }).gpu
    return g?.name && typeof g.vramGb === 'number' ? g : undefined
  } catch {
    return undefined
  }
}

function detectGpu(): Promise<{ gpu: HardwareInfo['gpu']; ok: boolean }> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', GPU_SCRIPT], { windowsHide: true, timeout: 15_000 }, (err, stdout) => {
      if (err) return resolve({ gpu: undefined, ok: false })
      resolve({ gpu: parseGpus(stdout.trim()), ok: true })
    })
  })
}

/**
 * RAM et carte graphique (détectées une fois), place libre. Si la détection
 * échoue (PowerShell trop lent quand la mémoire est pleine), on reprend la
 * dernière carte connue : sans ça, le modèle local perdait la moitié de sa
 * fenêtre de contexte jusqu'au redémarrage de Compi.
 */
export async function hardwareInfo(): Promise<HardwareInfo> {
  if (cached && (!retryAt || Date.now() < retryAt)) return { ...cached, freeDiskGb: await freeDisk() }
  const ramGb = Math.round((totalmem() / GB) * 10) / 10
  let gpu: HardwareInfo['gpu']
  if (process.platform === 'win32') {
    const found = await detectGpu()
    if (found.ok) {
      gpu = found.gpu
      retryAt = 0
      try {
        if (gpu) writeFileSync(gpuFile(), JSON.stringify({ gpu }))
      } catch (e) {
        log('warn', 'carte graphique non enregistrée', (e as Error).message)
      }
    } else {
      gpu = lastGpu() ?? cached?.gpu
      retryAt = Date.now() + RETRY_MS
      log('warn', `carte graphique non détectée${gpu ? ` : je garde la dernière connue (${gpu.name}, ${gpu.vramGb} Go)` : ''}`)
    }
  }
  cached = { ramGb, gpu }
  return { ...cached, freeDiskGb: await freeDisk() }
}

async function freeDisk(): Promise<number | undefined> {
  try {
    const wanted = (await resolveModelsDir().catch(() => null))?.dir ?? ollamaModelsDir()
    const dir = existsSync(wanted) ? wanted : homedir()
    const s = await statfs(dir)
    return Math.round(((s.bavail * s.bsize) / GB) * 10) / 10
  } catch {
    return undefined
  }
}
