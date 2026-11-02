// Cartes visuelles du chat (Lot W) : la météo, l'agenda, les tâches et les rappels lus par
// une étape s'affichent en carte, avec icônes et couleurs. Les données viennent de l'outil
// (jamais du modèle) et restent avec la discussion, sur le PC.

import { Fragment, useState } from 'react'
import { BellRing, CalendarDays, Droplets, ListTodo, MapPin, Repeat } from 'lucide-react'
import type { AgendaCardEvent, ChatCard, ReminderCardItem, TaskCardItem, WeatherCardDay } from '@shared/cards'
import { addDays, localDay } from '@shared/tasks'
import { weatherKind, weekDayLabel, type WeatherKind } from '@shared/week'
import type { ToolActivity } from '@shared/types'
import { Block, Empty, EventLine, TIME } from './Day'
import { TaskRow } from './Tasks'
import { WeatherIcon } from './WeekAgenda'
import { useNow } from './Live'

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
