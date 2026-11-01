// Plein écran « Poste de pilotage » : la journée à gauche, la discussion au
// centre, ce qui t'attend à droite, et un dock en bas. Même fenêtre que
// l'encoche : Échap, le raccourci ou un passage à une autre appli la replient.
// Les blocs des colonnes se déplacent et se masquent (« Disposer ») ; « À toi »
// reste toujours en haut à droite.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  AArrowDown,
  AArrowUp,
  BellRing,
  CalendarDays,
  CloudSun,
  Folder,
  Hand,
  LayoutDashboard,
  Mail,
  Mic,
  Minimize2,
  RefreshCw,
  RotateCcw,
  Search,
  TerminalSquare,
  X
} from 'lucide-react'
import { DEFAULT_FULL, DEFAULT_FULL_BLOCKS } from '@shared/fullBlocks'
import { fullLayout } from '@shared/fullLayout'
import type { HeroContext } from '@shared/hero'
import { isPreparable, prepKey } from '@shared/meetingPrep'
import { missedCounts } from '@shared/missed'
import { ZOOM_STEPS } from '@shared/zoom'
import { gaugeLevel } from '@shared/perf'
import type { FullBlockId, FullSettings, TodayInfo } from '@shared/types'
import { useCompi } from '../store'
import { useMood } from '../mascot/useMood'
import { CompiTitle, PanelBody, PanelNav } from './Panel'
import { CallBanner } from './CallLive'
import { CallPanel } from './CallPanel'
import { PendingRequests } from './Cards'
import { Block, dayTitle, Empty, MessagesBlock, MissedBlock, ReminderRow, Timeline, TIME, TimerBlock, UnreadRows, useToday } from './Day'
import { BlockColumn, RecentsBlock, saveBlocks } from './FullBlocks'
import { FullSearch } from './FullSearch'
import { FullContext, type FullContextValue } from './fullContext'
import { GAUGE_COLOR, perfLevels } from './Gauges'
import { MediaPeek, useNow } from './Live'
import { TasksBlock } from './Tasks'
import { Button, IconButton, LedDots, Segmented, cx } from './ui'
import { useVoiceStage, VoiceStage } from './VoiceStage'
import { WeatherIcon, WeekAgenda } from './WeekAgenda'
import { RoutinesSection } from '../views/RoutinesSection'

const NO_FOLDERS: string[] = []

type Day = ReturnType<typeof useToday>

/** Réglages du plein écran ; seule la partie changée est remplacée. */
function saveFull(patch: Partial<FullSettings>): void {
  const s = useCompi.getState()
  if (!s.settings) return
  const full = { ...s.settings.full, ...patch }
  s.setSettings({ ...s.settings, full })
  void window.compi.updateSettings({ full }).then(s.setSettings)
}

/** La demande en cours (dernier message de l'utilisateur) et l'étape qui tourne. */
function CurrentTask() {
  const task = useCompi((s) => {
    if (!s.streamingId) return null
    for (let i = s.messages.length - 1; i >= 0; i--) if (s.messages[i].role === 'user') return s.messages[i].text
    return null
  })
  const step = useCompi((s) => s.messages.at(-1)?.tools?.find((t) => t.status === 'running')?.label ?? null)
  if (!task) return null
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="min-w-0 border-l border-white/[0.08] pl-4">
      <div className="flex items-center gap-2 text-[11px] text-fog-500">
        <LedDots /> En cours
      </div>
      <div className="truncate text-[12.5px] text-fog-100" title={task}>
        {task}
      </div>
      {step && <div className="truncate text-[11px] text-led-violet">› {step}</div>}
    </motion.div>
  )
}

function Clock() {
  const now = useNow(true, 15_000)
  return <span className="font-dot text-[17px] leading-none text-fog-100 tabular-nums">{TIME.format(new Date(now))}</span>
}

function TopBar({ eyes, arranging, onArrange }: { eyes: ReactNode; arranging: boolean; onArrange: () => void }) {
  const exitFull = useCompi((s) => s.exitFull)
  const collapse = useCompi((s) => s.collapse)
  const setPalette = useCompi((s) => s.setPalette)
  const talking = useVoiceStage()
  return (
    <header className="relative grid h-[78px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
      <div className="flex min-w-0 items-center gap-4">
        <CompiTitle />
        <div className="flex shrink-0 items-center rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]">
          <IconButton label="Me parler" active={talking} onClick={() => void useCompi.getState().startDictation()} disabled={talking}>
            <Mic size={15} />
          </IconButton>
          <IconButton label={arranging ? 'Terminer la disposition' : 'Disposer les blocs'} active={arranging} onClick={onArrange}>
            <LayoutDashboard size={15} />
          </IconButton>
        </div>
        <CurrentTask />
      </div>
      <div className="px-4">{eyes}</div>
      <div className="flex min-w-0 items-center justify-end gap-3">
        <button
          onClick={() => setPalette(true)}
          title="Chercher une appli, un fichier, une réunion… (Ctrl K)"
          className="flex shrink-0 items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-1.5 text-[12px] text-fog-500 ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.07] hover:text-fog-300"
          data-full-search-button
        >
          <Search size={13} /> <span className="hidden 2xl:inline">Chercher</span>
          <kbd className="hidden rounded-[5px] bg-black/30 px-1.5 py-px font-mono text-[10px] text-fog-500 2xl:inline">Ctrl K</kbd>
        </button>
        {/* Écran étroit : la barre tiendrait mal à côté des yeux ; Ctrl + / − règle toujours la taille. */}
        <div className="hidden 2xl:block">
          <ZoomControl />
        </div>
        <Clock />
        <PanelNav>
          <IconButton label="Revenir à l’encoche (Échap)" onClick={exitFull}>
            <Minimize2 size={15} />
          </IconButton>
          <IconButton label="Fermer" onClick={collapse}>
            <X size={16} />
          </IconButton>
        </PanelNav>
      </div>
    </header>
  )
}

/** Taille du texte du plein écran, réglable sur place (aussi Ctrl + molette, Ctrl + / −). */
function ZoomControl() {
  const pct = useCompi((s) => s.settings?.zoom.full ?? 100)
  const step = (dir: -1 | 0 | 1): void => void window.compi.zoomStep(dir)
  return (
    <div className="flex items-center rounded-xl bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]">
      <IconButton label="Texte plus petit (Ctrl −)" onClick={() => step(-1)} disabled={pct <= ZOOM_STEPS[0]} className="disabled:opacity-30">
        <AArrowDown size={15} />
      </IconButton>
      <button
        onClick={() => step(0)}
        title="Taille du texte : revenir à 100 % (Ctrl 0)"
        aria-label={`Taille du texte : ${pct} %. Revenir à 100 %`}
        className="w-11 text-center text-[11.5px] text-fog-500 tabular-nums transition-colors hover:text-fog-100"
      >
        {pct} %
      </button>
      <IconButton label="Texte plus grand (Ctrl +)" onClick={() => step(1)} disabled={pct >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} className="disabled:opacity-30">
        <AArrowUp size={15} />
      </IconButton>
    </div>
  )
}

/** En-tête de la colonne de gauche : le jour, la météo, Actualiser. */
function DayHeader({ day }: { day: Day }) {
  const weather = day.today?.weather
  return (
    <div className="flex items-end justify-between gap-3 px-0.5">
      <div className="min-w-0">
        <div className="led-text text-[11px] text-fog-500">Ta journée</div>
        <div className="mt-1 text-[19px] leading-tight font-semibold text-fog-100">{dayTitle(day.now)}</div>
        {weather && (
          <div className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-fog-300">
            {weather.code !== undefined ? <WeatherIcon code={weather.code} /> : <CloudSun size={14} className="shrink-0 text-[#FDBA74]" />}
            {weather.label} · {weather.min}–{weather.max} °C{weather.rain != null && weather.rain >= 20 ? ` · pluie ${weather.rain} %` : ''}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1">
        {day.loading && <LedDots color="#FDBA74" />}
        <IconButton label="Actualiser" onClick={() => void day.load()}>
          <RefreshCw size={14} />
        </IconButton>
      </div>
    </div>
  )
}

const AGENDA_VIEWS: Array<{ value: FullSettings['agenda']; label: string }> = [
  { value: 'day', label: 'Aujourd’hui' },
  { value: 'week', label: '7 jours' }
]

function AgendaBlock({ day, view }: { day: Day; view: FullSettings['agenda'] }) {
  const settings = useCompi((s) => s.settings)
  const setView = useCompi((s) => s.setView)
  const focusSettings = useCompi((s) => s.focusSettings)
  const { today, loading, now } = day
  const agenda = today?.agenda ?? Boolean(settings && (settings.google.calendar || settings.agenda.sources.some((x) => x.enabled)))
  // Les tâches des connecteurs vont dans le bloc Tâches : pas deux fois.
  const events = (today?.events ?? []).filter((e) => e.kind !== 'task')
  const toggle = (
    <div className="w-[170px]">
      <Segmented id="full-agenda" value={view} options={AGENDA_VIEWS} onChange={(agenda) => saveFull({ agenda })} />
    </div>
  )
  if (!agenda)
    return (
      <Block icon={<CalendarDays size={12} />} title="Agenda">
        <Empty>
          Aucun agenda choisi.{' '}
          <button
            className="text-fog-300 underline-offset-2 hover:underline"
            onClick={() => {
              focusSettings('agenda')
              setView('settings')
            }}
          >
            Ajouter une source
          </button>
        </Empty>
      </Block>
    )
  if (view === 'week')
    return (
      <Block icon={<CalendarDays size={12} />} title="Agenda" extra={toggle} bare>
        <WeekAgenda now={now} />
      </Block>
    )
  return (
    <Block icon={<CalendarDays size={12} />} title="Agenda" extra={toggle}>
      {events.length ? <Timeline events={events} now={now} /> : <Empty>{loading ? 'Chargement…' : 'Rien à l’agenda aujourd’hui.'}</Empty>}
    </Block>
  )
}

function MailBlock({ today }: { today: TodayInfo | null }) {
  const settings = useCompi((s) => s.settings)
  const google = today?.google ?? { email: settings?.google.email ?? '', calendar: false, mail: settings?.google.mail ?? false }
  if (!google.mail) return null
  return (
    <Block
      icon={<Mail size={12} />}
      title="E-mails non lus"
      extra={today?.unread ? <span className="text-[11px] text-fog-500">{today.unread.count > 99 ? '99+' : today.unread.count}</span> : undefined}
    >
      {today?.unread?.latest.length ? <UnreadRows today={today} email={google.email} /> : <Empty>{today ? 'Boîte de réception à jour.' : 'Chargement…'}</Empty>}
    </Block>
  )
}

/** Le contenu d'un bloc, où qu'il soit placé. */
function renderBlock(id: FullBlockId, day: Day, view: FullSettings['agenda']): ReactNode {
  switch (id) {
    case 'missed':
      return <MissedBlock />
    case 'agenda':
      return <AgendaBlock day={day} view={view} />
    case 'reminders':
      return (
        <Block icon={<BellRing size={12} />} title="Rappels">
          {day.reminders.length ? day.reminders.map((r) => <ReminderRow key={r.id} r={r} compact />) : <Empty>Aucun rappel.</Empty>}
        </Block>
      )
    case 'timer':
      return <TimerBlock />
    case 'mail':
      return <MailBlock today={day.today} />
    case 'call':
      return <CallPanel />
    case 'tasks':
      return <TasksBlock limit={8} extra={(day.today?.events ?? []).filter((e) => e.kind === 'task')} />
    case 'recents':
      return <RecentsBlock />
    case 'messages':
      return <MessagesBlock />
    case 'routines':
      return <RoutinesSection />
  }
}

/** « À toi » : ce qui attend une décision. Toujours en haut à droite, jamais masqué. */
function ForYou() {
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  return (
    <section className="space-y-2.5">
      <h3 className={cx('led-text flex items-center gap-1.5 px-0.5 text-[11px]', pending ? 'text-led-amber' : 'text-fog-500')}>
        <Hand size={12} /> À toi{pending ? ` · ${pending}` : ''}
      </h3>
      {pending ? (
        <PendingRequests />
      ) : (
        <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-5 text-center text-[12px] leading-snug text-fog-500">
          Rien ne t’attend.
          <br />
          Quand j’ai besoin de ton accord, la carte arrive ici, avec tout le détail.
        </div>
      )}
    </section>
  )
}

function ArrangeBar({ onDone, narrow }: { onDone: () => void; narrow: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mb-2 flex items-center gap-3 rounded-xl bg-[var(--led)]/[0.08] px-3.5 py-2 text-[12px] text-fog-300 ring-1 ring-inset ring-[var(--led)]/25"
      data-arrange-bar
    >
      <LayoutDashboard size={14} className="shrink-0 text-[var(--led)]" />
      <span className="min-w-0 flex-1">
        Glisse les blocs d’une place ou d’une colonne à l’autre, ou utilise les flèches. L’œil masque un bloc.
        {narrow ? ' Sur cet écran, la colonne de gauche reste dans l’onglet Aujourd’hui.' : ''}
      </span>
      <Button size="sm" variant="ghost" onClick={() => saveBlocks(DEFAULT_FULL_BLOCKS)}>
        <RotateCcw size={12} /> Par défaut
      </Button>
      <Button size="sm" variant="primary" onClick={onDone}>
        Terminé
      </Button>
    </motion.div>
  )
}

function DockItem({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('flex h-full shrink-0 items-center rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]', className)}>{children}</div>
}

/** Jauges de Ce PC, mesurées seulement tant que le plein écran est affiché. */
function DockGauges() {
  const perf = useCompi((s) => s.perf)
  useEffect(() => {
    void window.compi.perfWatch('full', true, 3000).then((p) => p && useCompi.getState().setPerf(p))
    return () => void window.compi.perfWatch('full', false)
  }, [])
  if (!perf) return null
  return (
    <DockItem className="gap-4 px-4">
      {perfLevels(perf).map((g) => {
        const color = GAUGE_COLOR[gaugeLevel(g.value)]
        return (
          <div key={g.key} className="w-[86px]" title={g.label}>
            <div className="flex items-baseline justify-between gap-1 text-[10.5px]">
              <span className="truncate text-fog-500">{g.short}</span>
              <span className="shrink-0 whitespace-nowrap text-fog-300 tabular-nums">{g.text.replace(' Go', '')}</span>
            </div>
            <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${Math.min(100, g.value * 100)}%`, background: color, boxShadow: `0 0 6px ${color}` }}
              />
            </div>
          </div>
        )
      })}
    </DockItem>
  )
}

function Dock() {
  const media = useCompi((s) => (s.settings?.showMusic && (s.media?.status === 'playing' || s.media?.status === 'paused') ? s.media : null))
  const folders = useCompi((s) => s.settings?.folders ?? NO_FOLDERS)
  const sessions = useCompi((s) => s.sessions)
  const setView = useCompi((s) => s.setView)
  const setActivityTab = useCompi((s) => s.setActivityTab)
  const live = sessions.filter((x) => x.status !== 'ended')
  const working = live.filter((x) => x.status === 'working').length
  const waiting = live.filter((x) => x.status === 'waiting').length
  return (
    <footer className="flex h-[66px] shrink-0 items-stretch gap-3 overflow-hidden px-5 pt-1 pb-3.5">
      {media && (
        <DockItem className="w-[330px]">
          <div className="h-full w-full">
            <MediaPeek media={media} />
          </div>
        </DockItem>
      )}
      {folders.length > 0 && (
        <DockItem className="min-w-0 shrink gap-1 overflow-hidden px-2">
          {folders.slice(0, 6).map((f) => (
            <button
              key={f}
              title={`Ouvrir ${f}`}
              onClick={() => void window.compi.openFolder(f)}
              className="flex min-w-0 items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-[12px] text-fog-300 transition-colors hover:bg-white/[0.06] hover:text-fog-100"
            >
              <Folder size={13} className="shrink-0 text-[var(--led)]" />
              <span className="max-w-[140px] truncate">{f.split(/[\\/]/).filter(Boolean).pop() ?? f}</span>
            </button>
          ))}
        </DockItem>
      )}
      <div className="flex-1" />
      {live.length > 0 && (
        <button
          onClick={() => {
            setActivityTab('claude')
            setView('activity')
          }}
          className="flex h-full shrink-0 items-center gap-2.5 rounded-2xl bg-ink-850/80 px-4 text-[12px] text-fog-300 ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-ink-800"
        >
          <TerminalSquare size={15} className="text-[#F59E7B]" />
          Claude Code
          {working > 0 && (
            <span className="flex items-center gap-1.5 text-led-violet">
              <LedDots color="#A78BFA" /> {working}
            </span>
          )}
          {waiting > 0 && <span className="text-led-amber">{waiting} en attente</span>}
          {!working && !waiting && <span className="text-fog-500">{live.length}</span>}
        </button>
      )}
      <DockGauges />
    </footer>
  )
}

/** Nombre d'éléments de « Ce que tu as manqué » (pour l'accueil). */
function useMissedCount(): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const count = (i: Parameters<typeof missedCounts>[0] | null): void => {
      if (!i) return setN(0)
      const c = missedCounts(i)
      setN(c.messages + c.mails + c.reminders)
    }
    void window.compi.missed().then(count)
    return window.compi.onMissed(count)
  }, [])
  return n
}

export function FullScreen({ eyes, width }: { eyes: ReactNode; width: number }) {
  const { color } = useMood()
  const layout = fullLayout(width)
  // La journée est lue une fois pour tout le plein écran, et relue toutes les 5 min.
  const day = useToday(5 * 60_000)
  const full = useCompi((s) => s.settings?.full) ?? DEFAULT_FULL
  const prepOn = useCompi((s) => s.settings?.day.meetingPrep === true)
  const unread = day.today?.unread?.count ?? 0
  const palette = useCompi((s) => s.palette)
  const talking = useVoiceStage()
  const missed = useMissedCount()
  const [arranging, setArranging] = useState(false)

  const hero = useMemo<HeroContext>(() => {
    const next = prepOn ? day.today?.events.find((e) => isPreparable(e) && new Date(e.start).getTime() > day.now) : undefined
    return {
      now: new Date(day.now),
      missed,
      unread,
      ...(next ? { nextMeeting: { title: next.title, start: new Date(next.start).getTime(), prepKey: prepKey(next) } } : {})
    }
  }, [day.today, day.now, prepOn, missed, unread])
  const ctx = useMemo<FullContextValue>(
    () => ({
      hero,
      showMissed: () => document.querySelector('[data-block="missed"]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      showWeek: () => saveFull({ agenda: 'week' })
    }),
    [hero]
  )

  // Appel affiché en grand dans un bloc visible : le bandeau rouge serait en double.
  const callBlock = full.blocks.find((b) => b.id === 'call')
  const callInBlock = Boolean(callBlock && !callBlock.hidden && (callBlock.col === 'right' || layout.left !== null))
  const render = (id: FullBlockId): ReactNode => renderBlock(id, day, full.agenda)

  return (
    <FullContext.Provider value={ctx}>
      <div className="relative flex h-full flex-col">
        {/* Halo de l'humeur derrière le robot, et la trame de points sous la barre du haut. Sur tout
            l'écran, un flou (filter) et un masque coûtaient ~360 Mo de mémoire graphique en 3440 × 1440 :
            ici un simple dégradé, et une trame limitée au bandeau du haut. */}
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[900px] -translate-x-1/2"
          style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${color} 16%, transparent), transparent)` }}
        />
        <div className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-[200px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

        <TopBar eyes={eyes} arranging={arranging} onArrange={() => setArranging(!arranging)} />
        {!callInBlock && <CallBanner />}
        {arranging && <ArrangeBar onDone={() => setArranging(false)} narrow={layout.left === null} />}

        <div className="relative flex min-h-0 flex-1 gap-4 px-5 pb-2">
          {layout.left !== null && (
            <aside className="scroll-y shrink-0 space-y-4 pr-1 pb-2" style={{ width: layout.left }}>
              <DayHeader day={day} />
              <BlockColumn col="left" blocks={full.blocks} arranging={arranging} render={render} />
              {day.today?.errors.map((e) => (
                <div key={e} className="px-1 text-[11.5px] text-led-amber">
                  {e}
                </div>
              ))}
            </aside>
          )}
          <main
            className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-ink-900/70 pt-3 ring-1 ring-inset ring-white/[0.06]"
            style={{ ['--chat-max' as string]: `${layout.center}px` }}
          >
            <PanelBody />
            <AnimatePresence>{talking && <VoiceStage key="voice" />}</AnimatePresence>
          </main>
          <aside className="scroll-y shrink-0 space-y-5 pr-1 pb-2" style={{ width: layout.right }}>
            <ForYou />
            <BlockColumn col="right" blocks={full.blocks} arranging={arranging} render={render} />
          </aside>
        </div>

        <Dock />
        <AnimatePresence>{palette && <FullSearch key="search" />}</AnimatePresence>
      </div>
    </FullContext.Provider>
  )
}
