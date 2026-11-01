// Les 7 prochains jours du plein écran : un en-tête par jour (météo comprise), puis les
// rendez-vous, rappels et tâches à échéance. Lu seulement quand la vue est affichée.

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { BellRing, CheckCircle2, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Sun, type LucideIcon } from 'lucide-react'
import { weatherKind, weekDayLabel, type WeatherKind } from '@shared/week'
import type { DayEvent, Reminder, TaskItem, WeekDay, WeekInfo } from '@shared/types'
import { Empty, EventRow, TIME } from './Day'
import { LedDots, cx } from './ui'

const WEATHER_ICON: Record<WeatherKind, LucideIcon> = {
  sun: Sun,
  partly: CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: CloudSnow,
  storm: CloudLightning
}

export function WeatherIcon({ code, size = 14 }: { code?: number; size?: number }) {
  const Icon = WEATHER_ICON[weatherKind(code)]
  return <Icon size={size} className="shrink-0 text-[#FDBA74]" />
}

/** Lecture des 7 jours, rafraîchie toutes les 5 min tant que la vue est affichée. */
function useWeek(): { week: WeekInfo | null; loading: boolean } {
  const [week, setWeek] = useState<WeekInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      setWeek(await window.compi.week())
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 5 * 60_000)
    const off = window.compi.onReminders(() => void load())
    return () => {
      clearInterval(t)
      off()
    }
  }, [load])
  return { week, loading }
}

function Line({ icon, time, title, sub }: { icon: ReactNode; time: string; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-2 [&+&]:border-t [&+&]:border-white/[0.05]">
      <div className="w-[52px] shrink-0 text-right text-[11.5px] text-fog-500 tabular-nums">{time}</div>
      <span className="grid w-[3px] shrink-0 place-items-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fog-100">{title}</div>
        {sub && <div className="truncate text-[11px] text-fog-500">{sub}</div>}
      </div>
    </div>
  )
}

const ReminderLine = ({ r, late }: { r: Reminder; late: boolean }) => (
  <Line
    icon={<BellRing size={12} className={late ? 'text-led-amber' : 'text-fog-500'} />}
    time={TIME.format(new Date(r.dueAt))}
    title={r.message}
    sub={late ? 'Rappel en retard' : 'Rappel'}
  />
)

const TaskLine = ({ title, sub }: { title: string; sub: string }) => <Line icon={<CheckCircle2 size={12} className="text-led-violet" />} time="tâche" title={title} sub={sub} />

function Day({ day, today, now }: { day: WeekDay; today: string; now: number }) {
  const label = weekDayLabel(day.date, today)
  // Les tâches des connecteurs arrivent comme des rendez-vous sans durée : affichées en tâches.
  const events = day.events.filter((e) => e.kind !== 'task')
  const crmTasks: DayEvent[] = day.events.filter((e) => e.kind === 'task')
  const tasks: TaskItem[] = day.tasks
  const count = events.length + crmTasks.length + day.reminders.length + tasks.length
  return (
    <section className="space-y-1.5" data-week-day={day.date}>
      <div className="flex items-center gap-2 px-0.5">
        <h4 className={cx('text-[12.5px] font-semibold first-letter:uppercase', day.date === today ? 'text-fog-100' : 'text-fog-300')}>{label}</h4>
        <span className="text-[11px] text-fog-700">{count ? `${count} élément${count > 1 ? 's' : ''}` : ''}</span>
        <span className="flex-1" />
        {day.weather && (
          <span className="flex items-center gap-1.5 text-[11.5px] text-fog-300 tabular-nums" title={day.weather.label}>
            <WeatherIcon code={day.weather.code} size={13} />
            {day.weather.min}–{day.weather.max} °C
          </span>
        )}
      </div>
      {count ? (
        <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
          {events.map((e) => (
            <EventRow key={`${e.id}${e.start}`} e={e} now={now} />
          ))}
          {day.reminders.map((r) => (
            <ReminderLine key={`${r.id}-${r.dueAt}`} r={r} late={r.dueAt < now} />
          ))}
          {crmTasks.map((e) => (
            <TaskLine key={e.id} title={e.title} sub={`${e.calendar ?? 'Tâche'} · échéance ${TIME.format(new Date(e.start))}`} />
          ))}
          {tasks.map((t) => (
            <TaskLine key={t.id} title={t.title} sub={t.due && t.due < today ? `${t.list} · en retard` : t.list} />
          ))}
        </div>
      ) : (
        <div className="px-0.5 text-[11.5px] text-fog-700">Rien de prévu.</div>
      )}
    </section>
  )
}

export function WeekAgenda({ now }: { now: number }) {
  const { week, loading } = useWeek()
  if (!week) return <Empty>{loading ? 'Chargement des 7 jours…' : 'Semaine indisponible.'}</Empty>
  return (
    <div className="space-y-3.5" data-week>
      {loading && (
        <div className="flex justify-end px-1">
          <LedDots color="#FDBA74" />
        </div>
      )}
      {week.days.map((d) => (
        <Day key={d.date} day={d} today={week.today} now={now} />
      ))}
      {week.errors.map((e) => (
        <div key={e} className="px-1 text-[11.5px] text-led-amber">
          {e}
        </div>
      ))}
    </div>
  )
}
