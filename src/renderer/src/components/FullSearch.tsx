// Recherche universelle du plein écran (Ctrl+K) : applis du menu Démarrer, fichiers des
// dossiers confiés, réunions, discussions (titres et messages), rappels, tâches,
// souvenirs, actions et réglages. Tout est cherché sur le PC. Les résultats arrivent au
// fil de l'eau : d'abord ce qui est rapide, puis l'index de Windows et le sens.
// Sans flou derrière : sur tout l'écran, il coûterait de la mémoire graphique.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { AppWindow, AudioLines, BellRing, Brain, FileSearch, FileText, ListTodo, MessageCircle, Search, Sparkles } from 'lucide-react'
import { searchPalette } from '@shared/palette'
import type { FileSearchHit, LocalSearch, SemanticPassage } from '@shared/types'
import { useCompi } from '../store'
import { usePaletteItems } from './CommandPalette'
import { openMeetingView } from './FullBlocks'
import { cx, LedDots, timeAgo } from './ui'

interface Entry {
  key: string
  group: string
  icon: ReactNode
  label: string
  sub?: string
  hint?: string
  run: () => void
}

const NO_CONVERSATIONS: never[] = []
const EMPTY: LocalSearch = { apps: [], meetings: [], chats: [], reminders: [], tasks: [], memory: [] }
const TIME = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const close = (): void => useCompi.getState().setPalette(false)
const scrollToBlock = (id: string): void =>
  void setTimeout(() => document.querySelector(`[data-block="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 60)
const folderOf = (path: string): string => path.split(/[\\/]/).slice(-2, -1)[0] ?? ''

export function FullSearch() {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [local, setLocal] = useState<LocalSearch>(EMPTY)
  const [files, setFiles] = useState<FileSearchHit[]>([])
  const [meaning, setMeaning] = useState<SemanticPassage[]>([])
  const [busy, setBusy] = useState(false)
  const semanticOn = useCompi((s) => s.settings?.semantic.enabled === true)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const seq = useRef(0)
  const palette = usePaletteItems(NO_CONVERSATIONS)

  // Première ouverture : les listes (applis…) se préparent pendant que l'on tape.
  useEffect(() => {
    void window.compi.searchLocal('')
    setTimeout(() => input.current?.focus(), 30)
  }, [])

  useEffect(() => {
    const q = query.trim()
    const id = ++seq.current
    setIndex(0)
    if (!q) {
      setLocal(EMPTY)
      setFiles([])
      setMeaning([])
      setBusy(false)
      return
    }
    const fast = setTimeout(() => void window.compi.searchLocal(q).then((r) => id === seq.current && setLocal(r)), 80)
    // L'index de Windows, puis le sens : plus lents, seulement à partir de 3 lettres.
    const slow =
      q.length >= 3
        ? setTimeout(() => {
            setBusy(true)
            void window.compi
              .searchFiles(q)
              .then((r) => id === seq.current && setFiles(r))
              .then(() => (semanticOn && id === seq.current ? window.compi.trySemantic(q) : null))
              .then((r) => id === seq.current && setMeaning(r ?? []))
              .finally(() => id === seq.current && setBusy(false))
          }, 300)
        : undefined
    if (q.length < 3) {
      setFiles([])
      setMeaning([])
    }
    return () => {
      clearTimeout(fast)
      clearTimeout(slow)
    }
  }, [query, semanticOn])

  const entries = useMemo<Entry[]>(() => {
    const q = query.trim()
    const s = useCompi.getState
    const out: Entry[] = []
    const fromPalette = (limit: number): void => {
      for (const p of searchPalette(palette, q, limit)) {
        const Icon = p.icon
        out.push({ key: `p-${p.id}`, group: p.group, icon: <Icon size={15} />, label: p.label, hint: p.hint, run: p.run })
      }
    }
    if (!q) {
      fromPalette(8)
      return out
    }
    for (const a of local.apps)
      out.push({
        key: `app-${a.id}`,
        group: 'Applis',
        icon: a.icon ? <img src={a.icon} alt="" className="size-[18px]" /> : <AppWindow size={15} />,
        label: a.name,
        hint: 'Ouvrir',
        run: () => void window.compi.launchStartApp(a.id)
      })
    for (const f of files)
      out.push({
        key: `file-${f.path}`,
        group: 'Fichiers',
        icon: <FileText size={15} />,
        label: f.name,
        sub: `${folderOf(f.path)}${f.modified ? ` · ${timeAgo(Date.parse(f.modified))}` : ''}`,
        run: () => void window.compi.openConfidedFile(f.path)
      })
    for (const m of local.meetings)
      out.push({
        key: `meet-${m.id}`,
        group: 'Réunions',
        icon: <AudioLines size={15} />,
        label: m.title,
        sub: m.snippet ?? timeAgo(m.startedAt),
        run: () => openMeetingView(m.id)
      })
    for (const c of local.chats)
      out.push({
        key: `chat-${c.id}`,
        group: 'Discussions',
        icon: <MessageCircle size={15} />,
        label: c.title || 'Discussion sans titre',
        sub: c.snippet ?? timeAgo(c.updatedAt),
        run: () =>
          void s()
            .loadConversation(c.id)
            .then(() => s().setView('chat'))
      })
    fromPalette(5)
    for (const r of local.reminders)
      out.push({
        key: `rem-${r.id}`,
        group: 'Rappels',
        icon: <BellRing size={15} />,
        label: r.message,
        sub: TIME.format(new Date(r.dueAt)),
        run: () => scrollToBlock('reminders')
      })
    for (const t of local.tasks)
      out.push({ key: `task-${t.listId}-${t.id}`, group: 'Tâches', icon: <ListTodo size={15} />, label: t.title, sub: t.list, run: () => scrollToBlock('tasks') })
    for (const m of local.memory)
      out.push({ key: `mem-${m.id}`, group: 'Ce que je sais de toi', icon: <Brain size={15} />, label: m.fact, run: () => s().setView('memory') })
    for (const p of meaning)
      out.push({
        key: `sense-${p.file}-${p.page ?? 0}`,
        group: 'Par le sens',
        icon: <FileSearch size={15} />,
        label: p.file.split(/[\\/]/).pop() ?? p.file,
        sub: p.text,
        run: () => void window.compi.openConfidedFile(p.file)
      })
    out.push({
      key: 'ask',
      group: 'Demander',
      icon: <Sparkles size={15} />,
      label: `Demander à Compi : « ${q} »`,
      run: () => {
        s().setView('chat')
        void s().send(q)
      }
    })
    return out
  }, [query, local, files, meaning, palette])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (e: Entry | undefined): void => {
    if (!e) return
    close()
    e.run()
  }

  /** Premier résultat du groupe suivant (Tab) ou précédent (Maj+Tab). */
  const jumpGroup = (dir: 1 | -1): number => {
    const cur = entries[index]?.group
    if (dir === 1) {
      const i = entries.findIndex((e, k) => k > index && e.group !== cur)
      return i < 0 ? 0 : i
    }
    let k = index - 1
    while (k >= 0 && entries[k].group === cur) k--
    if (k < 0) k = entries.length - 1
    const g = entries[k]?.group
    while (k > 0 && entries[k - 1].group === g) k--
    return Math.max(0, k)
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Fermer la recherche, pas le plein écran.
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(entries.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Tab') {
      e.preventDefault()
      setIndex(jumpGroup(e.shiftKey ? -1 : 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(entries[index])
    }
  }

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-start justify-center bg-black/55 px-6 pt-[92px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      data-full-search
    >
      <motion.div
        className="flex max-h-[min(640px,78vh)] w-full max-w-[760px] flex-col overflow-hidden rounded-[22px] bg-ink-850 shadow-[0_30px_80px_-20px_black] ring-1 ring-inset ring-white/[0.1]"
        initial={{ y: -10, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.06] px-5">
          <Search size={18} className="shrink-0 text-[var(--led)]" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Une appli, un fichier, une réunion, une discussion, un réglage…"
            className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-fog-100 outline-none placeholder:text-fog-700"
            aria-label="Rechercher"
          />
          {busy && <LedDots />}
          <kbd className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] text-fog-500">Échap</kbd>
        </div>
        <div ref={list} className="scroll-y min-h-0 flex-1 p-2" role="listbox">
          {!query.trim() && (
            <div className="px-3 pt-2 pb-1 text-[12px] text-fog-500">
              Tape le nom d’une appli pour l’ouvrir, ou un mot pour retrouver un fichier de tes dossiers, une réunion ou une discussion. Tout est cherché sur ton PC.
            </div>
          )}
          {entries.map((r, i) => {
            const header = i === 0 || entries[i - 1].group !== r.group
            return (
              <div key={r.key}>
                {header && <div className="px-3 pt-2.5 pb-1 text-[10.5px] font-medium tracking-wide text-fog-700 uppercase">{r.group}</div>}
                <button
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => pick(r)}
                  className={cx(
                    'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors',
                    i === index ? 'bg-white/[0.07] text-fog-100 shadow-[inset_2px_0_0_var(--led)]' : 'text-fog-300'
                  )}
                >
                  <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.04]', i === index ? 'text-[var(--led)]' : 'text-fog-500')}>{r.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px]">{r.label}</span>
                    {r.sub && <span className="block truncate text-[11.5px] text-fog-500">{r.sub}</span>}
                  </span>
                  {r.hint && <span className="shrink-0 font-mono text-[10.5px] text-fog-700">{r.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-white/[0.06] px-5 py-2 text-[11px] text-fog-700">
          <span>↑ ↓ choisir</span>
          <span>Entrée ouvrir</span>
          <span>Tab groupe suivant</span>
          <span className="flex-1" />
          <span>Sur ton PC · dossiers confiés seulement</span>
        </div>
      </motion.div>
    </motion.div>
  )
}
