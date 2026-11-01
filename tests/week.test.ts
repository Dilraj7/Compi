import { describe, expect, it } from 'vitest'
import { groupWeek, onDay, reminderOccurrences, weatherKind, weekDayLabel } from '../src/shared/week'
import type { DayEvent, Reminder, TaskItem } from '../src/shared/types'

const at = (day: string, h: number, m = 0): string => {
  const [y, mo, d] = day.split('-').map(Number)
  return new Date(y, mo - 1, d, h, m).toISOString()
}
const ev = (id: string, start: string, end: string, allDay = false): DayEvent => ({ id, title: id, start, end, allDay })
const task = (id: string, due?: string, done = false): TaskItem => ({ id, listId: 'l', list: 'Mes tâches', title: id, due, done })

describe('les 7 jours du plein écran', () => {
  const today = '2026-10-31'

  it('un rendez-vous tombe sur son jour, une nuit à cheval sur les deux', () => {
    expect(onDay(ev('a', at(today, 9), at(today, 10)), today)).toBe(true)
    expect(onDay(ev('a', at(today, 9), at(today, 10)), '2026-11-01')).toBe(false)
    const night = ev('n', at(today, 23), at('2026-11-01', 1))
    expect(onDay(night, today)).toBe(true)
    expect(onDay(night, '2026-11-01')).toBe(true)
    // Fin à minuit pile : pas le lendemain.
    expect(onDay(ev('m', at(today, 22), at('2026-11-01', 0)), '2026-11-01')).toBe(false)
  })

  it('journée entière : fin exclue ; échéance sans durée : son jour', () => {
    const we = ev('we', '2026-11-04', '2026-11-06', true)
    expect(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].map((d) => onDay(we, d))).toEqual([false, true, true, false])
    expect(onDay(ev('x', '2026-11-02', '', true), '2026-11-02')).toBe(true)
    const due = ev('t', at('2026-11-02', 17), at('2026-11-02', 17))
    expect(onDay(due, '2026-11-02')).toBe(true)
    expect(onDay(due, '2026-11-03')).toBe(false)
  })

  it('passage à l’heure d’hiver (dimanche 25/10/2026) : 7 jours distincts, sans doublon', () => {
    const days = groupWeek({ events: [], reminders: [], tasks: [], weather: [] }, '2026-10-24')
    expect(days.map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'])
  })

  it('range rendez-vous, rappels, tâches et météo ; le retard reste aujourd’hui', () => {
    const now = new Date(at(today, 12)).getTime()
    const reminders: Reminder[] = [
      { id: 'late', message: 'en retard', dueAt: now - 3600_000 },
      { id: 'mon', message: 'lundi', dueAt: new Date(at('2026-11-02', 8)).getTime() },
      { id: 'far', message: 'loin', dueAt: new Date(at('2026-11-20', 8)).getTime() }
    ]
    const days = groupWeek(
      {
        events: [ev('b', at(today, 15), at(today, 16)), ev('a', today, '2026-11-01', true), ev('c', at('2026-11-03', 9), at('2026-11-03', 10))],
        reminders,
        tasks: [task('vieille', '2026-10-20'), task('lundi', '2026-11-02'), task('faite', today, true), task('sans date')],
        weather: [{ date: '2026-11-01', city: 'Nantes', label: 'Pluie', code: 63, min: 8, max: 13 }]
      },
      today
    )
    expect(days).toHaveLength(7)
    expect(days[0].events.map((e) => e.id)).toEqual(['a', 'b'])
    expect(days[0].reminders.map((r) => r.id)).toEqual(['late'])
    expect(days[0].tasks.map((t) => t.id)).toEqual(['vieille'])
    expect(days[1].weather).toEqual({ city: 'Nantes', label: 'Pluie', code: 63, min: 8, max: 13 })
    expect(days[2].reminders.map((r) => r.id)).toEqual(['mon'])
    expect(days[2].tasks.map((t) => t.id)).toEqual(['lundi'])
    expect(days[3].events.map((e) => e.id)).toEqual(['c'])
    expect(days.flatMap((d) => d.reminders).some((r) => r.id === 'far')).toBe(false)
  })

  it('un rappel répété revient chaque jour jusqu’à la fin de la semaine', () => {
    const r: Reminder = { id: 'r', message: 'eau', dueAt: 1000, repeat: { every: 'day', time: '09:00' } as never }
    const out = reminderOccurrences(r, 1000 + 3 * 86_400_000, (after) => after + 86_400_000)
    expect(out.map((x) => x.dueAt)).toEqual([1000, 1000 + 86_400_000, 1000 + 2 * 86_400_000])
    expect(reminderOccurrences({ ...r, repeat: undefined }, 1e12, () => 0)).toHaveLength(1)
    expect(reminderOccurrences(r, 1e12, () => {
      throw new Error('x')
    })).toHaveLength(1)
  })

  it('icônes et libellés', () => {
    expect([0, 2, 3, 45, 53, 63, 81, 73, 95, undefined].map(weatherKind)).toEqual(['sun', 'partly', 'cloud', 'fog', 'drizzle', 'rain', 'rain', 'snow', 'storm', 'partly'])
    expect(weekDayLabel(today, today)).toBe('Aujourd’hui')
    expect(weekDayLabel('2026-11-01', today)).toBe('Demain')
    expect(weekDayLabel('2026-11-02', today)).toBe('lundi 2')
  })
})
