// Réfs courtes des tâches Google (« t3 »), comme celles des événements (eventRefs.ts) :
// tasks_list les affiche, tasks_complete et tasks_update les reçoivent, et les cartes y
// lisent la tâche réellement visée. Numérotées dans l'ordre, oubliées au redémarrage.

import type { TaskItem } from '../../shared/types'

export interface TaskRef {
  ref: string
  listId: string
  taskId: string
  title: string
  list: string
  due?: string
}

const MAX_REFS = 500
const refByKey = new Map<string, string>()
const taskByRef = new Map<string, TaskRef>()
let lastRef = 0

const keyOf = (listId: string, taskId: string): string => `${listId}\n${taskId}`

/** Retient une tâche et renvoie sa réf. */
export function rememberTask(t: TaskItem): string {
  const key = keyOf(t.listId, t.id)
  let ref = refByKey.get(key)
  if (!ref) {
    ref = `t${++lastRef}`
    refByKey.set(key, ref)
  }
  // Réinsérée à la fin : les plus anciennes sont oubliées en premier.
  taskByRef.delete(ref)
  taskByRef.set(ref, { ref, listId: t.listId, taskId: t.id, title: t.title, list: t.list, ...(t.due ? { due: t.due } : {}) })
  while (taskByRef.size > MAX_REFS) {
    const [oldest, old] = taskByRef.entries().next().value as [string, TaskRef]
    taskByRef.delete(oldest)
    refByKey.delete(keyOf(old.listId, old.taskId))
  }
  return ref
}

/** Tâche retenue sous cette réf (« t3 », « réf t3 », « T3 »…). */
export function taskByReference(ref: unknown): TaskRef | undefined {
  const m = typeof ref === 'string' ? /t\s*(\d+)/i.exec(ref) : null
  return m ? taskByRef.get(`t${m[1]}`) : undefined
}
