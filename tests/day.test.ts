import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.' },
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false },
  Notification: class {
    show(): void {}
    on(): void {}
  }
}))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/bus', () => ({ emit: vi.fn() }))
vi.mock('../src/main/notchWindow', () => ({ sendIslandCommand: vi.fn() }))

const { nextOccurrence } = await import('../src/main/day/reminders')
const { repeatLabel, senderName } = await import('../src/shared/day')
const { repeatFrom } = await import('../src/main/agent/dayTools')
const { weatherLabel } = await import('../src/main/day/weather')
const { morningLine } = await import('../src/main/day/today')
const { alertDelay } = await import('../src/main/day/meetings')
const { EXTERNAL_CONTENT_TOOLS, filterAutoAllowed, isOutbound, privacyDecision } = await import('../src/shared/privacy')

// Mardi 13 octobre 2026, 10:00 (heure locale).
const NOW = new Date(2026, 9, 13, 10, 0).getTime()
const local = (y: number, mo: number, d: number, h: number, m = 0): number => new Date(y, mo - 1, d, h, m).getTime()

describe('rappels répétés', () => {
  it('chaque jour : aujourd’hui si l’heure n’est pas passée, sinon demain', () => {
    expect(nextOccurrence({ every: 'day', time: '18:30' }, NOW)).toBe(local(2026, 10, 13, 18, 30))
    expect(nextOccurrence({ every: 'day', time: '08:00' }, NOW)).toBe(local(2026, 10, 14, 8))
  })

  it('jours ouvrés : vendredi soir → lundi', () => {
    const fridayEvening = local(2026, 10, 16, 20)
    expect(nextOccurrence({ every: 'weekdays', time: '07:30' }, fridayEvening)).toBe(local(2026, 10, 19, 7, 30))
  })

  it('chaque semaine, plusieurs jours', () => {
    // Lundi (1) et jeudi (4) à 19:30, depuis mardi → jeudi.
    expect(nextOccurrence({ every: 'week', days: [1, 4], time: '19:30' }, NOW)).toBe(local(2026, 10, 15, 19, 30))
    // Depuis jeudi 20:00 → lundi suivant.
    expect(nextOccurrence({ every: 'week', days: [1, 4], time: '19:30' }, local(2026, 10, 15, 20))).toBe(local(2026, 10, 19, 19, 30))
  })

  it('chaque mois : le 31 devient le dernier jour des mois courts', () => {
    expect(nextOccurrence({ every: 'month', day: 31, time: '09:00' }, local(2026, 11, 1, 0))).toBe(local(2026, 11, 30, 9))
    expect(nextOccurrence({ every: 'month', day: 13, time: '09:00' }, NOW)).toBe(local(2026, 11, 13, 9))
  })

  it('changement d’heure : l’heure locale est gardée', () => {
    // Passage à l'heure d'hiver en France le 25 octobre 2026.
    const d = new Date(nextOccurrence({ every: 'day', time: '09:00' }, local(2026, 10, 25, 10)))
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([26, 9, 0])
  })

  it('libellés', () => {
    expect(repeatLabel({ every: 'week', days: [4, 1], time: '19:30' })).toBe('chaque lundi et jeudi à 19 h 30')
    expect(repeatLabel({ every: 'week', days: [0, 6], time: '10:00' })).toBe('chaque samedi et dimanche à 10 h')
    expect(repeatLabel({ every: 'weekdays', time: '07:05' })).toBe('du lundi au vendredi à 7 h 05')
    expect(repeatLabel({ every: 'month', day: 1, time: '09:00' })).toBe('le 1er de chaque mois à 9 h')
  })

  it('demande du modèle → règle', () => {
    const first = new Date(2026, 9, 15, 19, 30) // jeudi
    expect(repeatFrom('chaque_semaine', first)).toEqual({ every: 'week', days: [4], time: '19:30' })
    expect(repeatFrom('chaque_semaine', first, ['lundi', 'jeudi', 'lundi'])).toEqual({ every: 'week', days: [1, 4], time: '19:30' })
    expect(repeatFrom('chaque_mois', first)).toEqual({ every: 'month', day: 15, time: '19:30' })
    expect(repeatFrom('jamais', first)).toBeUndefined()
    expect(repeatFrom(undefined, first)).toBeUndefined()
  })
})

describe('ta journée', () => {
  it('météo : libellés des codes de l’OMM', () => {
    expect(weatherLabel(0)).toBe('Ciel dégagé')
    expect(weatherLabel(81)).toBe('Averses')
    expect(weatherLabel(95)).toBe('Orage')
    expect(weatherLabel(1234)).toBe('Temps variable')
  })

  it('résumé du matin', () => {
    const base = { date: '2026-10-13', google: { email: 'a@b.fr', calendar: true, mail: true }, agenda: true, reminders: [], errors: [] }
    const ev = (h: number, title: string) => ({
      id: title,
      title,
      start: new Date(local(2026, 10, 13, h)).toISOString(),
      end: new Date(local(2026, 10, 13, h + 1)).toISOString(),
      allDay: false
    })
    expect(
      morningLine(
        {
          ...base,
          events: [ev(8, 'Passé'), ev(14, 'Point'), ev(17, 'Dentiste')],
          unread: { count: 7, latest: [] },
          weather: { city: 'Nantes', label: 'Averses', min: 9, max: 15 }
        },
        'Alex',
        new Date(NOW)
      )
    ).toBe('Bonjour Alex ! 2 rendez-vous · 7 e-mails non lus · averses, 15 °C')
    const none = { ...base, google: { email: '', calendar: false, mail: false }, agenda: false, events: [] }
    expect(morningLine(none, '', new Date(NOW))).toBe('Bonjour ! Rien de prévu aujourd’hui.')
    // Messages en attente : le nombre seulement, jamais les noms.
    expect(morningLine(none, '', new Date(NOW), 2)).toBe('Bonjour ! 2 messages en attente')
    // Sans Google, une autre source d'agenda (connecteur, lien .ics) compte aussi.
    expect(morningLine({ ...none, agenda: true, events: [ev(14, 'Cours de piano')] }, '', new Date(NOW))).toBe('Bonjour ! 1 rendez-vous')
  })

  it('alerte de réunion : N minutes avant, tout de suite si on est déjà dedans, jamais pour la journée entière', () => {
    const e = (startMin: number, allDay = false) => ({
      id: 'x',
      title: 'Point',
      start: new Date(NOW + startMin * 60_000).toISOString(),
      end: new Date(NOW + (startMin + 30) * 60_000).toISOString(),
      allDay
    })
    expect(alertDelay(e(30), 5, NOW)).toBe(25 * 60_000)
    expect(alertDelay(e(3), 5, NOW)).toBe(0)
    expect(alertDelay(e(-10), 5, NOW)).toBeNull()
    expect(alertDelay(e(30, true), 5, NOW)).toBeNull()
  })

  it('nom de l’expéditeur', () => {
    expect(senderName('"Claire Martin" <claire@exemple.fr>')).toBe('Claire Martin')
    expect(senderName('noreply@edf.fr')).toBe('noreply@edf.fr')
  })
})

describe('garde-fou e-mails et agenda', () => {
  it('e-mails et agenda sont des catégories de confidentialité', () => {
    expect(privacyDecision('custom', 'mcp__compi__mail_read', { mail: 'never' } as never)).toBe('deny')
    expect(privacyDecision('anthropic', 'mcp__compi__calendar_events', undefined)).toBe('ask')
    expect(privacyDecision('local', 'mcp__compi__mail_search', { mail: 'never' } as never)).toBeNull()
    expect(EXTERNAL_CONTENT_TOOLS).toEqual(['mcp__compi__mail_search', 'mcp__compi__mail_read', 'mcp__compi__calendar_events'])
  })

  it('outils « sortants » : pages web, liens, connecteurs, commandes', () => {
    for (const t of ['WebFetch', 'WebSearch', 'Bash', 'mcp__compi__fetch_page', 'mcp__compi__open_url', 'mcp__notion-1a2b__search'])
      expect(isOutbound(t), t).toBe(true)
    for (const t of ['mcp__compi__read_document', 'mcp__compi__mail_read', 'mcp__compi__reminder_create', 'Read']) expect(isOutbound(t), t).toBe(false)
  })

  it('compte Google connecté : les outils sortants ne sont plus autorisés d’office (canUseTool décide)', () => {
    const tools = ['WebFetch', 'mcp__compi__get_datetime', 'mcp__compi__fetch_page']
    expect(filterAutoAllowed(tools, 'anthropic', undefined, tools.filter(isOutbound))).toEqual(['mcp__compi__get_datetime'])
  })
})
