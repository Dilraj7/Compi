import { describe, expect, it } from 'vitest'
import {
  cleanEventLink,
  eventLink,
  isPreparable,
  MAX_ATTENDEES,
  otherAttendees,
  pickPrevious,
  prepDelay,
  prepKey,
  prepMailQuery
} from '../src/shared/meetingPrep'
import type { DayEvent, MeetingEventLink, MeetingMeta } from '../src/shared/types'

const NOW = Date.parse('2026-10-28T09:00:00Z')
const event = (over: Partial<DayEvent> = {}): DayEvent => ({
  id: 'ev1',
  title: 'Point équipe',
  start: '2026-10-28T10:00:00Z',
  end: '2026-10-28T10:30:00Z',
  allDay: false,
  attendees: [{ email: 'claire@example.com', name: 'Claire Martin' }],
  ...over
})
const meta = (over: Partial<MeetingMeta>): MeetingMeta => ({
  id: 'm',
  title: 'Réunion',
  startedAt: NOW - 7 * 86_400_000,
  durationMs: 1_800_000,
  status: 'done',
  engine: 'parakeet',
  others: true,
  hasSummary: true,
  audio: false,
  ...over
})
const link = (over: Partial<MeetingEventLink> = {}): MeetingEventLink => ({
  id: 'ev1',
  title: 'Point équipe',
  start: '2026-10-28T10:00:00Z',
  attendees: ['claire@example.com'],
  ...over
})

describe('participants', () => {
  it('sans toi, sans les salles ni ceux qui ont décliné, une fois chacun', () => {
    const list = otherAttendees(
      [
        { email: 'Claire@Example.com', name: 'Claire Martin', organizer: true },
        { email: 'claire@example.com', name: 'Claire' },
        { email: 'alex@example.com', name: 'Alex' },
        { email: 'moi@example.com', self: true },
        { email: 'salle-b@resource.example.com', name: 'Salle B', resource: true },
        { email: 'paul@example.com', declined: true },
        { name: 'Léa' },
        { email: 'pas une adresse', name: '' }
      ],
      'ALEX@example.com'
    )
    expect(list).toEqual([{ email: 'claire@example.com', name: 'Claire Martin', organizer: true }, { name: 'Léa' }])
  })

  it('l’organisateur aussi invité devient une seule ligne marquée organisateur', () => {
    expect(otherAttendees([{ email: 'paul@example.com' }, { email: 'paul@example.com', name: 'Paul', organizer: true }])).toEqual([
      { email: 'paul@example.com', name: 'Paul', organizer: true }
    ])
  })

  it('au plus 30 personnes gardées', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ email: `p${i}@example.com` }))
    expect(otherAttendees(many)).toHaveLength(MAX_ATTENDEES)
  })
})

describe('quand proposer la préparation', () => {
  it('10 min avant, seulement pour une réunion avec horaire et d’autres personnes', () => {
    expect(prepDelay(event(), 10, NOW)).toBe(50 * 60_000)
    expect(prepDelay(event({ attendees: undefined }), 10, NOW)).toBeNull()
    expect(prepDelay(event({ attendees: [] }), 10, NOW)).toBeNull()
    expect(prepDelay(event({ allDay: true, start: '2026-10-28', end: '2026-10-29' }), 10, NOW)).toBeNull()
    expect(isPreparable(event({ attendees: [] }))).toBe(false)
  })

  it('tout de suite si on est déjà dans les 10 min ; rien si elle a commencé', () => {
    expect(prepDelay(event({ start: '2026-10-28T09:05:00Z' }), 10, NOW)).toBe(0)
    expect(prepDelay(event({ start: '2026-10-28T09:00:00Z' }), 10, NOW)).toBeNull()
    expect(prepDelay(event({ start: '2026-10-28T08:30:00Z' }), 10, NOW)).toBeNull()
  })

  it('clé stable par rendez-vous et par horaire (un déplacement donne une nouvelle préparation)', () => {
    expect(prepKey(event())).toBe('ev1|2026-10-28T10:00:00Z')
    expect(prepKey(event({ start: '2026-10-28T11:00:00Z' }))).not.toBe(prepKey(event()))
  })
})

describe('recherche des derniers e-mails', () => {
  it('de, à ou en copie, 30 derniers jours, adresses en double retirées', () => {
    expect(prepMailQuery(['Claire@example.com', 'claire@example.com', 'paul@example.com'])).toBe(
      '{from:claire@example.com to:claire@example.com cc:claire@example.com from:paul@example.com to:paul@example.com cc:paul@example.com} newer_than:30d'
    )
  })

  it('rien qui puisse changer la recherche Gmail, au plus 10 personnes', () => {
    expect(prepMailQuery(['x@example.com OR subject:facture', 'a b@example.com', '{y@example.com}'])).toBeNull()
    expect(prepMailQuery([])).toBeNull()
    const q = prepMailQuery(Array.from({ length: 15 }, (_, i) => `p${i}@example.com`)) ?? ''
    expect(q.match(/from:/g)).toHaveLength(10)
  })
})

describe('lien avec l’enregistrement', () => {
  it('l’enregistrement garde le titre, l’horaire, la série et les adresses seulement', () => {
    expect(
      eventLink(
        event({ seriesId: 's1', attendees: [{ email: 'claire@example.com', name: 'Claire Martin', organizer: true }, { name: 'Léa' }], location: 'Salle B' })
      )
    ).toEqual({ id: 'ev1', seriesId: 's1', title: 'Point équipe', start: '2026-10-28T10:00:00Z', attendees: ['claire@example.com'] })
  })

  it('lien venu de l’îlot vérifié : champs obligatoires, tailles bornées, adresses valides', () => {
    expect(cleanEventLink(null)).toBeUndefined()
    expect(cleanEventLink({ id: 'a', title: 'T', start: 'demain' })).toBeUndefined()
    expect(cleanEventLink({ id: 'a', title: '  ', start: '2026-10-28T10:00:00Z' })).toBeUndefined()
    expect(
      cleanEventLink({ id: 'a', title: 'x'.repeat(500), start: '2026-10-28T10:00:00Z', attendees: ['A@example.com', 'a@example.com', 'pas une adresse', 42] })
    ).toEqual({
      id: 'a',
      title: 'x'.repeat(200),
      start: '2026-10-28T10:00:00Z',
      attendees: ['a@example.com']
    })
  })
})

describe('la réunion d’avant', () => {
  it('même série d’abord, la plus récente', () => {
    const list = [
      meta({ id: 'old', startedAt: NOW - 14 * 86_400_000, event: { ...link({ id: 'o', seriesId: 's1' }) } }),
      meta({ id: 'last', startedAt: NOW - 7 * 86_400_000, title: 'Renommée après coup', event: { ...link({ id: 'l', seriesId: 's1' }) } }),
      meta({ id: 'title', startedAt: NOW - 86_400_000, title: 'Point équipe' })
    ]
    expect(pickPrevious(link({ seriesId: 's1' }), list)?.id).toBe('last')
  })

  it('sinon même titre avec quelqu’un en commun', () => {
    const list = [
      meta({ id: 'autres', event: link({ id: 'x', attendees: ['inconnu@example.com'] }) }),
      meta({ id: 'commun', startedAt: NOW - 8 * 86_400_000, event: link({ id: 'y', title: 'point equipe', attendees: ['CLAIRE@example.com'] }) })
    ]
    expect(pickPrevious(link(), list)?.id).toBe('commun')
  })

  it('sinon un titre très proche, jamais un « Appel du … » ni un titre d’un seul mot', () => {
    expect(pickPrevious(link({ title: 'Revue budget trimestre' }), [meta({ id: 'proche', title: 'Revue du budget, trimestre 3' })])?.id).toBe('proche')
    expect(pickPrevious(link({ title: 'Appel du 20 oct., 17 h 40' }), [meta({ title: 'Appel du 21 oct., 17 h 40' })])).toBeNull()
    expect(pickPrevious(link({ title: 'Point' }), [meta({ title: 'Point' })])).toBeNull()
    expect(pickPrevious(link(), [meta({ title: 'Dentiste' })])).toBeNull()
  })

  it('seulement les réunions terminées, commencées avant celle-ci', () => {
    const series = link({ seriesId: 's1' })
    expect(pickPrevious(series, [meta({ status: 'interrupted', event: link({ id: 'i', seriesId: 's1' }) })])).toBeNull()
    // Enregistrement lancé à l'heure de cette réunion : c'est elle, pas celle d'avant.
    expect(pickPrevious(series, [meta({ startedAt: Date.parse(series.start), event: link({ id: 'n', seriesId: 's1' }) })])).toBeNull()
  })
})
