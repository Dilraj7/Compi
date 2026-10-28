// Tâches Google (API Google Tasks) : lire les tâches à faire de toutes les listes,
// et, sur un clic de l'utilisateur ou avec son accord (carte), ajouter, cocher ou
// modifier une tâche. Rien ne part vers un cerveau d'ici : l'outil tasks_list passe
// par le garde-fou de confidentialité comme l'agenda.

import { IPC } from '../../shared/ipc'
import { dueParam, isDay, isTaskId, localDay, MAX_TASK_LISTS, sortTasks, TASKS_PER_LIST, toTaskItem, type RawTask } from '../../shared/tasks'
import type { TaskItem } from '../../shared/types'
import { emit } from '../bus'
import { googleApi, googleEndpoints } from './connect'

interface TaskList {
  id: string
  title: string
}

const api = (): string => googleEndpoints().tasks
const enc = encodeURIComponent
let listCache: { at: number; lists: TaskList[] } | null = null

/** Les listes du compte (la liste par défaut en premier), relues toutes les 10 minutes. */
async function taskLists(): Promise<TaskList[]> {
  if (listCache && Date.now() - listCache.at < 10 * 60_000) return listCache.lists
  const r = await googleApi<{ items?: Array<{ id?: string; title?: string }> }>(`${api()}/users/@me/lists?maxResults=100`)
  const lists = (r.items ?? [])
    .filter((l): l is { id: string; title?: string } => isTaskId(l.id))
    .slice(0, MAX_TASK_LISTS)
    .map((l) => ({ id: l.id, title: l.title?.trim() || 'Mes tâches' }))
  listCache = { at: Date.now(), lists }
  return lists
}

/** Tâches à faire de toutes les listes, dans l'ordre d'affichage. */
export async function listTasks(): Promise<TaskItem[]> {
  const lists = await taskLists()
  const all: TaskItem[] = []
  // Trois listes à la fois : assez rapide, sans inonder Google.
  for (let i = 0; i < lists.length; i += 3) {
    const chunk = await Promise.all(
      lists.slice(i, i + 3).map(async (l) => {
        const r = await googleApi<{ items?: RawTask[] }>(`${api()}/lists/${enc(l.id)}/tasks?showCompleted=false&showHidden=false&maxResults=${TASKS_PER_LIST}`)
        return (r.items ?? []).map((t) => toTaskItem(t, l.id, l.title)).filter((t): t is TaskItem => t !== null)
      })
    )
    all.push(...chunk.flat())
  }
  return sortTasks(all, localDay(new Date()))
}

/** Liste choisie par son nom, sinon la liste par défaut. */
async function listFor(name?: string): Promise<TaskList> {
  const lists = await taskLists()
  const wanted = name?.trim().toLowerCase()
  const found = wanted ? lists.find((l) => l.title.toLowerCase() === wanted) : undefined
  if (wanted && !found) throw new Error(`Liste « ${name} » introuvable. Listes : ${lists.map((l) => l.title).join(', ') || 'aucune'}.`)
  const list = found ?? lists[0]
  if (!list) throw new Error('Aucune liste de tâches dans ce compte Google.')
  return list
}

const changed = (): void => emit(IPC.tasksChanged)

export async function createTask(o: { title: string; due?: string; notes?: string; list?: string }): Promise<TaskItem> {
  const title = o.title.trim().slice(0, 1024)
  if (!title) throw new Error('Il faut un titre à la tâche.')
  if (o.due !== undefined && !isDay(o.due)) throw new Error(`Échéance invalide : « ${o.due} » (attendu AAAA-MM-JJ).`)
  const list = await listFor(o.list)
  const raw = await googleApi<RawTask>(`${api()}/lists/${enc(list.id)}/tasks`, {
    method: 'POST',
    body: { title, ...(o.notes?.trim() ? { notes: o.notes.trim().slice(0, 8000) } : {}), ...(o.due ? { due: dueParam(o.due) } : {}) }
  })
  const t = toTaskItem(raw, list.id, list.title)
  if (!t) throw new Error('Google n’a pas renvoyé la tâche créée.')
  changed()
  return t
}

/** Cocher (ou décocher) une tâche. */
export async function setTaskDone(listId: string, taskId: string, done: boolean): Promise<TaskItem | null> {
  if (!isTaskId(listId) || !isTaskId(taskId)) throw new Error('Tâche inconnue.')
  const lists = await taskLists()
  const raw = await googleApi<RawTask>(`${api()}/lists/${enc(listId)}/tasks/${enc(taskId)}`, {
    method: 'PATCH',
    body: done ? { status: 'completed' } : { status: 'needsAction', completed: null }
  })
  changed()
  return toTaskItem(raw, listId, lists.find((l) => l.id === listId)?.title ?? 'Mes tâches')
}

/** Titre, échéance (`null` : la retirer) et notes ; le reste ne bouge pas. */
export async function updateTask(listId: string, taskId: string, c: { title?: string; due?: string | null; notes?: string }): Promise<TaskItem | null> {
  if (!isTaskId(listId) || !isTaskId(taskId)) throw new Error('Tâche inconnue.')
  if (typeof c.due === 'string' && !isDay(c.due)) throw new Error(`Échéance invalide : « ${c.due} » (attendu AAAA-MM-JJ).`)
  const body: Record<string, unknown> = {}
  if (c.title?.trim()) body.title = c.title.trim().slice(0, 1024)
  if (c.due !== undefined) body.due = c.due === null ? null : dueParam(c.due)
  if (c.notes !== undefined) body.notes = c.notes.trim().slice(0, 8000)
  if (!Object.keys(body).length) throw new Error('Rien à modifier : donne un titre, une échéance ou des notes.')
  const lists = await taskLists()
  const raw = await googleApi<RawTask>(`${api()}/lists/${enc(listId)}/tasks/${enc(taskId)}`, { method: 'PATCH', body })
  changed()
  return toTaskItem(raw, listId, lists.find((l) => l.id === listId)?.title ?? 'Mes tâches')
}

/** Compte déconnecté ou autre compte : les listes seront relues. */
export function forgetTaskLists(): void {
  listCache = null
}
