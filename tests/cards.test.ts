import { describe, expect, it } from 'vitest'
import {
  agendaCard,
  cardKey,
  CARD_MAX_EVENTS,
  CARD_MAX_FILES,
  CARD_MAX_MAILS,
  CARD_MAX_TASKS,
  folderCard,
  foundFilesCard,
  keyHours,
  mailsCard,
  meetingCard,
  meetingsCard,
  remindersCard,
  tasksCard,
  timerCard,
  weatherCard,
  webCard
} from '../src/shared/cards'
import type { DayEvent, Reminder, TaskItem } from '../src/shared/types'

const event = (over: Partial<DayEvent> = {}): DayEvent => ({
  id: 'e1',
  title: 'Point équipe',
  start: '2026-11-02T10:00:00+01:00',
  end: '2026-11-02T10:30:00+01:00',
  allDay: false,
  ...over
})

const task = (over: Partial<TaskItem> = {}): TaskItem => ({ id: 't1', listId: 'l1', list: 'Mes tâches', title: 'Appeler la banque', done: false, ...over })

describe('clé d’un appel d’outil', () => {
  it('ne dépend ni du préfixe du serveur, ni de l’ordre des paramètres, ni des absents', () => {
    expect(cardKey('mcp__compi__weather_forecast', { days: 2, city: 'Lyon' })).toBe(cardKey('weather_forecast', { city: 'Lyon', days: 2, from_day: undefined }))
    expect(cardKey('weather_forecast', { city: 'Lyon' })).not.toBe(cardKey('weather_forecast', { city: 'Paris' }))
    expect(cardKey('tasks_list', {})).toBe('tasks_list|[]')
  })
})

describe('heures clés de la météo', () => {
  const times = ['2026-11-02T08:00', '2026-11-02T09:00', '2026-11-02T12:00', '2026-11-02T15:00', '2026-11-02T18:00', '2026-11-03T09:00']
  it('prend 9 h, 12 h, 15 h et 18 h du bon jour, arrondies', () => {
    const hours = keyHours('2026-11-02', times, [5, 7.6, 11.2, 12.5, 9.4, 3], [0, 1, 2, 61, 3, 0], [0, 0, 10, 70, null, 0])
    expect(hours).toEqual([
      { hour: 9, temp: 8, code: 1, rain: 0 },
      { hour: 12, temp: 11, code: 2, rain: 10 },
      { hour: 15, temp: 13, code: 61, rain: 70 },
      { hour: 18, temp: 9, code: 3 }
    ])
  })
  it('saute les heures absentes (jour en cours de journée, données manquantes)', () => {
    expect(keyHours('2026-11-03', times, [0, 0, 0, 0, 0, 4], [], undefined)).toEqual([{ hour: 9, temp: 4 }])
    expect(keyHours('2026-11-04', times, [], [], undefined)).toEqual([])
  })
})

describe('carte météo', () => {
  it('garde la ville, les jours et leurs heures', () => {
    const card = weatherCard([
      { city: 'Lyon', label: 'Averses', code: 80, min: 6, max: 12, rain: 70, date: '2026-11-03', hours: [{ hour: 9, temp: 7 }] },
      { city: 'Lyon', label: 'Ensoleillé', code: 0, min: 4, max: 13, date: '2026-11-04' }
    ])
    expect(card).toEqual({
      kind: 'weather',
      place: 'Lyon',
      days: [
        { date: '2026-11-03', label: 'Averses', code: 80, min: 6, max: 12, rain: 70, hours: [{ hour: 9, temp: 7 }] },
        { date: '2026-11-04', label: 'Ensoleillé', code: 0, min: 4, max: 13 }
      ]
    })
  })
  it('rien à montrer sans prévisions', () => {
    expect(weatherCard([])).toBeUndefined()
  })
})

describe('carte agenda', () => {
  it('ne garde jamais les participants ni les liens de l’agenda', () => {
    const card = agendaCard('2026-11-02', 1, [
      event({
        attendees: [{ email: 'alex@example.com', name: 'Alex' }],
        htmlLink: 'https://calendar.google.com/x',
        calendarId: 'primary',
        meetUrl: 'https://meet.google.com/abc'
      })
    ])
    expect(card).toEqual({
      kind: 'agenda',
      from: '2026-11-02',
      days: 1,
      events: [
        { title: 'Point équipe', start: '2026-11-02T10:00:00+01:00', end: '2026-11-02T10:30:00+01:00', allDay: false, meetUrl: 'https://meet.google.com/abc' }
      ],
      more: 0
    })
    expect(JSON.stringify(card)).not.toContain('alex@example.com')
  })
  it('écarte un lien de visio qui n’est pas https, marque les tâches des connecteurs', () => {
    const card = agendaCard('2026-11-02', 1, [event({ meetUrl: 'javascript:alert(1)' }), event({ id: 'e2', kind: 'task', calendar: 'Twenty' })])
    if (card.kind !== 'agenda') throw new Error()
    expect(card.events[0].meetUrl).toBeUndefined()
    expect(card.events[1]).toMatchObject({ task: true, calendar: 'Twenty' })
  })
  it('coupe au-delà de la limite et compte le reste, raccourcit les longs titres', () => {
    const many = Array.from({ length: CARD_MAX_EVENTS + 3 }, (_, i) => event({ id: `e${i}`, title: i === 0 ? 'x'.repeat(500) : `R${i}` }))
    const card = agendaCard('2026-11-02', 7, many)
    if (card.kind !== 'agenda') throw new Error()
    expect(card.events).toHaveLength(CARD_MAX_EVENTS)
    expect(card.more).toBe(3)
    expect(card.events[0].title.length).toBeLessThanOrEqual(140)
  })
})

describe('carte tâches', () => {
  it('à faire d’abord, par échéance, sans échéance ensuite, avec leurs identifiants', () => {
    const card = tasksCard(
      [
        task({ id: 'a', title: 'Sans date' }),
        task({ id: 'b', title: 'Faite', done: true, due: '2026-11-01' }),
        task({ id: 'c', title: 'Demain', due: '2026-11-03' }),
        task({ id: 'd', title: 'Hier', due: '2026-11-01' })
      ],
      '2026-11-02'
    )
    if (card.kind !== 'tasks') throw new Error()
    expect(card.items.map((t) => t.id)).toEqual(['d', 'c', 'a', 'b'])
    expect(card.items[0]).toEqual({ id: 'd', listId: 'l1', title: 'Hier', due: '2026-11-01', list: 'Mes tâches', done: false })
    expect(card.today).toBe('2026-11-02')
  })
  it('n’emporte pas les notes, coupe au-delà de la limite', () => {
    const card = tasksCard(
      Array.from({ length: CARD_MAX_TASKS + 2 }, (_, i) => task({ id: `t${i}`, notes: 'code 1234' })),
      '2026-11-02'
    )
    if (card.kind !== 'tasks') throw new Error()
    expect(card.items).toHaveLength(CARD_MAX_TASKS)
    expect(card.more).toBe(2)
    expect(JSON.stringify(card)).not.toContain('1234')
  })
})

describe('carte rappels', () => {
  it('du plus proche au plus lointain, avec la répétition écrite', () => {
    const list: Reminder[] = [
      { id: 'r1', message: 'Sortir les poubelles', dueAt: 2_000, repeat: { every: 'week', days: [1], time: '19:00' } },
      { id: 'r2', message: 'Pause', dueAt: 1_000 }
    ]
    const card = remindersCard(list, (r) => (r.repeat ? 'chaque lundi' : undefined))
    expect(card).toEqual({
      kind: 'reminders',
      items: [
        { message: 'Pause', dueAt: 1_000 },
        { message: 'Sortir les poubelles', dueAt: 2_000, repeat: 'chaque lundi' }
      ],
      more: 0
    })
  })
})

describe('carte e-mails', () => {
  const mail = (i: number) => ({
    id: `m${i}`,
    from: 'Claire Martin <claire@example.com>',
    subject: `Facture ${i}`,
    snippet: 'Bonjour, voici la facture du mois. '.repeat(10),
    date: '2026-11-02T08:00:00Z',
    unread: i === 0,
    important: false
  })
  it('le nom de l’expéditeur seulement, un extrait court, et le total', () => {
    const card = mailsCard('from:claire facture', { total: 40, mails: Array.from({ length: CARD_MAX_MAILS + 2 }, (_, i) => mail(i)) })
    if (card.kind !== 'mails') throw new Error()
    expect(card.items).toHaveLength(CARD_MAX_MAILS)
    expect(card.total).toBe(40)
    expect(card.items[0]).toMatchObject({ id: 'm0', from: 'Claire Martin', subject: 'Facture 0', unread: true })
    expect(card.items[0].snippet!.length).toBeLessThanOrEqual(120)
    expect(JSON.stringify(card)).not.toContain('claire@example.com')
  })
})

describe('cartes fichiers et dossier', () => {
  it('fichiers trouvés : date ISO lue, taille gardée, reste compté', () => {
    const hits = Array.from({ length: CARD_MAX_FILES + 1 }, (_, i) => ({
      path: `C:/Docs/f${i}.pdf`,
      name: `f${i}.pdf`,
      modified: '2026-11-01T10:00:00Z',
      size: 2048
    }))
    const card = foundFilesCard('facture', [...hits, { path: 'C:/x', name: 'x', modified: 'n’importe quoi', size: null }])
    if (card.kind !== 'files') throw new Error()
    expect(card.items[0]).toEqual({ name: 'f0.pdf', path: 'C:/Docs/f0.pdf', kind: 'file', size: 2048, modified: Date.parse('2026-11-01T10:00:00Z') })
    expect(card.more).toBe(2)
    expect(card.query).toBe('facture')
  })
  it('dossier : sous-dossiers d’abord, puis le plus récent, sans fichiers système', () => {
    const card = folderCard('C:/Bureau', [
      { name: 'vieux.txt', path: 'C:/Bureau/vieux.txt', kind: 'file', size: 10, modified: 1, flags: [] },
      { name: 'desktop.ini', path: 'C:/Bureau/desktop.ini', kind: 'file', size: 1, modified: 9, flags: ['system'] },
      { name: 'récent.pdf', path: 'C:/Bureau/récent.pdf', kind: 'file', size: 10, modified: 5, flags: [] },
      { name: 'Projets', path: 'C:/Bureau/Projets', kind: 'folder', size: 999, modified: 2, flags: [] }
    ])
    if (card.kind !== 'files') throw new Error()
    expect(card.path).toBe('C:/Bureau')
    expect(card.items.map((i) => i.name)).toEqual(['Projets', 'récent.pdf', 'vieux.txt'])
    expect(card.items[0].size).toBeUndefined()
  })
})

describe('carte recherche web', () => {
  it('liens http(s) seulement ; rien sans source', () => {
    const card = webCard('météo lyon', [
      { title: 'Prévisions', url: 'https://meteo.example.com/lyon' },
      { title: 'Piège', url: 'javascript:alert(1)' }
    ])
    expect(card).toEqual({ kind: 'web', query: 'météo lyon', sources: [{ title: 'Prévisions', url: 'https://meteo.example.com/lyon' }] })
    expect(webCard('x', [{ title: 'a', url: 'file:///C:/a' }])).toBeUndefined()
  })
})

describe('cartes réunions', () => {
  const meta = { id: 'r1', title: 'Point équipe', startedAt: 1, durationMs: 1_800_000, hasSummary: true }
  it('liste : seulement ce qui s’affiche', () => {
    const card = meetingsCard([{ ...meta, status: 'done', engine: 'parakeet', others: true, audio: false } as never])
    expect(card).toEqual({ kind: 'meetings', items: [meta], more: 0 })
  })
  it('réunion lue : résumé, 5 points et 6 tâches au plus, jamais la transcription', () => {
    const card = meetingCard({
      ...meta,
      summary: {
        title: 'Point équipe',
        summary: 'On lance la version 2.',
        points: Array.from({ length: 8 }, (_, i) => `Point ${i}`),
        tasks: Array.from({ length: 9 }, (_, i) => ({ text: `Tâche ${i}`, owner: 'Paul' })),
        brain: 'local',
        at: 2
      },
      lines: [{ who: 's1', start: 0, end: 1, text: 'phrase secrète' }]
    } as never)
    if (card.kind !== 'meeting') throw new Error()
    expect(card.summary).toBe('On lance la version 2.')
    expect(card.points).toHaveLength(5)
    expect(card.tasks).toHaveLength(6)
    expect(card.tasks[0]).toEqual({ text: 'Tâche 0', owner: 'Paul' })
    expect(JSON.stringify(card)).not.toContain('phrase secrète')
  })
  it('sans résumé : la carte le dit (pas de points ni de tâches)', () => {
    const card = meetingCard({ ...meta, hasSummary: false })
    expect(card).toMatchObject({ kind: 'meeting', points: [], tasks: [] })
    expect('summary' in card).toBe(false)
  })
})

describe('carte minuteur', () => {
  it('garde l’état du moment', () => {
    const t = { kind: 'timer' as const, label: 'Pâtes', durationMs: 600_000, endsAt: 1_600_000 }
    expect(timerCard(t, 1_000_000)).toEqual({ kind: 'timer', timer: t, at: 1_000_000 })
  })
})
