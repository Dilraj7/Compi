import { describe, expect, it } from 'vitest'
import {
  compactTool,
  compiGroupOf,
  compiGroupServers,
  connectorKeywords,
  estimateMessages,
  estimateTokens,
  findServer,
  localToolsNote,
  presentGroups,
  selectLocalTools,
  splitServerInstructions,
  toolServerKey,
  usableInRoutine,
  wantedServers,
  withServerInstructions,
  type ToolDef,
  type ToolServer
} from '../src/shared/localTools'

const tool = (name: string, chars: number): ToolDef => ({ name, description: 'x'.repeat(chars), input_schema: { type: 'object', properties: {} } })
const ask = (text: string): Array<{ role: string; content: unknown }> => [{ role: 'user', content: [{ type: 'text', text }] }]

const servers: ToolServer[] = [
  { key: 'notion-741c', name: 'Notion', keywords: connectorKeywords('Notion') },
  { key: 'brave-search-45ad', name: 'Brave Search', keywords: connectorKeywords('Brave Search', 'brave-search') },
  { key: 'crm-d369', name: 'Mon CRM', keywords: connectorKeywords('Mon CRM') }
]

// Petits outils (les descriptions restent sous 600 caractères : la version courte ne les change pas).
const tools: ToolDef[] = [
  tool('Skill', 300),
  ...Array.from({ length: 10 }, (_, i) => tool(`mcp__compi__outil${i}`, 500)),
  ...Array.from({ length: 30 }, (_, i) => tool(`mcp__notion-741c__notion${i}`, 550)),
  ...Array.from({ length: 4 }, (_, i) => tool(`mcp__brave-search-45ad__brave${i}`, 500)),
  tool('mcp__crm-d369__people', 400)
]

describe('connectorKeywords', () => {
  it('le nom, ses mots et ses synonymes, sans accents', () => {
    expect(connectorKeywords('Brave Search', 'brave-search')).toEqual(expect.arrayContaining(['brave', 'search', 'bravesearch', 'web', 'internet']))
    expect(connectorKeywords('Graphe de mémoire', 'memory')).toEqual(expect.arrayContaining(['graphe', 'memoire']))
    expect(connectorKeywords('Notion (clé)')).toEqual(['notion'])
  })
})

describe('toolServerKey', () => {
  it('lit la clé du connecteur', () => {
    expect(toolServerKey('mcp__notion-741c__notion-search')).toBe('notion-741c')
    expect(toolServerKey('mcp__graphe-de-memoire-8eb3__read_graph')).toBe('graphe-de-memoire-8eb3')
    expect(toolServerKey('Skill')).toBeNull()
  })
})

describe('wantedServers', () => {
  it('connecteur nommé par l’utilisateur, accents et casse ignorés', () => {
    expect(wantedServers(ask('Cherche dans NOTION ma page'), servers)).toEqual(['notion-741c'])
    expect(wantedServers(ask('quelles actualités sur le web ?'), servers)).toEqual(['brave-search-45ad'])
  })

  it('mot entier seulement', () => {
    expect(wantedServers(ask('les notions de base'), servers)).toEqual([])
  })

  it('ignore les rappels du moteur et les résultats d’outils', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>Notion est branché</system-reminder>' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: 'page Notion' }] }
    ]
    expect(wantedServers(messages, servers)).toEqual([])
  })

  it('garde un connecteur déjà utilisé dans la discussion', () => {
    const messages = [...ask('et la suite ?'), { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'mcp__crm-d369__people', input: {} }] }]
    expect(wantedServers(messages, servers)).toEqual(['crm-d369'])
  })
})

describe('compactTool', () => {
  it('raccourcit les descriptions, retire les exemples, garde les champs « title »', () => {
    const t = compactTool({
      name: 'mcp__x__y',
      description: `${'Phrase. '.repeat(200)}`,
      input_schema: { type: 'object', properties: { title: { type: 'string', description: 'd'.repeat(500), examples: ['a'] } }, required: ['title'] }
    })
    expect((t.description as string).length).toBeLessThanOrEqual(601)
    const props = (t.input_schema as { properties: Record<string, { description: string; examples?: unknown }> }).properties
    expect(props.title.description.length).toBeLessThanOrEqual(161)
    expect(props.title.examples).toBeUndefined()
    expect((t.input_schema as { required: string[] }).required).toEqual(['title'])
  })

  it('coupe les schémas trop profonds en « n’importe quel objet »', () => {
    let deep: Record<string, unknown> = { type: 'object', properties: { leaf: { type: 'string' } } }
    for (let i = 0; i < 20; i++) deep = { type: 'object', properties: { next: deep } }
    const t = compactTool({ name: 'mcp__x__deep', input_schema: deep })
    expect(estimateTokens(t)).toBeLessThan(estimateTokens({ input_schema: deep }) / 2)
    expect(JSON.stringify(t)).toContain('{"type":"object"}')
  })
})

describe('connecteurs chargés à la demande', () => {
  const load = (name: string, id = 'u1'): { role: string; content: unknown } => ({
    role: 'assistant',
    content: [{ type: 'tool_use', id, name: 'mcp__compi__use_extension', input: { name } }]
  })
  const core = ['Skill', ...Array.from({ length: 10 }, (_, i) => `mcp__compi__outil${i}`)]

  it('findServer : nom exact, sans accents ni casse, ou un mot du nom', () => {
    expect(findServer('NOTION', servers)?.key).toBe('notion-741c')
    expect(findServer('brave', servers)?.key).toBe('brave-search-45ad')
    expect(findServer('mon crm', servers)?.key).toBe('crm-d369')
    expect(findServer('Slack', servers)).toBeUndefined()
    expect(findServer('  ', servers)).toBeUndefined()
  })

  it('wantedServers : un connecteur chargé par le modèle (use_extension) est voulu', () => {
    expect(wantedServers([...ask('crée une page'), load('Notion')], servers)).toEqual(['notion-741c'])
    expect(wantedServers([...ask('crée une page'), load('Inconnu')], servers)).toEqual([])
  })

  it('par défaut : seulement les outils de Compi et du moteur, quelle que soit la place', () => {
    const sel = selectLocalTools({ tools, messages: ask('minuteur 1 min'), contextTokens: 65_536, servers })
    expect(sel.tools.map((t) => t.name)).toEqual(core)
    expect(sel.loaded).toEqual([])
    expect(sel.omitted).toEqual([])
  })

  it('les connecteurs voulus passent après ceux de Compi, dans l’ordre de la demande', () => {
    const messages = [...ask('cherche sur le web'), { role: 'assistant', content: 'ok' }, ...ask('et le crm ?')]
    const sel = selectLocalTools({ tools, messages, contextTokens: 65_536, servers })
    const names = sel.tools.map((t) => t.name)
    expect(names.slice(0, core.length)).toEqual(core)
    // Brave Search demandé d'abord, puis le CRM : la liste ne fait que s'allonger d'un tour à l'autre.
    expect(names.slice(core.length)).toEqual([...Array.from({ length: 4 }, (_, i) => `mcp__brave-search-45ad__brave${i}`), 'mcp__crm-d369__people'])
    expect(sel.loaded).toEqual(['Brave Search', 'Mon CRM'])
    const before = selectLocalTools({ tools, messages: ask('cherche sur le web'), contextTokens: 65_536, servers }).tools.map((t) => t.name)
    expect(names.slice(0, before.length)).toEqual(before)
  })

  it('connecteur voulu trop gros : en partie, outils dans l’ordre du connecteur', () => {
    const sel = selectLocalTools({ tools, messages: ask('ajoute une page dans Notion'), contextTokens: 8_192, servers })
    const notion = sel.tools.map((t) => t.name).filter((n) => n.startsWith('mcp__notion'))
    expect(notion.length).toBeGreaterThan(0)
    expect(notion.length).toBeLessThan(30)
    const index = (n: string): number => Number(/\d+$/.exec(n)![0])
    expect(notion).toEqual([...notion].sort((a, b) => index(a) - index(b)))
    expect(sel.partial).toEqual(['Notion'])
    expect(sel.wanted).toEqual(['notion-741c'])
  })

  it('connecteur voulu sans aucune place : signalé comme trop gros', () => {
    const long = [...ask('x'.repeat(100_000)), ...ask('dans notion')]
    const sel = selectLocalTools({ tools, messages: long, contextTokens: 32_768, servers })
    expect(sel.omitted).toEqual(['Notion'])
    expect(sel.tools.some((t) => t.name.startsWith('mcp__notion'))).toBe(false)
  })

  it('routine : seuls les outils autorisés d’office passent', () => {
    const sel = selectLocalTools({ tools, messages: ask('cherche sur le web'), contextTokens: 65_536, servers, allowed: ['mcp__brave-search-45ad__brave1'] })
    expect(sel.tools.filter((t) => t.name.startsWith('mcp__brave')).map((t) => t.name)).toEqual(['mcp__brave-search-45ad__brave1'])
    expect(usableInRoutine('brave-search-45ad', ['mcp__brave-search-45ad__brave1'])).toBe(true)
    expect(usableInRoutine('notion-741c', ['mcp__brave-search-45ad__brave1'])).toBe(false)
  })

  it('une capture d’écran dans la discussion ne fait pas croire la fenêtre pleine', () => {
    const shot = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'A'.repeat(3_000_000) } }
    const messages = [
      ...ask('analyse mon bureau et cherche sur le web'),
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'mcp__compi__screen_capture', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [shot] }] },
      ...ask('range-le')
    ]
    const sel = selectLocalTools({ tools, messages, contextTokens: 65_536, servers })
    expect(sel.loaded).toEqual(['Brave Search'])
    expect(sel.partial).toEqual([])
    expect(estimateMessages(messages)).toBeLessThan(2_000)
  })

  it('un outil inconnu (connecteur absent de la liste) passe tel quel', () => {
    const sel = selectLocalTools({ tools: [tool('mcp__autre__x', 100)], messages: ask('a'), contextTokens: 4_096, servers })
    expect(sel.tools.map((t) => t.name)).toEqual(['mcp__autre__x'])
  })

  it('note : liste fixe des extensions (triée), et celles qui n’ont pas pu se charger du tout', () => {
    const note = localToolsNote({ servers, omitted: [] })!
    expect(note).toContain('Brave Search, Mon CRM, Notion')
    expect(note).toContain('mcp__compi__use_extension')
    // Même texte quel que soit l'ordre des connecteurs : le début de la requête ne change pas.
    expect(localToolsNote({ servers: [...servers].reverse(), omitted: [] })).toBe(note)
    expect(localToolsNote({ servers: [], omitted: [] })).toBeNull()
    expect(localToolsNote({ servers, omitted: ['Notion'] })).toContain('trop grosses pour ta mémoire, non chargées : Notion')
  })
})

describe('extension trop grosse : les outils utiles d’abord', () => {
  // Noms réels de Notion (octobre 2026). Les essentiels sont les plus gros : avant, on
  // gardait les plus petits d'abord, et ce sont eux qui sautaient (journal : « en partie : Notion »).
  const big = ['notion-search', 'notion-fetch', 'notion-create-pages', 'notion-update-page', 'notion-query-data-sources']
  const small = [
    'notion-get-teams',
    'notion-get-self',
    'notion-stop-session',
    'notion-wait-session',
    'notion-spawn-session',
    'notion-get-session-status',
    'notion-list-session-events',
    'notion-get-enabled-skills',
    'notion-set-comment-reaction',
    'notion-create-comment',
    'notion-get-comments',
    'notion-delete-pages'
  ]
  const notion: ToolDef[] = [...big.map((n) => tool(`mcp__notion-741c__${n}`, 2_000)), ...small.map((n) => tool(`mcp__notion-741c__${n}`, 300))].sort((a, b) =>
    a.name.localeCompare(b.name)
  )
  const core: ToolDef[] = [tool('Skill', 300), ...Array.from({ length: 10 }, (_, i) => tool(`mcp__compi__outil${i}`, 500))]
  // Fenêtre où un peu plus de la moitié de Notion tient (les descriptions sont raccourcies à 600 caractères).
  const ctx = 8_192
  const pick = (messages: Array<{ role: string; content: unknown }>, extra: ToolDef[] = []): ReturnType<typeof selectLocalTools> =>
    selectLocalTools({ tools: [...core, ...extra, ...notion], messages, contextTokens: ctx, servers })
  const short = (sel: ReturnType<typeof selectLocalTools>): string[] =>
    sel.tools
      .map((t) => t.name)
      .filter((n) => n.startsWith('mcp__notion'))
      .map((n) => n.replace(/^mcp__.+?__/, ''))

  it('chercher, lire, créer et modifier passent avant les petits outils rares', () => {
    const sel = pick(ask('Ajoute une tâche dans Notion'))
    expect(sel.partial).toEqual(['Notion'])
    expect(short(sel)).toEqual(expect.arrayContaining(['notion-search', 'notion-fetch', 'notion-query-data-sources']))
    expect(short(sel)).not.toContain('notion-spawn-session')
    // Toujours dans l'ordre du connecteur (cache du modèle).
    expect(short(sel)).toEqual([...short(sel)].sort())
    // Ce qui manque est listé, pour pouvoir le demander.
    expect(sel.missing['notion-741c']).toContain('notion-spawn-session')
  })

  it('ce dont la demande parle passe avant le reste (« commentaire » → comment)', () => {
    expect(short(pick(ask('Mets un commentaire sur ma page Notion')))).toContain('notion-create-comment')
  })

  it('un outil demandé par le modèle (use_extension, tools) ou déjà utilisé passe en premier', () => {
    const asked = [
      ...ask('dans Notion'),
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'u', name: 'mcp__compi__use_extension', input: { name: 'Notion', tools: ['notion-spawn-session'] } }]
      }
    ]
    expect(short(pick(asked))).toContain('notion-spawn-session')
    const used = [
      ...ask('dans Notion'),
      { role: 'assistant', content: [{ type: 'tool_use', id: 'u', name: 'mcp__notion-741c__notion-wait-session', input: {} }] }
    ]
    expect(short(pick(used))).toContain('notion-wait-session')
  })

  it('les outils de lecture des ressources ne passent qu’avec une extension chargée, juste avant ses outils', () => {
    const readers = [tool('ListMcpResourcesTool', 200), tool('ReadMcpResourceTool', 200)]
    expect(pick(ask('minuteur 1 min'), readers).tools.map((t) => t.name)).toEqual(core.map((t) => t.name))
    const names = pick(ask('dans Notion'), readers).tools.map((t) => t.name)
    expect(names.slice(core.length, core.length + 2)).toEqual(['ListMcpResourcesTool', 'ReadMcpResourceTool'])
    expect(names[core.length + 2]).toMatch(/^mcp__notion/)
  })

  it('les outils laissés de côté sont signalés avec ceux de l’extension, pas dans les consignes', () => {
    const out = withServerInstructions([tool('mcp__compi__outil0', 10), tool('mcp__notion-741c__a', 10)], {}, servers, {
      'notion-741c': ['notion-create-view']
    })
    expect(out[0].description).toBe('x'.repeat(10))
    expect(out[1].description).toMatch(/^Extension Notion chargée en partie, faute de place\. Outils non chargés : notion-create-view\./)
    expect(out[1].description).toContain('mcp__compi__use_extension')
  })
})

describe('instructions des connecteurs', () => {
  const env = [
    '# Environment',
    'You have been invoked in the following environment:',
    '',
    '# MCP Server Instructions',
    '',
    'The following MCP servers have provided instructions for how to use their tools and resources:',
    '',
    '## brave-search-45ad',
    'Use this server to search the Web.',
    '',
    '## compi',
    'Outils du bureau Windows.',
    '',
    '## notion-741c',
    'Use the Notion search tool for every content search.',
    '## Titre interne de Notion',
    'Détail.',
    '',
    'The following skills are available for use with the Skill tool:',
    '',
    '- compi:resume-document'
  ].join('\n')

  it('retire les sections des connecteurs connus, garde celle de Compi et la suite', () => {
    const { text, sections } = splitServerInstructions(
      env,
      servers.map((s) => s.key)
    )
    expect(text).toContain('## compi\nOutils du bureau Windows.')
    expect(text).toContain('The following skills are available')
    expect(text).toContain('- compi:resume-document')
    expect(text).not.toContain('Brave')
    expect(text).not.toContain('Notion')
    expect(sections['brave-search-45ad']).toBe('Use this server to search the Web.')
    // Un titre « ## » qui n'est pas une clé de connecteur reste dans sa section.
    expect(sections['notion-741c']).toBe('Use the Notion search tool for every content search.\n## Titre interne de Notion\nDétail.')
  })

  it('sans section MCP : texte inchangé', () => {
    expect(splitServerInstructions('Tu es Compi.', ['notion-741c'])).toEqual({ text: 'Tu es Compi.', sections: {} })
  })

  it('accompagnent le premier outil d’un connecteur chargé', () => {
    const out = withServerInstructions(
      [tool('mcp__compi__outil0', 10), tool('mcp__notion-741c__a', 10), tool('mcp__notion-741c__b', 10)],
      { 'notion-741c': 'Cherche avant de créer.' },
      servers
    )
    expect(out[0].description).toBe('x'.repeat(10))
    expect(out[1].description).toBe(`Consignes de l'extension Notion : Cherche avant de créer.\n\n${'x'.repeat(10)}`)
    expect(out[2].description).toBe('x'.repeat(10))
  })
})

describe('outils de Compi en groupes (modèle local)', () => {
  const c = (short: string, chars = 300): ToolDef => tool(`mcp__compi__${short}`, chars)
  // Ordre du moteur : alphabétique, groupes et outils essentiels mélangés.
  const compiTools: ToolDef[] = [
    tool('Skill', 300),
    c('create_folders'),
    c('fetch_page'),
    c('get_datetime'),
    c('move_items'),
    c('open_app'),
    c('reminder_create'),
    c('routine_create'),
    c('screen_capture'),
    c('search_files'),
    c('set_theme'),
    c('use_extension'),
    tool('mcp__notion-741c__notion0', 400),
    tool('ListMcpResourcesTool', 200)
  ]
  const names = (sel: { tools: ToolDef[] }): string[] => sel.tools.map((t) => t.name.replace('mcp__compi__', ''))
  const select = (messages: Array<{ role: string; content: unknown }>) =>
    selectLocalTools({ tools: compiTools, messages, contextTokens: 32_768, servers, groups: true })

  it('compiGroupOf et presentGroups : groupe d’un outil, groupes présents dans la liste', () => {
    expect(compiGroupOf('mcp__compi__move_items')).toBe('compi:rangement')
    expect(compiGroupOf('mcp__compi__get_datetime')).toBeNull()
    expect(compiGroupOf('mcp__notion-741c__move_items')).toBeNull()
    const present = presentGroups(compiTools)
    // Sans compte Google, pas d'outils d'agenda ni de brouillon : leurs groupes ne sont pas annoncés.
    expect(present.map((g) => g.id)).toEqual(['windows', 'ecran', 'rangement', 'routines'])
    expect(present.find((g) => g.id === 'rangement')!.tools).toEqual(['create_folders', 'move_items'])
  })

  it('par défaut : les outils essentiels seulement, dans l’ordre du moteur', () => {
    const sel = select(ask('quelle heure est-il ?'))
    expect(names(sel)).toEqual(['Skill', 'fetch_page', 'get_datetime', 'reminder_create', 'search_files', 'use_extension'])
    expect(sel.wanted).toEqual([])
    expect(sel.loaded).toEqual([])
  })

  it('sans l’option : tous les outils de Compi passent, comme avant', () => {
    const sel = selectLocalTools({ tools: compiTools, messages: ask('bonjour'), contextTokens: 32_768, servers })
    expect(names(sel)).toEqual(
      compiTools.filter((t) => !t.name.includes('notion') && t.name !== 'ListMcpResourcesTool').map((t) => t.name.replace('mcp__compi__', ''))
    )
  })

  it('un mot de la demande charge le groupe, à la fin et en entier', () => {
    const sel = select(ask('Range mon Bureau stp'))
    expect(names(sel)).toEqual(['Skill', 'fetch_page', 'get_datetime', 'reminder_create', 'search_files', 'use_extension', 'create_folders', 'move_items'])
    expect(sel.wanted).toEqual(['compi:rangement'])
    expect(sel.loaded).toEqual(['Rangement'])
  })

  it('les blocs <contexte> et <reglages> de Compi ne chargent rien (ni groupe ni connecteur)', () => {
    const first = `<contexte>Nous sommes le mardi.</contexte>\n<reglages>\n- Agenda : sources Notion, Mon CRM.\n- Dossiers confiés : Bureau, Téléchargements\n</reglages>\n\nbonjour`
    const sel = select(ask(first))
    expect(sel.wanted).toEqual([])
    expect(wantedServers(ask(first), servers)).toEqual([])
  })

  it('groupe demandé par le modèle (use_extension) ou outil d’un groupe déjà utilisé : chargé, dans l’ordre de la demande', () => {
    const messages = [
      ...ask('mets la page Notion à jour puis tu sais quoi'),
      { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__compi__use_extension', input: { name: 'Écran et presse-papier' } }] },
      { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
      { role: 'assistant', content: [{ type: 'tool_use', name: 'mcp__compi__set_theme', input: { mode: 'dark' } }] }
    ]
    const sel = select(messages)
    expect(sel.wanted).toEqual(['notion-741c', 'compi:ecran', 'compi:windows'])
    // Lecture des ressources juste avant le connecteur ; groupes ensuite, dans l'ordre de la demande.
    expect(names(sel).slice(6)).toEqual(['ListMcpResourcesTool', 'mcp__notion-741c__notion0', 'screen_capture', 'open_app', 'set_theme'])
  })

  it('un groupe chargé avant un connecteur garde sa place : la requête ne fait que s’allonger', () => {
    const before = select(ask('ouvre la calculatrice'))
    const after = select([
      ...ask('ouvre la calculatrice'),
      { role: 'assistant', content: [{ type: 'text', text: 'Ouverte.' }] },
      ...ask('et cherche dans Notion')
    ])
    expect(names(after).slice(0, before.tools.length)).toEqual(names(before))
    expect(names(after).slice(before.tools.length)).toEqual(['ListMcpResourcesTool', 'mcp__notion-741c__notion0'])
  })

  it('findServer : un groupe par son nom ou un mot, une extension d’abord par son nom exact', () => {
    const all = [...servers, ...compiGroupServers()]
    expect(findServer('Rangement', all)?.key).toBe('compi:rangement')
    expect(findServer('ecran', all)?.key).toBe('compi:ecran')
    expect(findServer('Notion', all)?.key).toBe('notion-741c')
  })

  it('note : groupes présents avec leurs outils, texte fixe', () => {
    const note = localToolsNote({ servers: [], omitted: [], groups: presentGroups(compiTools) })!
    expect(note).toContain('mcp__compi__use_extension avec le nom du groupe')
    expect(note).toContain('- Rangement : ')
    expect(note).toContain('(create_folders, move_items)')
    expect(note).not.toContain('Agenda')
    expect(localToolsNote({ servers: [], omitted: [], groups: presentGroups([...compiTools].reverse()) })).toBe(note)
  })
})
