// Musique en cours : petites fonctions pures partagées par le processus
// principal et l'îlot (testées).

import type { MediaInfo } from './types'

/** Applications connues, par identifiant Windows (AppUserModelId, en minuscules). */
const KNOWN_APPS: Record<string, string> = {
  spotify: 'Spotify',
  chrome: 'Chrome',
  msedge: 'Edge',
  firefox: 'Firefox',
  '308046b0af4a39cb': 'Firefox',
  brave: 'Brave',
  opera: 'Opera',
  vivaldi: 'Vivaldi',
  'microsoft.zunemusic': 'Lecteur multimédia',
  'microsoft.zunevideo': 'Films et TV',
  'microsoft.media.player': 'Lecteur multimédia',
  vlc: 'VLC',
  deezer: 'Deezer',
  applemusic: 'Apple Music',
  itunes: 'iTunes',
  tidal: 'Tidal',
  foobar2000: 'foobar2000',
  musicbee: 'MusicBee',
  aimp: 'AIMP'
}

/**
 * Nom lisible de l'application qui joue, depuis son identifiant Windows :
 * « SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify » → « Spotify »,
 * « C:\…\vlc.exe » → « VLC ».
 */
export function appLabel(aumid: string): string {
  const raw = aumid.trim()
  if (!raw) return ''
  const afterBang = raw.includes('!') ? raw.slice(raw.lastIndexOf('!') + 1) : raw
  const base = afterBang.split(/[\\/]/).pop()!.replace(/\.exe$/i, '')
  const key = base.toLowerCase()
  if (KNOWN_APPS[key]) return KNOWN_APPS[key]
  const pkg = raw.split('_')[0].toLowerCase()
  if (KNOWN_APPS[pkg]) return KNOWN_APPS[pkg]
  for (const [k, v] of Object.entries(KNOWN_APPS)) if (key.includes(k) || pkg.includes(k)) return v
  // Identifiant opaque (empreinte) : mieux vaut rien qu'un code.
  if (/^[0-9a-f]{12,}$/i.test(base)) return ''
  return base.replace(/^Microsoft\./, '')
}

/** Position actuelle dans le morceau (s), en tenant compte du temps écoulé depuis le relevé. */
export function mediaPosition(m: Pick<MediaInfo, 'status' | 'position' | 'duration' | 'at'>, now: number): number {
  if (m.duration <= 0) return 0
  const elapsed = m.status === 'playing' && m.at > 0 ? (now - m.at) / 1000 : 0
  return Math.min(m.duration, Math.max(0, m.position + elapsed))
}

/** Même morceau (pour ne pas recharger la pochette). */
export const trackKey = (m: Pick<MediaInfo, 'app' | 'title' | 'artist'>): string => `${m.app}\u0000${m.title}\u0000${m.artist}`

/**
 * Faut-il prévenir l'îlot ? Oui si quelque chose de visible a changé, ou si
 * la position a sauté (avance rapide) : pas pour la simple avancée du temps.
 */
export function mediaChanged(prev: MediaInfo | null, next: MediaInfo | null, now: number): boolean {
  if (!prev || !next) return prev !== next
  if (
    prev.status !== next.status ||
    trackKey(prev) !== trackKey(next) ||
    prev.art !== next.art ||
    prev.duration !== next.duration ||
    prev.canNext !== next.canNext ||
    prev.canPrevious !== next.canPrevious
  )
    return true
  return Math.abs(mediaPosition(prev, now) - mediaPosition(next, now)) > 2.5
}

/** « 3:07 » (ou « 1:02:03 » au-delà d'une heure). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
