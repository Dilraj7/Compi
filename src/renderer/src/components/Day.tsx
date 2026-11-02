// Blocs de la journée, communs à « Aujourd'hui » (encoche) et à la colonne
// « Ta journée » du plein écran : agenda, rappels, messages, minuteur.

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { BellRing, ClipboardList, ExternalLink, Mail, MessageSquareText, Pause, Play, Repeat, Timer, Undo2, Video, X } from 'lucide-react'
import { gmailWebUrl, repeatLabel, senderName } from '@shared/day'
import { attendeeLabel, eventLink, isPreparable, prepKey, PREP_MAIL_DAYS } from '@shared/meetingPrep'
import { groupLabel, groupPending, waitingFor } from '@shared/messages'
import { causeLabel, missedCounts, type MissedInfo } from '@shared/missed'
import { formatClock } from '@shared/media'
import { remainingMs, timerTitle } from '@shared/timer'
import type { DayEvent, MeetingPrep, MessagesStatus, Reminder, TodayInfo } from '@shared/types'
import { useCompi } from '../store'
import { StartCallCard } from '../views/MeetingsView'
import { REC } from './CallLive'
import { Button, cx, IconButton, LedDots } from './ui'
import { useNow } from './Live'

export const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })
const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/** « Lundi 26 octobre ». */
export const dayTitle = (now: number): string => {
  const s = DAY.format(new Date(now))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** `bare` : le contenu fait ses propres cartes (les 7 jours du plein écran). */
export function Block({ icon, title, extra, bare, children }: { icon: ReactNode; title: string; extra?: ReactNode; bare?: boolean; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h3 className="led-text flex items-center gap-1.5 text-[11px] text-fog-500">
          {icon} {title}
        </h3>
        {extra}
      </div>
      {bare ? children : <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">{children}</div>}
    </section>
  )
}

export const Empty = ({ children }: { children: ReactNode }) => <div className="px-3.5 py-3 text-[12px] text-fog-500">{children}</div>

/**
 * Journée, rappels et l'heure qui avance (toutes les 30 s), rechargés à la demande, et
 * toutes les `refreshMs` si c'est donné (plein écran : la vue peut rester ouverte longtemps).
 */
export function useToday(refreshMs?: number): { today: TodayInfo | null; reminders: Reminder[]; loading: boolean; now: number; load: () => Promise<void> } {
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
    const reload = refreshMs ? setInterval(() => void load(), refreshMs) : undefined
    return () => {
      off()
      clearInterval(tick)
      clearInterval(reload)
    }
  }, [load, refreshMs])

  return { today, reminders, loading, now, load }
}

export function EventRow({ e, now }: { e: DayEvent; now: number }) {
  const start = new Date(e.start).getTime()
  const end = new Date(e.end).getTime()
  const past = !e.allDay && end < now
  const live = !e.allDay && start <= now && now < end
  const soon = !e.allDay && start > now && start - now < 15 * 60_000
  // « Préparer » (option de Ta journée) : réunion avec d'autres personnes, pas encore finie.
  const prepOn = useCompi((s) => s.settings?.day.meetingPrep === true) && isPreparable(e) && !past
  const focused = useCompi((s) => s.prepFocus === prepKey(e))
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focused) return
    setOpen(true)
    setTimeout(() => ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 250)
    // Les deux journées (encoche et plein écran) peuvent l'afficher : la demande s'efface un peu après.
    const t = setTimeout(() => useCompi.getState().setPrepFocus(null), 600)
    return () => clearTimeout(t)
  }, [focused])
  return (
    <div ref={ref} className="@container [&+&]:border-t [&+&]:border-white/[0.05]">
      <EventLine e={e} past={past} live={live} soon={soon} start={start} end={end}>
        {prepOn && (
          // Colonne étroite (plein écran) : l'icône seule, pour laisser la place au titre.
          <Button
            size="sm"
            variant={open ? 'primary' : 'subtle'}
            accent="#A78BFA"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-label="Préparer"
            title="Préparer"
          >
            <ClipboardList size={13} /> <span className="hidden @sm:inline">Préparer</span>
          </Button>
        )}
      </EventLine>
      {prepOn && open && <PrepCard e={e} />}
    </div>
  )
}

export function EventLine({
  e,
  past,
  live,
  soon,
  start,
  end,
  children
}: {
  /** Un rendez-vous lu à l'instant, ou celui d'une carte du chat (mêmes champs affichés). */
  e: Pick<DayEvent, 'title' | 'start' | 'end' | 'allDay' | 'location' | 'calendar' | 'meetUrl'>
  past: boolean
  live: boolean
  soon: boolean
  start: number
  end: number
  children?: ReactNode
}) {
  return (
    <div className={cx('flex items-center gap-3 px-3.5 py-2.5', past && 'opacity-45')}>
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
      {children}
      {e.meetUrl && !past && (
        <Button
          size="sm"
          variant={live || soon ? 'primary' : 'subtle'}
          accent="#34D399"
          onClick={() => void window.compi.openExternal(e.meetUrl!)}
          aria-label="Rejoindre"
          title="Rejoindre"
        >
          {/* Avec « Préparer » à côté, dans une colonne étroite : l'icône seule. */}
          <Video size={13} /> <span className={children ? 'hidden @sm:inline' : undefined}>Rejoindre</span>
        </Button>
      )}
    </div>
  )
}

const SHORT_DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })
const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function PrepPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[10.5px] font-medium tracking-wide text-fog-700 uppercase">{title}</div>
      {children}
    </div>
  )
}

/** Préparation d'une réunion : qui sera là, vos derniers e-mails, ce qui avait été décidé la fois d'avant. Tout reste sur le PC. */
function PrepCard({ e }: { e: DayEvent }) {
  const email = useCompi((s) => s.settings?.google.email ?? '')
  const calling = useCompi((s) => s.call !== null)
  const [prep, setPrep] = useState<MeetingPrep | null>(null)
  const [error, setError] = useState('')
  const [recording, setRecording] = useState(false)
  const people = e.attendees ?? []

  useEffect(() => {
    let alive = true
    window.compi.meetingPrep(eventLink(e)).then(
      (p) => alive && setPrep(p),
      (err: Error) => alive && setError(cleanError(err))
    )
    return () => {
      alive = false
    }
    // Une seule lecture par rendez-vous (pas à chaque rafraîchissement de la journée).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.id, e.start])

  const openMeeting = (id: string): void => {
    const s = useCompi.getState()
    s.setHistoryTab('meetings')
    s.openMeeting(id)
    s.setView('history')
  }

  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="px-3.5 pb-3" data-meeting-prep>
      <div className="space-y-3 rounded-xl bg-white/[0.035] p-3 ring-1 ring-white/[0.06] ring-inset">
        <PrepPart title="Avec">
          <div className="flex flex-wrap gap-1.5">
            {people.map((a) => (
              <span
                key={a.email ?? a.name}
                title={a.email}
                className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-white/[0.06] px-2 py-0.5 text-[11.5px] text-fog-100"
              >
                {attendeeLabel(a)}
                {a.organizer && <span className="text-fog-500">· organise</span>}
              </span>
            ))}
          </div>
        </PrepPart>

        <PrepPart title="Vos derniers e-mails">
          {error ? (
            <div className="text-[11.5px] text-led-amber">{error}</div>
          ) : !prep ? (
            <LedDots color="#A78BFA" />
          ) : prep.mails === null ? (
            <div className="text-[11.5px] text-fog-500">Autorise Gmail (Réglages › Journée › Comptes) pour les voir ici.</div>
          ) : prep.mailError ? (
            <div className="text-[11.5px] text-led-amber">Gmail : {prep.mailError}</div>
          ) : prep.mails.length ? (
            <div className="-mx-1.5">
              {prep.mails.map((m) => (
                <button
                  key={m.id}
                  onClick={() => void window.compi.openExternal(gmailWebUrl(email, { messageId: m.id }))}
                  className="group flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[11.5px] hover:bg-white/[0.05]"
                >
                  <span className="w-24 shrink-0 truncate text-fog-300">{senderName(m.from)}</span>
                  <span className="min-w-0 flex-1 truncate text-fog-100">{m.subject}</span>
                  {m.date && <span className="shrink-0 text-fog-700 tabular-nums">{SHORT_DATE.format(new Date(m.date))}</span>}
                  <ExternalLink size={11} className="shrink-0 text-fog-700 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[11.5px] text-fog-500">Aucun échange ces {PREP_MAIL_DAYS} derniers jours.</div>
          )}
        </PrepPart>

        <PrepPart title="La dernière fois">
          {!prep ? (
            error ? null : (
              <LedDots color="#A78BFA" />
            )
          ) : prep.previous ? (
            <div className="space-y-1">
              <button className="flex items-baseline gap-1.5 text-left text-[12px] text-fog-100 hover:underline" onClick={() => openMeeting(prep.previous!.id)}>
                {prep.previous.title}
                <span className="text-[11px] text-fog-500">· {SHORT_DATE.format(new Date(prep.previous.startedAt))}</span>
              </button>
              {prep.previous.tasks.length ? (
                <ul className="space-y-0.5">
                  {prep.previous.tasks.map((t, i) => (
                    <li key={i} className="flex gap-1.5 text-[11.5px] leading-snug text-fog-300">
                      <span className="text-fog-700">•</span>
                      <span>
                        {t.text}
                        {(t.owner || t.due) && <span className="text-fog-500"> — {[t.owner, t.due].filter(Boolean).join(', ')}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-[11.5px] text-fog-500">Pas de tâche notée.</div>
              )}
            </div>
          ) : (
            <div className="text-[11.5px] text-fog-500">Pas de réunion enregistrée avec eux.</div>
          )}
        </PrepPart>

        {!recording && (
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="subtle" disabled={calling} onClick={() => setRecording(true)}>
              <span className="size-2 rounded-full" style={{ background: REC, boxShadow: `0 0 6px ${REC}` }} />
              {calling ? 'Enregistrement en cours' : 'Enregistrer'}
            </Button>
          </div>
        )}
        {recording && <StartCallCard event={eventLink(e)} onClose={() => setRecording(false)} />}
      </div>
    </motion.div>
  )
}

/** Ligne « maintenant » de la frise : l'heure actuelle entre ce qui est passé et ce qui vient. */
function NowLine({ now }: { now: number }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-1">
      <div className="w-[52px] shrink-0 text-right text-[10.5px] font-semibold text-led-red tabular-nums">{TIME.format(new Date(now))}</div>
      <span className="size-[7px] shrink-0 rounded-full bg-led-red shadow-[0_0_8px_#f87171]" />
      <span className="h-px flex-1 bg-led-red/50" />
    </div>
  )
}

/** Rendez-vous du jour, avec la ligne « maintenant » (frise du plein écran). */
export function Timeline({ events, now }: { events: DayEvent[]; now: number }) {
  const timed = events.filter((e) => !e.allDay)
  const at = timed.findIndex((e) => new Date(e.start).getTime() > now)
  const nowAfter = at === -1 ? timed.at(-1) : timed[at - 1]
  return (
    <>
      {events.map((e) => (
        <Fragment key={`${e.id}${e.start}`}>
          {at === 0 && e === timed[0] && <NowLine now={now} />}
          <EventRow e={e} now={now} />
          {at !== 0 && e === nowAfter && <NowLine now={now} />}
        </Fragment>
      ))}
    </>
  )
}

/** `compact` (colonne étroite du plein écran) : les boutons passent par-dessus le texte au survol ou au clavier. */
export function ReminderRow({ r, compact }: { r: Reminder; compact?: boolean }) {
  const due = new Date(r.dueAt)
  const today = due.toDateString() === new Date().toDateString()
  return (
    <div className="group relative flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]">
      <div className="w-[52px] shrink-0 text-right text-[12px] text-fog-100 tabular-nums">{today ? TIME.format(due) : SHORT_DAY.format(due)}</div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fog-100">{r.message}</div>
        {r.repeat && (
          <div className="flex items-center gap-1 truncate text-[11px] text-fog-500">
            <Repeat size={10} /> {repeatLabel(r.repeat)}
          </div>
        )}
      </div>
      <div
        className={cx(
          'flex shrink-0 items-center gap-1 transition-opacity group-hover:opacity-100',
          compact ? 'absolute right-2 rounded-xl bg-ink-850 pl-2 opacity-0 shadow-[-12px_0_12px_var(--color-ink-850)] focus-within:opacity-100' : 'opacity-60'
        )}
      >
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

/** E-mails non lus : expéditeur et sujet, ouverts dans Gmail. */
export function UnreadRows({ today, email }: { today: TodayInfo | null; email: string }) {
  return (
    <>
      {today?.unread?.latest.map((m) => (
        <button
          key={m.id}
          className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.03] [&+&]:border-t [&+&]:border-white/[0.05]"
          onClick={() => void window.compi.openExternal(gmailWebUrl(email, { messageId: m.id }))}
        >
          <span className={cx('size-1.5 shrink-0 rounded-full', m.important ? 'bg-led-amber' : 'bg-[#4C8DF6]')} />
          <span className="w-28 shrink-0 truncate text-[12px] text-fog-100">{senderName(m.from)}</span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-fog-500">{m.subject}</span>
        </button>
      ))}
    </>
  )
}

/** Petit titre d'une partie de la carte « Ce que tu as manqué ». */
function MissedPart({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-t border-white/[0.05] px-3.5 pt-2.5 pb-1 text-[11px] text-fog-500 first:border-t-0">
      {icon} {label}
    </div>
  )
}

/**
 * « Ce que tu as manqué » : après une concentration, une réunion ou une absence, ce qui
 * est arrivé pendant ce temps (messages, e-mails, rappels). Rien si aucune carte.
 */
export function MissedBlock() {
  const email = useCompi((s) => s.settings?.google.email ?? '')
  const [info, setInfo] = useState<MissedInfo | null>(null)
  useEffect(() => {
    void window.compi.missed().then(setInfo)
    return window.compi.onMissed(setInfo)
  }, [])
  if (!info) return null
  const c = missedCounts(info)
  const span = `${TIME.format(new Date(info.from))}–${TIME.format(new Date(info.to))}`
  return (
    <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} data-missed>
      <Block
        icon={<Undo2 size={12} />}
        title="Ce que tu as manqué"
        extra={
          <IconButton label="Fermer" onClick={() => void window.compi.dismissMissed()}>
            <X size={13} />
          </IconButton>
        }
      >
        <div className="px-3.5 pt-2.5 pb-1 text-[12px] text-fog-300">
          {causeLabel(info.cause)}
          {info.title ? ` « ${info.title} »` : ''} <span className="text-fog-500">· {span}</span>
        </div>
        {c.messages > 0 && (
          <>
            <MissedPart icon={<MessageSquareText size={11} />} label={c.messages > 1 ? `${c.messages} messages` : '1 message'} />
            {groupPending(info.messages).map((g) => (
              <div key={g.keys[0]} className="flex items-center gap-3 px-3.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[12px] text-fog-100">
                  {groupLabel(g)} <span className="text-fog-500">· {g.app}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void window.compi.openMessage(g.keys[0])}>
                  <ExternalLink size={12} /> Ouvrir
                </Button>
              </div>
            ))}
          </>
        )}
        {info.mails && c.mails > 0 && (
          <>
            <MissedPart
              icon={<Mail size={11} />}
              label={`${c.mails > 1 ? `${c.mails} e-mails non lus` : '1 e-mail non lu'}${c.mails > info.mails.length ? ` · les ${info.mails.length} premiers` : ''}`}
            />
            {info.mails.map((m) => (
              <button
                key={m.id}
                className="flex w-full items-center gap-3 px-3.5 py-1.5 text-left transition-colors hover:bg-white/[0.03]"
                onClick={() => void window.compi.openExternal(gmailWebUrl(email, { messageId: m.id }))}
              >
                <span className={cx('size-1.5 shrink-0 rounded-full', m.important ? 'bg-led-amber' : 'bg-[#4C8DF6]')} />
                <span className="w-28 shrink-0 truncate text-[12px] text-fog-100">{senderName(m.from)}</span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-fog-500">{m.subject}</span>
              </button>
            ))}
          </>
        )}
        {c.reminders > 0 && (
          <>
            <MissedPart icon={<BellRing size={11} />} label={c.reminders > 1 ? `${c.reminders} rappels ont sonné` : '1 rappel a sonné'} />
            {info.reminders.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-3.5 py-1.5 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-fog-100">{r.message}</span>
                <span className="shrink-0 text-[11px] text-fog-500">{TIME.format(new Date(r.at))}</span>
              </div>
            ))}
          </>
        )}
        {info.mailError && <div className="px-3.5 py-1.5 text-[11.5px] text-led-amber">Gmail : {info.mailError}</div>}
        <div className="h-1.5" />
      </Block>
    </motion.div>
  )
}

/** Même action sur chaque message d'une ligne regroupée ; renvoie le dernier état. */
async function eachKey(keys: string[], fn: (key: string) => Promise<MessagesStatus>): Promise<MessagesStatus> {
  let last: MessagesStatus | undefined
  for (const k of keys) last = await fn(k)
  return last!
}

/** Messages restés sans réponse (notifications des messageries), si l'utilisateur l'a activé. */
export function MessagesBlock() {
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
export function TimerBlock() {
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
