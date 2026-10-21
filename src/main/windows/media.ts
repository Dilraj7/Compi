// Musique en cours et voix de Windows, par un deuxième hôte PowerShell
// (media.ps1). Séparé de l'hôte principal : une lecture de l'écran ou une
// longue synthèse vocale ne fige jamais l'affichage de la musique.
//
// La musique est relevée régulièrement (toutes les 2,5 s quand ça joue, plus
// rarement sinon), et l'îlot n'est prévenu que si quelque chose de visible
// change. Rien n'est relevé quand le réglage est coupé ou le PC verrouillé.

import { powerMonitor } from 'electron'
import script from './media.ps1?raw'
import { PowerShellHost } from './host'
import { appLabel, mediaChanged, trackKey } from '../../shared/media'
import type { MediaAction, MediaInfo, VoiceInfo } from '../../shared/types'
import { log } from '../log'

type MediaFn = 'ping' | 'media_now' | 'media_art' | 'media_control' | 'voices' | 'speak'

/** Arrêté après 10 min sans appel (relancé au besoin). */
const host = new PowerShellHost<MediaFn>('hôte musique', script, 10 * 60_000)

interface RawNow {
  status: MediaInfo['status'] | 'none'
  title?: string
  artist?: string
  album?: string
  app?: string
  hasArt?: boolean
  position?: number
  duration?: number
  updated?: number
  canNext?: boolean
  canPrevious?: boolean
}

/** Réponse brute de l'hôte → ce qu'affiche l'îlot (`null` : rien ne joue). */
export function toMediaInfo(raw: RawNow, now: number): MediaInfo | null {
  if (raw.status === 'none' || !raw.title?.trim()) return null
  if (raw.status === 'stopped') return null
  const updated = Number(raw.updated) || 0
  return {
    status: raw.status,
    title: raw.title.trim(),
    artist: (raw.artist ?? '').trim(),
    album: (raw.album ?? '').trim(),
    app: appLabel(raw.app ?? ''),
    position: Math.max(0, Number(raw.position) || 0),
    duration: Math.max(0, Number(raw.duration) || 0),
    // Certaines applications ne datent pas la position : on prend l'instant du relevé.
    at: updated > now - 86_400_000 && updated <= now + 5000 ? updated : now,
    canNext: raw.canNext !== false,
    canPrevious: raw.canPrevious !== false
  }
}

// ─── Relevé de la musique ────────────────────────────────────────────────────

let onChange: ((m: MediaInfo | null) => void) | null = null
let enabled = false
let locked = false
let timer: NodeJS.Timeout | null = null
let running = false
let current: MediaInfo | null = null
let artKey = ''
let art: string | undefined
let artTries = 0
let failures = 0

function schedule(ms: number): void {
  if (timer) clearTimeout(timer)
  timer = enabled && !locked ? setTimeout(() => void tick(), ms) : null
}

async function tick(): Promise<void> {
  if (running || !enabled || locked) return
  running = true
  try {
    const raw = await host.call<RawNow>('media_now', {}, 6000)
    failures = 0
    const next = toMediaInfo(raw, Date.now())
    if (next) {
      const key = trackKey(next)
      if (key !== artKey) {
        artKey = key
        art = undefined
        artTries = 0
      }
      // La pochette arrive parfois un peu après le titre : quelques essais.
      if (raw.hasArt && !art && artTries < 3) {
        artTries++
        try {
          const a = await host.call<{ art: string | null; type?: string }>('media_art', {}, 6000)
          if (a.art) art = `data:${a.type ?? 'image/png'};base64,${a.art}`
        } catch {
          // Sans pochette, l'îlot affiche une note de musique.
        }
      }
      next.art = art
    }
    if (mediaChanged(current, next, Date.now())) {
      current = next
      onChange?.(next)
    } else if (next) current = next
    schedule(next?.status === 'playing' ? 2500 : next ? 5000 : 8000)
  } catch (e) {
    failures++
    if (failures === 3) log('warn', 'musique en cours : relevé impossible', (e as Error).message)
    if (current) {
      current = null
      onChange?.(null)
    }
    schedule(Math.min(60_000, 4000 * 2 ** Math.min(failures, 4)))
  } finally {
    running = false
  }
}

/** Démarre ou arrête le relevé (réglage « Afficher la musique dans l'îlot »). */
export function watchMedia(on: boolean, listener: (m: MediaInfo | null) => void): void {
  onChange = listener
  if (on === enabled) return
  enabled = on
  if (on) {
    failures = 0
    schedule(400)
  } else {
    schedule(0)
    if (current) {
      current = null
      listener(null)
    }
  }
}

let powerHooked = false
/** Pas de relevé quand le PC est verrouillé ou en veille. */
export function hookMediaPower(): void {
  if (powerHooked) return
  powerHooked = true
  const pause = (): void => {
    locked = true
    schedule(0)
  }
  const resume = (): void => {
    locked = false
    schedule(1000)
  }
  powerMonitor.on('lock-screen', pause)
  powerMonitor.on('suspend', pause)
  powerMonitor.on('unlock-screen', resume)
  powerMonitor.on('resume', resume)
}

export const currentMedia = (): MediaInfo | null => current

/** Lecture/pause, suivant, précédent : clic de l'utilisateur dans l'îlot. */
export async function controlMedia(action: MediaAction): Promise<boolean> {
  if (action !== 'play_pause' && action !== 'next' && action !== 'previous') return false
  const r = await host.call<{ done: boolean }>('media_control', { action }, 5000)
  // L'application met un instant à changer d'état.
  setTimeout(() => void tick(), action === 'play_pause' ? 250 : 700)
  return r.done
}

/** Ce qui joue, sans attendre le prochain relevé (outil « now_playing »). */
export async function nowPlaying(): Promise<MediaInfo | null> {
  return toMediaInfo(await host.call<RawNow>('media_now', {}, 6000), Date.now())
}

// ─── Voix ────────────────────────────────────────────────────────────────────

let voiceCache: VoiceInfo[] | null = null

/** Voix installées, françaises d'abord. */
export async function listVoices(): Promise<VoiceInfo[]> {
  if (voiceCache) return voiceCache
  const r = await host.call<{ voices: VoiceInfo[] }>('voices', {}, 8000)
  const list = (r.voices ?? []).filter((v) => v && typeof v.id === 'string')
  voiceCache = list.sort((a, b) => Number(b.lang.startsWith('fr')) - Number(a.lang.startsWith('fr')) || a.name.localeCompare(b.name))
  return voiceCache
}

/** Synthèse d'un morceau de texte : un fichier WAV, en mémoire. */
export async function synthesize(text: string, voice: string, rate: number): Promise<Buffer> {
  const t = text.trim().slice(0, 1000)
  if (!t) return Buffer.alloc(0)
  const r = await host.call<{ audio: string }>('speak', { text: t, voice, rate }, 20_000)
  return Buffer.from(r.audio ?? '', 'base64')
}
