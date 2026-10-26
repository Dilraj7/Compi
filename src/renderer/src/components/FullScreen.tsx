// Plein écran « Poste de pilotage » : la journée à gauche, la discussion au
// centre, ce qui t'attend à droite, et un dock en bas. Même fenêtre que
// l'encoche : Échap, le raccourci ou un passage à une autre appli la replient.

import { useEffect, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { BellRing, CalendarDays, CloudSun, Folder, Hand, Mail, Minimize2, RefreshCw, Search, TerminalSquare, X } from 'lucide-react'
import { fullLayout } from '@shared/fullLayout'
import { gaugeLevel } from '@shared/perf'
import { useCompi } from '../store'
import { useMood } from '../mascot/useMood'
import { CompiTitle, PanelBody, PanelNav } from './Panel'
import { CallBanner } from './CallLive'
import { PendingRequests } from './Cards'
import { Block, dayTitle, Empty, MessagesBlock, ReminderRow, Timeline, TIME, TimerBlock, UnreadRows, useToday } from './Day'
import { GAUGE_COLOR, perfLevels } from './Gauges'
import { MediaPeek, useNow } from './Live'
import { IconButton, LedDots, cx } from './ui'
import { RoutinesSection } from '../views/RoutinesSection'

const NO_FOLDERS: string[] = []

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

function TopBar({ eyes }: { eyes: ReactNode }) {
  const exitFull = useCompi((s) => s.exitFull)
  const collapse = useCompi((s) => s.collapse)
  const setPalette = useCompi((s) => s.setPalette)
  return (
    <header className="relative grid h-[78px] shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-4 px-6">
      <div className="flex min-w-0 items-center gap-4">
        <CompiTitle />
        <CurrentTask />
      </div>
      <div className="px-4">{eyes}</div>
      <div className="flex min-w-0 items-center justify-end gap-3">
        <button
          onClick={() => setPalette(true)}
          className="hidden items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-1.5 text-[12px] text-fog-500 ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.07] hover:text-fog-300 xl:flex"
        >
          <Search size={13} /> Chercher
          <kbd className="rounded-[5px] bg-black/30 px-1.5 py-px font-mono text-[10px] text-fog-500">Ctrl K</kbd>
        </button>
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

/** Colonne de gauche : la journée (même contenu que l'onglet Aujourd'hui, en frise). */
function DayColumn() {
  const settings = useCompi((s) => s.settings)
  const setView = useCompi((s) => s.setView)
  const focusSettings = useCompi((s) => s.focusSettings)
  const { today, reminders, loading, now, load } = useToday()
  const google = today?.google ?? { email: settings?.google.email ?? '', calendar: false, mail: settings?.google.mail ?? false }
  const agenda = today?.agenda ?? Boolean(settings && (settings.google.calendar || settings.agenda.sources.some((x) => x.enabled)))
  const weather = today?.weather
  const agendaSettings = (): void => {
    focusSettings('agenda')
    setView('settings')
  }
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <div className="led-text text-[11px] text-fog-500">Ta journée</div>
          <div className="mt-1 text-[19px] leading-tight font-semibold text-fog-100">{dayTitle(now)}</div>
          {weather && (
            <div className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-fog-300">
              <CloudSun size={14} className="shrink-0 text-[#FDBA74]" />
              {weather.label} · {weather.min}–{weather.max} °C{weather.rain != null && weather.rain >= 20 ? ` · pluie ${weather.rain} %` : ''}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {loading && <LedDots color="#FDBA74" />}
          <IconButton label="Actualiser" onClick={() => void load()}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
      </div>

      <Block icon={<CalendarDays size={12} />} title="Agenda">
        {!agenda ? (
          <Empty>
            Aucun agenda choisi.{' '}
            <button className="text-fog-300 underline-offset-2 hover:underline" onClick={agendaSettings}>
              Ajouter une source
            </button>
          </Empty>
        ) : today?.events.length ? (
          <Timeline events={today.events} now={now} />
        ) : (
          <Empty>{loading ? 'Chargement…' : 'Rien à l’agenda aujourd’hui.'}</Empty>
        )}
      </Block>

      <Block icon={<BellRing size={12} />} title="Rappels">
        {reminders.length ? reminders.map((r) => <ReminderRow key={r.id} r={r} compact />) : <Empty>Aucun rappel.</Empty>}
      </Block>

      <TimerBlock />

      {google.mail && (
        <Block
          icon={<Mail size={12} />}
          title="E-mails non lus"
          extra={today?.unread ? <span className="text-[11px] text-fog-500">{today.unread.count > 99 ? '99+' : today.unread.count}</span> : undefined}
        >
          {today?.unread?.latest.length ? (
            <UnreadRows today={today} email={google.email} />
          ) : (
            <Empty>{loading ? 'Chargement…' : 'Boîte de réception à jour.'}</Empty>
          )}
        </Block>
      )}

      {today?.errors.map((e) => (
        <div key={e} className="px-1 text-[11.5px] text-led-amber">
          {e}
        </div>
      ))}
    </div>
  )
}

/** Colonne de droite : ce qui attend une décision, puis messages et routines. */
function ForYouColumn() {
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  return (
    <div className="space-y-5">
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
      <MessagesBlock />
      <RoutinesSection />
    </div>
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
              <span className="text-fog-300 tabular-nums">{g.text.replace(' Go', '')}</span>
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

export function FullScreen({ eyes, width }: { eyes: ReactNode; width: number }) {
  const { color } = useMood()
  const layout = fullLayout(width)
  return (
    <div className="relative flex h-full flex-col">
      {/* Halo de l'humeur derrière le robot, et la trame de points sous la barre du haut. Sur tout
          l'écran, un flou (filter) et un masque coûtaient ~360 Mo de mémoire graphique en 3440 × 1440 :
          ici un simple dégradé, et une trame limitée au bandeau du haut. */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[900px] -translate-x-1/2"
        style={{ background: `radial-gradient(closest-side, color-mix(in oklab, ${color} 16%, transparent), transparent)` }}
      />
      <div className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-[200px] [mask-image:linear-gradient(to_bottom,black,transparent)]" />

      <TopBar eyes={eyes} />
      <CallBanner />

      <div className="relative flex min-h-0 flex-1 gap-4 px-5 pb-2">
        {layout.left !== null && (
          <aside className="scroll-y shrink-0 pr-1 pb-2" style={{ width: layout.left }}>
            <DayColumn />
          </aside>
        )}
        <main
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[24px] bg-ink-900/70 pt-3 ring-1 ring-inset ring-white/[0.06]"
          style={{ ['--chat-max' as string]: `${layout.center}px` }}
        >
          <PanelBody />
        </main>
        <aside className="scroll-y shrink-0 pr-1 pb-2" style={{ width: layout.right }}>
          <ForYouColumn />
        </aside>
      </div>

      <Dock />
    </div>
  )
}
