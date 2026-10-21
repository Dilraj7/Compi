import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Activity, Brain, History, MessageCircle, Plug, Settings2, SquarePen, Sun, X } from 'lucide-react'
import type { PanelView } from '@shared/types'
import { useCompi } from '../store'
import { useMood } from '../mascot/useMood'
import { IconButton } from './ui'
import { CommandPalette } from './CommandPalette'
import { NoticeBanner } from './Notice'
import { ChatView } from '../views/ChatView'
import { ActivityView } from '../views/ActivityView'
import { HistoryView } from '../views/HistoryView'
import { ExtensionsView } from '../views/ExtensionsView'
import { SettingsView } from '../views/SettingsView'
import { QuickView } from '../views/QuickView'
import { TodayView } from '../views/TodayView'
import { MemoryView } from '../views/MemoryView'

const STATUS: Record<string, string> = {
  idle: 'en veille active',
  listening: 'je te réponds',
  thinking: 'je réfléchis',
  waiting: 'en attente de toi',
  happy: 'terminé',
  error: 'oups',
  sleeping: 'je somnole',
  surprised: 'oh !',
  wink: 'coucou'
}

const VIEWS: Record<PanelView, () => ReactNode> = {
  chat: () => <ChatView />,
  today: () => <TodayView />,
  activity: () => <ActivityView />,
  history: () => <HistoryView />,
  connectors: () => <ExtensionsView />,
  settings: () => <SettingsView />,
  quick: () => <QuickView />,
  memory: () => <MemoryView />
}

export function Panel({ eyes }: { eyes: ReactNode }) {
  const view = useCompi((s) => s.view)
  const setView = useCompi((s) => s.setView)
  const collapse = useCompi((s) => s.collapse)
  const newConversation = useCompi((s) => s.newConversation)
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  const hasMessages = useCompi((s) => s.messages.length > 0)
  const palette = useCompi((s) => s.palette)
  const { mood, color } = useMood()

  return (
    <div className="relative flex h-full flex-col">
      {/* Halo de l'humeur, qui descend du visage du robot. */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[420px] -translate-x-1/2 rounded-full opacity-[0.16] blur-3xl transition-colors duration-700"
        style={{ background: color }}
      />
      <div className="dot-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_70%)]" />

      <header className="relative grid h-[58px] shrink-0 grid-cols-[1fr_auto_1fr] items-center px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="led-text text-[15px] text-fog-100">Compi</span>
          <motion.span key={mood} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} className="truncate text-[11.5px] text-fog-500">
            <span className="mr-1.5 inline-block size-1.5 rounded-full align-middle" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            {STATUS[mood]}
          </motion.span>
        </div>

        <div className="px-3">{eyes}</div>

        <nav className="flex items-center justify-end gap-0.5">
          {view === 'chat' && hasMessages && (
            <IconButton label="Nouvelle discussion (Ctrl+N)" onClick={newConversation}>
              <SquarePen size={15} />
            </IconButton>
          )}
          <IconButton label="Discussion (Ctrl+1)" active={view === 'chat'} onClick={() => setView('chat')}>
            <MessageCircle size={16} />
          </IconButton>
          <IconButton label="Aujourd’hui (Ctrl+2)" active={view === 'today'} onClick={() => setView('today')}>
            <Sun size={16} />
          </IconButton>
          <IconButton label="Activité (Ctrl+3)" active={view === 'activity'} badge={pending} onClick={() => setView('activity')}>
            <Activity size={16} />
          </IconButton>
          <IconButton label="Historique (Ctrl+4)" active={view === 'history'} onClick={() => setView('history')}>
            <History size={16} />
          </IconButton>
          <IconButton label="Ce que je sais de toi, presse-papier (Ctrl+5)" active={view === 'memory'} onClick={() => setView('memory')}>
            <Brain size={16} />
          </IconButton>
          <IconButton label="Extensions : dossiers, connecteurs, compétences (Ctrl+6)" active={view === 'connectors'} onClick={() => setView('connectors')}>
            <Plug size={16} />
          </IconButton>
          <IconButton label="Réglages (Ctrl+7) · Ctrl+K pour chercher" active={view === 'settings'} onClick={() => setView('settings')}>
            <Settings2 size={16} />
          </IconButton>
          <span className="mx-1 h-4 w-px bg-white/10" />
          <IconButton label="Fermer (Échap)" onClick={collapse}>
            <X size={16} />
          </IconButton>
        </nav>
      </header>

      <div className="relative min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={view}
            className="absolute inset-0 flex flex-col"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] } }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
          >
            {VIEWS[view]()}
          </motion.div>
        </AnimatePresence>
        <NoticeBanner />
        <AnimatePresence>{palette && <CommandPalette key="palette" />}</AnimatePresence>
      </div>
    </div>
  )
}
