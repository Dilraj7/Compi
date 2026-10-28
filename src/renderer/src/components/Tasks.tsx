// Tâches Google : bloc d'« Aujourd'hui » (encoche) et de la colonne « À toi » du plein
// écran. Cocher une tâche est un clic de l'utilisateur : fait tout de suite chez Google,
// et un second clic la décoche. Ajouter une tâche passe par le petit champ du bas.

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ExternalLink, ListTodo, Plus } from 'lucide-react'
import { dueLabel, localDay, taskBucket, type TaskBucket } from '@shared/tasks'
import type { TaskItem, TasksInfo } from '@shared/types'
import { useCompi } from '../store'
import { Block, Empty } from './Day'
import { cx, LedDots } from './ui'

const ACCENT = '#4C8DF6'
const BUCKET_COLOR: Record<TaskBucket, string> = {
  late: 'text-led-red',
  today: 'text-[#7FB0FF]',
  soon: 'text-fog-500',
  later: 'text-fog-500',
  none: 'text-fog-500'
}
const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Tâches lues chez Google, relues quand elles changent (ajout, coche) et toutes les 5 minutes. */
export function useTasks(on: boolean): { info: TasksInfo | null; loading: boolean; load: () => Promise<void>; patch: (t: TaskItem) => void } {
  const [info, setInfo] = useState<TasksInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const next = await window.compi.tasks()
      // Une tâche cochée à l'instant reste visible (barrée) jusqu'au prochain rechargement complet.
      setInfo((prev) => ({ ...next, items: keepDone(prev?.items ?? [], next.items) }))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (!on) return
    void load()
    const off = window.compi.onTasks(() => void load())
    const every = setInterval(() => void load(), 5 * 60_000)
    return () => {
      off()
      clearInterval(every)
    }
  }, [on, load])
  const patch = useCallback(
    (t: TaskItem) => setInfo((prev) => prev && { ...prev, items: prev.items.map((x) => (x.id === t.id && x.listId === t.listId ? t : x)) }),
    []
  )
  return { info, loading, load, patch }
}

/** Les tâches cochées dans Compi gardent leur place, barrées, tant que la vue est ouverte. */
function keepDone(prev: TaskItem[], next: TaskItem[]): TaskItem[] {
  const out = [...next]
  prev.forEach((t, i) => {
    if (t.done && !next.some((x) => x.id === t.id && x.listId === t.listId)) out.splice(Math.min(i, out.length), 0, t)
  })
  return out
}

function TaskRow({ t, today, showList, onChange }: { t: TaskItem; today: string; showList: boolean; onChange: (t: TaskItem, error?: string) => void }) {
  const [busy, setBusy] = useState(false)
  const bucket = taskBucket(t, today)
  const toggle = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    const before = t
    onChange({ ...t, done: !t.done })
    try {
      await window.compi.setTaskDone(t.listId, t.id, !before.done)
    } catch (e) {
      onChange(before, cleanError(e as Error))
    } finally {
      setBusy(false)
    }
  }
  const sub = [t.due ? dueLabel(t.due, today) : '', showList ? t.list : ''].filter(Boolean)
  return (
    <div className="group flex items-center gap-2.5 px-3.5 py-2" data-task>
      <button
        role="checkbox"
        aria-checked={t.done}
        aria-label={t.done ? `Décocher « ${t.title} »` : `Cocher « ${t.title} »`}
        onClick={() => void toggle()}
        className={cx(
          'grid size-[18px] shrink-0 place-items-center rounded-full ring-[1.5px] ring-inset transition-colors',
          t.done ? 'bg-[#4C8DF6] text-ink-950 ring-[#4C8DF6]' : 'text-transparent ring-fog-700 hover:text-fog-500 hover:ring-fog-500'
        )}
      >
        <Check size={11} strokeWidth={3} />
      </button>
      <div className="min-w-0 flex-1">
        <div className={cx('truncate text-[12.5px] transition-colors', t.done ? 'text-fog-700 line-through' : 'text-fog-100')} title={t.notes}>
          {t.title}
        </div>
        {sub.length > 0 && (
          <div className="truncate text-[11px]">
            {t.due && <span className={t.done ? 'text-fog-700' : BUCKET_COLOR[bucket]}>{sub[0]}</span>}
            {showList && (
              <span className="text-fog-700">
                {t.due ? ' · ' : ''}
                {t.list}
              </span>
            )}
          </div>
        )}
      </div>
      {t.link && (
        <button
          title="Ouvrir dans Google Tasks"
          aria-label="Ouvrir dans Google Tasks"
          onClick={() => void window.compi.openExternal(t.link!)}
          className="grid size-6 shrink-0 place-items-center rounded-lg text-fog-700 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-white/10 hover:text-fog-100 focus-visible:opacity-100"
        >
          <ExternalLink size={12} />
        </button>
      )}
    </div>
  )
}

function AddTask({ onError }: { onError: (e: string) => void }) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  // Sans échéance, la tâche ajoutée va en bas de la liste : le champ confirme qu'elle est partie.
  const [added, setAdded] = useState<TaskItem | null>(null)
  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(null), 4000)
    return () => clearTimeout(t)
  }, [added])
  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      setAdded(await window.compi.addTask(title.trim()))
      setTitle('')
    } catch (err) {
      onError(cleanError(err as Error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="flex items-center gap-2.5 border-t border-white/[0.05] px-3.5 py-1.5">
      <span className={cx('grid size-[18px] shrink-0 place-items-center', added ? 'text-[#7FB0FF]' : 'text-fog-700')}>
        {busy ? <LedDots color={ACCENT} /> : added ? <Check size={14} /> : <Plus size={14} />}
      </span>
      <input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          setAdded(null)
        }}
        placeholder={added ? `Ajoutée à « ${added.list} ». Une autre ?` : 'Ajouter une tâche'}
        aria-label="Ajouter une tâche"
        maxLength={300}
        className="h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-fog-100 outline-none placeholder:text-fog-700"
      />
    </form>
  )
}

/** Bloc « Tâches » : en retard et aujourd'hui d'abord ; rien si les tâches Google ne sont pas connectées. */
export function TasksBlock({ limit = 6 }: { limit?: number }) {
  const on = useCompi((s) => s.settings?.google.tasks === true)
  const { info, loading, patch } = useTasks(on)
  const [all, setAll] = useState(false)
  const [error, setError] = useState('')
  if (!on) return null
  const today = localDay(new Date())
  const items = info?.items ?? []
  const shown = all ? items : items.slice(0, limit)
  const lists = new Set(items.map((t) => t.listId)).size
  const due = items.filter((t) => !t.done && t.due && t.due <= today).length
  const change = (t: TaskItem, e?: string): void => {
    patch(t)
    setError(e ?? '')
  }
  return (
    <Block
      icon={<ListTodo size={12} />}
      title="Tâches"
      extra={loading && !info ? <LedDots color={ACCENT} /> : due ? <span className="text-[11px] text-fog-500">{due} pour aujourd’hui</span> : undefined}
    >
      {info?.error ? (
        <div className="px-3.5 py-3 text-[11.5px] leading-snug text-led-amber">{info.error}</div>
      ) : items.length ? (
        <>
          <AnimatePresence initial={false}>
            {shown.map((t) => (
              <motion.div
                key={`${t.listId}/${t.id}`}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="[&+&]:border-t [&+&]:border-white/[0.05]"
              >
                <TaskRow t={t} today={today} showList={lists > 1} onChange={change} />
              </motion.div>
            ))}
          </AnimatePresence>
          {items.length > limit && (
            <button
              onClick={() => setAll(!all)}
              className="w-full border-t border-white/[0.05] px-3.5 py-1.5 text-left text-[11.5px] text-fog-500 hover:text-fog-100"
            >
              {all ? 'Moins' : `${items.length - limit} autre${items.length - limit > 1 ? 's' : ''}…`}
            </button>
          )}
        </>
      ) : (
        <Empty>{loading ? 'Chargement…' : 'Rien à faire : toutes tes tâches sont cochées.'}</Empty>
      )}
      {error && <div className="border-t border-white/[0.05] px-3.5 py-2 text-[11.5px] text-led-amber">{error}</div>}
      {!info?.error && <AddTask onError={setError} />}
    </Block>
  )
}
