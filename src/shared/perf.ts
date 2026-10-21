// Activité du PC et du modèle local : instantanés et conseils. Fonctions pures,
// testées dans tests/perf.test.ts. Tout est mesuré sur le PC, rien ne part en ligne.

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
  ram: { usedGb: number; totalGb: number; top: Array<{ name: string; gb: number }> }
  gpu?: {
    name: string
    util: number
    vramUsedGb: number
    vramTotalGb: number
    vram: VramUse[]
    /** Application qui occupe le plus la carte graphique, hors modèle local. */
    busyApp?: { name: string; util: number }
  }
  local?: { engine: 'ollama' | 'lmstudio'; models: LocalModelState[]; chatModel: string; keepAlive: KeepAlive }
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

export type AdviceAction = 'smaller-model' | 'unload-embed' | 'keep-longer' | 'new-chat'

export interface PerfAdvice {
  id: string
  level: 'warn' | 'info'
  text: string
  action?: AdviceAction
}

export const gbText = (gb: number): string => `${gb.toLocaleString('fr-FR', { maximumFractionDigits: gb < 10 ? 1 : 0 })} Go`
const pct = (x: number): string => `${Math.round(x * 100)} %`
const secText = (ms: number): string => (ms >= 90_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`)
export const KEEP_ALIVE_LABEL: Record<KeepAlive, string> = { '30m': '30 min', '2h': '2 h', '8h': '8 h' }

/** Ce qui ralentit le modèle local, du plus utile au moins utile. Calculé sur le PC, sans cerveau. */
export function perfAdvice(s: PerfSnapshot): PerfAdvice[] {
  const out: PerfAdvice[] = []
  const chat = s.local?.models.find((m) => m.role === 'chat')
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
