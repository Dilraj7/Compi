// Activité du PC pour « Ce PC » (Activité) et l'îlot : processeur, mémoire,
// carte graphique (par application) et modèle local. Mesurée seulement quand
// quelqu'un regarde (vue ouverte, option de l'îlot, réponse locale en cours),
// jamais quand le PC est verrouillé. Rien ne part en ligne.

import { cpus, freemem, totalmem } from 'node:os'
import { powerMonitor } from 'electron'
import script from '../windows/perf.ps1?raw'
import { PowerShellHost } from '../windows/host'
import { IPC } from '../../shared/ipc'
import {
  cpuPercent,
  cpuTimes,
  friendlyName,
  groupVram,
  isModelProcess,
  pickGpu,
  sameModel,
  type CpuTimes,
  type GpuAdapterSample,
  type GpuProcessSample,
  type LocalModelState,
  type PerfRun,
  type PerfSnapshot
} from '../../shared/perf'
import type { RunStats } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { settings } from '../store/settings'
import { hardwareInfo } from '../brains/hardware'
import { lmstudioBase, ollamaBase } from '../brains/local'
import { loadedLmStudioModels } from '../brains/lmstudio'
import { loadedModels, unloadModel } from '../brains/ollama'

type PerfFn = 'ping' | 'sample' | 'ram_top' | 'quns'
const host = new PowerShellHost<PerfFn>('hôte performances', script, 5 * 60_000)

const GB = 1024 ** 3
const RAM_TOP_MS = 10_000
const RUNS_MAX = 20

/** Abonnés et rythme voulu par chacun (ms). */
const watchers = new Map<string, number>()
let timer: NodeJS.Timeout | null = null
let sampling = false
let locked = false
let prevCpu: CpuTimes | null = null
let ramTop: { at: number; top: Array<{ name: string; gb: number }> } = { at: 0, top: [] }
let gpuFailures = 0
let last: PerfSnapshot | null = null
const runs: PerfRun[] = []
let generating: PerfSnapshot['generating']
/** Matériel (nom et mémoire de la carte graphique), lu une fois. */
let hw: Awaited<ReturnType<typeof hardwareInfo>> | null = null

async function gpuSample(): Promise<{ adapters: GpuAdapterSample[]; processes: GpuProcessSample[] } | null> {
  if (process.platform !== 'win32' || gpuFailures >= 5) return null
  try {
    const r = await host.call<{ adapters?: GpuAdapterSample[]; processes?: GpuProcessSample[] }>('sample', {}, 8000)
    gpuFailures = 0
    return { adapters: Array.isArray(r.adapters) ? r.adapters : [], processes: Array.isArray(r.processes) ? r.processes : [] }
  } catch (e) {
    if (++gpuFailures === 5) log('warn', 'activité de la carte graphique illisible', (e as Error).message)
    return null
  }
}

async function topRam(): Promise<Array<{ name: string; gb: number }>> {
  if (Date.now() - ramTop.at < RAM_TOP_MS || process.platform !== 'win32') return ramTop.top
  try {
    const r = await host.call<{ top?: Array<{ name: string; bytes: number }> }>('ram_top', {}, 8000)
    const top = (r.top ?? [])
      .filter((t) => t.name && !isModelProcess(t.name))
      .slice(0, 3)
      .map((t) => ({ name: friendlyName(t.name), gb: t.bytes / GB }))
    ramTop = { at: Date.now(), top }
  } catch {
    ramTop = { ...ramTop, at: Date.now() }
  }
  return ramTop.top
}

async function localState(): Promise<PerfSnapshot['local']> {
  const s = settings.get()
  const chatModel = s.local.model
  const embedModel = s.semantic.model
  const role = (name: string): LocalModelState['role'] =>
    chatModel && sameModel(name, chatModel) ? 'chat' : embedModel && sameModel(name, embedModel) ? 'embed' : 'other'
  try {
    if (s.local.engine === 'lmstudio') {
      const models = await loadedLmStudioModels(lmstudioBase())
      return {
        engine: 'lmstudio',
        chatModel,
        keepAlive: s.local.keepAlive ?? '30m',
        models: models.map((m) => ({ name: m.name, sizeGb: m.sizeBytes / GB, gpuShare: 1, contextLength: m.contextLength, role: role(m.name) }))
      }
    }
    const models = await loadedModels(ollamaBase())
    return {
      engine: 'ollama',
      chatModel,
      keepAlive: s.local.keepAlive ?? '30m',
      models: models.map((m) => ({
        name: m.name.replace(/-compi$/, ''),
        sizeGb: m.sizeBytes / GB,
        gpuShare: m.gpuShare,
        expiresAt: m.expiresAt,
        contextLength: m.contextLength,
        role: role(m.name)
      }))
    }
  } catch {
    // Moteur arrêté : rien de chargé.
    return s.provider === 'local' || chatModel ? { engine: s.local.engine, chatModel, keepAlive: s.local.keepAlive ?? '30m', models: [] } : undefined
  }
}

async function sample(): Promise<void> {
  if (sampling) return
  sampling = true
  try {
    const now = cpuTimes(cpus())
    const cpu = prevCpu ? cpuPercent(prevCpu, now) : 0
    prevCpu = now
    const totalGb = totalmem() / GB
    hw ??= await hardwareInfo().catch(() => null)
    const [gpu, top, local] = await Promise.all([gpuSample(), topRam(), localState()])
    let gpuInfo: PerfSnapshot['gpu']
    const adapter = gpu ? pickGpu(gpu.adapters) : undefined
    if (gpu && adapter && hw?.gpu) {
      const busy = gpu.processes.filter((p) => !isModelProcess(p.name) && !/^(dwm|compi)$/i.test(p.name)).sort((a, b) => b.util - a.util)[0]
      gpuInfo = {
        name: hw.gpu.name,
        util: adapter.util,
        vramUsedGb: adapter.dedicatedBytes / GB,
        vramTotalGb: hw.gpu.vramGb,
        vram: groupVram(gpu.processes),
        busyApp: busy && busy.util > 0 ? { name: friendlyName(busy.name), util: busy.util } : undefined
      }
    }
    last = {
      at: Date.now(),
      cpu,
      ram: { usedGb: totalGb - freemem() / GB, totalGb, top },
      gpu: gpuInfo,
      local,
      runs: [...runs],
      generating
    }
    emit(IPC.perfChanged, last)
  } finally {
    sampling = false
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  if (!watchers.size || locked) return
  const every = Math.min(...watchers.values())
  timer = setTimeout(() => void sample().finally(schedule), every)
}

/** S'abonne (ou se désabonne) à l'activité du PC ; `every` : rythme voulu (ms). */
export function perfWatch(id: string, on: boolean, every = 2000): PerfSnapshot | null {
  const had = watchers.size
  if (on) watchers.set(id, Math.max(1000, every))
  else watchers.delete(id)
  if (on && !had) void sample()
  schedule()
  return last
}

export const perfSnapshot = (): PerfSnapshot | null => last

// ─── Réponses du modèle local ────────────────────────────────────────────────

export interface LocalRunProbe {
  /** À fusionner dans les mesures de la réponse. */
  extra(): Pick<RunStats, 'coldStart' | 'gpuShare'>
  finish(stats?: RunStats): void
}

/**
 * Début d'une réponse locale : regarde si le modèle est déjà chargé (sinon, il
 * faudra le recharger) et suit l'activité pendant la réponse.
 */
export function startLocalRun(model: string): LocalRunProbe {
  let coldStart: boolean | undefined
  let gpuShare: number | undefined
  generating = { since: Date.now(), model }
  const engine = settings.get().local.engine
  if (engine === 'ollama') {
    void loadedModels(ollamaBase())
      .then((list) => (coldStart = !list.some((m) => sameModel(m.name, model))))
      .catch(() => undefined)
  }
  perfWatch('generating', true, 2000)
  const share = (): number | undefined => last?.local?.models.find((m) => sameModel(m.name, model))?.gpuShare ?? gpuShare
  return {
    extra: () => {
      gpuShare = engine === 'ollama' ? share() : undefined
      return { coldStart, gpuShare }
    },
    finish: (stats) => {
      generating = undefined
      if (stats) {
        runs.push({
          at: Date.now(),
          model,
          firstTokenMs: stats.firstTokenMs,
          tokensPerSec: stats.tokensPerSec,
          inputTokens: stats.inputTokens,
          coldStart,
          gpuShare: engine === 'ollama' ? share() : undefined
        })
        if (runs.length > RUNS_MAX) runs.splice(0, runs.length - RUNS_MAX)
      }
      perfWatch('generating', false)
      if (watchers.size) void sample()
    }
  }
}

/** « Libérer » : décharge le modèle de la recherche par le sens, ou tous les modèles. */
export async function unloadLocal(which: 'all' | 'embed'): Promise<PerfSnapshot | null> {
  const s = settings.get()
  if (s.local.engine === 'ollama') {
    const list = await loadedModels(ollamaBase()).catch(() => [])
    for (const m of list) {
      if (which === 'embed' && !sameModel(m.name, s.semantic.model)) continue
      await unloadModel(ollamaBase(), m.name).catch((e) => log('warn', `modèle ${m.name} non libéré`, (e as Error).message))
    }
    log('info', which === 'all' ? 'mémoire vidéo libérée : modèles locaux déchargés' : 'modèle de la recherche par le sens déchargé')
  }
  await sample()
  return last
}

/** Une application est en plein écran (jeu, vidéo, présentation) : pas de son. */
export async function fullscreenNow(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const r = await host.call<{ state: number }>('quns', {}, 1500)
    // 2 : application en plein écran, 3 : jeu Direct3D, 4 : présentation.
    return r.state === 2 || r.state === 3 || r.state === 4
  } catch {
    return false
  }
}

let powerHooked = false
export function hookPerfPower(): void {
  if (powerHooked) return
  powerHooked = true
  const pause = (): void => {
    locked = true
    schedule()
  }
  const resume = (): void => {
    locked = false
    prevCpu = null
    schedule()
  }
  powerMonitor.on('lock-screen', pause)
  powerMonitor.on('suspend', pause)
  powerMonitor.on('unlock-screen', resume)
  powerMonitor.on('resume', resume)
}

export function stopPerf(): void {
  watchers.clear()
  if (timer) clearTimeout(timer)
  timer = null
  host.stop()
}
