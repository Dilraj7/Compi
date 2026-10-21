// Ce que Compi sait faire sur Windows : regarder (état du PC, fenêtres) et
// quelques petites actions réversibles (son, musique, thème, Paramètres,
// ouvrir une app). Jamais d'arrêt, de verrouillage, de veille ni de suppression.

import { shell } from 'electron'
import { isSettingsPage, type SettingsPage } from '../../shared/windows'
import { callHost } from './host'

export { isSettingsPage, SETTINGS_PAGES, type SettingsPage } from '../../shared/windows'

export interface WindowInfo {
  handle: number
  title: string
  process: string
  pid: number
  minimized: boolean
}

export interface PcStatus {
  volume?: number
  muted?: boolean
  battery?: { percent: number; plugged: boolean }
  network?: { connected: boolean; name?: string; wifi?: boolean; ssid?: string | null; level?: string }
  disks?: { drive: string; freeGb: number; sizeGb: number }[]
  memory?: { totalGb: number; freeGb: number }
  uptimeHours?: number
  cpu?: number
  topApps?: { name: string; memMb: number }[]
  theme?: 'dark' | 'light'
}

export const getStatus = (): Promise<PcStatus> => callHost<PcStatus>('status', {}, 8000)

/** Fenêtre au premier plan, telle quelle (peut être Compi). */
export async function foregroundWindow(): Promise<WindowInfo | null> {
  return (await callHost<{ window: WindowInfo | null }>('foreground')).window
}

/** Fenêtres ouvertes, de la plus en avant à la plus en arrière, sans celles de Compi ni le bureau. */
export async function listWindows(): Promise<WindowInfo[]> {
  const { windows } = await callHost<{ windows: WindowInfo[] }>('windows')
  return windows.filter((w) => w.pid !== process.pid && !(w.process === 'explorer' && w.title === 'Program Manager'))
}

/**
 * Fenêtre où l'utilisateur travaillait avant d'ouvrir l'îlot : la première,
 * dans l'ordre d'affichage, qui n'est pas à Compi.
 */
export async function userWindow(): Promise<WindowInfo | null> {
  return (await listWindows()).find((w) => !w.minimized) ?? null
}

export async function focusWindow(handle: number): Promise<boolean> {
  if (!Number.isSafeInteger(handle) || handle <= 0) return false
  return (await callHost<{ focused: boolean }>('focus', { handle })).focused
}

export async function setVolume(o: { level?: number; mute?: boolean }): Promise<{ volume: number; muted: boolean }> {
  const args: Record<string, unknown> = {}
  if (o.level !== undefined) {
    args.level = Math.round(Math.min(100, Math.max(0, o.level)))
    // « Mets le son à 40 » sous-entend de le remettre s'il était coupé.
    if (o.mute === undefined) args.mute = false
  }
  if (o.mute !== undefined) args.mute = o.mute
  return callHost('volume', args)
}

export const MEDIA_ACTIONS = ['play_pause', 'next', 'previous'] as const
export type MediaAction = (typeof MEDIA_ACTIONS)[number]

export async function mediaControl(action: MediaAction): Promise<boolean> {
  if (!MEDIA_ACTIONS.includes(action)) return false
  return (await callHost<{ sent: boolean }>('media', { action })).sent
}

export async function setTheme(mode: 'dark' | 'light'): Promise<void> {
  await callHost('theme', { mode })
}

export async function openSettings(page: SettingsPage): Promise<void> {
  if (!isSettingsPage(page)) throw new Error('Page des Paramètres inconnue.')
  await shell.openExternal(`ms-settings:${page}`)
}

// ─── Applications du menu Démarrer ───────────────────────────────────────────

export interface StartApp {
  name: string
  id: string
}

let appsCache: { at: number; apps: StartApp[] } | null = null

export async function startApps(): Promise<StartApp[]> {
  if (appsCache && Date.now() - appsCache.at < 10 * 60_000) return appsCache.apps
  const { apps } = await callHost<{ apps: StartApp[] }>('apps', {}, 10_000)
  appsCache = { at: Date.now(), apps }
  return apps
}

const fold = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** Applications qui correspondent au nom demandé, la plus probable d'abord. */
export function matchApps(apps: StartApp[], name: string): StartApp[] {
  const q = fold(name)
  if (!q) return []
  const scored = apps
    .map((a) => {
      const n = fold(a.name)
      const score = n === q ? 4 : n.startsWith(`${q} `) || n.startsWith(q) ? 3 : n.split(' ').includes(q) ? 2 : n.includes(q) ? 1 : 0
      return { a, score }
    })
    .filter((x) => x.score > 0)
  // À score égal, le nom le plus court (« Word » plutôt que « Word Viewer »).
  return scored.sort((x, y) => y.score - x.score || x.a.name.length - y.a.name.length).map((x) => x.a)
}

export async function launchApp(app: StartApp): Promise<string> {
  return (await callHost<{ launched: string }>('launch', { id: app.id }, 8000)).launched
}

// ─── Texte pour le modèle ────────────────────────────────────────────────────

const gb = (n: number): string => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`

export function formatStatus(s: PcStatus): string {
  const lines: string[] = []
  if (s.battery) lines.push(`Batterie : ${s.battery.percent} %${s.battery.plugged ? ' (sur secteur)' : ' (sur batterie)'}`)
  else lines.push('Alimentation : secteur (pas de batterie)')
  if (s.volume !== undefined) lines.push(`Son : ${s.muted ? 'coupé' : `${s.volume} %`}`)
  if (s.network) {
    lines.push(
      s.network.connected
        ? `Réseau : ${s.network.wifi ? `Wi-Fi${s.network.ssid ? ` « ${s.network.ssid} »` : ''}` : s.network.name ?? 'connecté'}${s.network.level === 'InternetAccess' ? ', Internet OK' : s.network.level ? `, ${s.network.level}` : ''}`
        : 'Réseau : déconnecté'
    )
  }
  if (s.cpu !== undefined) lines.push(`Processeur : ${s.cpu} % utilisé`)
  if (s.memory) lines.push(`Mémoire : ${gb(s.memory.totalGb - s.memory.freeGb)} utilisés sur ${gb(s.memory.totalGb)}`)
  if (s.topApps?.length) lines.push(`Applications les plus gourmandes en mémoire : ${s.topApps.map((a) => `${a.name} (${a.memMb} Mo)`).join(', ')}`)
  for (const d of s.disks ?? []) lines.push(`Disque ${d.drive} : ${gb(d.freeGb)} libres sur ${gb(d.sizeGb)}`)
  if (s.theme) lines.push(`Thème : ${s.theme === 'dark' ? 'sombre' : 'clair'}`)
  if (s.uptimeHours !== undefined) lines.push(`Allumé depuis : ${s.uptimeHours < 48 ? `${Math.round(s.uptimeHours)} h` : `${Math.round(s.uptimeHours / 24)} jours`}`)
  return lines.join('\n')
}

export function formatWindow(w: WindowInfo): string {
  return `${w.title} (${w.process}${w.minimized ? ', réduite' : ''})`
}
