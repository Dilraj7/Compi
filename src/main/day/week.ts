// Les 7 prochains jours du plein écran : rendez-vous de toutes les sources, rappels
// (répétitions déroulées), tâches Google à échéance et météo. Calculé sur le PC, sans
// modèle. Lu seulement quand la vue « 7 jours » est affichée.

import type { WeekInfo } from '../../shared/types'
import { addDays, localDay } from '../../shared/tasks'
import { dayStartMs, groupWeek, reminderOccurrences, WEEK_DAYS } from '../../shared/week'
import { settings } from '../store/settings'
import { listTasks } from '../google/tasks'
import { agendaActive, agendaEvents } from './agenda'
import { listReminders, nextOccurrence } from './reminders'
import { forecast } from './weather'

export async function buildWeek(now = new Date()): Promise<WeekInfo> {
  const s = settings.get()
  const today = localDay(now)
  const from = new Date(dayStartMs(today))
  const to = new Date(dayStartMs(addDays(today, WEEK_DAYS)))
  const errors: string[] = []
  const fail =
    (what: string) =>
    (e: unknown): undefined => {
      errors.push(`${what} : ${(e as Error).message}`)
      return undefined
    }
  const [agenda, tasks, weather] = await Promise.all([
    // Sans `max`, Google s'arrête à 50 rendez-vous par agenda et la fusion à 100.
    agendaEvents({ from, to, max: 300 }),
    s.google.tasks ? listTasks().catch(fail('Tâches')) : Promise.resolve(undefined),
    s.day.city && s.day.cityLat != null && s.day.cityLon != null
      ? forecast({ label: s.day.city, lat: s.day.cityLat, lon: s.day.cityLon }, WEEK_DAYS).catch(fail('Météo'))
      : Promise.resolve(undefined)
  ])
  errors.unshift(...agenda.errors)
  const reminders = listReminders().flatMap((r) => reminderOccurrences(r, to.getTime(), (after) => nextOccurrence(r.repeat!, after)))
  return {
    today,
    agenda: agendaActive(),
    days: groupWeek({ events: agenda.events, reminders, tasks: tasks ?? [], weather: weather ?? [] }, today),
    errors
  }
}
