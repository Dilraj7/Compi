// Notifications de l'îlot : icônes des pastilles, clic vers la vue concernée, et
// bandeau affiché en haut du panneau quand il est ouvert (sinon on n'entendrait que le son).

import { AnimatePresence, motion } from 'motion/react'
import {
  AudioLines,
  BellRing,
  Brain,
  CheckCircle2,
  FileText,
  MessageCircle,
  MessageCircleQuestion,
  MessageSquareText,
  Music2,
  Repeat,
  ShieldQuestion,
  Sparkles,
  Sun,
  TerminalSquare,
  Timer,
  TriangleAlert,
  Video,
  X
} from 'lucide-react'
import { PILLS, type PillId } from '@shared/pills'
import type { IslandNotice } from '@shared/types'
import { useCompi } from '../store'
import { Ticker } from './ui'

export const PILL_ICONS: Record<PillId, typeof MessageCircle> = {
  chat: MessageCircle,
  thinking: Sparkles,
  approval: ShieldQuestion,
  question: MessageCircleQuestion,
  'claude-session': TerminalSquare,
  'claude-done': CheckCircle2,
  reminder: BellRing,
  today: Sun,
  meeting: Video,
  timer: Timer,
  music: Music2,
  speaking: AudioLines,
  memory: Brain,
  routine: Repeat,
  message: MessageSquareText,
  file: FileText,
  error: TriangleAlert
}

/** Clic sur une notification : sa vue (la discussion d'une routine…), sinon la discussion. */
export function openFromNotice(notice: IslandNotice | null): void {
  const s = useCompi.getState()
  if (notice?.conversationId) {
    s.dismissNotice()
    void s.loadConversation(notice.conversationId).then(() => s.open('chat', { focus: true }))
  } else if (notice?.view) {
    // Panneau ouvert : le bandeau a servi, il s'efface.
    if (s.mode === 'expanded') s.dismissNotice()
    s.open(notice.view)
  } else s.open('chat', { focus: true })
}

/** Panneau ouvert : la notification descend en bandeau sous l'en-tête. */
export function NoticeBanner() {
  const notice = useCompi((s) => s.notice)
  const holdNotice = useCompi((s) => s.holdNotice)
  const noticeScrollTime = useCompi((s) => s.noticeScrollTime)
  const dismiss = useCompi((s) => s.dismissNotice)
  const def = notice ? (PILLS[notice.pill] ?? PILLS.chat) : null
  const Icon = notice ? PILL_ICONS[notice.pill] : null

  return (
    <AnimatePresence>
      {notice && def && Icon && (
        <motion.div
          key="notice"
          data-notice-banner
          role="status"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.18 } }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
          className="absolute top-1 right-4 left-4 z-30 flex items-center gap-2.5 rounded-2xl bg-ink-850/95 py-2 pr-1.5 pl-3 shadow-[0_12px_32px_-12px_rgb(0_0_0/0.8)] ring-1 ring-white/[0.08] backdrop-blur"
          onMouseEnter={() => holdNotice(true)}
          onMouseLeave={() => holdNotice(false)}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            onClick={() => {
              if (notice.action) {
                void window.compi.openExternal(notice.action.url)
                dismiss()
              } else openFromNotice(notice)
            }}
          >
            <Icon size={15} className="shrink-0" style={{ color: def.color }} />
            <span className="led-text shrink-0 text-[11.5px]" style={{ color: def.color, textShadow: `0 0 10px ${def.color}88` }}>
              {def.label}
            </span>
            <Ticker key={notice.text} text={notice.text} className="min-w-0 flex-1 text-[12px] text-fog-300" onScrollTime={noticeScrollTime} />
            {notice.action && (
              <span className="shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-medium text-ink-950" style={{ background: def.color }}>
                {notice.action.label}
              </span>
            )}
          </button>
          <button
            onClick={dismiss}
            className="grid size-6 shrink-0 place-items-center rounded-lg text-fog-500 hover:bg-white/10 hover:text-fog-100"
            aria-label="Fermer la notification"
          >
            <X size={13} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
