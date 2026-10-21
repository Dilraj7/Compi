// « Aujourd'hui » : la journée d'un coup d'œil. Agenda, e-mails non lus,
// rappels et météo, calculés sur le PC (aucun cerveau n'est sollicité).

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  BellRing,
  CalendarDays,
  CloudSun,
  ExternalLink,
  Mail,
  MessageCircle,
  MessageSquareText,
  Pause,
  Play,
  RefreshCw,
  Repeat,
  Timer,
  Video,
  X
} from 'lucide-react'
import { gmailWebUrl, repeatLabel, senderName } from '@shared/day'
import { groupLabel, groupPending, waitingFor } from '@shared/messages'
import { formatClock } from '@shared/media'
import { remainingMs, timerTitle } from '@shared/timer'
import type { DayEvent, MessagesStatus, Reminder, TodayInfo } from '@shared/types'
import { useCompi } from '../store'
import { Button, cx, IconButton, LedDots } from '../components/ui'
import { useNow } from '../components/Live'
import { RoutinesSection } from './RoutinesSection'

const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function Block({ icon, title, extra, children }: { icon: React.ReactNode; title: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h3 className="led-text flex items-center gap-1.5 text-[11px] text-fog-500">
          {icon} {title}
        </h3>
        {extra}
      </div>
      <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">{children}</div>
    </section>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <div className="px-3.5 py-3 text-[12px] text-fog-500">{children}</div>

function EventRow({ e, now }: { e: DayEvent; now: number }) {
  const start = new Date(e.start).getTime()
  const end = new Date(e.end).getTime()
  const past = !e.allDay && end < now
  const live = !e.allDay && start <= now && now < end
  const soon = !e.allDay && start > now && start - now < 15 * 60_000
  return (
    <div className={cx('flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]', past && 'opacity-45')}>
      <div className="w-[52px] shrink-0 text-right">
        {e.allDay ? (
          <span className="text-[11px] text-fog-500">journée</span>
        ) : (
          <>
            <div className="text-[12.5px] text-fog-100 tabular-nums">{TIME.format(new Date(e.start))}</div>
            {/* Échéance (tâche) : pas de fin à afficher. */}
            {end > start && <div className="text-[10.5px] text-fog-700 tabular-nums">{TIME.format(new Date(e.end))}</div>}
          </>
        )}
      </div>
      <span className={cx('h-8 w-[3px] shrink-0 rounded-full', live ? 'bg-led-green shadow-[0_0_8px_#4ade80]' : 'bg-white/[0.12]')} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fog-100">{e.title}</div>
        <div className="truncate text-[11px] text-fog-500">
          {live ? <span className="text-led-green">En cours</span> : soon ? <span className="text-led-amber">Bientôt</span> : null}
          {(live || soon) && (e.location || e.calendar) ? ' · ' : ''}
          {[e.location, e.calendar].filter(Boolean).join(' · ')}
        </div>
      </div>
      {e.meetUrl && !past && (
        <Button size="sm" variant={live || soon ? 'primary' : 'subtle'} accent="#34D399" onClick={() => void window.compi.openExternal(e.meetUrl!)}>
          <Video size={13} /> Rejoindre
        </Button>
      )}
    </div>
  )
}

function ReminderRow({ r }: { r: Reminder }) {
  const due = new Date(r.dueAt)
  const today = due.toDateString() === new Date().toDateString()
  return (
    <div className="group flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]">
      <div className="w-[52px] shrink-0 text-right text-[12px] text-fog-100 tabular-nums">{today ? TIME.format(due) : SHORT_DAY.format(due)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fog-100">{r.message}</div>
        {r.repeat && (
          <div className="flex items-center gap-1 truncate text-[11px] text-fog-500">
            <Repeat size={10} /> {repeatLabel(r.repeat)}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
        <Button size="sm" variant="ghost" onClick={() => void window.compi.snoozeReminder(r.id, 10)}>
          +10 min
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void window.compi.snoozeReminder(r.id, 60)}>
          +1 h
        </Button>
        <IconButton label={r.repeat ? 'Annuler toute la série' : 'Annuler le rappel'} onClick={() => void window.compi.cancelReminder(r.id)}>
          <X size={13} />
        </IconButton>
      </div>
    </div>
  )
}

/** Messages restés sans réponse (notifications des messageries), si l'utilisateur l'a activé. */
/** Même action sur chaque message d'une ligne regroupée ; renvoie le dernier état. */
async function eachKey(keys: string[], fn: (key: string) => Promise<MessagesStatus>): Promise<MessagesStatus> {
  let last: MessagesStatus | undefined
  for (const k of keys) last = await fn(k)
  return last!
}

function MessagesBlock() {
  const enabled = useCompi((s) => s.settings?.messages.enabled ?? false)
  const setView = useCompi((s) => s.setView)
  const focusSettings = useCompi((s) => s.focusSettings)
  const [status, setStatus] = useState<MessagesStatus | null>(null)
  const now = useNow(enabled, 60_000)
  useEffect(() => {
    if (!enabled) return
    void window.compi.messagesStatus().then(setStatus)
    return window.compi.onMessages(setStatus)
  }, [enabled])
  if (!enabled || !status) return null
  return (
    <Block
      icon={<MessageSquareText size={12} />}
      title="Messages en attente"
      extra={
        <button
          className="text-[11px] text-fog-700 hover:text-fog-300"
          onClick={() => {
            focusSettings('messages')
            setView('settings')
          }}
        >
          Réglages
        </button>
      }
    >
      {status.pending.length ? (
        groupPending(status.pending).map((g) => (
          <div key={g.keys[0]} className="group flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]">
            <div className="min-w-0 flex-1">
              <div className={cx('truncate text-[12.5px]', g.sender ? 'text-fog-100' : 'text-fog-300')}>{groupLabel(g)}</div>
              <div className="truncate text-[11px] text-fog-500">
                {g.app} · depuis {waitingFor(g.at, now)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
              <Button size="sm" variant="ghost" onClick={() => void window.compi.openMessage(g.keys[0])}>
                <ExternalLink size={12} /> Ouvrir
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void eachKey(g.keys, window.compi.snoozeMessage).then(setStatus)}>
                Plus tard
              </Button>
              <IconButton
                label={g.count > 1 ? 'Ignorer ces messages' : 'Ignorer ce message'}
                onClick={() => void eachKey(g.keys, window.compi.ignoreMessage).then(setStatus)}
              >
                <X size={13} />
              </IconButton>
            </div>
          </div>
        ))
      ) : status.windows && (!status.windows.toasts || status.windows.blocked.length) ? (
        <div className="px-3.5 py-2.5 text-[11.5px] leading-snug text-led-amber">
          {!status.windows.toasts
            ? 'Les notifications de Windows sont coupées : je ne vois pas tes messages.'
            : `Windows ne garde pas les notifications de ${status.windows.blocked.map((b) => b.app).join(', ')} : je ne vois pas leurs messages.`}{' '}
          Voir les Réglages.
        </div>
      ) : (
        <Empty>Aucun message en attente.</Empty>
      )}
    </Block>
  )
}

/** Minuteur en cours, ou boutons pour en lancer un. */
function TimerBlock() {
  const timer = useCompi((s) => s.timer)
  const running = timer?.endsAt !== undefined
  const now = useNow(Boolean(timer) && running)
  const color = timer?.pomodoro?.phase === 'break' ? '#34D399' : '#F472B6'
  return (
    <Block icon={<Timer size={12} />} title="Minuteur">
      {timer ? (
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <div className="w-[52px] shrink-0 text-right text-[15px] font-semibold text-fog-100 tabular-nums">{formatClock(remainingMs(timer, now))}</div>
          <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: color, boxShadow: running ? `0 0 8px ${color}` : undefined }} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] text-fog-100">{timerTitle(timer)}</div>
            <div className="text-[11px] text-fog-500">{running ? 'En cours · une notification sonnera à la fin' : 'En pause'}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void (running ? window.compi.pauseTimer() : window.compi.resumeTimer())}>
            {running ? <Pause size={12} /> : <Play size={12} />} {running ? 'Pause' : 'Reprendre'}
          </Button>
          <IconButton label="Arrêter le minuteur" onClick={() => void window.compi.stopTimer()}>
            <X size={13} />
          </IconButton>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 px-3.5 py-2.5">
          {[5, 10, 15, 30].map((m) => (
            <Button key={m} size="sm" onClick={() => void window.compi.startTimer(m)}>
              {m} min
            </Button>
          ))}
          <Button
            size="sm"
            variant="primary"
            accent="#F472B6"
            onClick={() => void window.compi.startPomodoro()}
            title="25 min de concentration, 5 min de pause, 4 fois"
          >
            Pomodoro
          </Button>
          <span className="ml-1 text-[11px] text-fog-700">ou dis-moi « minuteur 12 minutes »</span>
        </div>
      )}
    </Block>
  )
}

export function TodayView() {
  const settings = useCompi((s) => s.settings)
  const setView = useCompi((s) => s.setView)
  const newConversation = useCompi((s) => s.newConversation)
  const setDraft = useCompi((s) => s.setDraft)
  const focusSettings = useCompi((s) => s.focusSettings)
  const [today, setToday] = useState<TodayInfo | null>(null)
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(Date.now())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [t, list] = await Promise.all([window.compi.today(), window.compi.reminders()])
      setToday(t)
      setReminders(list)
    } finally {
      setLoading(false)
      setNow(Date.now())
    }
  }, [])

  useEffect(() => {
    void load()
    const off = window.compi.onReminders(setReminders)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [load])

  const google = today?.google ?? { email: settings?.google.email ?? '', calendar: settings?.google.calendar ?? false, mail: settings?.google.mail ?? false }
  // Agenda : Google ou n'importe quelle source ajoutée (connecteur, lien .ics).
  const agenda = today?.agenda ?? Boolean(settings && (settings.google.calendar || settings.agenda.sources.some((x) => x.enabled)))
  const weather = today?.weather
  const askCompi = (): void => {
    newConversation()
    setDraft(
      agenda && google.mail
        ? 'Résume ma journée : mes rendez-vous et mes e-mails importants.'
        : agenda
          ? 'Résume ma journée : mes rendez-vous.'
          : 'Résume mes e-mails importants du jour.'
    )
    setView('chat')
  }
  const agendaSettings = (): void => {
    focusSettings('agenda')
    setView('settings')
  }

  return (
    <div className="scroll-y flex-1 space-y-4 px-5 pt-1 pb-5">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <div className="text-[19px] leading-tight font-semibold text-fog-100">{capitalize(DAY.format(new Date(now)))}</div>
          {weather ? (
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-fog-300">
              <CloudSun size={14} className="text-[#FDBA74]" />
              {weather.label} · {weather.min}–{weather.max} °C{weather.rain != null && weather.rain >= 20 ? ` · pluie ${weather.rain} %` : ''}
              <span className="text-fog-700">· {weather.city.split(',')[0]}</span>
            </div>
          ) : (
            !loading &&
            !settings?.day.city && (
              <button className="mt-1 text-[11.5px] text-fog-500 hover:text-fog-300" onClick={() => setView('settings')}>
                Ajouter la météo de ta ville
              </button>
            )
          )}
        </div>
        <div className="flex items-center gap-1">
          {loading && <LedDots color="#FDBA74" />}
          <IconButton label="Actualiser" onClick={() => void load()}>
            <RefreshCw size={14} />
          </IconButton>
        </div>
      </div>

      {!agenda && !google.mail && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl bg-[#4C8DF6]/[0.08] px-3.5 py-3 ring-1 ring-inset ring-[#4C8DF6]/25"
        >
          <CalendarDays size={18} className="shrink-0 text-[#4C8DF6]" />
          <div className="min-w-0 flex-1 text-[12px] leading-snug text-fog-300">
            Choisis ton agenda (Google, un connecteur, un lien .ics) pour voir ici tes rendez-vous. Ton compte Google ajoute aussi les e-mails non lus.
          </div>
          <Button size="sm" variant="primary" accent="#4C8DF6" onClick={agendaSettings}>
            Choisir
          </Button>
        </motion.div>
      )}

      {(agenda || google.mail) && (
        <Block
          icon={<CalendarDays size={12} />}
          title="Agenda"
          extra={
            <button className="text-[11px] text-fog-500 transition-colors hover:text-fog-300" onClick={agendaSettings}>
              Sources
            </button>
          }
        >
          {!agenda ? (
            <Empty>
              Aucun agenda choisi.{' '}
              <button className="text-fog-300 underline-offset-2 hover:underline" onClick={agendaSettings}>
                Ajouter une source
              </button>
            </Empty>
          ) : today?.events.length ? (
            today.events.map((e) => <EventRow key={`${e.id}${e.start}`} e={e} now={now} />)
          ) : (
            <Empty>{loading ? 'Chargement…' : 'Rien à l’agenda aujourd’hui.'}</Empty>
          )}
        </Block>
      )}

      {google.mail && (
        <Block
          icon={<Mail size={12} />}
          title="E-mails non lus"
          extra={
            today?.unread ? (
              <span className="text-[11px] text-fog-500">{today.unread.count > 99 ? '99+' : today.unread.count} dans la boîte de réception</span>
            ) : undefined
          }
        >
          {today?.unread?.latest.length ? (
            today.unread.latest.map((m) => (
              <button
                key={m.id}
                className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] [&+&]:border-t [&+&]:border-white/[0.05]"
                onClick={() => void window.compi.openExternal(gmailWebUrl(google.email, { messageId: m.id }))}
              >
                <span className={cx('size-1.5 shrink-0 rounded-full', m.important ? 'bg-led-amber' : 'bg-[#4C8DF6]')} />
                <span className="w-28 shrink-0 truncate text-[12px] text-fog-100">{senderName(m.from)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fog-500">{m.subject}</span>
              </button>
            ))
          ) : (
            <Empty>{loading ? 'Chargement…' : 'Boîte de réception à jour.'}</Empty>
          )}
        </Block>
      )}

      <Block icon={<BellRing size={12} />} title="Rappels">
        {reminders.length ? (
          reminders.map((r) => <ReminderRow key={r.id} r={r} />)
        ) : (
          <Empty>Aucun rappel. Dis-moi « rappelle-moi… », une fois ou chaque semaine.</Empty>
        )}
      </Block>

      <MessagesBlock />

      <RoutinesSection />

      <TimerBlock />

      {today?.errors.map((e) => (
        <div key={e} className="px-1 text-[11.5px] text-led-amber">
          {e}
        </div>
      ))}

      {(agenda || google.mail) && (
        <div className="flex justify-center pt-1">
          <Button variant="ghost" onClick={askCompi}>
            <MessageCircle size={14} /> Demander un résumé à Compi
          </Button>
        </div>
      )}
    </div>
  )
}
