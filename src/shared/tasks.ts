// Tâches Google, partie pure (sans Electron, testée) : conversion des tâches de
// l'API, ordre d'affichage (en retard, aujourd'hui, bientôt, plus tard, sans date),
// libellés d'échéance et texte donné au cerveau.

import type { TaskItem } from './types'

/** Listes lues au plus, et tâches par liste. */
export const MAX_TASK_LISTS = 10
export const TASKS_PER_LIST = 100
/** Tâches données au cerveau d'un coup. */
export const MAX_TASKS_TEXT = 50

/** Identifiant de tâche ou de liste tel que Google les donne (jamais un chemin). */
export const isTaskId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(s)

/** « AAAA-MM-JJ » valide. */
export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

const clip = (s: unknown, n: number): string | undefined => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : undefined)

export interface RawTask {
  id?: string
  title?: string
  notes?: string
  due?: string
  status?: string
  webViewLink?: string
  deleted?: boolean
  hidden?: boolean
}

/** Tâche de l'API → tâche de Compi (`null` : supprimée, cachée ou sans titre). */
export function toTaskItem(raw: RawTask, listId: string, list: string): TaskItem | null {
  if (!isTaskId(raw.id) || raw.deleted || raw.hidden) return null
  const title = clip(raw.title, 300)
  if (!title) return null
  const due = typeof raw.due === 'string' ? raw.due.slice(0, 10) : undefined
  const notes = clip(raw.notes, 500)
  const link = typeof raw.webViewLink === 'string' && raw.webViewLink.startsWith('https://tasks.google.com/') ? raw.webViewLink : undefined
  return {
    id: raw.id,
    listId,
    list,
    title,
    ...(notes ? { notes } : {}),
    ...(isDay(due) ? { due } : {}),
    done: raw.status === 'completed',
    ...(link ? { link } : {})
  }
}

/** Jour local « AAAA-MM-JJ ». */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Jour décalé de `n` jours (calcul en UTC : pas de piège d'heure d'été). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export type TaskBucket = 'late' | 'today' | 'soon' | 'later' | 'none'

/** En retard, aujourd'hui, dans les 7 jours, plus tard, ou sans échéance. */
export function taskBucket(t: Pick<TaskItem, 'due'>, today: string): TaskBucket {
  if (!t.due) return 'none'
  if (t.due < today) return 'late'
  if (t.due === today) return 'today'
  return t.due <= addDays(today, 7) ? 'soon' : 'later'
}

const ORDER: Record<TaskBucket, number> = { late: 0, today: 1, soon: 2, later: 3, none: 4 }

/** Ordre d'affichage : par groupe, puis par échéance ; sans échéance, l'ordre de Google est gardé. */
export function sortTasks(items: TaskItem[], today: string): TaskItem[] {
  return items
    .map((t, i) => ({ t, i, b: ORDER[taskBucket(t, today)] }))
    .sort((a, b) => a.b - b.b || (a.t.due ?? '').localeCompare(b.t.due ?? '') || a.i - b.i)
    .map((x) => x.t)
}

/** À faire aujourd'hui (en retard compris), pour le résumé du matin. */
export const dueTodayCount = (items: TaskItem[], today: string): number => items.filter((t) => !t.done && t.due !== undefined && t.due <= today).length

const SHORT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
const shortDay = (day: string): string => SHORT.format(new Date(`${day}T00:00:00Z`))

/** « aujourd’hui », « demain », « en retard · lun. 26 oct. », « jeu. 30 oct. ». */
export function dueLabel(due: string | undefined, today: string): string {
  if (!due) return ''
  if (due === today) return 'aujourd’hui'
  if (due === addDays(today, 1)) return 'demain'
  if (due === addDays(today, -1)) return 'en retard · hier'
  return due < today ? `en retard · ${shortDay(due)}` : shortDay(due)
}

/** Échéance pour l'API : Google ne garde que le jour (minuit UTC). */
export const dueParam = (day: string): string => `${day}T00:00:00.000Z`

/** Liste lisible pour le cerveau, avec une réf par tâche (« réf t3 »). */
export function formatTasks(items: TaskItem[], today: string, ref?: (t: TaskItem) => string | undefined): string {
  const shown = items.slice(0, MAX_TASKS_TEXT)
  const lines = shown.map((t) => {
    const r = ref?.(t)
    const when = t.due ? `échéance : ${dueLabel(t.due, today)} (${t.due})` : 'sans échéance'
    const notes = t.notes ? ` · notes : ${t.notes.replace(/\s+/g, ' ').slice(0, 200)}` : ''
    return `- ${r ? `[réf ${r}] ` : ''}${t.title} · ${when} · liste ${t.list}${t.done ? ' · terminée' : ''}${notes}`
  })
  const more = items.length - shown.length
  return lines.join('\n') + (more > 0 ? `\n(${more} autre(s) non affichée(s) : précise la recherche.)` : '')
}
