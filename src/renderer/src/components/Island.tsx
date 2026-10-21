// L'îlot : une forme noire collée en haut de l'écran, qui se transforme
// (caché → pastille → aperçu → panneau) avec une animation à ressort.
// Les yeux du robot restent le point focal d'un état à l'autre.

import { useEffect, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { PILLS, type PillId } from '@shared/pills'
import { gaugeLevel, gbText, type PerfSnapshot } from '@shared/perf'
import { useCompi } from '../store'
import { useMood } from '../mascot/useMood'
import { LedEyes, useLook } from '../mascot/LedEyes'
import { LedDots, prettyShortcut, Ticker } from './ui'
import { PILL_ICONS, openFromNotice } from './Notice'
import { Panel } from './Panel'
import { CompactArt, CompactTimer, LedEq, ListeningPeek, MediaPeek, SpeakingPeek, TimerPeek, useLiveMedia } from './Live'

const SIZE = {
  hidden: { width: 140, height: 6, radius: 6 },
  compact: { width: 200, height: 36, radius: 18 },
  peek: { width: 400, height: 58, radius: 28 },
  // Une notification élargit l'aperçu : plus de texte avant qu'il ne défile.
  notice: { width: 520, height: 58, radius: 28 },
  expanded: { width: 680, height: 476, radius: 30 }
} as const

const SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.85 } as const

function Eyes({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  // Le regard vit dans un enfant : l'élément partagé (layoutId) ne se redessine pas à
  // chaque mouvement de souris, ce qui relancerait son animation de mise en page.
  return (
    <motion.div layoutId="compi-eyes" transition={SPRING} className="grid place-items-center">
      <LookingEyes size={size} />
    </motion.div>
  )
}

function LookingEyes({ size }: { size: 'sm' | 'md' }) {
  const { mood, color } = useMood()
  const { ref, look } = useLook(size === 'md' ? 1.4 : 1.1)
  return (
    <div ref={ref} className="grid place-items-center">
      <LedEyes mood={mood} color={color} dot={size === 'md' ? 3.4 : 2.9} gap={size === 'md' ? 1.5 : 1.3} eyeGap={size === 'md' ? 13 : 11} look={look} />
    </div>
  )
}

function Fade({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, filter: 'blur(6px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)', transition: { duration: 0.22, delay } }}
      exit={{ opacity: 0, filter: 'blur(6px)', transition: { duration: 0.1 } }}
    >
      {children}
    </motion.div>
  )
}

/** Les quatre mesures de l'îlot : processeur, mémoire, carte graphique, mémoire vidéo (0 à 1). */
function perfLevels(p: PerfSnapshot): Array<{ key: string; label: string; short: string; value: number; text: string }> {
  const out = [
    { key: 'cpu', label: 'Processeur', short: 'Processeur', value: p.cpu / 100, text: `${Math.round(p.cpu)} %` },
    {
      key: 'ram',
      label: 'Mémoire',
      short: 'Mémoire',
      value: p.ram.usedGb / p.ram.totalGb,
      text: `${gbText(p.ram.usedGb).replace(' Go', '')}/${gbText(p.ram.totalGb)}`
    }
  ]
  if (p.gpu) {
    out.push(
      { key: 'gpu', label: 'Carte graphique', short: 'Graphique', value: p.gpu.util / 100, text: `${Math.round(p.gpu.util)} %` },
      {
        key: 'vram',
        label: 'Mémoire vidéo',
        short: 'Mém. vidéo',
        value: p.gpu.vramUsedGb / p.gpu.vramTotalGb,
        text: `${gbText(p.gpu.vramUsedGb).replace(' Go', '')}/${gbText(p.gpu.vramTotalGb)}`
      }
    )
  }
  return out
}

const GAUGE_COLOR = { ok: 'var(--led)', high: '#FBBF24', full: '#F87171' } as const

/** Mini-jauges LED à côté du robot : une colonne de 4 points par mesure. */
function MiniGauges({ perf }: { perf: PerfSnapshot }) {
  return (
    <div className="flex items-end gap-[3px] pl-0.5" title="Processeur · mémoire · carte graphique · mémoire vidéo">
      {perfLevels(perf).map((g) => {
        const lit = g.value > 0.02 ? Math.max(1, Math.round(Math.min(1, g.value) * 4)) : 0
        const color = GAUGE_COLOR[gaugeLevel(g.value)]
        return (
          <span key={g.key} className="flex flex-col-reverse gap-[2px]">
            {[0, 1, 2, 3].map((d) => (
              <span
                key={d}
                className="size-[3px] rounded-[0.5px] transition-colors duration-500"
                style={d < lit ? { background: color, boxShadow: `0 0 4px ${color}` } : { background: 'rgb(255 255 255 / 0.09)' }}
              />
            ))}
          </span>
        )
      })}
    </div>
  )
}

function CompactContent() {
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  const working = useCompi((s) => s.sessions.filter((x) => x.status === 'working').length)
  const streaming = useCompi((s) => s.streamingId !== null)
  const timer = useCompi((s) => s.timer)
  const speaking = useCompi((s) => s.speaking)
  const dictating = useCompi((s) => s.dictation.phase !== 'idle')
  const perf = useCompi((s) => (s.settings?.monitor.island ? s.perf : null))
  const media = useLiveMedia()

  // À gauche : l'activité de Compi, sinon la pochette, sinon les mini-jauges (option).
  // À droite : ce qui attend l'utilisateur, puis le minuteur, la voix, la musique.
  const left = streaming || working > 0 ? 'busy' : media ? 'art' : perf ? 'perf' : null
  const right = pending > 0 ? 'pending' : dictating ? 'listening' : timer ? 'timer' : speaking ? 'speaking' : media ? 'eq' : null

  return (
    <div className="relative flex h-full items-center justify-center px-3">
      <div className="absolute left-3 flex items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {left === 'busy' && (
            <Fade key="busy" className="pl-0.5">
              <LedDots />
            </Fade>
          )}
          {left === 'art' && media && (
            <Fade key="art">
              <CompactArt media={media} />
            </Fade>
          )}
          {left === 'perf' && perf && (
            <Fade key="perf">
              <MiniGauges perf={perf} />
            </Fade>
          )}
        </AnimatePresence>
      </div>
      <Eyes />
      <div className="absolute right-3 flex items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {right === 'pending' && (
            <Fade key="pending">
              <span className="grid h-4.5 min-w-4.5 place-items-center rounded-full bg-led-amber px-1 text-[10px] font-bold text-black shadow-[0_0_10px_rgb(251_191_36/0.7)]">
                {pending}
              </span>
            </Fade>
          )}
          {right === 'timer' && timer && (
            <Fade key="timer">
              <CompactTimer timer={timer} />
            </Fade>
          )}
          {right === 'listening' && (
            <Fade key="listening">
              <LedEq color={PILLS.chat.color} on />
            </Fade>
          )}
          {right === 'speaking' && (
            <Fade key="speaking">
              <LedEq color={PILLS.speaking.color} on />
            </Fade>
          )}
          {right === 'eq' && (
            <Fade key="eq" className="pr-0.5">
              <LedEq color={PILLS.music.color} on />
            </Fade>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function PeekContent() {
  const settings = useCompi((s) => s.settings)
  const notice = useCompi((s) => s.notice)
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  const streamingId = useCompi((s) => s.streamingId)
  const activity = useCompi((s) => {
    const m = s.messages.find((x) => x.id === s.streamingId)
    return m?.tools?.filter((t) => t.status === 'running').at(-1)?.label
  })
  const working = useCompi(useShallow((s) => s.sessions.filter((x) => x.status === 'working')))
  const speaking = useCompi((s) => s.speaking)
  const dictating = useCompi((s) => s.dictation.phase !== 'idle')
  const timer = useCompi((s) => s.timer)
  // En aperçu, la musique en pause reste visible pour pouvoir la relancer.
  const media = useCompi((s) => (s.settings?.showMusic ? s.media : null))
  const perf = useCompi((s) => (s.settings?.monitor.island ? s.perf : null))
  const noticeScrollTime = useCompi((s) => s.noticeScrollTime)

  // Ce qui demande l'attention passe avant l'îlot vivant.
  if (dictating && !pending) return <ListeningPeek eyes={<Eyes size="md" />} />
  if (!notice && !pending && !streamingId) {
    if (speaking) return <SpeakingPeek eyes={<Eyes size="md" />} />
    if (timer) return <TimerPeek timer={timer} />
    if (media) return <MediaPeek media={media} />
    if (perf) return <PerfPeek perf={perf} />
  }

  let pill: PillId = 'chat'
  let title = `Salut${settings?.userName ? ` ${settings.userName}` : ''} !`
  let subtitle = settings?.shortcutActive ? `${prettyShortcut(settings.shortcut)} pour me parler` : 'Clique pour me parler'

  if (notice) {
    pill = notice.pill
    title = (PILLS[notice.pill] ?? PILLS.chat).label
    subtitle = notice.text
  } else if (pending) {
    pill = 'approval'
    title = 'Validation requise'
    subtitle = `${pending} demande${pending > 1 ? 's' : ''} en attente — clique pour voir`
  } else if (streamingId) {
    pill = 'thinking'
    title = 'Je réfléchis'
    subtitle = activity ?? 'Rédaction de la réponse…'
  } else if (working.length) {
    pill = 'claude-session'
    title = 'Claude Code'
    subtitle = working.length === 1 ? `${working[0].project} · ${working[0].currentTool ?? 'au travail'}` : `${working.length} sessions au travail`
  }

  const def = PILLS[pill] ?? PILLS.chat
  const Icon = PILL_ICONS[pill]

  return (
    <div className="flex h-full items-center gap-3.5 pr-5 pl-5">
      <Eyes size="md" />
      <Fade className="min-w-0 flex-1" delay={0.06}>
        <div className="led-text truncate text-[12px] leading-tight" style={{ color: def.color, textShadow: `0 0 10px ${def.color}88` }}>
          {title}
        </div>
        {notice ? (
          // Trop long pour l'aperçu : le texte défile, et la notification attend la fin.
          <Ticker key={notice.text} text={subtitle} className="mt-0.5 text-[12px] text-fog-300" onScrollTime={noticeScrollTime} />
        ) : (
          <div className="mt-0.5 truncate text-[12px] text-fog-300">{subtitle}</div>
        )}
      </Fade>
      <Fade delay={0.1}>
        {notice?.action ? (
          <button
            className="rounded-full px-3 py-1.5 text-[12px] font-medium text-ink-950 transition-transform hover:scale-[1.04]"
            style={{ background: def.color, boxShadow: `0 0 16px ${def.color}66` }}
            onClick={(e) => {
              // Le clic ne doit pas aussi ouvrir le panneau.
              e.stopPropagation()
              void window.compi.openExternal(notice.action!.url)
              useCompi.getState().dismissNotice()
            }}
          >
            {notice.action.label}
          </button>
        ) : (
          <Icon size={16} style={{ color: def.color }} />
        )}
      </Fade>
    </div>
  )
}

/** Au survol (option « moniteur ») : les chiffres derrière les mini-jauges. */
function PerfPeek({ perf }: { perf: PerfSnapshot }) {
  return (
    <div className="flex h-full items-center gap-3.5 pr-5 pl-5">
      <Eyes size="md" />
      <Fade className="grid min-w-0 flex-1 grid-flow-col gap-3" delay={0.06}>
        {perfLevels(perf).map((g) => {
          const color = GAUGE_COLOR[gaugeLevel(g.value)]
          return (
            <div key={g.key} className="min-w-0" title={g.label}>
              <div className="truncate text-[10px] leading-tight text-fog-500">{g.short}</div>
              <div
                className="mt-0.5 truncate text-[12.5px] font-semibold tabular-nums"
                style={{ color, textShadow: `0 0 10px color-mix(in oklab, ${color} 45%, transparent)` }}
              >
                {g.text}
              </div>
            </div>
          )
        })}
      </Fade>
    </div>
  )
}

export function Island() {
  const mode = useCompi((s) => s.mode)
  const notice = useCompi((s) => s.notice)
  const hover = useCompi((s) => s.hover)
  const holdNotice = useCompi((s) => s.holdNotice)
  const open = useCompi((s) => s.open)
  const addAttachments = useCompi((s) => s.addAttachments)
  const { color } = useMood()

  // Une notification force l'aperçu le temps de l'afficher.
  const shown = notice && mode !== 'expanded' ? 'peek' : mode
  const size = shown === 'peek' && notice ? SIZE.notice : SIZE[shown]
  const expanded = shown === 'expanded'

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const s = useCompi.getState()
      // Échap pendant la dictée : on l'abandonne, sans refermer.
      if (s.dictation.phase === 'recording' || s.dictation.phase === 'starting') s.cancelDictation()
      else if (s.mode === 'expanded') s.collapse()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const paths = [...e.dataTransfer.files].map((f) => window.compi.getPathForFile(f)).filter(Boolean)
    if (!paths.length) return
    addAttachments(paths)
    open('chat', { focus: true })
    useCompi
      .getState()
      .showNotice({ pill: 'file', text: paths.length > 1 ? `${paths.length} fichiers reçus` : (paths[0].split(/[\\/]/).pop() ?? 'Fichier reçu') })
  }

  return (
    <div
      data-island
      className="absolute top-0 left-1/2 -translate-x-1/2"
      onMouseEnter={() => {
        hover(true)
        // Souris sur la notification : elle reste le temps qu'on la lise (dans le panneau, c'est le bandeau qui la retient).
        if (useCompi.getState().mode !== 'expanded') holdNotice(true)
      }}
      onMouseLeave={() => {
        hover(false)
        holdNotice(false)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <motion.div
        className="relative overflow-hidden bg-black"
        initial={false}
        animate={{
          width: size.width,
          height: size.height,
          borderBottomLeftRadius: size.radius,
          borderBottomRightRadius: size.radius,
          boxShadow: expanded
            ? `0 34px 90px -24px rgb(0 0 0 / 0.85), 0 0 0 1px rgb(255 255 255 / 0.07), 0 18px 60px -30px ${color}`
            : `0 8px 24px -10px rgb(0 0 0 / 0.7), 0 0 0 1px rgb(255 255 255 / 0.05), 0 6px 26px -14px ${color}`
        }}
        transition={SPRING}
        onClick={!expanded ? () => openFromNotice(notice) : undefined}
        style={{ cursor: expanded ? 'default' : 'pointer' }}
      >
        <AnimatePresence mode="popLayout" initial={false}>
          {shown === 'hidden' && (
            <Fade key="hidden" className="flex h-full items-center justify-center">
              <span className="h-[2px] w-10 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            </Fade>
          )}
          {/* `animate` explicite : un état qui revient pendant sa sortie (survol bref) doit
              redevenir visible, sinon l'îlot reste noir et vide. */}
          {shown === 'compact' && (
            <motion.div
              key="compact"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.12 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              <CompactContent />
            </motion.div>
          )}
          {shown === 'peek' && (
            <motion.div
              key="peek"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.12 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              <PeekContent />
            </motion.div>
          )}
          {shown === 'expanded' && (
            <motion.div
              key="expanded"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.18, delay: 0.05 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              <Panel eyes={<Eyes size="md" />} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      <span className="notch-shoulder left" />
      <span className="notch-shoulder right" />
    </div>
  )
}
