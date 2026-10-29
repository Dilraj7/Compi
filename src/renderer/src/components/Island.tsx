// L'îlot : une forme noire collée en haut de l'écran, qui se transforme
// (caché → pastille → aperçu → panneau) avec une animation à ressort.
// Les yeux du robot restent le point focal d'un état à l'autre.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useShallow } from 'zustand/react/shallow'
import { PILLS, type PillId } from '@shared/pills'
import { gaugeLevel, type PerfSnapshot } from '@shared/perf'
import { useCompi } from '../store'
import { useMood } from '../mascot/useMood'
import { LedEyes, useLook } from '../mascot/LedEyes'
import { LedDots, prettyShortcut, Ticker } from './ui'
import { GAUGE_COLOR, MiniGauges, perfLevels } from './Gauges'
import { PILL_ICONS, openFromNotice, runNoticeAction } from './Notice'
import { Panel } from './Panel'
import { FullScreen } from './FullScreen'
import { ZoomToast } from './ZoomToast'
import { CompactArt, CompactTimer, ConversePeek, LedEq, ListeningPeek, MediaPeek, SpeakingPeek, TimerPeek, useLiveMedia } from './Live'
import { CallPeek, CompactCall, REC } from './CallLive'

const SIZE = {
  hidden: { width: 140, height: 6, radius: 6 },
  compact: { width: 200, height: 36, radius: 18 },
  peek: { width: 400, height: 58, radius: 28 },
  // Une notification élargit l'aperçu : plus de texte avant qu'il ne défile.
  notice: { width: 520, height: 58, radius: 28 },
  expanded: { width: 680, height: 476, radius: 30 }
} as const

const SPRING = { type: 'spring', stiffness: 380, damping: 32, mass: 0.85 } as const

/** Taille de la fenêtre : en plein écran, l'îlot la remplit (elle grandit juste après l'appel). */
function useViewport(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = (): void => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

type EyeSize = 'sm' | 'md' | 'lg'

const EYE_SIZE = {
  sm: { look: 1.1, dot: 2.9, gap: 1.3, eyeGap: 11 },
  md: { look: 1.4, dot: 3.4, gap: 1.5, eyeGap: 13 },
  // Plein écran : le robot en grand dans la barre du haut.
  lg: { look: 1.8, dot: 4.4, gap: 1.9, eyeGap: 17 }
} as const

function Eyes({ size = 'sm' }: { size?: EyeSize }) {
  // Le regard vit dans un enfant : l'élément partagé (layoutId) ne se redessine pas à
  // chaque mouvement de souris, ce qui relancerait son animation de mise en page.
  return (
    <motion.div layoutId="compi-eyes" transition={SPRING} className="grid place-items-center">
      <LookingEyes size={size} />
    </motion.div>
  )
}

function LookingEyes({ size }: { size: EyeSize }) {
  const { mood, color } = useMood()
  const e = EYE_SIZE[size]
  const { ref, look } = useLook(e.look)
  return (
    <div ref={ref} className="grid place-items-center">
      <LedEyes mood={mood} color={color} dot={e.dot} gap={e.gap} eyeGap={e.eyeGap} look={look} />
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

function CompactContent() {
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  const working = useCompi((s) => s.sessions.filter((x) => x.status === 'working').length)
  const streaming = useCompi((s) => s.streamingId !== null)
  const timer = useCompi((s) => s.timer)
  const speaking = useCompi((s) => s.speaking)
  const dictating = useCompi((s) => s.dictation.phase !== 'idle')
  const perf = useCompi((s) => (s.settings?.monitor.island ? s.perf : null))
  const call = useCompi((s) => s.call)
  const media = useLiveMedia()

  // À gauche : l'enregistrement d'un appel (toujours visible), l'activité de Compi, sinon la pochette, sinon les mini-jauges (option).
  // À droite : ce qui attend l'utilisateur, puis le minuteur, la voix, la musique.
  const left = call ? 'call' : streaming || working > 0 ? 'busy' : media ? 'art' : perf ? 'perf' : null
  const right = pending > 0 ? 'pending' : dictating ? 'listening' : timer ? 'timer' : speaking ? 'speaking' : media ? 'eq' : null

  return (
    <div className="relative flex h-full items-center justify-center px-3">
      <div className="absolute left-3 flex items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          {left === 'call' && call && (
            <Fade key="call">
              <CompactCall call={call} />
            </Fade>
          )}
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
  const calling = useCompi((s) => s.call !== null)
  // Conversation vocale entre deux réponses (pendant la réponse : « Je réfléchis », puis la lecture).
  const conversing = useCompi((s) => s.converse.phase !== 'off' && s.converse.phase !== 'answering')

  // Ce qui demande l'attention passe avant l'îlot vivant.
  if (dictating && !pending) return <ListeningPeek eyes={<Eyes size="md" />} />
  if (conversing && !pending) return <ConversePeek eyes={<Eyes size="md" />} />
  if (calling && !pending && !notice) return <CallPeek eyes={<Eyes size="md" />} />
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
              // Le clic ne doit pas aussi ouvrir le panneau (sauf « Préparer », qui ouvre Aujourd'hui).
              e.stopPropagation()
              runNoticeAction(notice)
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
  const everywhere = useCompi((s) => s.dictation.everywhere !== null)
  const conversing = useCompi((s) => s.converse.phase !== 'off')
  const calling = useCompi((s) => s.call !== null)
  const full = useCompi((s) => s.full)
  const viewport = useViewport()
  const { color } = useMood()

  // Une notification (ou une dictée partout, une conversation vocale) force l'aperçu le temps de l'afficher, sans prendre le focus.
  // Un appel enregistré n'est jamais caché : au moins la pastille, avec son point rouge.
  const shown = (notice || everywhere || conversing) && mode !== 'expanded' ? 'peek' : calling && mode === 'hidden' ? 'compact' : mode
  const size = full ? { ...viewport, radius: 0 } : shown === 'peek' && notice ? SIZE.notice : SIZE[shown]
  const expanded = shown === 'expanded'

  // Sortie du plein écran : la fenêtre reprend sa taille une fois l'îlot rétréci (fin de
  // l'animation, ou au plus tard 0,9 s), jamais pendant : l'îlot serait coupé.
  const windowFull = useRef(false)
  const restoreWindow = (): void => {
    if (!windowFull.current || useCompi.getState().full) return
    windowFull.current = false
    window.compi.setFull(false)
  }
  useEffect(() => {
    if (full) {
      windowFull.current = true
      return
    }
    const t = setTimeout(restoreWindow, 900)
    return () => clearTimeout(t)
  }, [full])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const s = useCompi.getState()
      // Échap pendant la dictée : on l'abandonne, sans refermer.
      if (s.dictation.phase === 'recording' || s.dictation.phase === 'starting') s.cancelDictation()
      // Puis la conversation vocale (la lecture en cours continue).
      else if (s.converse.phase !== 'off') s.endConversation()
      // En plein écran, Échap ramène d'abord le panneau de l'encoche.
      else if (s.full) s.exitFull()
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
          boxShadow: full
            ? `0 0 0 0 transparent, 0 0 0 0 transparent, 0 0 0 0 transparent`
            : expanded
              ? `0 34px 90px -24px rgb(0 0 0 / 0.85), 0 0 0 1px ${calling ? `${REC}99` : 'rgb(255 255 255 / 0.07)'}, 0 18px 60px -30px ${color}`
              : `0 8px 24px -10px rgb(0 0 0 / 0.7), 0 0 0 1px ${calling ? `${REC}b3` : 'rgb(255 255 255 / 0.05)'}, 0 6px 26px -14px ${calling ? REC : color}`
        }}
        transition={SPRING}
        onAnimationComplete={restoreWindow}
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
          {shown === 'expanded' && !full && (
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
          {full && (
            <motion.div
              key="full"
              className="h-full"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.22, delay: 0.12 } }}
              exit={{ opacity: 0, transition: { duration: 0.08 } }}
            >
              <FullScreen eyes={<Eyes size="lg" />} width={viewport.width} />
            </motion.div>
          )}
        </AnimatePresence>
        {expanded && <ZoomToast />}
      </motion.div>
      {!full && (
        <>
          <span className="notch-shoulder left" />
          <span className="notch-shoulder right" />
        </>
      )}
    </div>
  )
}
