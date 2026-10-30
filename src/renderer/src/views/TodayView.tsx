// « Aujourd'hui » : la journée d'un coup d'œil. Agenda, e-mails non lus,
// rappels et météo, calculés sur le PC (aucun cerveau n'est sollicité).

import { motion } from 'motion/react'
import { BellRing, CalendarDays, CloudSun, Mail, MessageCircle, RefreshCw } from 'lucide-react'
import { useCompi } from '../store'
import { Button, IconButton, LedDots } from '../components/ui'
import { Block, dayTitle, Empty, EventRow, MessagesBlock, MissedBlock, ReminderRow, TimerBlock, UnreadRows, useToday } from '../components/Day'
import { TasksBlock } from '../components/Tasks'
import { RoutinesSection } from './RoutinesSection'

export function TodayView() {
  const settings = useCompi((s) => s.settings)
  const setView = useCompi((s) => s.setView)
  const newConversation = useCompi((s) => s.newConversation)
  const setDraft = useCompi((s) => s.setDraft)
  const focusSettings = useCompi((s) => s.focusSettings)
  const { today, reminders, loading, now, load } = useToday()

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
          <div className="text-[19px] leading-tight font-semibold text-fog-100">{dayTitle(now)}</div>
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

      <MissedBlock />

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
            <UnreadRows today={today} email={google.email} />
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

      <TasksBlock />

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
