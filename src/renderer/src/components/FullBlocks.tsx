// Blocs propres au plein écran : « Récents » (réunions, fichiers des dossiers confiés),
// et le mode « Disposer » qui déplace, masque ou remet les blocs à leur place.

import { useCallback, useEffect, useState, type DragEvent, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  AudioLines,
  BellRing,
  CalendarDays,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileText,
  File as FileIcon,
  GripVertical,
  History,
  Image,
  ListTodo,
  Mail,
  MessageSquareText,
  Repeat,
  Sparkles,
  Timer,
  type LucideIcon
} from 'lucide-react'
import { columnBlocks, moveBlock, shiftBlock, toggleBlock } from '@shared/fullBlocks'
import type { FullBlockId, FullBlockPlace, FullColumn, RecentsInfo } from '@shared/types'
import { openMeetingView } from '../lib/meetingNav'
import { useCompi } from '../store'
import { Block, Empty } from './Day'
import { cx, IconButton, LedDots, timeAgo } from './ui'

export const BLOCK_META: Record<FullBlockId, { title: string; icon: LucideIcon }> = {
  missed: { title: 'Ce que tu as manqué', icon: Sparkles },
  agenda: { title: 'Agenda', icon: CalendarDays },
  reminders: { title: 'Rappels', icon: BellRing },
  timer: { title: 'Minuteur', icon: Timer },
  mail: { title: 'E-mails non lus', icon: Mail },
  call: { title: 'Appel en cours', icon: AudioLines },
  tasks: { title: 'Tâches', icon: ListTodo },
  recents: { title: 'Récents', icon: History },
  messages: { title: 'Messages en attente', icon: MessageSquareText },
  routines: { title: 'Routines', icon: Repeat }
}

// ─── Récents ────────────────────────────────────────────────────────────────

const minutes = (ms: number): string => `${Math.max(1, Math.round(ms / 60_000))} min`

function fileIcon(name: string): LucideIcon {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return FileSpreadsheet
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'svg'].includes(ext)) return Image
  if (['doc', 'docx', 'pdf', 'txt', 'md', 'odt', 'rtf'].includes(ext)) return FileText
  return FileIcon
}

export { openMeetingView }

/** Dernières réunions et fichiers modifiés cette semaine dans les dossiers confiés. */
export function RecentsBlock() {
  const [info, setInfo] = useState<RecentsInfo | null>(null)
  const [note, setNote] = useState('')
  const load = useCallback(async () => setInfo(await window.compi.recents()), [])
  useEffect(() => {
    void load()
    const off = window.compi.onMeetings(() => void load())
    const t = setInterval(() => void load(), 5 * 60_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [load])
  const open = (path: string): void => {
    void window.compi.openConfidedFile(path).then((r) => setNote(r === 'shown' ? 'C’est un programme : je le montre dans l’Explorateur sans le lancer.' : r === 'refused' ? 'Ce fichier n’a pas pu être ouvert.' : ''))
  }
  const empty = info && !info.meetings.length && !info.files.length
  return (
    <Block icon={<History size={12} />} title="Récents" extra={!info ? <LedDots color="#7FB0FF" /> : undefined}>
      {empty ? (
        <Empty>
          {info.folders
            ? 'Rien de neuf cette semaine : tes réunions enregistrées et les fichiers modifiés dans tes dossiers confiés apparaîtront ici.'
            : 'Tes réunions enregistrées apparaîtront ici, et les fichiers modifiés de tes dossiers, si tu m’en confies (Réglages › Dossiers).'}
        </Empty>
      ) : (
        <>
          {info?.meetings.map((m) => (
            <button
              key={m.id}
              onClick={() => openMeetingView(m.id)}
              className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.04] [&+&]:border-t [&+&]:border-white/[0.05]"
            >
              <AudioLines size={14} className="mt-0.5 shrink-0 text-[#F472B6]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-fog-100">{m.title}</span>
                <span className="block truncate text-[11px] text-fog-500">
                  {timeAgo(m.startedAt)} · {minutes(m.durationMs)}
                  {m.tasks ? ` · ${m.tasks} tâche${m.tasks > 1 ? 's' : ''}` : ''}
                </span>
                {m.summary && <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-fog-300">{m.summary}</span>}
              </span>
            </button>
          ))}
          {info?.files.map((f) => {
            const Icon = fileIcon(f.name)
            return (
              <button
                key={f.path}
                onClick={() => open(f.path)}
                title={f.path}
                className="flex w-full items-center gap-3 border-t border-white/[0.05] px-3.5 py-2 text-left transition-colors first:border-t-0 hover:bg-white/[0.04]"
              >
                <Icon size={14} className="shrink-0 text-[#7FB0FF]" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fog-100">{f.name}</span>
                {f.modified && <span className="shrink-0 text-[11px] text-fog-500">{timeAgo(Date.parse(f.modified))}</span>}
              </button>
            )
          })}
        </>
      )}
      {note && <div className="border-t border-white/[0.05] px-3.5 py-2 text-[11.5px] text-led-amber">{note}</div>}
    </Block>
  )
}

// ─── Disposer ───────────────────────────────────────────────────────────────

/** Enregistre la nouvelle place des blocs (le reste du plein écran est gardé). */
export function saveBlocks(blocks: FullBlockPlace[]): void {
  const s = useCompi.getState()
  const full = s.settings?.full
  if (!full) return
  s.setSettings({ ...s.settings!, full: { ...full, blocks } })
  void window.compi.updateSettings({ full: { ...full, blocks } }).then(s.setSettings)
}

const DRAG_TYPE = 'application/x-compi-block'

function HandleRow({ b, blocks, col, index }: { b: FullBlockPlace; blocks: FullBlockPlace[]; col: FullColumn; index: number }) {
  const { title, icon: Icon } = BLOCK_META[b.id]
  const [over, setOver] = useState(false)
  const other: FullColumn = col === 'left' ? 'right' : 'left'
  const drop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const id = e.dataTransfer.getData(DRAG_TYPE) as FullBlockId
    if (id && id !== b.id) saveBlocks(moveBlock(blocks, id, col, index))
  }
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, b.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      data-block-handle={b.id}
      className={cx(
        'flex cursor-grab items-center gap-2 rounded-2xl bg-ink-850/80 px-2.5 py-2 ring-1 ring-inset ring-white/[0.08] active:cursor-grabbing',
        b.hidden && 'opacity-45',
        over && 'ring-[var(--led)]/70'
      )}
    >
      <GripVertical size={14} className="shrink-0 text-fog-700" />
      <Icon size={13} className="shrink-0 text-fog-500" />
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-fog-100">{title}</span>
      <IconButton label="Monter" onClick={() => saveBlocks(shiftBlock(blocks, b.id, 'up'))} className="size-7">
        <ArrowUp size={13} />
      </IconButton>
      <IconButton label="Descendre" onClick={() => saveBlocks(shiftBlock(blocks, b.id, 'down'))} className="size-7">
        <ArrowDown size={13} />
      </IconButton>
      <IconButton
        label={other === 'left' ? 'Passer à gauche' : 'Passer à droite'}
        onClick={() => saveBlocks(shiftBlock(blocks, b.id, other))}
        className="size-7"
      >
        {other === 'left' ? <ArrowLeft size={13} /> : <ArrowRight size={13} />}
      </IconButton>
      <IconButton label={b.hidden ? 'Afficher' : 'Masquer'} onClick={() => saveBlocks(toggleBlock(blocks, b.id))} className="size-7">
        {b.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
      </IconButton>
    </div>
  )
}

/**
 * Une colonne de blocs. En mode « Disposer », chaque bloc devient une poignée qu'on
 * glisse (ou qu'on déplace aux flèches) ; la fin de la colonne accepte aussi un dépôt.
 */
export function BlockColumn({
  col,
  blocks,
  arranging,
  render
}: {
  col: FullColumn
  blocks: FullBlockPlace[]
  arranging: boolean
  render: (id: FullBlockId) => ReactNode
}) {
  const list = columnBlocks(blocks, col)
  const [over, setOver] = useState(false)
  if (!arranging)
    return (
      <>
        {list
          .filter((b) => !b.hidden)
          .map((b) => (
            <div key={b.id} data-block={b.id} className="empty:hidden">
              {render(b.id)}
            </div>
          ))}
      </>
    )
  return (
    <div className="space-y-2" data-arrange={col}>
      {list.map((b, i) => (
        <HandleRow key={b.id} b={b} blocks={blocks} col={col} index={i} />
      ))}
      <div
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          const id = e.dataTransfer.getData(DRAG_TYPE) as FullBlockId
          if (id) saveBlocks(moveBlock(blocks, id, col, list.length))
        }}
        className={cx(
          'rounded-2xl border border-dashed px-3 py-3 text-center text-[11.5px] transition-colors',
          over ? 'border-[var(--led)]/70 text-fog-300' : 'border-white/[0.08] text-fog-700'
        )}
      >
        Déposer ici
      </div>
    </div>
  )
}
