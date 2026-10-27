// Activité du PC pour « Ce PC » (Activité) et l'îlot : processeur, mémoire,
// carte graphique (par application) et modèle local. Mesurée seulement quand
// quelqu'un regarde (vue ouverte, option de l'îlot, réponse locale en cours),
// jamais quand le PC est verrouillé. Rien ne part en ligne.

import { cpus, freemem, totalmem } from 'node:os'
import { powerMonitor } from 'electron'
import { callWatch } from '../windows/host'
import { IPC } from '../../shared/ipc'
import {
  cpuPercent,
  cpuTimes,
  friendlyName,
  groupRamTop,
  groupVram,
  isModelProcess,
  memoryAlertText,
  MEMORY_ALERT_RATIO,
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
import { ollamaCacheState } from '../brains/ollamaCache'
import { healthBook } from '../store/modelHealth'
import { FAIL_MEMORY_MS, healthKey, reliableModels, unreliable } from '../../shared/modelHealth'

const GB = 1024 ** 3
const RAM_TOP_MS = 10_000
const RUNS_MAX = 20

/** Abonnés et rythme voulu par chacun (ms). */
const watchers = new Map<string, number>()
let timer: NodeJS.Timeout | null = null
let sampling = false
let locked = false
let prevCpu: CpuTimes | null = null
let ramTop: { at: number; top: Array<{ name: string; gb: number }>; modelGb: number } = { at: 0, top: [], modelGb: 0 }
let gpuFailures = 0
let last: PerfSnapshot | null = null
const runs: PerfRun[] = []
let generating: PerfSnapshot['generating']
/** Matériel (nom et mémoire de la carte graphique), lu une fois. */
let hw: Awaited<ReturnType<typeof hardwareInfo>> | null = null

async function gpuSample(): Promise<{ adapters: GpuAdapterSample[]; processes: GpuProcessSample[] } | null> {
  if (process.platform !== 'win32' || gpuFailures >= 5) return null
  try {
    const r = await callWatch<{ adapters?: GpuAdapterSample[]; processes?: GpuProcessSample[] }>('sample', {}, 8000)
    gpuFailures = 0
    return { adapters: Array.isArray(r.adapters) ? r.adapters : [], processes: Array.isArray(r.processes) ? r.processes : [] }
  } catch (e) {
    if (++gpuFailures === 5) log('warn', 'activité de la carte graphique illisible', (e as Error).message)
    return null
  }
}

/** Applications les plus gourmandes, modèle local compris (avec son cache des conversations). */
async function topRam(): Promise<typeof ramTop> {
  if (Date.now() - ramTop.at < RAM_TOP_MS || process.platform !== 'win32') return ramTop
  try {
    const r = await callWatch<{ top?: Array<{ name: string; bytes: number }> }>('ram_top', {}, 8000)
    ramTop = { at: Date.now(), ...groupRamTop(r.top ?? []) }
  } catch {
    ramTop = { ...ramTop, at: Date.now() }
  }
  return ramTop
}

let tags: { at: number; base: string; names: string[] } | null = null

/** Modèles installés dans Ollama (relus au plus une fois par minute). */
async function installedModels(base: string): Promise<string[]> {
  if (tags && tags.base === base && Date.now() - tags.at < 60_000) return tags.names
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) })
    const data = (await res.json()) as { models?: Array<{ name?: string }> }
    const names = (data.models ?? []).map((m) => m.name ?? '').filter((n) => n && !/-compi$/.test(n))
    tags = { at: Date.now(), base, names }
  } catch {
    tags = { at: Date.now(), base, names: tags?.names ?? [] }
  }
  return tags.names
}

/** Le modèle de discussion fait mal ses actions : ce qu'on en sait, et les modèles installés qui ont réussi l'essai. */
async function toolHealth(engine: 'ollama' | 'lmstudio', chatModel: string): Promise<NonNullable<PerfSnapshot['local']>['health']> {
  if (!chatModel) return undefined
  const book = healthBook()
  const h = book[healthKey(chatModel)]
  const now = Date.now()
  if (!unreliable(h, now)) return undefined
  const installed = engine === 'ollama' ? await installedModels(ollamaBase()) : []
  return {
    model: healthKey(chatModel),
    repaired: h!.repaired,
    failed: h!.lastFailAt && now - h!.lastFailAt < FAIL_MEMORY_MS ? h!.failed : 0,
    testFailed: h!.tested?.tools === false,
    alternatives: reliableModels(book, installed, chatModel, now)
  }
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
        models: models.map((m) => ({ name: m.name, sizeGb: m.sizeBytes / GB, gpuShare: 1, contextLength: m.contextLength, role: role(m.name) })),
        health: await toolHealth('lmstudio', chatModel)
      }
    }
    const models = (await loadedModels(ollamaBase())).map((m) => ({
      name: m.name.replace(/-compi$/, ''),
      sizeGb: m.sizeBytes / GB,
      gpuShare: m.gpuShare,
      expiresAt: m.expiresAt,
      contextLength: m.contextLength,
      role: role(m.name)
    }))
    const cache = await ollamaCacheState(
      ollamaBase(),
      models.some((m) => m.role !== 'embed')
    ).catch(() => undefined)
    return { engine: 'ollama', chatModel, keepAlive: s.local.keepAlive ?? '30m', models, cache, health: await toolHealth('ollama', chatModel) }
  } catch {
    // Moteur arrêté : rien de chargé.
    return s.provider === 'local' || chatModel ? { engine: s.local.engine, chatModel, keepAlive: s.local.keepAlive ?? '30m', models: [] } : undefined
  }
}

/**
 * Abonnés qui n'affichent que les jauges (processeur, mémoire, carte graphique) : pour eux
 * seuls, ni modèles chargés (/api/ps, ~1 200 fois par heure sinon) ni applications les plus
 * gourmandes. Activité › Ce PC et les réponses locales les demandent, eux.
 */
const GAUGES_ONLY = new Set(['ui:island'])

async function sample(): Promise<void> {
  if (sampling) return
  sampling = true
  try {
    const now = cpuTimes(cpus())
    const cpu = prevCpu ? cpuPercent(prevCpu, now) : 0
    prevCpu = now
    const totalGb = totalmem() / GB
    hw ??= await hardwareInfo().catch(() => null)
    const gaugesOnly = watchers.size > 0 && [...watchers.keys()].every((id) => GAUGES_ONLY.has(id))
    const [gpu, top, local] = await Promise.all([
      gpuSample(),
      gaugesOnly ? Promise.resolve({ top: last?.ram.top ?? [], modelGb: last?.ram.modelGb ?? 0 }) : topRam(),
      gaugesOnly ? Promise.resolve(last?.local) : localState()
    ])
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
      ram: { usedGb: totalGb - freemem() / GB, totalGb, top: top.top, modelGb: top.modelGb },
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
  // Jusque-là, seulement les jauges : les modèles chargés n'ont pas été relus, on mesure tout de suite.
  const gaugesOnly = had > 0 && [...watchers.keys()].every((w) => GAUGES_ONLY.has(w))
  if (on) watchers.set(id, Math.max(1000, every))
  else watchers.delete(id)
  if (on && (!had || (gaugesOnly && !GAUGES_ONLY.has(id)))) void sample()
  schedule()
  return last
}

export const perfSnapshot = (): PerfSnapshot | null => last

/** Mesure tout de suite (après un changement d'Ollama). */
export async function refreshPerf(): Promise<PerfSnapshot | null> {
  await sample()
  return last
}

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
          ...(stats.reread ? { reread: stats.reread } : {}),
          ...(stats.toolsOmitted ? { toolsOmitted: stats.toolsOmitted } : {}),
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
    const r = await callWatch<{ state: number }>('quns', {}, 1500)
    // 2 : application en plein écran, 3 : jeu Direct3D, 4 : présentation.
    return r.state === 2 || r.state === 3 || r.state === 4
  } catch {
    return false
  }
}

// ─── Alerte mémoire de l'îlot ────────────────────────────────────────────────

const ALERT_EVERY_MS = 60_000
const ALERT_COOLDOWN_MS = 2 * 3_600_000
let alertTimer: NodeJS.Timeout | null = null
let alertStreak = 0
let alertedAt = 0

/**
 * Toutes les minutes, sans PowerShell ni Ollama : la mémoire libre du PC. Pleine à 92 % deux
 * fois de suite avec un modèle local chargé, l'îlot prévient (au plus toutes les 2 h) et un
 * clic ouvre Ce PC, qui dit quoi faire. Désactivable (Réglages › Îlot).
 */
async function checkMemory(): Promise<void> {
  if (locked || !settings.get().monitor.memoryAlert) {
    alertStreak = 0
    return
  }
  alertStreak = 1 - freemem() / totalmem() >= MEMORY_ALERT_RATIO ? alertStreak + 1 : 0
  if (alertStreak < 2 || Date.now() - alertedAt < ALERT_COOLDOWN_MS) return
  alertStreak = 0
  const local = await localState()
  if (!local?.models.length) return
  const top = await topRam()
  const totalGb = totalmem() / GB
  const ram = { usedGb: totalGb - freemem() / GB, totalGb, top: top.top, modelGb: top.modelGb }
  alertedAt = Date.now()
  emit(IPC.islandNotify, { pill: 'pc', text: memoryAlertText({ ram, local }), duration: 15_000, view: 'activity', sound: null })
  log('info', `alerte mémoire : ${Math.round((ram.usedGb / totalGb) * 100)} % pris, modèle local ${top.modelGb.toFixed(1)} Go`)
}

export function startMemoryAlert(): void {
  if (alertTimer || process.platform !== 'win32') return
  alertTimer = setInterval(() => void checkMemory().catch(() => undefined), ALERT_EVERY_MS)
  alertTimer.unref()
}

/** Une réponse du modèle local est en cours (Ollama ne doit pas redémarrer). */
export const localBusy = (): boolean => generating !== undefined

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
  if (alertTimer) clearInterval(alertTimer)
  alertTimer = null
}
