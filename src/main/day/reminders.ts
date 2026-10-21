// Rappels : ponctuels ou répétés (chaque jour, jours ouvrés, chaque semaine,
// chaque mois), qu'on peut voir, annuler ou reporter. Enregistrés dans
// userData/reminders.json, replanifiés au démarrage.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import type { Reminder, ReminderRepeat } from '../../shared/types'
import { emit } from '../bus'
import { readJson, writeJson } from '../store/jsonFile'
import { toastSilent } from '../store/settings'
import { repeatLabel } from '../../shared/day'

export { repeatLabel }

/** Prochaine échéance strictement après `after` (pur, testé). */
export function nextOccurrence(repeat: ReminderRepeat, after: number): number {
  const [h, m] = repeat.time.split(':').map(Number)
  const from = new Date(after)
  if (repeat.every === 'month') {
    for (let k = 0; k < 26; k++) {
      const y = from.getFullYear()
      const mo = from.getMonth() + k
      const last = new Date(y, mo + 1, 0).getDate()
      const c = new Date(y, mo, Math.min(repeat.day, last), h, m).getTime()
      if (c > after) return c
    }
  } else {
    for (let i = 0; i < 15; i++) {
      const c = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i, h, m)
      if (c.getTime() <= after) continue
      const wd = c.getDay()
      if (repeat.every === 'day') return c.getTime()
      if (repeat.every === 'weekdays' && wd >= 1 && wd <= 5) return c.getTime()
      if (repeat.every === 'week' && repeat.days.includes(wd)) return c.getTime()
    }
  }
  throw new Error('Répétition sans échéance.')
}

const file = (): string => join(app.getPath('userData'), 'reminders.json')
const timers = new Map<string, NodeJS.Timeout>()

const load = (): Reminder[] => readJson<Reminder[]>(file(), [])

function save(list: Reminder[]): void {
  writeJson(file(), list)
  emit(IPC.remindersChanged, listReminders())
}

export const listReminders = (): Reminder[] => load().sort((a, b) => a.dueAt - b.dueAt)

function fire(id: string, late = false): void {
  timers.delete(id)
  const list = load()
  const r = list.find((x) => x.id === id)
  if (!r) return
  const text = late ? `${r.message} (prévu à ${new Date(r.dueAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})` : r.message
  new Notification({ title: 'Rappel de Compi', body: text, silent: toastSilent() }).show()
  emit(IPC.islandNotify, { pill: 'reminder', text, duration: 12_000, view: 'today' })
  if (r.repeat) {
    r.dueAt = nextOccurrence(r.repeat, Date.now())
    save(list)
    schedule(r)
  } else {
    save(list.filter((x) => x.id !== id))
  }
}

function schedule(r: Reminder): void {
  clearTimeout(timers.get(r.id))
  const delay = Math.max(0, r.dueAt - Date.now())
  // setTimeout est limité à ~24,8 jours : on replanifie par étapes.
  const step = Math.min(delay, 2 ** 31 - 1)
  timers.set(
    r.id,
    setTimeout(() => {
      const current = load().find((x) => x.id === r.id)
      if (!current) return
      if (Date.now() >= current.dueAt) fire(r.id)
      else schedule(current)
    }, step)
  )
}

/** Au démarrage : replanifie, et signale une fois ce qui a été manqué pendant que le PC était éteint. */
export function restoreReminders(): void {
  const now = Date.now()
  const list = load()
  for (const r of list) {
    if (r.dueAt > now) schedule(r)
    else if (!r.repeat || now - r.dueAt < 2 * 3600_000) setTimeout(() => fire(r.id, true), 4000)
    else {
      // Répétition manquée depuis longtemps : on passe directement à la prochaine.
      r.dueAt = nextOccurrence(r.repeat, now)
      schedule(r)
    }
  }
  writeJson(file(), list)
}

export function addReminder(message: string, dueAt: number, repeat?: ReminderRepeat): Reminder {
  const r: Reminder = { id: randomUUID(), message: message.trim().slice(0, 300), dueAt, ...(repeat ? { repeat } : {}) }
  save([...load(), r])
  schedule(r)
  return r
}

export function cancelReminder(id: string): boolean {
  const list = load()
  if (!list.some((r) => r.id === id)) return false
  clearTimeout(timers.get(id))
  timers.delete(id)
  save(list.filter((r) => r.id !== id))
  return true
}

/** Reporte la prochaine échéance (une répétition reprend ensuite son rythme). */
export function snoozeReminder(id: string, minutes: number): Reminder | null {
  const list = load()
  const r = list.find((x) => x.id === id)
  if (!r) return null
  r.dueAt = Date.now() + Math.min(Math.max(minutes, 1), 7 * 24 * 60) * 60_000
  save(list)
  schedule(r)
  return r
}

/** Liste lisible pour le modèle. */
export function formatReminders(list: Reminder[]): string {
  if (!list.length) return 'Aucun rappel programmé.'
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return list.map((r) => `- [${r.id}] ${fmt.format(new Date(r.dueAt))} · ${r.message}${r.repeat ? ` · ${repeatLabel(r.repeat)}` : ''}`).join('\n')
}
