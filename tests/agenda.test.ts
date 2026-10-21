import { describe, expect, it } from 'vitest'
import {
  argsFor,
  argsSpec,
  catalogEntries,
  extractEvents,
  findGateway,
  icsUrl,
  isTimedMeeting,
  localDay,
  localIso,
  mergeEvents,
  payloadError,
  rankAgendaTools,
  readDate,
  toolUsable,
  type McpToolInfo
} from '../src/shared/agenda'
import { parseIcs } from '../src/main/day/ics'
import type { AgendaToolArgs, DayEvent } from '../src/shared/types'

// Jeudi 15 octobre 2026 (heure locale du PC qui lance les tests).
const FROM = new Date(2026, 9, 15)
const TO = new Date(2026, 9, 16)
const local = (d: number, h: number, m = 0): string => new Date(2026, 9, d, h, m).toISOString()

// Un connecteur d'agenda familial quelconque : rien de ce nom n'est connu de Compi.
const FAMILY_TOOLS: McpToolInfo[] = [
  { name: 'add_grocery_item', description: 'Add an item to the grocery list', inputSchema: { properties: { name: { type: 'string' } }, required: ['name'] } },
  {
    name: 'create_event',
    description: 'Create a family calendar event',
    inputSchema: { properties: { title: { type: 'string' }, start: { type: 'string' } }, required: ['title', 'start'] }
  },
  { name: 'delete_event', description: 'Delete an event', inputSchema: { properties: { id: { type: 'string' } }, required: ['id'] } },
  {
    name: 'list_events',
    description: 'List family events between two dates',
    inputSchema: {
      properties: {
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'integer', maximum: 500 }
      }
    }
  },
  { name: 'get_family_overview', description: 'Overview of members, upcoming events and tasks', inputSchema: { properties: {} } },
  { name: 'list_grocery_items', description: 'List grocery items', inputSchema: { properties: {} } }
]

describe('choisir l’outil d’un connecteur', () => {
  it('connecteur d’agenda : l’outil de lecture des événements en premier, les écritures signalées', () => {
    const ranked = rankAgendaTools(FAMILY_TOOLS)
    expect(ranked[0]).toMatchObject({ tool: 'list_events' })
    expect(ranked[0].problem).toBeUndefined()
    expect(ranked.find((t) => t.tool === 'get_family_overview')?.problem).toBeUndefined()
    for (const name of ['create_event', 'delete_event']) expect(ranked.find((t) => t.tool === name)?.problem, name).toMatch(/modifier/)
    // Les outils signalés passent après tous les autres.
    const firstProblem = ranked.findIndex((t) => t.problem)
    expect(ranked.slice(firstProblem).every((t) => t.problem)).toBe(true)
  })

  it('un outil marqué « lecture seule » par le serveur n’est pas pris pour une écriture', () => {
    const tool: McpToolInfo = { name: 'sync_calendar_events', annotations: { readOnlyHint: true }, inputSchema: { properties: {} } }
    expect(rankAgendaTools([tool])[0].problem).toBeUndefined()
    expect(toolUsable(tool)).toEqual({ format: 'datetime', fixed: {} })
    // Et un outil « destructeur » l'est, quel que soit son nom.
    expect(toolUsable({ name: 'events', annotations: { destructiveHint: true } })).toBeNull()
  })

  it('un paramètre obligatoire inconnu (identifiant, requête) rend l’outil inutilisable', () => {
    const search: McpToolInfo = {
      name: 'notion-search',
      description: 'Search the workspace',
      inputSchema: { properties: { query: { type: 'string' } }, required: ['query'] }
    }
    expect(rankAgendaTools([search])[0].problem).toMatch(/query/)
    expect(toolUsable(search)).toBeNull()
  })

  it('aucun outil ne parle d’agenda : les outils de lecture sont proposés quand même, pas les écritures', () => {
    const ranked = rankAgendaTools([{ name: 'records' }, { name: 'insert_record' }])
    expect(ranked.map((t) => t.tool)).toEqual(['records'])
  })
})

describe('remplir les paramètres', () => {
  it('début, fin, format « date » et limite plafonnée', () => {
    const tool = FAMILY_TOOLS.find((t) => t.name === 'list_events')!
    expect(argsSpec(tool)).toEqual({ args: { from: 'start_date', to: 'end_date', format: 'date', fixed: { limit: 100 } } })
    expect(argsFor((argsSpec(tool) as { args: never }).args, FROM, TO)).toEqual([{ limit: 100, start_date: '2026-10-15', end_date: '2026-10-16' }])
  })

  it('timeMin / timeMax : heure locale avec décalage, qui désigne bien le même instant', () => {
    const spec = argsSpec({ name: 'events', inputSchema: { properties: { timeMin: { type: 'string', format: 'date-time' }, timeMax: { type: 'string' } } } })
    expect(spec).toEqual({ args: { from: 'timeMin', to: 'timeMax', format: 'datetime', fixed: {} } })
    const [call] = argsFor((spec as { args: never }).args, FROM, TO)
    expect(call.timeMin).toMatch(/^2026-10-15T00:00:00[+-]\d{2}:\d{2}$/)
    expect(Date.parse(call.timeMin as string)).toBe(FROM.getTime())
  })

  it('fuseau horaire exigé (Notion Calendar) : celui du PC, et l’outil devient utilisable', () => {
    // Schéma réel de notion-calendar-list-events (octobre 2026).
    const tool: McpToolInfo = {
      name: 'notion-calendar-list-events',
      description: 'List the user’s events across connected calendars within a time range.',
      inputSchema: {
        properties: {
          includeDeclinedInvites: { type: 'boolean' },
          instructions_version: { type: 'string' },
          timeMax: { type: 'string', description: 'End of the time range, as an ISO 8601 date-time.' },
          timeMin: { type: 'string', description: 'Start of the time range, as an ISO 8601 date-time.' },
          timeZone: { type: 'string', description: 'Date-times of returned events will be expressed in this time-zone' }
        },
        required: ['timeMin', 'timeMax', 'timeZone']
      }
    }
    expect(argsSpec(tool)).toEqual({ args: { from: 'timeMin', to: 'timeMax', zone: 'timeZone', format: 'datetime', fixed: {} } })
    expect(toolUsable(tool)).not.toBeNull()
    const [call] = argsFor((argsSpec(tool) as { args: never }).args, FROM, TO)
    expect(call.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone)
    expect(Date.parse(call.timeMin as string)).toBe(FROM.getTime())
    expect(rankAgendaTools([tool])[0]).toEqual({ tool: tool.name, description: tool.description })
  })

  it('un seul jour par appel : un appel par jour, 14 au plus', () => {
    const spec = argsSpec({ name: 'agenda_for_day', inputSchema: { properties: { date: { type: 'string', format: 'date' } }, required: ['date'] } })
    expect(spec).toEqual({ args: { day: 'date', format: 'date', fixed: {} } })
    const args = (spec as { args: never }).args
    expect(argsFor(args, FROM, new Date(2026, 9, 18))).toEqual([{ date: '2026-10-15' }, { date: '2026-10-16' }, { date: '2026-10-17' }])
    expect(argsFor(args, FROM, new Date(2026, 11, 31))).toHaveLength(14)
  })
})

describe('lire la réponse d’un outil', () => {
  it('réponse structurée, style Google (start.dateTime), lieu en objet, lien de visio', () => {
    const r = extractEvents(
      {
        structuredContent: {
          items: [
            {
              id: 'a1',
              summary: 'Point équipe',
              start: { dateTime: '2026-10-15T10:00:00+02:00' },
              end: { dateTime: '2026-10-15T10:30:00+02:00' },
              location: { name: 'Salle Rhône' },
              joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc'
            },
            { id: 'a2', summary: 'Annulé', status: 'cancelled', start: { dateTime: '2026-10-15T12:00:00+02:00' } }
          ]
        }
      },
      FROM,
      TO,
      'Travail'
    )
    expect(r.readable).toBe(true)
    expect(r.events).toEqual([
      {
        id: 'a1',
        title: 'Point équipe',
        start: '2026-10-15T08:00:00.000Z',
        end: '2026-10-15T08:30:00.000Z',
        allDay: false,
        location: 'Salle Rhône',
        calendar: 'Travail',
        meetUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
        htmlLink: 'https://teams.microsoft.com/l/meetup-join/abc'
      }
    ])
  })

  it('JSON dans un texte, date et heures dans des champs séparés (heure locale)', () => {
    const r = extractEvents(
      { content: [{ type: 'text', text: 'Voici les événements :\n[{"name":"Dentiste","date":"2026-10-15","start_time":"17:30","end_time":"18:00"}]' }] },
      FROM,
      TO
    )
    expect(r.events).toMatchObject([{ title: 'Dentiste', start: local(15, 17, 30), end: local(15, 18), allDay: false }])
  })

  it('journée entière, date en secondes depuis 1970, échéance ponctuelle', () => {
    const at = Math.floor(new Date(2026, 9, 15, 9).getTime() / 1000)
    const r = extractEvents(
      {
        structuredContent: {
          data: [
            { title: 'Anniversaire de Léa', startDate: '2026-10-15', allDay: true },
            { subject: 'Appel', startsAt: at, endsAt: at + 1800 },
            { title: 'Rendre le dossier', dueDate: '2026-10-15T16:00:00' }
          ]
        }
      },
      FROM,
      TO
    )
    expect(r.events.map((e) => [e.title, e.start, e.end, e.allDay])).toEqual([
      ['Anniversaire de Léa', '2026-10-15', '2026-10-16', true],
      ['Appel', local(15, 9), local(15, 9, 30), false],
      ['Rendre le dossier', local(15, 16), local(15, 16), false]
    ])
    expect(r.events.map(isTimedMeeting)).toEqual([false, true, false])
  })

  it('hors de la période : écarté, mais compté dans « found » (pour juger l’outil)', () => {
    const r = extractEvents({ structuredContent: [{ title: 'Demain', start: '2026-10-16T10:00:00Z', end: '2026-10-16T11:00:00Z' }] }, FROM, TO)
    expect(r).toEqual({ events: [], readable: true, found: 1 })
  })

  it('agenda vide : lisible ; texte libre : illisible', () => {
    expect(extractEvents({ content: [{ type: 'text', text: '{"events": []}' }] }, FROM, TO)).toEqual({ events: [], readable: true, found: 0 })
    expect(extractEvents({ content: [{ type: 'text', text: '## Aujourd’hui\n- 10:00 Point équipe\n- 17:30 Dentiste' }] }, FROM, TO).readable).toBe(false)
  })

  it('dates : formats acceptés et refusés', () => {
    expect(readDate('2026-10-15')).toEqual({ iso: '2026-10-15', allDay: true })
    expect(readDate('2026-10-15 09:15')).toEqual({ iso: local(15, 9, 15), allDay: false })
    expect(readDate({ date: '2026-10-15' })).toEqual({ iso: '2026-10-15', allDay: true })
    expect(readDate('10:00')).toBeNull()
    expect(readDate(42)).toBeNull()
  })
})

describe('plusieurs sources', () => {
  it('sans doublon (même titre, même début), du plus tôt au plus tard', () => {
    const e = (title: string, start: string, calendar?: string): DayEvent => ({
      id: title,
      title,
      start,
      end: start,
      allDay: false,
      ...(calendar ? { calendar } : {})
    })
    const merged = mergeEvents([[e('Dentiste', local(15, 17))], [e('dentiste', local(15, 17), 'Famille'), e('Piano', local(15, 9), 'Famille')]])
    expect(merged.map((x) => x.title)).toEqual(['Piano', 'Dentiste'])
  })
})

describe('liens .ics', () => {
  it('webcal devient https ; http refusé sauf sur le PC lui-même', () => {
    expect(icsUrl(' webcal://p01-caldav.icloud.com/published/2/abc ')).toEqual({ url: 'https://p01-caldav.icloud.com/published/2/abc' })
    expect(icsUrl('http://exemple.fr/agenda.ics')).toEqual({ problem: expect.stringMatching(/https/) })
    expect(icsUrl('http://127.0.0.1:8123/a.ics')).toEqual({ url: 'http://127.0.0.1:8123/a.ics' })
    expect(icsUrl('agenda')).toEqual({ problem: expect.any(String) })
  })
})

const OUTLOOK_TZ = `BEGIN:VTIMEZONE
TZID:Romance Standard Time
BEGIN:STANDARD
DTSTART:16010101T030000
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:16010101T020000
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3
END:DAYLIGHT
END:VTIMEZONE`

const ics = (...events: string[]): string =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//FR', OUTLOOK_TZ, ...events, 'END:VCALENDAR'].join('\r\n').replace(/\r?\n/g, '\r\n')

describe('agendas .ics', () => {
  it('fuseau Outlook défini dans le fichier, UTC, fuseau IANA nommé seul', () => {
    const text = ics(
      'BEGIN:VEVENT\nUID:o1\nDTSTART;TZID=Romance Standard Time:20261015T100000\nDTEND;TZID=Romance Standard Time:20261015T110000\nSUMMARY:Point\nLOCATION:https://zoom.us/j/123\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:u1\nDTSTART:20261015T150000Z\nDTEND:20261015T153000Z\nSUMMARY:Appel UTC\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:n1\nDTSTART;TZID=America/New_York:20261015T100000\nDTEND;TZID=America/New_York:20261015T110000\nSUMMARY:New York\nEND:VEVENT'
    )
    const events = parseIcs(text, new Date('2026-10-14T00:00:00Z'), new Date('2026-10-17T00:00:00Z'), 'Bureau')
    expect(events.map((e) => [e.title, e.start, e.end])).toEqual([
      ['Point', '2026-10-15T08:00:00.000Z', '2026-10-15T09:00:00.000Z'],
      ['New York', '2026-10-15T14:00:00.000Z', '2026-10-15T15:00:00.000Z'],
      ['Appel UTC', '2026-10-15T15:00:00.000Z', '2026-10-15T15:30:00.000Z']
    ])
    expect(events[0]).toMatchObject({ calendar: 'Bureau', location: 'https://zoom.us/j/123', meetUrl: 'https://zoom.us/j/123' })
  })

  it('répétition hebdomadaire : date exclue, séance déplacée, changement d’heure', () => {
    const text = ics(
      'BEGIN:VEVENT\nUID:w1\nDTSTART;TZID=Romance Standard Time:20261005T180000\nDTEND;TZID=Romance Standard Time:20261005T190000\nRRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=10\nEXDATE;TZID=Romance Standard Time:20261012T180000\nSUMMARY:Piano\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:w1\nRECURRENCE-ID;TZID=Romance Standard Time:20261019T180000\nDTSTART;TZID=Romance Standard Time:20261019T183000\nDTEND;TZID=Romance Standard Time:20261019T193000\nSUMMARY:Piano (décalé)\nEND:VEVENT'
    )
    const events = parseIcs(text, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-03T00:00:00Z'))
    expect(events.map((e) => [e.title, e.start])).toEqual([
      ['Piano', '2026-10-05T16:00:00.000Z'],
      ['Piano (décalé)', '2026-10-19T16:30:00.000Z'],
      // Heure d'hiver depuis le 25 octobre : 18 h à Paris = 17 h UTC.
      ['Piano', '2026-10-26T17:00:00.000Z'],
      ['Piano', '2026-11-02T17:00:00.000Z']
    ])
  })

  it('journée entière, événement annulé, événement hors période', () => {
    const text = ics(
      'BEGIN:VEVENT\nUID:d1\nDTSTART;VALUE=DATE:20261015\nDTEND;VALUE=DATE:20261016\nSUMMARY:Sortie scolaire\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:c1\nDTSTART:20261015T090000Z\nDTEND:20261015T100000Z\nSTATUS:CANCELLED\nSUMMARY:Annulé\nEND:VEVENT',
      'BEGIN:VEVENT\nUID:l1\nDTSTART:20261120T090000Z\nDTEND:20261120T100000Z\nSUMMARY:Plus tard\nEND:VEVENT'
    )
    const events = parseIcs(text, FROM, TO)
    expect(events).toEqual([{ id: 'd1|2026-10-15', title: 'Sortie scolaire', start: '2026-10-15', end: '2026-10-16', allDay: true, meetUrl: undefined }])
  })

  it('événement quotidien depuis des années : seulement la période, rapidement', () => {
    const text = ics('BEGIN:VEVENT\nUID:q1\nDTSTART:20000101T070000Z\nDTEND:20000101T071500Z\nRRULE:FREQ=DAILY\nSUMMARY:Médicament\nEND:VEVENT')
    const t0 = Date.now()
    const events = parseIcs(text, new Date('2026-10-15T00:00:00Z'), new Date('2026-10-17T00:00:00Z'))
    expect(events.map((e) => e.start)).toEqual(['2026-10-15T07:00:00.000Z', '2026-10-16T07:00:00.000Z'])
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('jour local d’un événement .ics « journée entière »', () => {
    const [e] = parseIcs(ics('BEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20261231\nSUMMARY:Réveillon\nEND:VEVENT'), new Date(2026, 11, 31), new Date(2027, 0, 1))
    expect([e.start, e.end, localDay(new Date(`${e.end}T12:00:00`))]).toEqual(['2026-12-31', '2027-01-01', '2027-01-01'])
  })
})

// Connecteur « passerelle » façon CRM : catalogue → schémas → exécution. Formes de données
// relevées sur un vrai connecteur (noms d'outils et schémas seulement).
const GATEWAY_TOOLS: McpToolInfo[] = [
  {
    name: 'get_tool_catalog',
    description: 'STEP 1: Start here. Browse available tools by category.',
    inputSchema: { properties: { categories: { type: 'array' } } }
  },
  {
    name: 'learn_tools',
    description: 'Get input schemas for tools.',
    inputSchema: { properties: { toolNames: { type: 'array' }, aspects: { type: 'array' } }, required: ['toolNames'] }
  },
  {
    name: 'execute_tool',
    description: 'Execute a tool by name with arguments.',
    inputSchema: { properties: { toolName: { type: 'string' }, arguments: { type: 'object' } }, required: ['toolName', 'arguments'] }
  },
  { name: 'list_skills', description: 'List all available skill names.', inputSchema: { properties: {} } }
]

const DATE_FILTER = {
  type: 'object',
  properties: {
    eq: { type: 'string', format: 'date-time' },
    gte: { type: 'string', format: 'date-time' },
    lt: { type: 'string', format: 'date-time' },
    lte: { type: 'string', format: 'date-time' }
  }
}
const findMany = (fields: Record<string, unknown>): McpToolInfo['inputSchema'] =>
  ({
    properties: {
      limit: { type: 'integer', description: 'Maximum number of records (default: 10, max: 100).' },
      offset: { type: 'integer' },
      select: { type: 'array', items: { type: 'string' }, description: "Fields to include. Required. Use '*' to return all fields." },
      title: { $ref: '#/$defs/text' },
      ...fields,
      or: { type: 'array', items: { $ref: '#/$defs/filter' } },
      and: { type: 'array', description: 'AND condition - matches if ALL filters match', items: { $ref: '#/$defs/filter' } }
    },
    required: ['select'],
    $defs: { text: { type: 'object', properties: { eq: { type: 'string' }, ilike: { type: 'string' } } }, date: DATE_FILTER, filter: { type: 'object' } }
  }) as McpToolInfo['inputSchema']

describe('connecteur « passerelle » (catalogue → schémas → exécution)', () => {
  it('repère le catalogue, l’outil des schémas et l’outil d’exécution, d’après les schémas seulement', () => {
    expect(findGateway(GATEWAY_TOOLS)).toEqual({
      catalog: 'get_tool_catalog',
      learn: { tool: 'learn_tools', key: 'toolNames', array: true },
      execute: { tool: 'execute_tool', nameKey: 'toolName', argsKey: 'arguments' }
    })
    expect(findGateway(FAMILY_TOOLS)).toBeNull()
    // Un « catalogue » qui pourrait écrire n'est jamais appelé tout seul.
    expect(findGateway([GATEWAY_TOOLS[2], { name: 'sync_tools', inputSchema: { properties: {} } }])).toBeNull()
  })

  it('lit le catalogue (par catégories) et les schémas', () => {
    const catalog = catalogEntries({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            catalog: {
              ACTION: [{ name: 'send_email', description: 'Send an email.' }],
              DATABASE_CRUD: [
                { name: 'find_many_calendar_events', description: 'Search for Calendar events records.' },
                { name: 'find_many_calendar_event_participants', description: 'Search for Calendar event participants records.' },
                { name: 'find_many_calendar_channel_event_associations', description: 'Search for Calendar Channel Event Associations records.' },
                { name: 'delete_many_calendar_events', description: 'Soft-delete multiple Calendar events.' },
                { name: 'find_many_tasks', description: 'Search for Tasks records.' },
                { name: 'find_many_companies', description: 'Search for Companies records.' }
              ]
            },
            message: 'Found 6 tools.'
          })
        }
      ]
    })
    expect(catalog.map((t) => t.name)).toContain('find_many_tasks')
    const ranked = rankAgendaTools(catalog, { strict: true })
    expect(ranked[0].tool).toBe('find_many_calendar_events')
    expect(ranked.find((t) => t.tool === 'delete_many_calendar_events')?.problem).toMatch(/modifier/)
    expect(ranked.findIndex((t) => t.tool === 'find_many_calendar_event_participants')).toBeGreaterThan(0)
    expect(ranked.some((t) => t.tool === 'send_email' && !t.problem)).toBe(false)
    // Un enregistrement par identifiant ou des statistiques passent après les listes.
    const crowded = rankAgendaTools(
      [
        ...['find_one_calendar_event', 'group_by_calendar_events', 'find_one_calendar_event_participant', 'group_by_calendar_event_participants'].map(
          (name) => ({
            name,
            description: 'Calendar event'
          })
        ),
        ...catalog
      ],
      { strict: true }
    ).filter((t) => !t.problem)
    const at = (name: string): number => crowded.findIndex((t) => t.tool === name)
    expect(at('find_many_calendar_events')).toBeLessThan(at('find_one_calendar_event'))
    expect(at('find_many_calendar_event_participants')).toBeLessThan(at('find_one_calendar_event_participant'))
    expect(crowded.at(-1)?.tool).toMatch(/^group_by/)
    // Ce qui ne parle ni d'agenda ni de tâches n'est pas proposé.
    expect(ranked.some((t) => t.tool === 'find_many_companies')).toBe(false)

    const learned = catalogEntries({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ tools: [{ name: 'find_many_tasks', description: 'Tasks', inputSchema: findMany({ dueAt: { $ref: '#/$defs/date' } }) }] })
        }
      ]
    })
    expect(learned[0].inputSchema?.required).toEqual(['select'])
  })

  it('filtre sur un champ date (« startsAt: { gte, lt } »), tous les champs, limite', () => {
    const events: McpToolInfo = {
      name: 'find_many_calendar_events',
      inputSchema: findMany({ startsAt: { $ref: '#/$defs/date' }, endsAt: { $ref: '#/$defs/date' }, externalCreatedAt: { $ref: '#/$defs/date' } })
    }
    const spec = argsSpec(events)
    expect(spec).toEqual({ args: { range: { field: 'startsAt', gte: 'gte', lt: 'lt', and: 'and' }, format: 'datetime', fixed: { limit: 100, select: ['*'] } } })
    const args = (spec as { args: AgendaToolArgs }).args
    expect(argsFor(args, FROM, TO)).toEqual([{ limit: 100, select: ['*'], startsAt: { gte: localIso(FROM), lt: localIso(TO) } }])
    // Service qui n'accepte qu'un opérateur par champ : une condition par borne, réunies par « and ».
    expect(argsFor({ ...args, range: { ...args.range!, split: true } }, FROM, TO)).toEqual([
      { limit: 100, select: ['*'], and: [{ startsAt: { gte: localIso(FROM) } }, { startsAt: { lt: localIso(TO) } }] }
    ])
    // Avec un filtre de date, l'outil des événements passe devant celui des participants.
    const participants: McpToolInfo = { name: 'find_many_calendar_event_participants', inputSchema: findMany({ displayName: { $ref: '#/$defs/text' } }) }
    expect(rankAgendaTools([participants, events]).map((t) => t.tool)).toEqual(['find_many_calendar_events', 'find_many_calendar_event_participants'])
    // Une fois les schémas lus : les tâches (filtre sur l'échéance) devant les participants, la lecture par identifiant en dernier.
    const tasks: McpToolInfo = { name: 'find_many_tasks', description: 'Search for Tasks records.', inputSchema: findMany({ dueAt: { $ref: '#/$defs/date' } }) }
    participants.description = 'Search for Calendar event participants records.'
    const one: McpToolInfo = { name: 'find_one_calendar_event', inputSchema: { properties: { id: { type: 'string' } }, required: ['id'] } }
    expect(rankAgendaTools([one, participants, tasks, events]).map((t) => t.tool)).toEqual([
      'find_many_calendar_events',
      'find_many_tasks',
      'find_many_calendar_event_participants',
      'find_one_calendar_event'
    ])
  })

  it('une liste de champs obligatoire sans « * » ni valeurs permises : inutilisable', () => {
    const tool: McpToolInfo = {
      name: 'find_events',
      inputSchema: { properties: { fields: { type: 'array', items: { type: 'string' } } }, required: ['fields'] }
    }
    expect(argsSpec(tool)).toEqual({ problem: expect.stringMatching(/fields/) })
    const withEnum: McpToolInfo = {
      name: 'find_events',
      inputSchema: { properties: { fields: { type: 'array', items: { type: 'string', enum: ['title', 'start'] } } }, required: ['fields'] }
    }
    expect(argsSpec(withEnum)).toEqual({ args: { format: 'datetime', fixed: { fields: ['title', 'start'] } } })
  })

  it('enregistrements d’un CRM : annulé, journée entière, lien de visio en objet', () => {
    const r = extractEvents(
      {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              result: {
                records: [
                  {
                    id: 'c1',
                    title: 'Point client',
                    startsAt: new Date(2026, 9, 15, 10).toISOString(),
                    endsAt: new Date(2026, 9, 15, 10, 30).toISOString(),
                    isFullDay: false,
                    isCanceled: false,
                    location: '',
                    conferenceLink: { primaryLinkUrl: 'https://meet.google.com/abc-defg-hij', primaryLinkLabel: '' }
                  },
                  { id: 'c2', title: 'Annulé', startsAt: new Date(2026, 9, 15, 12).toISOString(), isCanceled: true },
                  { id: 'c3', title: 'Séminaire', startsAt: '2026-10-15T00:00:00.000Z', endsAt: '2026-10-16T00:00:00.000Z', isFullDay: true }
                ],
                count: '3',
                hasNextPage: false
              },
              recordReferences: [{ objectNameSingular: 'calendarEvent', recordId: 'c1', displayName: 'Point client' }]
            })
          }
        ]
      },
      FROM,
      TO
    )
    expect(r.events.map((e) => [e.title, e.start, e.end, e.allDay, e.meetUrl])).toEqual([
      ['Séminaire', '2026-10-15', '2026-10-16', true, undefined],
      ['Point client', local(15, 10), local(15, 10, 30), false, 'https://meet.google.com/abc-defg-hij']
    ])
  })

  it('tâches d’un CRM : échéance, tâche terminée écartée, date seule à minuit UTC', () => {
    const r = extractEvents(
      {
        structuredContent: {
          records: [
            { id: 't1', title: 'Relancer le client', dueAt: new Date(2026, 9, 15, 14).toISOString(), status: 'TODO' },
            { id: 't2', title: 'Déjà fait', dueAt: new Date(2026, 9, 15, 9).toISOString(), status: 'DONE' },
            { id: 't3', title: 'Envoyer le devis', dueAt: '2026-10-15T00:00:00.000Z', status: 'IN_PROGRESS' }
          ]
        }
      },
      FROM,
      TO
    )
    expect(r.events.map((e) => [e.title, e.start, e.allDay])).toEqual([
      ['Envoyer le devis', '2026-10-15', true],
      ['Relancer le client', local(15, 14), false]
    ])
    // Une échéance n'est pas une réunion : pas d'alerte.
    expect(r.events.some(isTimedMeeting)).toBe(false)
  })

  it('réponse qui annonce un échec : son message, pas un agenda vide', () => {
    expect(payloadError({ content: [{ type: 'text', text: '{"success":false,"message":"Invalid filter on startsAt"}' }] })).toBe('Invalid filter on startsAt')
    expect(payloadError({ structuredContent: { error: { message: 'Unauthorized' } } })).toBe('Unauthorized')
    expect(payloadError({ structuredContent: { success: true, result: { records: [] } } })).toBeNull()
    expect(payloadError({ structuredContent: { errors: [], data: [] } })).toBeNull()
  })
})
