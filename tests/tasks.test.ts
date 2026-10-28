import { describe, expect, it } from 'vitest'
import {
  addDays,
  dueLabel,
  dueParam,
  dueTodayCount,
  formatTasks,
  isDay,
  isTaskId,
  MAX_TASKS_TEXT,
  sortTasks,
  taskBucket,
  toTaskItem
} from '../src/shared/tasks'
import { rememberTask, taskByReference } from '../src/main/google/taskRefs'
import { stageDetail } from '../src/shared/stage'
import { COMPI_GROUPS } from '../src/shared/localTools'
import { EXTERNAL_CONTENT_TOOLS, TOOL_CATEGORY } from '../src/shared/privacy'
import type { TaskItem } from '../src/shared/types'

const TODAY = '2026-10-28'
const task = (id: string, over: Partial<TaskItem> = {}): TaskItem => ({ id, listId: 'L1', list: 'Mes tâches', title: `Tâche ${id}`, done: false, ...over })

describe('tâches de l’API Google', () => {
  it('échéance au jour près, lien Google seulement, notes bornées', () => {
    expect(
      toTaskItem(
        {
          id: 'abc_123',
          title: '  Payer la cantine ',
          due: '2026-10-29T00:00:00.000Z',
          status: 'needsAction',
          notes: 'x'.repeat(900),
          webViewLink: 'https://tasks.google.com/task/abc_123'
        },
        'L1',
        'Maison'
      )
    ).toEqual({
      id: 'abc_123',
      listId: 'L1',
      list: 'Maison',
      title: 'Payer la cantine',
      notes: 'x'.repeat(500),
      due: '2026-10-29',
      done: false,
      link: 'https://tasks.google.com/task/abc_123'
    })
    expect(toTaskItem({ id: 'a1', title: 'T', webViewLink: 'https://evil.example.com/x', status: 'completed' }, 'L', 'M')).toEqual({
      id: 'a1',
      listId: 'L',
      list: 'M',
      title: 'T',
      done: true
    })
  })

  it('ignorées : supprimées, cachées, sans titre, identifiant douteux', () => {
    expect(toTaskItem({ id: 'a1', title: 'T', deleted: true }, 'L', 'M')).toBeNull()
    expect(toTaskItem({ id: 'a1', title: 'T', hidden: true }, 'L', 'M')).toBeNull()
    expect(toTaskItem({ id: 'a1', title: '   ' }, 'L', 'M')).toBeNull()
    expect(toTaskItem({ id: '../../x', title: 'T' }, 'L', 'M')).toBeNull()
    expect(isTaskId('MTIzNDU2Nzg5MA')).toBe(true)
    expect(isTaskId('a/b')).toBe(false)
  })

  it('dates : jours valides seulement, échéance à minuit UTC pour Google', () => {
    expect(isDay('2026-10-28')).toBe(true)
    expect(isDay('2026-13-40')).toBe(false)
    expect(isDay('demain')).toBe(false)
    expect(dueParam('2026-10-30')).toBe('2026-10-30T00:00:00.000Z')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    // Passage à l'heure d'hiver (25 octobre) : aucun décalage.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
  })
})

describe('ordre et échéances', () => {
  it('en retard, aujourd’hui, cette semaine, plus tard, puis sans date dans l’ordre de Google', () => {
    const items = [
      task('none1'),
      task('later', { due: '2026-11-20' }),
      task('soon2', { due: '2026-11-02' }),
      task('today', { due: TODAY }),
      task('none2'),
      task('late', { due: '2026-10-20' }),
      task('soon1', { due: '2026-10-30' })
    ]
    expect(sortTasks(items, TODAY).map((t) => t.id)).toEqual(['late', 'today', 'soon1', 'soon2', 'later', 'none1', 'none2'])
    expect(taskBucket({ due: '2026-11-04' }, TODAY)).toBe('soon')
    expect(taskBucket({ due: '2026-11-05' }, TODAY)).toBe('later')
  })

  it('libellés : aujourd’hui, demain, hier en retard, autres jours', () => {
    expect(dueLabel(TODAY, TODAY)).toBe('aujourd’hui')
    expect(dueLabel('2026-10-29', TODAY)).toBe('demain')
    expect(dueLabel('2026-10-27', TODAY)).toBe('en retard · hier')
    expect(dueLabel('2026-10-26', TODAY)).toMatch(/^en retard · lun\.? 26 oct/)
    expect(dueLabel('2026-10-30', TODAY)).toMatch(/^ven\.? 30 oct/)
    expect(dueLabel(undefined, TODAY)).toBe('')
  })

  it('pour le résumé du matin : aujourd’hui et en retard, pas les cochées', () => {
    const items = [
      task('a', { due: TODAY }),
      task('b', { due: '2026-10-01' }),
      task('c', { due: '2026-10-29' }),
      task('d'),
      task('e', { due: TODAY, done: true })
    ]
    expect(dueTodayCount(items, TODAY)).toBe(2)
  })
})

describe('le cerveau', () => {
  it('liste lisible avec réfs, notes sur une ligne, bornée', () => {
    const items = [task('a', { due: TODAY, notes: 'ligne 1\nligne 2', list: 'Travail' }), task('b')]
    const text = formatTasks(items, TODAY, (t) => (t.id === 'a' ? 't1' : undefined))
    expect(text).toBe(
      '- [réf t1] Tâche a · échéance : aujourd’hui (2026-10-28) · liste Travail · notes : ligne 1 ligne 2\n- Tâche b · sans échéance · liste Mes tâches'
    )
    const many = Array.from({ length: MAX_TASKS_TEXT + 3 }, (_, i) => task(`t${i}`))
    expect(formatTasks(many, TODAY).split('\n').at(-1)).toBe('(3 autre(s) non affichée(s) : précise la recherche.)')
  })

  it('réfs courtes : stables, retrouvées même mal recopiées', () => {
    const a = rememberTask(task('a1', { listId: 'L9', title: 'Payer la cantine', due: TODAY }))
    expect(rememberTask(task('a1', { listId: 'L9', title: 'Payer la cantine' }))).toBe(a)
    expect(taskByReference(`réf ${a.toUpperCase()}`)).toMatchObject({ listId: 'L9', taskId: 'a1', title: 'Payer la cantine' })
    expect(taskByReference('t999999')).toBeUndefined()
    expect(taskByReference(42)).toBeUndefined()
  })

  it('les tâches suivent le choix « Agenda » et comptent comme un contenu venu d’ailleurs', () => {
    expect(TOOL_CATEGORY['mcp__compi__tasks_list']).toBe('calendar')
    expect(EXTERNAL_CONTENT_TOOLS).toContain('mcp__compi__tasks_list')
    // Modèle local à petite fenêtre : les tâches forment un groupe chargé à la demande.
    expect(COMPI_GROUPS.find((g) => g.id === 'taches')?.tools).toEqual(['tasks_list', 'tasks_create', 'tasks_complete', 'tasks_update'])
  })

  it('scène du plein écran : tâche ajoutée, terminée, modifiée ; rien en cas d’échec', () => {
    expect(stageDetail('mcp__compi__tasks_create', {}, 'Tâche ajoutée : « Payer la cantine », échéance demain (liste Maison).')).toEqual({
      kind: 'task',
      action: 'created',
      text: '« Payer la cantine », échéance demain (liste Maison)'
    })
    expect(stageDetail('mcp__compi__tasks_complete', {}, 'Tâche terminée : « Payer la cantine ».')).toEqual({
      kind: 'task',
      action: 'done',
      text: '« Payer la cantine »'
    })
    expect(stageDetail('mcp__compi__tasks_update', {}, 'Tâche modifiée (la même, aucun doublon) : « X » (liste M).')).toEqual({
      kind: 'task',
      action: 'updated',
      text: '« X » (liste M)'
    })
    expect(stageDetail('mcp__compi__tasks_create', {}, "Impossible d'ajouter la tâche : Google a répondu 500.")).toBeUndefined()
  })
})
