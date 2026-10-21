// Îlot vivant : musique en cours, minuteur et voix de Compi, en version
// pastille (petits éléments de part et d'autre des yeux) et en aperçu
// (contrôles). Les boutons n'ouvrent jamais le panneau : stopPropagation.

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Music2, Pause, Play, SkipBack, SkipForward, Square, Timer, X } from 'lucide-react'
import { PILLS } from '@shared/pills'
import { formatClock, mediaPosition } from '@shared/media'
import { progress, remainingMs, timerTitle } from '@shared/timer'
import type { MediaAction, MediaInfo, TimerState } from '@shared/types'
import { useCompi } from '../store'
import { cx } from './ui'

const TIMER = PILLS.timer.color
const MUSIC = PILLS.music.color

/** L'heure qui avance (toutes les `ms`) tant que `active` est vrai. */
export function useNow(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [active, ms])
  return now
}

/** Couleur dominante d'une pochette, pour teinter la lueur et la barre. */
function useArtColor(src: string | undefined): string {
  const [color, setColor] = useState(MUSIC)
  useEffect(() => {
    if (!src) {
      setColor(MUSIC)
      return
    }
    let alive = true
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 12
        const g = c.getContext('2d', { willReadFrequently: true })
        if (!g) return
        g.drawImage(img, 0, 0, 12, 12)
        const d = g.getImageData(0, 0, 12, 12).data
        // Moyenne pondérée par la saturation : les gris ne comptent presque pas.
        let r = 0, gr = 0, b = 0, w = 0
        for (let i = 0; i < d.length; i += 4) {
          const max = Math.max(d[i], d[i + 1], d[i + 2])
          const min = Math.min(d[i], d[i + 1], d[i + 2])
          const weight = (max - min) / 255 + 0.02
          r += d[i] * weight
          gr += d[i + 1] * weight
          b += d[i + 2] * weight
          w += weight
        }
        const [h, s] = rgbToHs(r / w, gr / w, b / w)
        if (alive) setColor(s < 0.12 ? MUSIC : `hsl(${Math.round(h)} ${Math.round(Math.max(55, s * 100))}% 62%)`)
      } catch {
        if (alive) setColor(MUSIC)
      }
    }
    img.src = src
    return () => {
      alive = false
    }
  }, [src])
  return color
}

function rgbToHs(r: number, g: number, b: number): [number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (!d) return [0, 0]
  const l = (max + min) / 2
  const s = d / (1 - Math.abs(2 * l - 1))
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(h * 60 + 360) % 360, s]
}

export function LedEq({ color, on }: { color: string; on: boolean }) {
  return (
    <span className={cx('led-eq', on && 'on')} style={{ ['--eq' as string]: color }} aria-hidden>
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}

function Art({ src, size, radius, color }: { src?: string; size: number; radius: number; color: string }) {
  return src ? (
    <img src={src} alt="" draggable={false} className="shrink-0 object-cover" style={{ width: size, height: size, borderRadius: radius, boxShadow: `0 0 14px -4px ${color}` }} />
  ) : (
    <span className="grid shrink-0 place-items-center bg-white/[0.07]" style={{ width: size, height: size, borderRadius: radius }}>
      <Music2 size={Math.round(size * 0.5)} style={{ color }} />
    </span>
  )
}

/** Musique à afficher dans la pastille : seulement quand ça joue. */
export function useLiveMedia(): MediaInfo | null {
  return useCompi((s) => (s.settings?.showMusic && s.media?.status === 'playing' ? s.media : null))
}

// ─── Pastille ────────────────────────────────────────────────────────────────

export function CompactArt({ media }: { media: MediaInfo }) {
  const color = useArtColor(media.art)
  return <Art src={media.art} size={20} radius={6} color={color} />
}

export function CompactTimer({ timer }: { timer: TimerState }) {
  const running = timer.endsAt !== undefined
  const now = useNow(running)
  return (
    <span
      className="font-dot text-[13px] leading-none font-bold tabular-nums"
      style={{ color: TIMER, textShadow: `0 0 8px ${TIMER}99`, opacity: running ? 1 : 0.55 }}
      title={timerTitle(timer)}
    >
      {formatClock(remainingMs(timer, now))}
    </span>
  )
}

// ─── Aperçu ──────────────────────────────────────────────────────────────────

function LiveButton({ label, onClick, children, big, color }: { label: string; onClick: () => void; children: ReactNode; big?: boolean; color?: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={(e) => {
        // Un clic sur un bouton ne doit pas ouvrir le panneau.
        e.stopPropagation()
        onClick()
      }}
      className={cx(
        'grid shrink-0 place-items-center rounded-full transition-[background,transform] duration-150 outline-none hover:scale-[1.06] focus-visible:ring-2 focus-visible:ring-white/40 active:scale-95',
        big ? 'size-8.5 text-ink-950' : 'size-7.5 text-fog-100 hover:bg-white/[0.1]'
      )}
      style={big ? { background: color ?? '#fff', boxShadow: `0 0 16px -2px ${color ?? '#fff'}88` } : undefined}
    >
      {children}
    </button>
  )
}

export function MediaPeek({ media }: { media: MediaInfo }) {
  const color = useArtColor(media.art)
  const playing = media.status === 'playing'
  const now = useNow(playing && media.duration > 0)
  const pos = mediaPosition(media, now)
  const ratio = media.duration > 0 ? pos / media.duration : 0
  const control = (action: MediaAction): void => {
    // L'état affiché change tout de suite ; le relevé suivant confirme.
    if (action === 'play_pause') useCompi.getState().setMedia({ ...media, status: playing ? 'paused' : 'playing', position: pos, at: Date.now() })
    void window.compi.mediaControl(action).catch(() => undefined)
  }
  const sub = [media.artist, media.app].filter(Boolean).join(' · ')

  return (
    <div className="flex h-full items-center gap-3 pr-3.5 pl-2.5">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }}>
        <Art src={media.art} size={40} radius={11} color={color} />
      </motion.div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-[12.5px] leading-tight font-medium text-fog-100">{media.title}</div>
          <LedEq color={color} on={playing} />
        </div>
        <div className="mt-0.5 truncate text-[11.5px] leading-tight text-fog-500">{sub || 'Musique en cours'}</div>
        {media.duration > 0 && (
          <div className="mt-1.5 flex items-center gap-2">
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/[0.1]">
              <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color, boxShadow: `0 0 6px ${color}` }} />
            </div>
            <span className="text-[10px] text-fog-500 tabular-nums">-{formatClock((media.duration - pos) * 1000)}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {media.canPrevious && (
          <LiveButton label="Morceau précédent" onClick={() => control('previous')}>
            <SkipBack size={14} fill="currentColor" />
          </LiveButton>
        )}
        <LiveButton label={playing ? 'Pause' : 'Lecture'} onClick={() => control('play_pause')} big color={color}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-[1px]" />}
        </LiveButton>
        {media.canNext && (
          <LiveButton label="Morceau suivant" onClick={() => control('next')}>
            <SkipForward size={14} fill="currentColor" />
          </LiveButton>
        )}
      </div>
    </div>
  )
}

function Ring({ value, size, color, children }: { value: number; size: number; color: string; children: ReactNode }) {
  const r = size / 2 - 2.5
  const c = 2 * Math.PI * r
  return (
    <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * value}
          style={{ filter: `drop-shadow(0 0 3px ${color})`, transition: 'stroke-dashoffset 0.9s linear' }}
        />
      </svg>
      {children}
    </span>
  )
}

export function TimerPeek({ timer }: { timer: TimerState }) {
  const running = timer.endsAt !== undefined
  const now = useNow(running, 500)
  const left = remainingMs(timer, now)
  const brk = timer.pomodoro?.phase === 'break'
  const color = brk ? PILLS.meeting.color : TIMER
  return (
    <div className="flex h-full items-center gap-3.5 pr-3.5 pl-3">
      <Ring value={progress(timer, now)} size={38} color={color}>
        <Timer size={15} style={{ color }} />
      </Ring>
      <div className="min-w-0 flex-1">
        <div className="led-text truncate text-[11px] leading-tight" style={{ color, textShadow: `0 0 10px ${color}88` }}>
          {timerTitle(timer)}
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-[19px] leading-none font-semibold text-fog-100 tabular-nums">{formatClock(left)}</span>
          <span className="text-[11px] text-fog-500">{running ? 'restant' : 'en pause'}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <LiveButton label={running ? 'Mettre en pause' : 'Reprendre'} onClick={() => void (running ? window.compi.pauseTimer() : window.compi.resumeTimer())} big color={color}>
          {running ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-[1px]" />}
        </LiveButton>
        <LiveButton label="Arrêter le minuteur" onClick={() => void window.compi.stopTimer()}>
          <X size={15} />
        </LiveButton>
      </div>
    </div>
  )
}

export function SpeakingPeek({ eyes }: { eyes: ReactNode }) {
  const color = PILLS.speaking.color
  return (
    <div className="flex h-full items-center gap-3.5 pr-3.5 pl-5">
      {eyes}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="led-text text-[12px] leading-tight" style={{ color, textShadow: `0 0 10px ${color}88` }}>
            Je parle
          </span>
          <LedEq color={color} on />
        </div>
        <div className="mt-0.5 truncate text-[12px] text-fog-300">Ma réponse, à voix haute</div>
      </div>
      <LiveButton label="Arrêter la lecture" onClick={() => useCompi.getState().stopSpeaking()} big color={color}>
        <Square size={12} fill="currentColor" />
      </LiveButton>
    </div>
  )
}

export function ListeningPeek({ eyes }: { eyes: ReactNode }) {
  const phase = useCompi((s) => s.dictation.phase)
  const color = PILLS.chat.color
  const listening = phase === 'recording' || phase === 'starting'
  return (
    <div className="flex h-full items-center gap-3.5 pr-3.5 pl-5">
      {eyes}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="led-text text-[12px] leading-tight" style={{ color, textShadow: `0 0 10px ${color}88` }}>
            {listening ? 'Je t’écoute' : 'Je transcris'}
          </span>
          <LedEq color={color} on={listening} />
        </div>
        <div className="mt-0.5 truncate text-[12px] text-fog-300">{listening ? 'Fais une pause pour envoyer' : 'Sur ton PC, rien n’est envoyé'}</div>
      </div>
      {listening && (
        <LiveButton label="Terminer la dictée" onClick={() => useCompi.getState().stopDictation()} big color={color}>
          <Square size={12} fill="currentColor" />
        </LiveButton>
      )}
    </div>
  )
}
