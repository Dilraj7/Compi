// Palette Ctrl+K : chercher une discussion, une vue, un réglage ou une action,
// sans tenir compte des accents. ↑ ↓ pour choisir, Entrée pour ouvrir, Échap pour fermer.

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'motion/react'
import {
  Activity,
  BellOff,
  Brain,
  CalendarDays,
  Gauge,
  History,
  Keyboard,
  MessageCircle,
  MessagesSquare,
  Mic,
  MonitorCog,
  Plug,
  Settings2,
  ShieldCheck,
  SquarePen,
  Sun,
  Timer,
  Volume2,
  Zap,
  type LucideIcon
} from 'lucide-react'
import { searchPalette, type PaletteEntry } from '@shared/palette'
import type { ConversationMeta, PanelView } from '@shared/types'
import { TAB_ORDER, useCompi, type SettingsFocus } from '../store'
import { cx } from './ui'

interface Item extends PaletteEntry {
  icon: LucideIcon
  hint?: string
  run: () => void
}

const VIEW_META: Record<PanelView, { label: string; icon: LucideIcon; keywords?: string }> = {
  chat: { label: 'Discussion', icon: MessageCircle },
  today: { label: 'Aujourd’hui', icon: Sun, keywords: 'agenda rappels meteo journee' },
  activity: { label: 'Activité', icon: Activity, keywords: 'claude code utilisation journal autorisations' },
  history: { label: 'Historique', icon: History, keywords: 'anciennes discussions' },
  memory: { label: 'Ce que je sais de toi', icon: Brain, keywords: 'memoire souvenirs presse papier' },
  connectors: { label: 'Extensions', icon: Plug, keywords: 'dossiers connecteurs competences' },
  settings: { label: 'Réglages', icon: Settings2, keywords: 'parametres options' },
  quick: { label: 'Actions rapides', icon: Zap }
}

const SETTINGS: Array<{ focus: SettingsFocus; label: string; icon: LucideIcon; keywords: string }> = [
  { focus: 'brain', label: 'Cerveau', icon: Brain, keywords: 'modele local ollama claude cle api garder pret' },
  { focus: 'quiz', label: 'Aide-moi à choisir un cerveau', icon: Brain, keywords: 'questionnaire modele conseil' },
  { focus: 'voice', label: 'Dictée', icon: Mic, keywords: 'micro voix whisper parler' },
  { focus: 'island', label: 'Moniteur du PC dans l’îlot', icon: MonitorCog, keywords: 'ilot jauges processeur memoire carte graphique' },
  { focus: 'sounds', label: 'Sons', icon: Volume2, keywords: 'bip volume heures calmes notification' },
  { focus: 'keys', label: 'Raccourcis des autorisations', icon: Keyboard, keywords: 'clavier autoriser refuser alt maj' },
  { focus: 'agenda', label: 'Sources de l’agenda', icon: CalendarDays, keywords: 'calendrier google ics outlook icloud connecteur rendez-vous' },
  { focus: 'messages', label: 'Messages en attente', icon: MessagesSquare, keywords: 'whatsapp sms telephone notifications' },
  { focus: 'privacy', label: 'Confidentialité', icon: ShieldCheck, keywords: 'toujours jamais envoyer donnees' }
]

function useItems(conversations: ConversationMeta[]): Item[] {
  const settings = useCompi((s) => s.settings)
  return useMemo(() => {
    const s = (): ReturnType<typeof useCompi.getState> => useCompi.getState()
    const go = (view: PanelView): void => s().setView(view)
    const items: Item[] = [
      {
        id: 'new-chat',
        group: 'Actions',
        label: 'Nouvelle discussion',
        icon: SquarePen,
        hint: 'Ctrl+N',
        run: () => {
          s().newConversation()
          s().open('chat', { focus: true })
          setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus(), 80)
        }
      },
      {
        id: 'timer',
        group: 'Actions',
        label: 'Minuteur 25 min',
        icon: Timer,
        keywords: 'chrono compte a rebours',
        run: () => void window.compi.startTimer(25)
      },
      { id: 'pomodoro', group: 'Actions', label: 'Pomodoro', icon: Timer, keywords: 'concentration focus pause', run: () => void window.compi.startPomodoro() },
      {
        id: 'perf',
        group: 'Actions',
        label: 'Voir Ce PC',
        icon: Gauge,
        keywords: 'performances processeur memoire ram vram carte graphique lent',
        run: () => {
          s().focusActivity('perf')
          go('activity')
        }
      },
      {
        id: 'unload',
        group: 'Actions',
        label: 'Libérer la mémoire vidéo',
        icon: Zap,
        keywords: 'decharger modele local vram',
        run: () => {
          void window.compi.perfUnload('all').then((p) => p && s().setPerf(p))
          s().focusActivity('perf')
          go('activity')
        }
      }
    ]
    if (settings) {
      items.push(
        {
          id: 'sounds',
          group: 'Actions',
          label: settings.sounds.enabled ? 'Couper les sons' : 'Réactiver les sons',
          icon: settings.sounds.enabled ? BellOff : Volume2,
          keywords: 'muet silence bip',
          run: () => void window.compi.updateSettings({ sounds: { ...settings.sounds, enabled: !settings.sounds.enabled } }).then(s().setSettings)
        },
        {
          id: 'monitor',
          group: 'Actions',
          label: settings.monitor.island ? 'Masquer le moniteur de l’îlot' : 'Afficher le moniteur dans l’îlot',
          icon: MonitorCog,
          keywords: 'jauges processeur memoire',
          run: () => void window.compi.updateSettings({ monitor: { island: !settings.monitor.island } }).then(s().setSettings)
        }
      )
    }
    TAB_ORDER.forEach((v, i) => {
      const m = VIEW_META[v]
      items.push({ id: `view-${v}`, group: 'Vues', label: m.label, icon: m.icon, keywords: m.keywords, hint: `Ctrl+${i + 1}`, run: () => go(v) })
    })
    for (const x of SETTINGS) {
      items.push({
        id: `settings-${x.focus}`,
        group: 'Réglages',
        label: x.label,
        icon: x.icon,
        keywords: `reglages ${x.keywords}`,
        run: () => {
          s().focusSettings(x.focus)
          go('settings')
        }
      })
    }
    for (const c of conversations) {
      items.push({
        id: `conv-${c.id}`,
        group: 'Discussions',
        label: c.title || 'Discussion sans titre',
        icon: MessageCircle,
        run: () =>
          void s()
            .loadConversation(c.id)
            .then(() => s().open('chat', { focus: true }))
      })
    }
    return items
  }, [settings, conversations])
}

export function CommandPalette() {
  const close = (): void => useCompi.getState().setPalette(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [conversations, setConversations] = useState<ConversationMeta[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const items = useItems(conversations)
  const results = useMemo(() => searchPalette(items, query), [items, query])

  useEffect(() => {
    void window.compi.listConversations().then((list) => setConversations([...list].sort((a, b) => b.updatedAt - a.updatedAt)))
    setTimeout(() => input.current?.focus(), 30)
  }, [])

  useEffect(() => setIndex(0), [query])

  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const pick = (item: Item | undefined): void => {
    if (!item) return
    close()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      // Fermer la palette, pas le panneau.
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(results.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(results[index])
    }
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex items-start justify-center bg-black/55 px-6 pt-3 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <motion.div
        className="flex max-h-[340px] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-ink-850 shadow-[0_24px_60px_-20px_black] ring-1 ring-inset ring-white/[0.09]"
        initial={{ y: -8, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 36 }}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-3.5">
          <span className="led-text text-[10.5px] text-[var(--led)]">Ctrl K</span>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Chercher une discussion, un réglage, une action…"
            className="h-11 min-w-0 flex-1 bg-transparent text-[13.5px] text-fog-100 outline-none placeholder:text-fog-700"
            aria-label="Rechercher"
          />
          <kbd className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-fog-500">Échap</kbd>
        </div>
        <div ref={list} className="scroll-y min-h-0 flex-1 p-1.5" role="listbox">
          {results.length === 0 && <div className="px-3 py-6 text-center text-[12px] text-fog-500">Rien trouvé pour « {query} ».</div>}
          {results.map((r, i) => {
            const Icon = r.icon
            // Sans recherche : par groupe ; avec une recherche, le classement prime et le groupe s'affiche à droite.
            const header = !query.trim() && (i === 0 || results[i - 1].group !== r.group)
            return (
              <div key={r.id}>
                {header && <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-medium tracking-wide text-fog-700 uppercase">{r.group}</div>}
                <button
                  data-index={i}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => i !== index && setIndex(i)}
                  onClick={() => pick(r)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-[12.5px] transition-colors',
                    i === index ? 'bg-white/[0.07] text-fog-100 shadow-[inset_2px_0_0_var(--led)]' : 'text-fog-300'
                  )}
                >
                  <Icon size={14} className={i === index ? 'text-[var(--led)]' : 'text-fog-500'} />
                  <span className="min-w-0 flex-1 truncate">{r.label}</span>
                  {query.trim() && <span className="shrink-0 text-[10.5px] text-fog-700">{r.group}</span>}
                  {r.hint && <span className="shrink-0 font-mono text-[10.5px] text-fog-700">{r.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
