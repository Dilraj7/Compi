// Activité du PC et du modèle local : instantanés et conseils. Fonctions pures,
// testées dans tests/perf.test.ts. Tout est mesuré sur le PC, rien ne part en ligne.

import { cacheChoice, SUGGESTED_CACHE_MB, type OllamaCache } from './ollamaCache'
import type { KeepAlive } from './types'

const GB = 1024 ** 3

// ─── Processeur ──────────────────────────────────────────────────────────────

export interface CpuTimes {
  idle: number
  total: number
}

/** Cumule les temps de tous les cœurs (sortie de `os.cpus()`). */
export function cpuTimes(list: Array<{ times: { user: number; nice: number; sys: number; idle: number; irq: number } }>): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of list) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

/** Charge du processeur entre deux mesures, en %. */
export function cpuPercent(prev: CpuTimes, next: CpuTimes): number {
  const total = next.total - prev.total
  if (total <= 0) return 0
  return Math.round(Math.min(100, Math.max(0, (1 - (next.idle - prev.idle) / total) * 100)))
}

// ─── Carte graphique ─────────────────────────────────────────────────────────

/** Ce que l'hôte PowerShell renvoie (compteurs de performances de Windows). */
export interface GpuAdapterSample {
  luid: string
  dedicatedBytes: number
  /** Moteur le plus occupé, en %. */
  util: number
}

export interface GpuProcessSample {
  pid: number
  name: string
  dedicatedBytes: number
  util: number
}

/** La carte graphique principale : celle qui porte le plus de mémoire vidéo. */
export function pickGpu(adapters: GpuAdapterSample[]): GpuAdapterSample | undefined {
  return [...adapters].sort((a, b) => b.dedicatedBytes - a.dedicatedBytes)[0]
}

/** Noms lisibles des applications les plus courantes. */
const FRIENDLY: Array<[RegExp, string]> = [
  [/^(ollama|ollama_llama_server|llama-server|lms|lm studio)/i, 'Modèle local'],
  [/^dwm$/i, 'Windows (affichage)'],
  [/^steam(webhelper)?$/i, 'Steam'],
  [/^phoneexperiencehost$/i, 'Mobile connecté'],
  [/^msedge(webview2)?$/i, 'Edge'],
  [/^chrome$/i, 'Chrome'],
  [/^firefox$/i, 'Firefox'],
  [/^comet$/i, 'Comet'],
  [/^code$/i, 'VS Code'],
  [/^claude$/i, 'Claude'],
  [/^compi$/i, 'Compi'],
  [/^discord$/i, 'Discord'],
  [/^explorer$/i, 'Explorateur'],
  [/^svchost$/i, 'Services Windows'],
  [/^memory compression$/i, 'Windows (compression mémoire)'],
  [/^msmpeng$/i, 'Antivirus Windows'],
  [/^searchhost$/i, 'Recherche Windows'],
  [/^wallpaper(32|64)?$/i, 'Fond d’écran animé']
]

export function friendlyName(processName: string): string {
  const hit = FRIENDLY.find(([re]) => re.test(processName))
  if (hit) return hit[1]
  return processName ? processName[0].toUpperCase() + processName.slice(1) : 'Application'
}

export const isModelProcess = (processName: string): boolean => friendlyName(processName) === 'Modèle local'

/**
 * Mémoire par application : les processus d'une même application sont réunis (ollama,
 * llama-server… font « Modèle local », compté comme les autres). Les 3 plus gourmandes,
 * et la mémoire du modèle local à part (cache des conversations compris).
 */
export function groupRamTop(list: Array<{ name: string; bytes: number }>): { top: Array<{ name: string; gb: number }>; modelGb: number } {
  const byName = new Map<string, number>()
  for (const t of list) {
    if (!t.name || !(t.bytes > 0)) continue
    const name = friendlyName(t.name)
    byName.set(name, (byName.get(name) ?? 0) + t.bytes)
  }
  const top = [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, bytes]) => ({ name, gb: bytes / GB }))
  return { top, modelGb: (byName.get('Modèle local') ?? 0) / GB }
}

export interface VramUse {
  label: string
  gb: number
  kind: 'model' | 'windows' | 'app' | 'other'
}

/** Mémoire vidéo par usage : modèle local, Windows, puis les 3 applications les plus gourmandes. */
export function groupVram(processes: GpuProcessSample[]): VramUse[] {
  const byLabel = new Map<string, number>()
  for (const p of processes) {
    if (p.dedicatedBytes <= 0) continue
    const label = friendlyName(p.name)
    byLabel.set(label, (byLabel.get(label) ?? 0) + p.dedicatedBytes)
  }
  const out: VramUse[] = []
  const take = (label: string, kind: VramUse['kind']): void => {
    const bytes = byLabel.get(label)
    if (bytes === undefined) return
    byLabel.delete(label)
    out.push({ label, gb: bytes / GB, kind })
  }
  take('Modèle local', 'model')
  take('Windows (affichage)', 'windows')
  const rest = [...byLabel.entries()].filter(([, b]) => b >= 50 * 1024 ** 2).sort((a, b) => b[1] - a[1])
  for (const [label, bytes] of rest.slice(0, 3)) out.push({ label, gb: bytes / GB, kind: 'app' })
  const other = rest.slice(3).reduce((n, [, b]) => n + b, 0)
  if (other > 0) out.push({ label: 'Autres', gb: other / GB, kind: 'other' })
  return out
}

// ─── Modèle local ────────────────────────────────────────────────────────────

export interface LocalModelState {
  name: string
  sizeGb: number
  /** Part dans la carte graphique (0 à 1) ; le reste tourne sur le processeur. */
  gpuShare: number
  expiresAt?: number
  contextLength?: number
  role: 'chat' | 'embed' | 'other'
}

/** « gemma4:12b-compi » et « gemma4:12b » désignent le même modèle. */
export const sameModel = (a: string, b: string): boolean => a.replace(/-compi$/, '') === b.replace(/-compi$/, '')

/** Le modèle de discussion fait mal ses actions (appels écrits en texte, essai d'outil raté). */
export interface ToolHealth {
  model: string
  repaired: number
  failed: number
  testFailed: boolean
  /** Modèles installés qui ont réussi le vrai essai d'outil : les seuls conseillés. */
  alternatives: string[]
}

export interface PerfRun {
  at: number
  model: string
  firstTokenMs?: number
  tokensPerSec?: number
  inputTokens: number
  coldStart?: boolean
  gpuShare?: number
}

export interface PerfSnapshot {
  at: number
  /** Processeur, en %. */
  cpu: number
  /** `modelGb` : mémoire du PC prise par le modèle local, cache des conversations compris. */
  ram: { usedGb: number; totalGb: number; top: Array<{ name: string; gb: number }>; modelGb?: number }
  gpu?: {
    name: string
    util: number
    vramUsedGb: number
    vramTotalGb: number
    vram: VramUse[]
    /** Application qui occupe le plus la carte graphique, hors modèle local. */
    busyApp?: { name: string; util: number }
  }
  local?: { engine: 'ollama' | 'lmstudio'; models: LocalModelState[]; chatModel: string; keepAlive: KeepAlive; cache?: OllamaCache; health?: ToolHealth }
  /** Dernières réponses du modèle local (les plus récentes en dernier). */
  runs: PerfRun[]
  /** Une réponse locale est en cours. */
  generating?: { since: number; model: string }
}

/** Avant le premier mot d'une réponse locale : le modèle se charge, ou il lit la demande. */
export function localPhase(s: PerfSnapshot | null | undefined): 'loading' | 'reading' | null {
  if (!s?.generating || !s.local) return null
  return s.local.models.some((m) => sameModel(m.name, s.generating!.model)) ? 'reading' : 'loading'
}

// ─── Conseils ────────────────────────────────────────────────────────────────

export type AdviceAction = 'smaller-model' | 'unload-embed' | 'keep-longer' | 'new-chat' | 'limit-cache' | 'restart-ollama' | 'use-model' | 'test-models'

export interface PerfAdvice {
  id: string
  level: 'warn' | 'info'
  text: string
  action?: AdviceAction
  /** « use-model » : le modèle conseillé. */
  model?: string
}

export const gbText = (gb: number): string => `${gb.toLocaleString('fr-FR', { maximumFractionDigits: gb < 10 ? 1 : 0 })} Go`
const pct = (x: number): string => `${Math.round(x * 100)} %`
const secText = (ms: number): string => (ms >= 90_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`)
export const KEEP_ALIVE_LABEL: Record<KeepAlive, string> = { '30m': '30 min', '2h': '2 h', '8h': '8 h' }

/** Ce qui ralentit le modèle local, du plus utile au moins utile. Calculé sur le PC, sans cerveau. */
export function perfAdvice(s: PerfSnapshot): PerfAdvice[] {
  const out: PerfAdvice[] = []
  const chat = s.local?.models.find((m) => m.role === 'chat')

  // 0. Le modèle écrit ses actions au lieu de les faire : rien ne s'exécute.
  const health = s.local?.health
  if (health) {
    const what = health.failed
      ? `${health.model} a écrit ${health.failed > 1 ? `${health.failed} fois une action` : 'une action'} au lieu de la faire : rien n’a été exécuté.`
      : `${health.model} n’a pas réussi l’essai d’outil : il risque d’écrire ses actions au lieu de les faire.`
    const alt = health.alternatives[0]
    out.push({
      id: 'tools',
      level: 'warn',
      text: alt
        ? `${what} ${alt} a réussi l’essai et fait ses actions : je te conseille de l’utiliser.`
        : `${what} Teste un autre modèle installé (Réglages › Cerveau, « Tester ») : je ne conseille que ceux qui réussissent l’essai.`,
      action: alt ? 'use-model' : 'test-models',
      model: alt
    })
  }
  const others = (s.gpu?.vram ?? []).filter((v) => v.kind === 'app' && v.gb >= 0.3)
  const names = (list: Array<{ label?: string; name?: string; gb: number }>): string =>
    list
      .slice(0, 3)
      .map((v) => `${v.label ?? v.name} (${gbText(v.gb)})`)
      .join(', ')

  // 1. Le modèle déborde de la carte graphique : une partie tourne sur le processeur.
  if (chat && chat.gpuShare < 0.97) {
    const taken = others.reduce((n, v) => n + v.gb, 0)
    out.push({
      id: 'spill',
      level: 'warn',
      text:
        `${pct(1 - chat.gpuShare)} du modèle tourne sur le processeur : il répond 3 à 5 fois plus lentement.` +
        (taken >= 1 ? ` La mémoire vidéo est aussi prise par ${names(others)}.` : ' Un modèle plus léger tiendrait entièrement dans la carte graphique.'),
      action: 'smaller-model'
    })
  }

  // 2. Mémoire du PC presque pleine : charger le modèle passe par le disque.
  const free = s.ram.totalGb - s.ram.usedGb
  if (s.ram.totalGb > 0 && (free < 3 || free / s.ram.totalGb < 0.15)) {
    out.push({
      id: 'ram',
      level: 'warn',
      text:
        `Il reste ${gbText(free)} de mémoire sur ${gbText(s.ram.totalGb)} : charger le modèle passe alors par le disque, ce qui peut prendre plusieurs minutes.` +
        (s.ram.top.length ? ` Les plus gourmands : ${names(s.ram.top)}.` : '')
    })
  }

  // 2 bis. Ollama garde les dernières discussions en mémoire du PC (8 Go au plus par défaut).
  const cache = s.local?.cache
  if (cache) {
    const choice = cacheChoice(cache)
    const usedGb = cache.usedMb / 1024
    const tight = s.ram.totalGb > 0 && s.ram.usedGb / s.ram.totalGb >= 0.85
    if (choice.restartPending && cache.configuredMb !== undefined) {
      out.push({
        id: 'cache-restart',
        level: 'info',
        text: `La mémoire des conversations d’Ollama est réglée à ${gbText(cache.configuredMb / 1024)}, mais Ollama tourne encore avec l’ancienne limite : il faut le redémarrer.`,
        action: 'restart-ollama'
      })
    } else if (choice.suggest === 'limit' && (usedGb >= 1 || tight)) {
      const max = cache.configuredMb === -1 ? 'sans limite' : `jusqu’à ${gbText((cache.configuredMb ?? cache.limitMb ?? 8192) / 1024)}`
      out.push({
        id: 'cache',
        level: tight ? 'warn' : 'info',
        text:
          `Ollama garde tes dernières discussions en mémoire du PC pour les reprendre plus vite : ${gbText(usedGb)} en ce moment, ${max}. ` +
          `Limiter à ${gbText(SUGGESTED_CACHE_MB / 1024)} garde la dernière discussion rapide et rend le reste de la mémoire.`,
        action: 'limit-cache'
      })
    }
  }

  // 3. Le modèle de la recherche par le sens occupe aussi la carte graphique.
  const embed = s.local?.models.find((m) => m.role === 'embed')
  if (embed && (chat || (s.gpu && s.gpu.vramUsedGb / s.gpu.vramTotalGb > 0.85))) {
    out.push({
      id: 'embed',
      level: 'info',
      text: `La recherche par le sens garde son modèle chargé (${gbText(embed.sizeGb)}). Il se libère seul après 10 min ; tu peux aussi le libérer tout de suite.`,
      action: 'unload-embed'
    })
  }

  const last = s.runs.at(-1)
  // 4. Le modèle s'était déchargé : la question a attendu son rechargement.
  if (last?.coldStart && (last.firstTokenMs ?? 0) > 30_000 && s.local) {
    out.push({
      id: 'cold',
      level: 'info',
      text: `Le modèle s’était déchargé : le recharger a pris ${secText(last.firstTokenMs!)}. Il reste prêt ${KEEP_ALIVE_LABEL[s.local.keepAlive]} après ta dernière question.`,
      action: s.local.keepAlive === '8h' ? undefined : 'keep-longer'
    })
  }

  // 5. Longue discussion : chaque question fait tout relire au modèle.
  if (last && !last.coldStart && last.inputTokens > 6000 && (last.firstTokenMs ?? 0) > 20_000) {
    out.push({
      id: 'long',
      level: 'info',
      text: `Ta dernière question a fait relire ${last.inputTokens.toLocaleString('fr-FR')} jetons au modèle : une nouvelle discussion répond bien plus vite.`,
      action: 'new-chat'
    })
  }

  // 6. Une autre application occupe la carte graphique (jeu, vidéo…).
  if (s.gpu?.busyApp && s.gpu.busyApp.util >= 70) {
    out.push({
      id: 'busy',
      level: 'info',
      text: `${s.gpu.busyApp.name} occupe la carte graphique à ${Math.round(s.gpu.busyApp.util)} % : le modèle local sera plus lent tant qu’elle tourne.`
    })
  }
  return out
}

/** Couleur d'une jauge selon son niveau (0 à 1). */
export const gaugeLevel = (x: number): 'ok' | 'high' | 'full' => (x >= 0.9 ? 'full' : x >= 0.7 ? 'high' : 'ok')

// ─── Ce que coûte le modèle local ────────────────────────────────────────────

/** Mémoire gardée par le modèle local chargé, mesurée sur le PC (pas la taille annoncée par Ollama). */
export interface ModelFootprint {
  vramGb: number
  /** Mémoire du PC, cache des conversations compris. */
  ramGb: number
  /** Dont les discussions gardées par Ollama. */
  cacheGb: number
}

export function modelFootprint(s: PerfSnapshot | null | undefined): ModelFootprint | null {
  if (!s?.local?.models.length) return null
  const vramGb = s.gpu?.vram.find((v) => v.kind === 'model')?.gb ?? 0
  const ramGb = s.ram.modelGb ?? 0
  if (vramGb < 0.1 && ramGb < 0.1) return null
  return { vramGb, ramGb, cacheGb: (s.local.cache?.usedMb ?? 0) / 1024 }
}

const cachePart = (f: { ramGb: number; cacheGb: number }, min: number): string =>
  f.cacheGb >= min && f.cacheGb <= f.ramGb + 0.1 ? `, dont ${gbText(f.cacheGb)} de discussions gardées` : ''

/** Sous « Garder le modèle prêt » : ce que le modèle garde pendant ce temps, même sans question. */
export function keepAliveCost(f: ModelFootprint, keepAlive: KeepAlive): string {
  const parts = [f.vramGb >= 0.1 && `${gbText(f.vramGb)} de mémoire vidéo`, f.ramGb >= 0.1 && `${gbText(f.ramGb)} de mémoire du PC${cachePart(f, 0.1)}`].filter(
    Boolean
  )
  return `Pendant ${KEEP_ALIVE_LABEL[keepAlive]} après ta dernière question, le modèle garde ${parts.join(' et ')}.`
}

/** Seuil de l'alerte de l'îlot : mémoire du PC presque pleine. */
export const MEMORY_ALERT_RATIO = 0.92

/** Texte de l'alerte de l'îlot : la mémoire, puis la cause la plus probable, en clair. */
export function memoryAlertText(s: Pick<PerfSnapshot, 'ram' | 'local'>): string {
  const tenth = (gb: number): string => `${gb.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
  const head = `Mémoire presque pleine : ${tenth(s.ram.usedGb)} sur ${tenth(s.ram.totalGb)}.`
  const model = s.ram.modelGb ?? 0
  if (model >= 1) {
    const cacheGb = (s.local?.cache?.usedMb ?? 0) / 1024
    return `${head} Le modèle local en prend ${gbText(model)}${cachePart({ ramGb: model, cacheGb }, 0.5)}. Touche pour voir quoi faire.`
  }
  const others = s.ram.top.filter((t) => t.name !== 'Modèle local').slice(0, 2)
  return `${head}${others.length ? ` Les plus gourmands : ${others.map((t) => `${t.name} (${gbText(t.gb)})`).join(', ')}.` : ''} Touche pour voir quoi faire.`
}
