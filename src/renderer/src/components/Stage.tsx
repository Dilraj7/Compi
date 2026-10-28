// La scène du plein écran : sous une étape terminée, ce qu'elle a changé
// (fichier, rangement, agenda, rappel, ouverture, sources trouvées).

import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  AppWindow,
  BellRing,
  CalendarCheck2,
  CalendarPlus,
  CalendarX2,
  CircleCheck,
  FileText,
  FolderInput,
  FolderOpen,
  Globe,
  ListPlus,
  ListTodo,
  Settings2,
  Timer
} from 'lucide-react'
import type { StageDetail } from '@shared/stage'
import { cx } from './ui'

const COLOR: Record<StageDetail['kind'], string> = {
  file: '#7DD3FC',
  moves: '#FCD34D',
  event: '#4C8DF6',
  reminder: '#F472B6',
  task: '#4C8DF6',
  timer: '#F472B6',
  opened: '#A78BFA',
  sources: '#34D399'
}

const leaf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
/** Dossier qui contient l'élément (« D:\Docs\Factures\f.pdf » → « Factures »). */
const parent = (p: string): string => p.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? p

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function Shell({ kind, icon, title, sub, children }: { kind: StageDetail['kind']; icon: ReactNode; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  const color = COLOR[kind]
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-1.5 ml-6.5 overflow-hidden rounded-xl bg-ink-850/90 ring-1 ring-inset ring-white/[0.06]"
      style={{ boxShadow: `inset 2px 0 0 ${color}` }}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span className="grid size-6 shrink-0 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color }}>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12.5px] text-fog-100">{title}</div>
          {sub && <div className="truncate text-[11px] text-fog-500">{sub}</div>}
        </div>
      </div>
      {children}
    </motion.div>
  )
}

const EVENT = {
  created: { label: 'Ajouté à l’agenda', Icon: CalendarPlus },
  updated: { label: 'Rendez-vous modifié', Icon: CalendarCheck2 },
  deleted: { label: 'Supprimé de l’agenda', Icon: CalendarX2 }
} as const

const TASK = {
  created: { label: 'Tâche ajoutée', Icon: ListPlus },
  done: { label: 'Tâche terminée', Icon: CircleCheck },
  updated: { label: 'Tâche modifiée', Icon: ListTodo }
} as const

const OPENED = {
  app: { label: 'Appli ouverte', Icon: AppWindow },
  page: { label: 'Page ouverte', Icon: Globe },
  file: { label: 'Ouvert', Icon: FileText },
  folder: { label: 'Dossier ouvert', Icon: FolderOpen },
  settings: { label: 'Paramètres ouverts', Icon: Settings2 }
} as const

export function StageCard({ detail }: { detail: StageDetail }) {
  switch (detail.kind) {
    case 'file':
      return (
        <Shell kind="file" icon={<FileText size={13} />} title={leaf(detail.path)} sub={detail.summary}>
          {detail.diff.length > 0 && (
            <div className="max-h-56 overflow-auto border-t border-white/[0.05] bg-black/40 py-1.5 font-mono text-[11.5px] leading-relaxed select-text">
              {detail.diff.map((l, i) => (
                <div
                  key={i}
                  className={cx(
                    'px-3 [overflow-wrap:anywhere] whitespace-pre-wrap',
                    l.startsWith('+ ') ? 'bg-led-green/[0.08] text-led-green' : l.startsWith('- ') ? 'bg-led-red/[0.08] text-led-red' : 'text-fog-500'
                  )}
                >
                  {l}
                </div>
              ))}
            </div>
          )}
        </Shell>
      )
    case 'moves': {
      const more = detail.total - detail.moves.length
      return (
        <Shell
          kind="moves"
          icon={<FolderInput size={13} />}
          title={`${detail.total} élément${detail.total > 1 ? 's' : ''} rangé${detail.total > 1 ? 's' : ''}`}
          sub={detail.refused ? <span className="text-led-amber">{detail.refused} non déplacé(s)</span> : undefined}
        >
          {detail.moves.length > 0 && (
            <div className="space-y-0.5 border-t border-white/[0.05] px-3 py-2 text-[11.5px]">
              {detail.moves.map((m) => (
                <div key={m.from} className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 truncate text-fog-300" title={m.from}>
                    {leaf(m.from)}
                  </span>
                  <span className="shrink-0 text-fog-700">→</span>
                  <span className="shrink-0 truncate text-[#FCD34D]" title={m.to}>
                    {parent(m.to)}
                  </span>
                </div>
              ))}
              {more > 0 && <div className="text-fog-700">… et {more} autre(s)</div>}
            </div>
          )}
        </Shell>
      )
    }
    case 'event': {
      const { label, Icon } = EVENT[detail.action]
      return <Shell kind="event" icon={<Icon size={13} />} title={detail.text} sub={label} />
    }
    case 'reminder':
      return <Shell kind="reminder" icon={<BellRing size={13} />} title={detail.text} sub={detail.when} />
    case 'task': {
      const { label, Icon } = TASK[detail.action]
      return <Shell kind="task" icon={<Icon size={13} />} title={detail.text} sub={label} />
    }
    case 'timer':
      return <Shell kind="timer" icon={<Timer size={13} />} title={detail.text} />
    case 'opened': {
      const { label, Icon } = OPENED[detail.what]
      return <Shell kind="opened" icon={<Icon size={13} />} title={detail.what === 'page' ? host(detail.target) : leaf(detail.target)} sub={label} />
    }
    case 'sources':
      return (
        <Shell
          kind="sources"
          icon={<Globe size={13} />}
          title={`${detail.sources.length} source${detail.sources.length > 1 ? 's' : ''} trouvée${detail.sources.length > 1 ? 's' : ''}`}
        >
          <div className="border-t border-white/[0.05] py-1">
            {detail.sources.map((s) => (
              <button
                key={s.url}
                title={s.url}
                onClick={() => void window.compi.openExternal(s.url)}
                className="flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left text-[11.5px] transition-colors hover:bg-white/[0.04]"
              >
                <span className="min-w-0 flex-1 truncate text-fog-300">{s.title}</span>
                <span className="shrink-0 text-fog-700">{host(s.url)}</span>
              </button>
            ))}
          </div>
        </Shell>
      )
  }
}
