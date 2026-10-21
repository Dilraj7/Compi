// Outils envoyés à un modèle local. Sa fenêtre est petite (32 000 à 64 000 jetons)
// et il relit lentement : sur un PC sans grosse carte graphique, ~90 jetons/s, soit
// 5 min pour les ~26 000 jetons d'outils de quelques connecteurs. Les outils
// essentiels de Compi passent toujours, en tête et dans le même ordre (le modèle les
// garde en cache d'une discussion à l'autre) ; les autres sont rangés en groupes
// (COMPI_GROUPS), chargés comme des connecteurs. Les connecteurs ne sont chargés qu'à la demande :
// nommés par l'utilisateur, déjà utilisés, ou demandés par le modèle avec
// use_extension. Leurs outils viennent après ceux de Compi, dans l'ordre où la
// discussion les a demandés : la requête ne fait que s'allonger, le cache reste
// bon. Fonctions pures, testées dans tests/localTools.test.ts.

export interface ToolDef {
  name: string
  description?: string
  input_schema?: unknown
  [k: string]: unknown
}

/** Connecteur branché : clé MCP (préfixe `mcp__<clé>__`), nom affiché, mots qui le désignent. */
export interface ToolServer {
  key: string
  name: string
  keywords: string[]
}

/** Outil de Compi (serveur `compi`) qui charge une extension pour le modèle local. */
export const USE_EXTENSION = 'use_extension'

/**
 * Outils de Compi chargés à la demande par le modèle local, par groupe. Les autres (heure,
 * rappels, minuteur, météo, mémoire, documents, fichiers du PC, pages web, agenda et
 * e-mails en lecture…) passent toujours : ~40 % de jetons en moins à relire au début de
 * chaque discussion (mesuré : 40 outils et ~5 300 jetons → 22 outils et ~3 200). Un groupe
 * se charge quand la demande en parle (mots-clés), quand le modèle le demande
 * (use_extension) ou dès qu'il a utilisé un de ses outils ; ses outils s'ajoutent à la
 * fin, comme ceux d'un connecteur, et le début de la requête ne change pas.
 */
export interface CompiGroup {
  id: string
  name: string
  /** Noms courts des outils (sans `mcp__compi__`). */
  tools: string[]
  /** Mots (repliés, sans accents) qui chargent le groupe quand l'utilisateur les écrit. */
  keywords: string[]
  /** Ce que le groupe permet, pour la note des consignes. */
  summary: string
}

export const COMPI_GROUPS: CompiGroup[] = [
  {
    id: 'windows',
    name: 'Windows',
    tools: ['open_app', 'focus_window', 'list_windows', 'sound_control', 'set_theme', 'open_settings', 'open_path'],
    keywords: [
      'ouvre',
      'ouvrir',
      'lance',
      'lancer',
      'application',
      'applications',
      'appli',
      'logiciel',
      'programme',
      'fenetre',
      'fenetres',
      'volume',
      'muet',
      'musique',
      'chanson',
      'theme',
      'mode sombre',
      'mode clair',
      'parametres'
    ],
    summary: 'ouvrir une application ou un fichier, fenêtres, son et musique, thème, Paramètres'
  },
  {
    id: 'ecran',
    name: 'Écran et presse-papier',
    tools: ['screen_capture', 'read_screen_text', 'clipboard_read', 'clipboard_write', 'clipboard_history'],
    keywords: ['ecran', 'capture', 'presse-papier', 'presse papier', 'copie', 'copier', 'copiee', 'colle', 'coller'],
    summary: 'regarder ou lire l’écran, lire et écrire le presse-papier, son historique'
  },
  {
    id: 'rangement',
    name: 'Rangement',
    tools: ['folder_inventory', 'create_folders', 'move_items', 'undo_moves', 'open_folder'],
    keywords: [
      'range',
      'ranger',
      'rangement',
      'trie',
      'trier',
      'tri',
      'organise',
      'organiser',
      'bureau',
      'telechargements',
      'dossier',
      'dossiers',
      'annule le rangement'
    ],
    summary: 'inventaire et rangement des dossiers confiés, annulation, ouvrir un dossier'
  },
  {
    id: 'routines',
    name: 'Routines',
    tools: ['routine_create', 'routine_list', 'routine_delete'],
    keywords: [
      'routine',
      'routines',
      'tous les jours',
      'toutes les semaines',
      'tous les matins',
      'tous les soirs',
      'chaque jour',
      'chaque semaine',
      'chaque matin',
      'chaque soir',
      'chaque lundi',
      'chaque mois'
    ],
    summary: 'créer, lister ou supprimer une routine'
  },
  {
    id: 'agenda',
    name: 'Agenda (modifier)',
    tools: ['calendar_create_event', 'calendar_update_event', 'calendar_delete_event'],
    keywords: ['agenda', 'rendez-vous', 'rdv', 'reunion', 'evenement', 'planifie', 'deplace', 'deplacer', 'decale', 'decaler', 'reporte', 'reporter'],
    summary: 'ajouter, déplacer ou supprimer un rendez-vous Google'
  },
  {
    id: 'emails',
    name: 'E-mails (brouillons)',
    tools: ['mail_create_draft'],
    keywords: ['brouillon', 'reponds', 'repondre', 'mail', 'mails', 'e-mail', 'e-mails', 'email', 'emails', 'courriel'],
    summary: 'préparer un brouillon Gmail'
  }
]

/** Groupes de Compi vus comme des extensions : clé `compi:<id>`. */
export const compiGroupServers = (core = 'compi'): ToolServer[] => COMPI_GROUPS.map((g) => ({ key: `${core}:${g.id}`, name: g.name, keywords: g.keywords }))

/** Groupes dont au moins un outil figure dans la liste (les outils Google n'existent qu'avec un compte connecté), outils absents retirés. */
export function presentGroups(tools: Pick<ToolDef, 'name'>[], core = 'compi'): CompiGroup[] {
  const names = new Set(tools.map((t) => t.name))
  return COMPI_GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => names.has(`mcp__${core}__${t}`)) })).filter((g) => g.tools.length)
}

/** Groupe d'un outil de Compi (`mcp__compi__move_items` → `compi:rangement`), ou null s'il passe toujours. */
export function compiGroupOf(name: string, core = 'compi'): string | null {
  const prefix = `mcp__${core}__`
  if (!name.startsWith(prefix)) return null
  const short = name.slice(prefix.length)
  const g = COMPI_GROUPS.find((x) => x.tools.includes(short))
  return g ? `${core}:${g.id}` : null
}

/**
 * Outils du moteur qui lisent les ressources des connecteurs (la documentation que
 * Notion demande de lire avant d'écrire, par exemple). Ils ne servent qu'avec un
 * connecteur chargé : ils passent alors juste avant ses outils.
 */
export const RESOURCE_TOOLS = ['ListMcpResourcesTool', 'ReadMcpResourceTool']

export interface ToolSelection {
  tools: ToolDef[]
  /** Connecteurs demandés mais trop gros pour la place qui reste (noms affichés). */
  omitted: string[]
  /** Connecteurs demandés mais chargés en partie, faute de place. */
  partial: string[]
  /** Outils laissés de côté, par connecteur chargé en partie (clé → noms courts). */
  missing: Record<string, string[]>
  /** Connecteurs que la discussion demande (clés). */
  wanted: string[]
  /** Connecteurs dont des outils sont envoyés (noms affichés). */
  loaded: string[]
  /** Taille estimée des outils envoyés (jetons). */
  tokens: number
}

/** Estimation prudente (surestime un peu) : ~3,5 caractères par jeton. */
export const estimateTokens = (v: unknown): number => Math.ceil((typeof v === 'string' ? v : (JSON.stringify(v) ?? '')).length / 3.5)

/** Une image ou un document coûte au modèle un nombre de jetons fixe, sans rapport avec sa taille en base64. */
const IMAGE_TOKENS = 1_000
const DOCUMENT_TOKENS = 3_000

/**
 * Taille estimée d'une discussion. Les images et documents (base64) comptent pour un
 * forfait : une capture d'écran de 3 Mo n'occupe pas 900 000 jetons. Sans ça, une
 * seule capture faisait croire la fenêtre pleine et retirait tous les connecteurs.
 */
export function estimateMessages(messages: unknown): number {
  let media = 0
  const json =
    JSON.stringify(messages, (_key, value: unknown) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const type = (value as { type?: unknown }).type
        if (type === 'image') {
          media += IMAGE_TOKENS
          return undefined
        }
        if (type === 'document') {
          media += DOCUMENT_TOKENS
          return undefined
        }
      }
      return value
    }) ?? ''
  return Math.ceil(json.length / 3.5) + media
}

/** Part de la fenêtre réservée aux outils, et part maximale de la requête entière. */
const TOOLS_SHARE = 0.4
const PROMPT_SHARE = 0.85
const ANSWER_ROOM = 2048

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Mots qui désignent un connecteur, en plus de son nom. */
const SYNONYMS: Record<string, string[]> = {
  'brave-search': ['web', 'internet', 'en ligne', 'actualite', 'actualites', 'google'],
  playwright: ['navigateur', 'site web', 'page web', 'site internet'],
  memory: ['graphe'],
  github: ['github', 'depot', 'pull request'],
  context7: ['documentation', 'doc'],
  'microsoft-learn': ['microsoft', 'azure']
}
// Mots trop courants pour désigner un connecteur (« Mon CRM » ne doit pas se charger pour « analyse mon bureau »).
const GENERIC = new Set([
  'mcp',
  'server',
  'serveur',
  'cle',
  'les',
  'des',
  'une',
  'the',
  'and',
  'pour',
  'avec',
  'dans',
  'sur',
  'par',
  'aux',
  'mon',
  'ton',
  'son',
  'mes',
  'tes',
  'ses',
  'nos',
  'vos',
  'notre',
  'votre',
  'local',
  'distant',
  'commande'
])

/** Mots qui désignent un connecteur dans une demande : son nom (entier et par mots) et ses synonymes. */
export function connectorKeywords(name: string, templateId?: string): string[] {
  const n = fold(name).replace(/\(.*?\)/g, ' ')
  const words = n.split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.has(w))
  const joined = words.join('')
  return [...new Set([...words, ...(joined.length >= 4 ? [joined] : []), ...(templateId ? (SYNONYMS[templateId] ?? []) : [])])]
}

/** Clé du connecteur d'un outil (`mcp__<clé>__nom`), ou null pour un outil du moteur. */
export function toolServerKey(name: string): string | null {
  const m = /^mcp__(.+?)__/.exec(name)
  return m ? m[1] : null
}

const cut = (s: string, max: number): string => {
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const stop = Math.max(head.lastIndexOf('. '), head.lastIndexOf('\n'))
  return `${(stop > max * 0.5 ? head.slice(0, stop + 1) : head).trimEnd()}…`
}

const DROP_KEYS = new Set(['examples', 'example', '$schema', '$comment', 'title'])
/** Au-delà, un sous-schéma devient « n'importe quel objet » : le service vérifie lui-même (filtres de Notion : 32 niveaux). */
const MAX_DEPTH = 8

function compactSchema(v: unknown, maxProp: number, depth: number): unknown {
  if (Array.isArray(v)) return v.map((x) => compactSchema(x, maxProp, depth + 1))
  if (!v || typeof v !== 'object') return v
  const node = v as Record<string, unknown>
  if (depth >= MAX_DEPTH) return typeof node.type === 'string' ? { type: node.type } : {}
  const out: Record<string, unknown> = {}
  for (const [k, x] of Object.entries(node)) {
    // Sous `properties`, les clés sont des noms de champs (un champ peut s'appeler « title »).
    if (k === 'properties' && x && typeof x === 'object' && !Array.isArray(x)) {
      out[k] = Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([p, s]) => [p, compactSchema(s, maxProp, depth + 2)]))
    } else if (DROP_KEYS.has(k)) {
      continue
    } else if (k === 'description' && typeof x === 'string') {
      out[k] = cut(x, maxProp)
    } else {
      out[k] = compactSchema(x, maxProp, depth + 1)
    }
  }
  return out
}

/** Version courte d'un outil de connecteur : descriptions raccourcies, exemples et détails profonds retirés. Le schéma reste valide. */
export function compactTool(tool: ToolDef, maxDesc = 600, maxProp = 160): ToolDef {
  return {
    ...tool,
    ...(typeof tool.description === 'string' ? { description: cut(tool.description, maxDesc) } : {}),
    ...(tool.input_schema !== undefined ? { input_schema: compactSchema(tool.input_schema, maxProp, 0) } : {})
  }
}

interface Msg {
  role?: string
  content?: unknown
}

/** Le mot (ou l'expression) apparaît en entier dans le texte replié. */
const mentions = (text: string, word: string): boolean => {
  let i = text.indexOf(word)
  while (i >= 0) {
    const before = text[i - 1]
    const after = text[i + word.length]
    if (!(before && /[a-z0-9]/.test(before)) && !(after && /[a-z0-9]/.test(after))) return true
    i = text.indexOf(word, i + 1)
  }
  return false
}

const textsOf = (content: unknown): string[] =>
  typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? (content as Array<{ type?: string; text?: unknown }>).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string)
      : []

/** Nom court d'un outil de connecteur : « mcp__notion-741c__notion-search » → « notion-search ». */
export const shortToolName = (name: string): string => name.replace(/^mcp__.+?__/, '')

/**
 * Ce que l'utilisateur a écrit dans un message (replié) : sans les rappels du moteur, les
 * résultats d'outils ni les blocs <contexte> et <reglages> ajoutés par Compi (une source
 * d'agenda qui porte le nom d'un connecteur ne doit pas le charger).
 */
const saidIn = (content: unknown): string =>
  fold(
    textsOf(content)
      .filter((t) => !t.trimStart().startsWith('<system-reminder>'))
      .join('\n')
      .replace(/<(contexte|reglages)>[\s\S]*?<\/\1>/g, ' ')
  ).trim()

/** Messages de l'utilisateur (voir saidIn). */
const userSaid = (messages: Msg[]): string[] =>
  messages
    .filter((m) => m.role === 'user')
    .map((m) => saidIn(m.content))
    .filter(Boolean)

/**
 * Quand un connecteur ne tient pas en entier : d'abord chercher et lire, puis créer et
 * modifier, puis lister. Le moteur trie les outils par nom : l'ordre du service est perdu.
 */
const VERB_RANK: Record<string, number> = {
  search: 0,
  fetch: 0,
  find: 0,
  query: 0,
  read: 0,
  lookup: 0,
  create: 1,
  update: 1,
  add: 1,
  edit: 1,
  append: 1,
  insert: 1,
  write: 1,
  list: 2,
  get: 2,
  retrieve: 2
}

/** Mots du nom d'un outil, sans ceux du nom du connecteur (« notion-create-pages » → create, pages). */
function nameWords(name: string, server: ToolServer): string[] {
  return shortToolName(name)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !server.keywords.includes(w))
}

const stem = (w: string): string => w.replace(/s$/, '')
/** « pages » / « page », « calendar » / « calendrier » (6 lettres en commun). */
function sameWord(a: string, b: string): boolean {
  if (stem(a) === stem(b)) return true
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i >= 6
}

/**
 * Outils qu'un connecteur trop gros garde en priorité, du plus utile au moins utile :
 * déjà utilisés ou demandés par le modèle (use_extension, `tools`), puis chercher et
 * lire, puis ceux dont la demande parle (« page », « commentaire »), puis créer et
 * modifier, puis lister, puis le reste. À rang égal, les noms courts (outils généraux)
 * et les petits d'abord.
 */
function byUsefulness(all: ToolDef[], server: ToolServer, messages: Msg[], requested: Set<string>): ToolDef[] {
  const said = userSaid(messages)
    .join(' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4)
  const rank = (t: ToolDef): number => {
    if (requested.has(t.name) || requested.has(shortToolName(t.name))) return 0
    const words = nameWords(t.name, server)
    const verb = Math.min(3, ...words.map((w) => VERB_RANK[w] ?? 3))
    if (verb === 0) return 1
    if (words.some((w) => w.length >= 4 && !(w in VERB_RANK) && said.some((u) => sameWord(u, w)))) return 2
    return verb + 2
  }
  const scored = all.map((t) => ({ t, rank: rank(t), words: nameWords(t.name, server).length, size: estimateTokens(t) }))
  return scored.sort((a, b) => a.rank - b.rank || a.words - b.words || a.size - b.size).map((s) => s.t)
}

/** Outils déjà appelés, ou demandés par le modèle avec use_extension (`tools`). */
function requestedTools(messages: Msg[], core: string): Set<string> {
  const out = new Set<string>()
  const loader = `mcp__${core}__${USE_EXTENSION}`
  for (const m of messages) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue
    for (const b of m.content as Array<{ type?: string; name?: unknown; input?: { tools?: unknown } }>) {
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      if (b.name !== loader) out.add(b.name)
      else if (Array.isArray(b.input?.tools)) for (const t of b.input.tools) if (typeof t === 'string' && t.trim()) out.add(shortToolName(t.trim()))
    }
  }
  return out
}

/** Routine (sans l'utilisateur) : un connecteur n'y sert que si au moins un de ses outils est réglé sur « Toujours ». */
export function usableInRoutine(key: string, alwaysAllow: string[]): boolean {
  return alwaysAllow.some((t) => t.startsWith(`mcp__${key}__`))
}

/** Connecteur désigné par un nom (« Notion », « brave »…), tel que le modèle l'écrit. */
export function findServer(name: string, servers: ToolServer[]): ToolServer | undefined {
  const n = fold(name).trim()
  if (!n) return undefined
  return servers.find((s) => fold(s.name) === n || s.key === name.trim()) ?? servers.find((s) => s.keywords.some((w) => mentions(n, w)))
}

/**
 * Connecteurs (et groupes d'outils de Compi, clés `compi:<id>`) voulus dans la discussion,
 * dans l'ordre : déjà utilisés ou chargés (use_extension) par le modèle, ou nommés par
 * l'utilisateur (pas dans les rappels du moteur, les blocs de Compi ni les résultats d'outils).
 */
export function wantedServers(messages: Msg[], servers: ToolServer[], core = 'compi'): string[] {
  const wanted: string[] = []
  const add = (k: string): void => {
    if (!wanted.includes(k)) wanted.push(k)
  }
  const loader = `mcp__${core}__${USE_EXTENSION}`
  for (const m of messages) {
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      for (const b of m.content as Array<{ type?: string; name?: unknown; input?: { name?: unknown } }>) {
        if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
        if (b.name === loader) {
          const s = findServer(String(b.input?.name ?? ''), servers)
          if (s) add(s.key)
          continue
        }
        const k = compiGroupOf(b.name, core) ?? toolServerKey(b.name)
        if (k && servers.some((s) => s.key === k)) add(k)
      }
    } else if (m.role === 'user') {
      const said = saidIn(m.content)
      if (!said) continue
      for (const s of servers) if (s.keywords.some((w) => mentions(said, w))) add(s.key)
    }
  }
  return wanted
}

/**
 * Outils à envoyer au modèle local. Ceux du moteur et de Compi passent toujours,
 * en tête. Les connecteurs (en version courte) ne passent que si la discussion les
 * demande, après, dans l'ordre de la demande ; ils se partagent ~40 % de la
 * fenêtre, sans que la requête dépasse 85 % (outil par outil, les plus utiles
 * d'abord, s'ils ne tiennent pas en entier : voir byUsefulness). Les outils de
 * lecture des ressources ne passent qu'avec un connecteur chargé, juste avant ses outils.
 * `allowed` (routine) : seuls ces outils de connecteur peuvent passer, les autres seraient
 * refusés. `groups` : les outils de Compi des COMPI_GROUPS se chargent eux aussi à la
 * demande, en entier (ils passaient tous avant : jamais moins de place qu'avant pour eux).
 */
export function selectLocalTools(o: {
  tools: ToolDef[]
  system?: unknown
  messages: Msg[]
  contextTokens: number
  servers: ToolServer[]
  core?: string
  allowed?: string[]
  groups?: boolean
}): ToolSelection {
  const core = o.core ?? 'compi'
  const groupServers = o.groups ? compiGroupServers(core) : []
  const known = new Map([...o.servers, ...groupServers].map((s) => [s.key, s]))
  const keep: ToolDef[] = []
  const readers: ToolDef[] = []
  const byServer = new Map<string, ToolDef[]>()
  const byGroup = new Map<string, ToolDef[]>()
  for (const t of o.tools) {
    const k = toolServerKey(t.name)
    const group = o.groups && k === core ? compiGroupOf(t.name, core) : null
    if (RESOURCE_TOOLS.includes(t.name)) readers.push(t)
    else if (group) byGroup.set(group, [...(byGroup.get(group) ?? []), t])
    else if (k === null || k === core || !known.has(k)) keep.push(t)
    else if (!o.allowed || o.allowed.includes(t.name)) byServer.set(k, [...(byServer.get(k) ?? []), compactTool(t)])
  }
  let used = estimateTokens(keep)
  const room = Math.floor(o.contextTokens * PROMPT_SHARE) - estimateTokens(o.system ?? '') - estimateMessages(o.messages) - ANSWER_ROOM
  const cap = Math.max(used, Math.min(Math.floor(o.contextTokens * TOOLS_SHARE), room))
  const omitted: string[] = []
  const partial: string[] = []
  const missing: Record<string, string[]> = {}
  const loaded: string[] = []
  const chosen: ToolDef[] = []
  const wanted = wantedServers(o.messages, [...o.servers, ...groupServers], core).filter((k) => byServer.has(k) || byGroup.has(k))
  const requested = requestedTools(o.messages, core)
  // Les groupes passent en entier : leur place est prise avant celle des connecteurs.
  for (const k of wanted) if (byGroup.has(k)) used += estimateTokens(byGroup.get(k))
  // Place réservée aux outils de lecture des ressources, rendue si aucun connecteur ne se charge.
  const readersSize = wanted.some((k) => byServer.has(k)) && readers.length ? estimateTokens(readers) : 0
  used += readersSize
  let readersPlaced = false

  for (const k of wanted) {
    const name = known.get(k)!.name
    const group = byGroup.get(k)
    if (group) {
      chosen.push(...group)
      loaded.push(name)
      continue
    }
    const all = byServer.get(k)!
    const picked = new Set<ToolDef>()
    for (const t of byUsefulness(all, known.get(k)!, o.messages, requested)) {
      const size = estimateTokens(t)
      if (used + size > cap) continue
      picked.add(t)
      used += size
    }
    if (picked.size && !readersPlaced) {
      chosen.push(...readers)
      readersPlaced = true
    }
    // Dans l'ordre du connecteur : la liste reste la même d'un tour à l'autre (cache du modèle).
    chosen.push(...all.filter((t) => picked.has(t)))
    if (!picked.size) omitted.push(name)
    else loaded.push(name)
    if (picked.size && picked.size < all.length) {
      partial.push(name)
      missing[k] = all.filter((t) => !picked.has(t)).map((t) => shortToolName(t.name))
    }
  }
  if (!readersPlaced) used -= readersSize
  return { tools: [...keep, ...chosen], omitted, partial, missing, wanted, loaded, tokens: used }
}

/**
 * Consignes ajoutées pour le modèle local : les groupes d'outils de Compi et la liste
 * des extensions branchées (toujours les mêmes, pour ne pas changer le début de la
 * requête quand l'un se charge) et celles qui n'ont pas pu se charger du tout. Une extension chargée en
 * partie est signalée avec ses outils (withServerInstructions) : les consignes passent
 * avant tous les outils, les changer ferait tout relire au modèle.
 */
export function localToolsNote(o: { servers: Pick<ToolServer, 'name'>[]; omitted: string[]; core?: string; groups?: CompiGroup[] }): string | null {
  const parts: string[] = []
  const loader = `mcp__${o.core ?? 'compi'}__${USE_EXTENSION}`
  if (o.groups?.length) {
    parts.push(
      `Autres outils de Compi, chargés à la demande : si la demande en a besoin et que tu ne les vois pas, appelle d'abord ${loader} avec le nom du groupe, puis utilise-les.\n${o.groups.map((g) => `- ${g.name} : ${g.summary} (${g.tools.join(', ')})`).join('\n')}`
    )
  }
  if (o.servers.length) {
    const names = o.servers.map((s) => s.name).sort((a, b) => a.localeCompare(b, 'fr'))
    parts.push(
      `Extensions branchées par l'utilisateur : ${names.join(', ')}. Leurs outils ne se chargent qu'à la demande : si la demande concerne l'une d'elles et que tu ne vois pas ses outils, appelle d'abord ${loader} avec son nom, puis utilise ses outils. N'invente jamais leur résultat.`
    )
  }
  if (o.omitted.length)
    parts.push(`Extensions trop grosses pour ta mémoire, non chargées : ${o.omitted.join(', ')}. Dis-le à l'utilisateur au lieu d'inventer leur résultat.`)
  return parts.length ? parts.join('\n') : null
}

const MCP_HEADER = '# MCP Server Instructions'
const SECTION_END = /^(# \S|The following skills are available)/

/**
 * Retire des consignes du moteur les instructions des connecteurs (section « MCP
 * Server Instructions » : celles d'un connecteur peuvent dépasser 1 500 jetons). Elles sont
 * rendues à part, pour accompagner les outils du connecteur quand il se charge.
 * Seules les sections `## <clé>` des connecteurs connus sont retirées.
 */
export function splitServerInstructions(text: string, keys: string[], core = 'compi'): { text: string; sections: Record<string, string> } {
  if (!text.includes(MCP_HEADER)) return { text, sections: {} }
  const known = new Set(keys)
  const kept: string[] = []
  const found: Record<string, string[]> = {}
  let inMcp = false
  let skipping: string | null = null
  for (const line of text.split('\n')) {
    if (line.trim() === MCP_HEADER) {
      inMcp = true
      skipping = null
    } else if (inMcp && SECTION_END.test(line)) {
      inMcp = false
      skipping = null
    } else if (inMcp) {
      const m = /^## (\S+)\s*$/.exec(line)
      if (m && (known.has(m[1]) || m[1] === core)) {
        skipping = known.has(m[1]) ? m[1] : null
        if (skipping) {
          found[skipping] = []
          continue
        }
      }
    }
    if (skipping) found[skipping].push(line)
    else kept.push(line)
  }
  const sections = Object.fromEntries(
    Object.entries(found)
      .map(([k, lines]) => [k, lines.join('\n').trim()] as const)
      .filter(([, t]) => t)
  )
  return { text: kept.join('\n'), sections }
}

const INSTRUCTIONS_MAX = 3000
const MISSING_MAX = 1500

/**
 * En tête de la description du premier outil d'un connecteur chargé (après ceux de
 * Compi) : ses instructions, et les outils laissés de côté faute de place, que le
 * modèle peut demander avec use_extension (`tools`).
 */
export function withServerInstructions(
  tools: ToolDef[],
  sections: Record<string, string>,
  servers: ToolServer[],
  missing: Record<string, string[]> = {},
  core = 'compi'
): ToolDef[] {
  const done = new Set<string>()
  return tools.map((t) => {
    const k = toolServerKey(t.name)
    if (!k || done.has(k) || (!sections[k] && !missing[k]?.length)) return t
    done.add(k)
    const name = servers.find((s) => s.key === k)?.name ?? k
    const intro = [
      sections[k] ? `Consignes de l'extension ${name} : ${cut(sections[k], INSTRUCTIONS_MAX)}` : '',
      missing[k]?.length
        ? `Extension ${name} chargée en partie, faute de place. Outils non chargés : ${cut(missing[k].join(', '), MISSING_MAX)}. Pour en utiliser un, appelle d'abord mcp__${core}__${USE_EXTENSION} avec name « ${name} » et tools contenant son nom.`
        : ''
    ]
      .filter(Boolean)
      .join('\n\n')
    return { ...t, description: t.description ? `${intro}\n\n${t.description}` : intro }
  })
}
