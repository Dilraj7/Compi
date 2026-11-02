// Cartes visuelles du chat (Lot W) : la météo, l'agenda, les tâches, les rappels, les
// e-mails, les fichiers, la recherche web, les réunions et le minuteur lus par une étape
// s'affichent en carte, avec icônes et couleurs. Les données viennent de l'outil
// (jamais du modèle) et restent avec la discussion, sur le PC.

import { Fragment, useState } from 'react'
import {
  AudioLines,
  BellRing,
  CalendarDays,
  Droplets,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderSearch,
  Globe,
  Link2,
  ListTodo,
  Mail,
  MapPin,
  Presentation,
  Repeat,
  Search,
  Timer as TimerIcon,
  type LucideIcon
} from 'lucide-react'
import type {
  AgendaCardEvent,
  ChatCard,
  FileCardItem,
  MailCardItem,
  MeetingCardItem,
  ReminderCardItem,
  SourceCardItem,
  TaskCardItem,
  WeatherCardDay
} from '@shared/cards'
import { gmailWebUrl } from '@shared/day'
import { formatClock } from '@shared/media'
import { remainingMs, timerTitle } from '@shared/timer'
import { addDays, localDay } from '@shared/tasks'
import { weatherKind, weekDayLabel, type WeatherKind } from '@shared/week'
import type { TimerState, ToolActivity } from '@shared/types'
import { useCompi } from '../store'
import { openMeetingView } from '../lib/meetingNav'
import { Block, Empty, EventLine, TIME } from './Day'
import { TaskRow } from './Tasks'
import { WeatherIcon } from './WeekAgenda'
import { useNow } from './Live'
import { Button, cx, IconButton } from './ui'

const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

/** Teinte du fond de la carte météo, d'après le temps du premier jour. */
const WEATHER_TINT: Record<WeatherKind, string> = {
  sun: '253,186,116',
  partly: '253,230,138',
  cloud: '148,163,184',
  fog: '148,163,184',
  drizzle: '127,176,255',
  rain: '76,141,246',
  snow: '165,243,252',
  storm: '167,139,250'
}

/** Les cartes des étapes d'une réponse, dans leur ordre. */
export function ChatCards({ tools }: { tools: ToolActivity[] }) {
  const cards = tools.filter((t) => t.card)
  if (!cards.length) return null
  return (
    <div className="space-y-2" data-chat-cards>
      {cards.map((t) => (
        <ChatCardView key={t.id} card={t.card!} />
      ))}
    </div>
  )
}

function ChatCardView({ card }: { card: ChatCard }) {
  switch (card.kind) {
    case 'weather':
      return <WeatherCard place={card.place} days={card.days} />
    case 'agenda':
      return <AgendaCard from={card.from} days={card.days} events={card.events} more={card.more} />
    case 'tasks':
      return <TasksCard items={card.items} more={card.more} />
    case 'reminders':
      return <RemindersCard items={card.items} more={card.more} />
    case 'mails':
      return <MailsCard query={card.query} items={card.items} total={card.total} />
    case 'files':
      return <FilesCard card={card} />
    case 'web':
      return <WebCard query={card.query} sources={card.sources} />
    case 'meetings':
      return <MeetingsCard items={card.items} more={card.more} />
    case 'meeting':
      return <MeetingCard card={card} />
    case 'timer':
      return <TimerCard card={card} />
  }
}

const More = ({ n, what }: { n: number; what: string }) =>
  n > 0 ? (
    <div className="border-t border-white/[0.05] px-3.5 py-2 text-[11px] text-fog-500">
      et {n} {what} de plus
    </div>
  ) : null

// ─── Météo ───────────────────────────────────────────────────────────────────

function WeatherCard({ place, days }: { place: string; days: WeatherCardDay[] }) {
  const today = localDay(new Date())
  const [first, ...rest] = days
  const tint = WEATHER_TINT[weatherKind(first.code)]
  const low = Math.min(...days.map((d) => d.min))
  const high = Math.max(...days.map((d) => d.max))
  return (
    <section
      data-card="weather"
      className="overflow-hidden rounded-2xl ring-1 ring-white/[0.06] ring-inset"
      style={{ background: `radial-gradient(120% 140% at 0% 0%, rgba(${tint},0.20), rgba(${tint},0.04) 55%, transparent), var(--color-ink-850)` }}
    >
      <div className="flex items-center gap-4 px-4 pt-3.5 pb-3">
        <WeatherIcon code={first.code} size={44} tinted />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 truncate text-[11px] text-fog-500">
            <MapPin size={11} className="shrink-0" /> {place || 'Météo'} · {weekDayLabel(first.date, today)}
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[30px] leading-tight font-light text-fog-100 tabular-nums">{first.max}°</span>
            <span className="text-[15px] text-fog-500 tabular-nums">{first.min}°</span>
          </div>
          <div className="truncate text-[12.5px] text-fog-100">{first.label}</div>
        </div>
        {first.rain != null && <Rain value={first.rain} big />}
      </div>
      {first.hours?.length ? (
        <div className="grid grid-cols-4 gap-1.5 px-3 pb-3">
          {first.hours.map((h) => (
            <div key={h.hour} className="flex flex-col items-center gap-1 rounded-xl bg-white/[0.04] py-2">
              <span className="text-[10.5px] text-fog-500">{h.hour} h</span>
              <WeatherIcon code={h.code} size={18} tinted />
              <span className="text-[13px] text-fog-100 tabular-nums">{h.temp}°</span>
              {h.rain != null && <Rain value={h.rain} />}
            </div>
          ))}
        </div>
      ) : null}
      {rest.length > 0 && (
        <div className="border-t border-white/[0.06] px-1.5 py-1">
          {rest.map((d) => (
            <div key={d.date} className="flex items-center gap-3 px-2 py-1.5">
              <span className="w-[86px] shrink-0 truncate text-[12px] text-fog-100 first-letter:uppercase">{weekDayLabel(d.date, today)}</span>
              <WeatherIcon code={d.code} size={16} tinted />
              <span className="w-[38px] shrink-0">{d.rain != null && <Rain value={d.rain} />}</span>
              <span className="w-7 shrink-0 text-right text-[12px] text-fog-500 tabular-nums">{d.min}°</span>
              <TempBar min={d.min} max={d.max} low={low} high={high} />
              <span className="w-7 shrink-0 text-[12px] text-fog-100 tabular-nums">{d.max}°</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/** Probabilité de pluie : bleue dès qu'elle compte (40 %). */
function Rain({ value, big }: { value: number; big?: boolean }) {
  const wet = value >= 40
  return (
    <span className={`flex shrink-0 items-center gap-0.5 tabular-nums ${big ? 'text-[12.5px]' : 'text-[10.5px]'} ${wet ? 'text-[#7FB0FF]' : 'text-fog-700'}`}>
      <Droplets size={big ? 13 : 10} /> {value} %
    </span>
  )
}

/** Écart du jour sur l'échelle de toute la période (du plus froid au plus chaud). */
function TempBar({ min, max, low, high }: { min: number; max: number; low: number; high: number }) {
  const span = Math.max(1, high - low)
  return (
    <span className="relative h-1 min-w-10 flex-1 rounded-full bg-white/[0.08]">
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          left: `${((min - low) / span) * 100}%`,
          width: `${Math.max(6, ((max - min) / span) * 100)}%`,
          background: 'linear-gradient(90deg, #7FB0FF, #FDBA74)'
        }}
      />
    </span>
  )
}

// ─── Agenda ──────────────────────────────────────────────────────────────────

const eventDay = (e: AgendaCardEvent): string => (e.allDay ? e.start.slice(0, 10) : localDay(new Date(e.start)))

function AgendaCard({ from, days, events, more }: { from: string; days: number; events: AgendaCardEvent[]; more: number }) {
  const now = useNow(true, 30_000)
  const today = localDay(new Date(now))
  const title = days <= 1 ? `Agenda · ${weekDayLabel(from, today).toLowerCase()}` : `Agenda · ${days} jours`
  const groups = new Map<string, AgendaCardEvent[]>()
  for (const e of events) groups.set(eventDay(e), [...(groups.get(eventDay(e)) ?? []), e])
  const many = days > 1 || groups.size > 1
  return (
    <div data-card="agenda">
      <Block icon={<CalendarDays size={12} />} title={title}>
        {!events.length && (
          <Empty>{days <= 1 ? 'Rien de prévu ce jour-là.' : `Rien de prévu du ${dayShort(from)} au ${dayShort(addDays(from, days - 1))}.`}</Empty>
        )}
        {[...groups].map(([day, list]) => (
          <Fragment key={day}>
            {many && (
              <div className="bg-white/[0.03] px-3.5 py-1 text-[10.5px] font-medium tracking-wide text-fog-500 uppercase">{weekDayLabel(day, today)}</div>
            )}
            {list.map((e, i) => {
              const start = new Date(e.start).getTime()
              const end = new Date(e.end).getTime()
              const past = !e.allDay && end < now
              const live = !e.allDay && start <= now && now < end
              const soon = !e.allDay && start > now && start - now < 15 * 60_000
              return (
                <div key={i} className="[&+&]:border-t [&+&]:border-white/[0.05]">
                  <EventLine e={e} past={past} live={live} soon={soon} start={start} end={end} />
                </div>
              )
            })}
          </Fragment>
        ))}
        <More n={more} what="rendez-vous" />
      </Block>
    </div>
  )
}

const dayShort = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number)
  return SHORT_DAY.format(new Date(y, m - 1, d))
}

// ─── Tâches ──────────────────────────────────────────────────────────────────

function TasksCard({ items, more }: { items: TaskCardItem[]; more: number }) {
  // Cocher ici est ton propre clic (comme dans Aujourd'hui) : la carte garde l'état affiché.
  const [list, setList] = useState(items)
  const [error, setError] = useState('')
  const today = localDay(new Date())
  const showList = new Set(list.map((t) => t.list)).size > 1
  return (
    <div data-card="tasks">
      <Block icon={<ListTodo size={12} />} title="Tâches">
        {list.map((t) => (
          <TaskRow
            key={`${t.listId}/${t.id}`}
            t={t}
            today={today}
            showList={showList}
            onChange={(next, err) => {
              setList((all) => all.map((x) => (x.id === next.id && x.listId === next.listId ? next : x)))
              setError(err ?? '')
            }}
          />
        ))}
        <More n={more} what={more > 1 ? 'tâches' : 'tâche'} />
        {error && <div className="border-t border-white/[0.05] px-3.5 py-2 text-[11px] text-led-red">{error}</div>}
      </Block>
    </div>
  )
}

// ─── Rappels ─────────────────────────────────────────────────────────────────

function RemindersCard({ items, more }: { items: ReminderCardItem[]; more: number }) {
  const now = useNow(true, 30_000)
  return (
    <div data-card="reminders">
      <Block icon={<BellRing size={12} />} title="Rappels">
        {items.map((r, i) => {
          const due = new Date(r.dueAt)
          const sameDay = due.toDateString() === new Date(now).toDateString()
          return (
            <div key={i} className={`flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05] ${r.dueAt < now ? 'opacity-45' : ''}`}>
              <div className="w-[52px] shrink-0 text-right text-[12px] text-fog-100 tabular-nums">{sameDay ? TIME.format(due) : SHORT_DAY.format(due)}</div>
              <span className="h-8 w-[3px] shrink-0 rounded-full bg-led-amber/60" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-fog-100">{r.message}</div>
                {(r.repeat || !sameDay) && (
                  <div className="flex items-center gap-1 truncate text-[11px] text-fog-500">
                    {r.repeat ? (
                      <>
                        <Repeat size={10} /> {r.repeat}
                      </>
                    ) : (
                      TIME.format(due)
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <More n={more} what={more > 1 ? 'rappels' : 'rappel'} />
      </Block>
    </div>
  )
}

// ─── E-mails ─────────────────────────────────────────────────────────────────

const MAIL_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

function MailsCard({ query, items, total }: { query: string; items: MailCardItem[]; total: number }) {
  const email = useCompi((s) => s.settings?.google.email ?? '')
  const today = new Date().toDateString()
  return (
    <div data-card="mails">
      <Block
        icon={<Mail size={12} />}
        title={query ? `E-mails · ${query}` : 'E-mails'}
        extra={
          total > items.length ? (
            <span className="text-[10.5px] text-fog-700">
              {items.length} sur ~{total}
            </span>
          ) : undefined
        }
      >
        {items.map((m) => {
          const d = m.date ? new Date(m.date) : null
          return (
            <button
              key={m.id}
              title="Ouvrir dans Gmail"
              onClick={() => void window.compi.openExternal(gmailWebUrl(email, { messageId: m.id }))}
              className="flex w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] [&+&]:border-t [&+&]:border-white/[0.05]"
            >
              <span className={cx('mt-[5px] size-1.5 shrink-0 rounded-full', m.important ? 'bg-led-amber' : m.unread ? 'bg-[#4C8DF6]' : 'bg-white/[0.12]')} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={cx('min-w-0 flex-1 truncate text-[12.5px]', m.unread ? 'font-medium text-fog-100' : 'text-fog-300')}>{m.from}</span>
                  {d && (
                    <span className="shrink-0 text-[10.5px] text-fog-700 tabular-nums">
                      {d.toDateString() === today ? TIME.format(d) : MAIL_DATE.format(d)}
                    </span>
                  )}
                </span>
                <span className={cx('block truncate text-[12px]', m.unread ? 'text-fog-100' : 'text-fog-500')}>{m.subject}</span>
                {m.snippet && <span className="block truncate text-[11px] text-fog-700">{m.snippet}</span>}
              </span>
            </button>
          )
        })}
      </Block>
    </div>
  )
}

// ─── Fichiers et dossiers ────────────────────────────────────────────────────

const FILE_TYPES: Array<{ ext: RegExp; icon: LucideIcon; color: string }> = [
  { ext: /\.(pdf)$/i, icon: FileText, color: '#F87171' },
  { ext: /\.(docx?|odt|rtf|txt|md)$/i, icon: FileText, color: '#7FB0FF' },
  { ext: /\.(xlsx?|ods|csv)$/i, icon: FileSpreadsheet, color: '#4ADE80' },
  { ext: /\.(pptx?|odp|key)$/i, icon: Presentation, color: '#FDBA74' },
  { ext: /\.(png|jpe?g|gif|webp|bmp|svg|heic|tiff?)$/i, icon: FileImage, color: '#C4B5FD' },
  { ext: /\.(mp4|mov|mkv|avi|webm)$/i, icon: FileVideo, color: '#F472B6' },
  { ext: /\.(mp3|wav|flac|m4a|ogg)$/i, icon: FileAudio, color: '#38E1FF' },
  { ext: /\.(zip|rar|7z|tar|gz)$/i, icon: FileArchive, color: '#FDE68A' },
  { ext: /\.(js|ts|tsx|py|json|html|css|ps1|bat|cmd|sh)$/i, icon: FileCode, color: '#A5F3FC' }
]

function fileLook(f: FileCardItem): { icon: LucideIcon; color: string } {
  if (f.kind === 'folder') return { icon: Folder, color: '#FDBA74' }
  if (f.kind === 'shortcut' || f.kind === 'weblink') return { icon: Link2, color: '#94A3B8' }
  return FILE_TYPES.find((t) => t.ext.test(f.name)) ?? { icon: File, color: '#94A3B8' }
}

const sizeText = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} Go` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`
const baseName = (p: string): string =>
  p
    .replace(/[\\/]+$/, '')
    .split(/[\\/]/)
    .pop() || p
const parentOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')

function FilesCard({ card }: { card: Extract<ChatCard, { kind: 'files' }> }) {
  const [note, setNote] = useState('')
  const open = async (path: string): Promise<void> => {
    const r = await window.compi.openConfidedFile(path)
    if (r === 'shown') setNote('C’est un programme : montré dans l’Explorateur, pas lancé.')
    else if (r === 'refused')
      setNote(
        (await window.compi.revealFile(path))
          ? 'Hors de tes dossiers confiés : montré dans l’Explorateur.'
          : 'Introuvable : le fichier a peut-être été déplacé.'
      )
    else setNote('')
  }
  const reveal = async (path: string): Promise<void> =>
    setNote((await window.compi.revealFile(path)) ? '' : 'Introuvable : le fichier a peut-être été déplacé.')
  const title = card.path ? `Dossier · ${baseName(card.path)}` : card.query ? `Fichiers · ${card.query}` : 'Fichiers'
  return (
    <div data-card="files">
      <Block
        icon={card.path ? <FolderOpen size={12} /> : <Search size={12} />}
        title={title}
        extra={
          card.path ? (
            <Button size="sm" variant="ghost" onClick={() => void open(card.path!)}>
              <FolderOpen size={12} /> Ouvrir
            </Button>
          ) : undefined
        }
      >
        {!card.items.length && <Empty>Ce dossier est vide.</Empty>}
        {card.items.map((f) => {
          const { icon: Icon, color } = fileLook(f)
          const sub = [
            f.size != null ? sizeText(f.size) : '',
            f.modified ? MAIL_DATE.format(new Date(f.modified)) : '',
            card.path ? '' : parentOf(f.path)
          ].filter(Boolean)
          return (
            <div key={f.path} className="group flex items-center gap-3 px-3.5 py-2 [&+&]:border-t [&+&]:border-white/[0.05]" data-file>
              <span className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: `${color}1f` }}>
                <Icon size={14} color={color} />
              </span>
              <button className="min-w-0 flex-1 text-left" title={f.path} onClick={() => void open(f.path)}>
                <span className="block truncate text-[12.5px] text-fog-100 group-hover:underline">{f.name}</span>
                {sub.length > 0 && <span className="block truncate text-[11px] text-fog-700">{sub.join(' · ')}</span>}
              </button>
              <IconButton label="Montrer dans l’Explorateur" onClick={() => void reveal(f.path)}>
                <FolderSearch size={13} />
              </IconButton>
            </div>
          )
        })}
        <More n={card.more} what={card.more > 1 ? 'éléments' : 'élément'} />
        {note && <div className="border-t border-white/[0.05] px-3.5 py-2 text-[11px] text-led-amber">{note}</div>}
      </Block>
    </div>
  )
}

// ─── Recherche web ───────────────────────────────────────────────────────────

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
/** Une couleur stable par site, pour la pastille (aucun logo chargé depuis Internet). */
const hueOf = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

function WebCard({ query, sources }: { query: string; sources: SourceCardItem[] }) {
  return (
    <div data-card="web">
      <Block icon={<Globe size={12} />} title={query ? `Recherche web · ${query}` : 'Recherche web'}>
        {sources.map((s) => {
          const host = hostOf(s.url)
          const hue = hueOf(host)
          return (
            <button
              key={s.url}
              title={s.url}
              onClick={() => void window.compi.openExternal(s.url)}
              className="group flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors hover:bg-white/[0.03] [&+&]:border-t [&+&]:border-white/[0.05]"
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-lg text-[12px] font-semibold uppercase"
                style={{ background: `hsl(${hue} 70% 60% / 0.16)`, color: `hsl(${hue} 80% 72%)` }}
              >
                {host.charAt(0)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-fog-100 group-hover:underline">{s.title}</span>
                <span className="block truncate text-[11px] text-fog-700">{host}</span>
              </span>
              <ExternalLink size={12} className="shrink-0 text-fog-700 opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          )
        })}
      </Block>
    </div>
  )
}

// ─── Réunions ────────────────────────────────────────────────────────────────

const MEETING_DATE = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const lengthText = (ms: number): string => {
  const min = Math.max(1, Math.round(ms / 60_000))
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

function MeetingsCard({ items, more }: { items: MeetingCardItem[]; more: number }) {
  return (
    <div data-card="meetings">
      <Block icon={<AudioLines size={12} />} title="Réunions enregistrées">
        {items.map((m) => (
          <button
            key={m.id}
            onClick={() => openMeetingView(m.id)}
            className="group flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] [&+&]:border-t [&+&]:border-white/[0.05]"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#A78BFA]/[0.14]">
              <AudioLines size={14} className="text-[#C4B5FD]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-fog-100 group-hover:underline">{m.title}</span>
              <span className="block truncate text-[11px] text-fog-700">
                {MEETING_DATE.format(new Date(m.startedAt))} · {lengthText(m.durationMs)}
              </span>
            </span>
            {m.hasSummary && <span className="shrink-0 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-fog-500">résumé</span>}
          </button>
        ))}
        <More n={more} what={more > 1 ? 'réunions' : 'réunion'} />
      </Block>
    </div>
  )
}

function MeetingCard({ card }: { card: Extract<ChatCard, { kind: 'meeting' }> }) {
  const m = card.meeting
  return (
    <section data-card="meeting" className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-white/[0.06] ring-inset">
      <div className="flex items-start gap-3 px-3.5 pt-3 pb-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[#A78BFA]/[0.14]">
          <AudioLines size={16} className="text-[#C4B5FD]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-fog-100">{m.title}</div>
          <div className="text-[11px] text-fog-700">
            {MEETING_DATE.format(new Date(m.startedAt))} · {lengthText(m.durationMs)}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => openMeetingView(m.id)}>
          Ouvrir
        </Button>
      </div>
      {card.summary ? (
        <p className="px-3.5 pb-2 text-[12px] leading-relaxed text-fog-300">{card.summary}</p>
      ) : (
        <p className="px-3.5 pb-2.5 text-[11.5px] text-fog-700">Pas encore de résumé : la transcription est sur la fiche.</p>
      )}
      {card.points.length > 0 && (
        <ul className="space-y-1 border-t border-white/[0.05] px-3.5 py-2">
          {card.points.map((p, i) => (
            <li key={i} className="flex gap-2 text-[12px] text-fog-100">
              <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[#C4B5FD]" />
              <span className="min-w-0">{p}</span>
            </li>
          ))}
        </ul>
      )}
      {card.tasks.length > 0 && (
        <div className="border-t border-white/[0.05] px-3.5 py-2">
          <div className="mb-1 text-[10.5px] font-medium tracking-wide text-fog-700 uppercase">À faire</div>
          {card.tasks.map((t, i) => (
            <div key={i} className="flex items-start gap-2 py-0.5 text-[12px]">
              <ListTodo size={12} className="mt-[3px] shrink-0 text-[#7FB0FF]" />
              <span className="min-w-0 text-fog-100">
                {t.text}
                {(t.owner || t.due) && <span className="text-fog-700"> · {[t.owner, t.due].filter(Boolean).join(' · ')}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ─── Minuteur ────────────────────────────────────────────────────────────────

/** Le minuteur de l'îlot est-il celui de la carte ? (même type, même réglage) */
function sameTimer(a: TimerState, b: TimerState): boolean {
  if (a.kind !== b.kind || a.label !== b.label) return false
  if (a.kind === 'timer') return a.durationMs === b.durationMs
  const p = a.pomodoro
  const q = b.pomodoro
  return Boolean(p && q && p.focusMin === q.focusMin && p.breakMin === q.breakMin && p.rounds === q.rounds)
}

function TimerCard({ card }: { card: Extract<ChatCard, { kind: 'timer' }> }) {
  const live = useCompi((s) => s.timer)
  const current = live && sameTimer(live, card.timer) ? live : null
  const now = useNow(Boolean(current), 1000)
  const t = current ?? card.timer
  const left = current ? remainingMs(current, now) : 0
  const share = current && t.durationMs > 0 ? Math.min(1, left / t.durationMs) : 0
  const pomodoro = t.kind === 'pomodoro' && t.pomodoro
  const color = pomodoro && t.pomodoro!.phase === 'break' ? '#4ADE80' : '#F472B6'
  return (
    <section data-card="timer" className="flex items-center gap-4 overflow-hidden rounded-2xl bg-ink-850/80 px-4 py-3 ring-1 ring-white/[0.06] ring-inset">
      <svg viewBox="0 0 36 36" className="size-11 shrink-0 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
        {current && (
          <circle cx="18" cy="18" r="15.5" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${share * 97.4} 97.4`} />
        )}
      </svg>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] text-fog-500">{timerTitle(t)}</div>
        {current ? (
          <div className="text-[24px] leading-tight font-light text-fog-100 tabular-nums">
            {formatClock(left)}
            {current.endsAt === undefined && <span className="ml-2 text-[11px] text-led-amber">en pause</span>}
          </div>
        ) : (
          <div className="text-[13px] text-fog-500">Plus en cours</div>
        )}
      </div>
      <TimerIcon size={16} className="shrink-0" color={color} />
    </section>
  )
}
