// Sources d'agenda venant des connecteurs : quel outil lit des événements (même
// caché derrière une « passerelle » catalogue → schéma → exécution), comment
// remplir ses paramètres pour une période, comment lire sa réponse.
// Aucun service n'est codé en dur : tout se déduit du schéma et de la réponse
// de l'outil, et l'utilisateur voit un aperçu avant d'ajouter la source.
// Fonctions pures, testées dans tests/agenda.test.ts.

import type { AgendaToolArgs, AgendaToolChoice, AgendaVia, DayEvent } from './types'

/** Hôtes de visioconférence reconnus pour le bouton « Rejoindre ». */
const MEETING_HOSTS = [
  'meet.google.com',
  'zoom.us',
  'zoomgov.com',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'whereby.com',
  'meet.jit.si',
  'gotomeeting.com',
  'meet.goto.com'
]

export function isMeetingUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))
  } catch {
    return false
  }
}

/** Premier lien de visio reconnu : liens donnés tels quels, puis ceux trouvés dans des textes (lieu, description). */
export function findMeetingUrl(links: Array<string | undefined>, texts: Array<string | undefined> = []): string | undefined {
  const inText = texts.flatMap((t) => [...(t ?? '').matchAll(/https:\/\/[^\s"'<>()]+/g)].map((m) => m[0].replace(/[.,;]+$/, '')))
  return [...links, ...inText].find((c): c is string => typeof c === 'string' && isMeetingUrl(c))
}

// ─── Choisir l'outil ─────────────────────────────────────────────────────────

interface JsonSchema {
  type?: string | string[]
  format?: string
  description?: string
  maximum?: number
  anyOf?: JsonSchema[]
  $ref?: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  enum?: unknown[]
  additionalProperties?: unknown
}

interface InputSchema {
  properties?: Record<string, JsonSchema>
  required?: string[]
  $defs?: Record<string, JsonSchema>
  definitions?: Record<string, JsonSchema>
}

/** Ce que `listTools` d'un serveur MCP renvoie d'utile ici. */
export interface McpToolInfo {
  name: string
  description?: string
  inputSchema?: InputSchema
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }
}

/** « listUpcomingEvents », « list_events », « notion-search » → mots en minuscules. */
export function words(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const WRITE_VERBS = new Set(
  'create add update delete remove send set move cancel post put patch insert write edit upsert archive complete mark book invite reply respond accept decline upload import sync run execute trigger modify rename duplicate restore clear reset assign'.split(
    ' '
  )
)
const READ_VERBS = new Set('list get search find query read fetch show view upcoming overview browse lookup'.split(' '))
const EVENT_WORDS = new Set(
  'event events calendar calendars agenda meeting meetings appointment appointments schedule schedules booking bookings task tasks todo todos deadline deadlines activity activities reminder reminders occurrence occurrences evenement evenements rendez reunion reunions tache taches echeance echeances'.split(
    ' '
  )
)
/** Mots neutres dans un nom d'outil (« find_many_events ») : ni bonus ni pénalité. */
const FILLER = new Set('many all my mine the of by for in on at a an to with me current next today day days'.split(' '))
/** Un seul enregistrement (« find_one », « get_by_id ») ou des statistiques (« group_by », « count ») : pas une liste d'événements. */
const LOOKUP_WORDS = new Set('one single id group aggregate aggregates count stats statistics'.split(' '))

const norm = (k: string): string => k.toLowerCase().replace(/[_\-\s.]/g, '')
const FROM_NAMES = new Set(
  'start from since after begin timemin startdate starttime startat datefrom datestart datemin fromdate startsafter rangestart periodstart mindate startingafter afterdate debut datedebut'.split(
    ' '
  )
)
const TO_NAMES = new Set(
  'end to until before timemax enddate endtime endat dateto dateend datemax todate endsbefore rangeend periodend maxdate beforedate untildate fin datefin'.split(
    ' '
  )
)
const DAY_NAMES = new Set('date day on ondate fordate targetdate jour'.split(' '))
/** Fuseau horaire demandé par l'outil (Notion Calendar l'exige) : celui du PC. */
const ZONE_NAMES = new Set('timezone tz tzid timezoneid fuseau fuseauhoraire'.split(' '))
const LIMIT_NAMES = new Set('limit max maxresults pagesize count first top perpage size'.split(' '))
/** Champs date sur lesquels filtrer une période (« startsAt: { gte, lt } »). */
const RANGE_FIELDS = new Set(
  'start startsat startat startdate starttime startdatetime begin beginsat date datetime when dueat duedate due deadline scheduledat scheduledfor scheduleddate debut echeance'.split(
    ' '
  )
)
const LOWER_OPS = ['gte', 'gt', 'after', 'from', 'since', 'min']
const UPPER_OPS = ['lt', 'lte', 'before', 'to', 'until', 'max']
/** Liste des champs à renvoyer (« select: ['*'] »). */
const SELECT_NAMES = new Set('select fields columns properties attributes include'.split(' '))
/** Combinaison « toutes les conditions » d'un filtre (« and: [ … ] »). */
const AND_NAMES = new Set(['and', '$and', 'allof'])

const typeOf = (s: JsonSchema): string[] => [s.type ?? [], ...(s.anyOf ?? []).map((a) => a.type ?? [])].flat()

/** Schéma réel d'un paramètre : suit les références internes (« #/$defs/… »). */
function resolve(s: JsonSchema | undefined, root: InputSchema | undefined, depth = 0): JsonSchema {
  if (!s || typeof s !== 'object') return {}
  if (!s.$ref || depth > 8) return s
  const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(s.$ref)
  const target = m ? (m[1] === '$defs' ? root?.$defs : root?.definitions)?.[m[2]] : undefined
  return target ? resolve({ ...target, ...(s.description ? { description: s.description } : {}) }, root, depth + 1) : {}
}

function formatOf(s: JsonSchema): 'date' | 'datetime' {
  const fmts = [s.format, ...(s.anyOf ?? []).map((a) => a.format)]
  if (fmts.includes('date')) return 'date'
  if (fmts.includes('date-time')) return 'datetime'
  const d = s.description ?? ''
  return /YYYY-MM-DD|AAAA-MM-JJ/i.test(d) && !/T?HH|heure|time|ISO ?8601/i.test(d) ? 'date' : 'datetime'
}

/** Opérateurs de borne basse et haute d'un champ filtrable (« { gte, lt } »), s'il en a. */
function rangeOps(s: JsonSchema, root: InputSchema | undefined): { gte: string; lt: string; format: 'date' | 'datetime' } | null {
  const ops = s.properties ?? {}
  const gte = LOWER_OPS.find((o) => o in ops)
  const lt = UPPER_OPS.find((o) => o in ops)
  if (!gte || !lt) return null
  const op = resolve(ops[gte], root)
  if (!typeOf(op).includes('string') && typeOf(op).length) return null
  return { gte, lt, format: formatOf(op) }
}

/** Comment remplir les paramètres de l'outil pour une période, ou ce qui l'empêche. */
export function argsSpec(tool: McpToolInfo): { args: AgendaToolArgs } | { problem: string } {
  const root = tool.inputSchema
  const props = root?.properties ?? {}
  const required = new Set(root?.required ?? [])
  const args: AgendaToolArgs = { format: 'datetime', fixed: {} }
  let range: (NonNullable<AgendaToolArgs['range']> & { format: 'date' | 'datetime' }) | undefined
  let and: string | undefined
  for (const [name, raw] of Object.entries(props)) {
    const schema = resolve(raw, root)
    const n = norm(name)
    if (AND_NAMES.has(n) && typeOf(schema).includes('array') && !required.has(name)) {
      and = name
      continue
    }
    const isText = typeOf(schema).some((t) => t === 'string') || (!typeOf(schema).length && !schema.properties)
    const ops = !range && RANGE_FIELDS.has(n) && schema.properties ? rangeOps(schema, root) : null
    if (isText && FROM_NAMES.has(n) && !args.from) {
      args.from = name
      args.format = formatOf(schema)
    } else if (isText && TO_NAMES.has(n) && !args.to) args.to = name
    else if (isText && DAY_NAMES.has(n) && !args.day) {
      args.day = name
      args.format = formatOf(schema)
    } else if (isText && ZONE_NAMES.has(n) && !args.zone) args.zone = name
    else if (ops) range = { field: name, ...ops }
    else if (LIMIT_NAMES.has(n) && typeOf(schema).some((t) => t === 'integer' || t === 'number')) {
      args.fixed[name] = Math.min(schema.maximum ?? 100, 100)
    } else if (required.has(name) && SELECT_NAMES.has(n) && typeOf(schema).includes('array')) {
      // « Utilise '*' pour tous les champs » : c'est le schéma qui le dit ; sinon toutes les valeurs permises.
      const items = resolve(schema.items, root)
      if (/['"`]\*['"`]/.test(`${raw.description ?? ''} ${schema.description ?? ''}`)) args.fixed[name] = ['*']
      else if (items.enum?.length && items.enum.every((v) => typeof v === 'string')) args.fixed[name] = items.enum as string[]
      else return { problem: `demande « ${name} », que Compi ne sait pas remplir` }
    } else if (required.has(name)) return { problem: `demande « ${name} », que Compi ne sait pas remplir` }
  }
  // Début et jour à la fois : la période l'emporte. Un filtre sur un champ date ne sert qu'à défaut.
  if (args.from && args.day) delete args.day
  if (range && !args.from && !args.to && !args.day) {
    args.range = { field: range.field, gte: range.gte, lt: range.lt, ...(and ? { and } : {}) }
    args.format = range.format
  }
  return { args }
}

const writes = (t: McpToolInfo): boolean =>
  t.annotations?.readOnlyHint !== true && (t.annotations?.destructiveHint === true || words(t.name).some((x) => WRITE_VERBS.has(x)))

/**
 * Outils d'un connecteur qui pourraient fournir des événements, du plus probable au
 * moins probable. Ceux qui pourraient modifier des données sont signalés : Compi
 * les appelle tout seul à chaque actualisation, donc seulement en lecture.
 * `strict` : seulement les outils dont le nom ou la description parle d'agenda (sinon,
 * si aucun n'en parle, les outils en lecture sont proposés pour essayer). `max` : 12 par défaut.
 */
export function rankAgendaTools(tools: McpToolInfo[], o: { strict?: boolean; max?: number } = {}): AgendaToolChoice[] {
  const scored = tools.map((t) => {
    const w = words(t.name)
    const d = words(t.description ?? '')
    const eventish = [...w, ...d].some((x) => EVENT_WORDS.has(x))
    const spec = argsSpec(t)
    const dated = 'args' in spec && Boolean(spec.args.from || spec.args.to || spec.args.day || spec.args.range)
    // « find_one_… », « group_by_… » : un enregistrement ou des statistiques, pas une liste.
    const lookup = w.some((x) => LOOKUP_WORDS.has(x))
    // « find_many_calendar_event_participants » parle d'autre chose que des événements eux-mêmes.
    const extra = w.filter((x) => !EVENT_WORDS.has(x) && !READ_VERBS.has(x) && !WRITE_VERBS.has(x) && !FILLER.has(x) && !LOOKUP_WORDS.has(x)).length
    const score =
      w.filter((x) => EVENT_WORDS.has(x)).length * 3 +
      Math.min(2, d.filter((x) => EVENT_WORDS.has(x)).length) +
      (w.some((x) => READ_VERBS.has(x)) ? 2 : 0) +
      (t.annotations?.readOnlyHint ? 1 : 0) +
      (dated ? 5 : 0) -
      Math.min(2, extra) -
      (lookup ? 4 : 0)
    const problem = writes(t) ? 'peut modifier des données : Compi ne l’appellera pas tout seul' : 'problem' in spec ? spec.problem : undefined
    return { choice: { tool: t.name, description: (t.description ?? '').slice(0, 200), ...(problem ? { problem } : {}) }, score, eventish }
  })
  // Aucun outil ne parle d'événements (« find_records »…) : les outils en lecture, pour essayer.
  const relevant = o.strict
    ? scored.filter((s) => s.eventish && s.score > 0)
    : scored.some((s) => s.score > 0)
      ? scored.filter((s) => s.score > 0)
      : scored.filter((s) => !s.choice.problem)
  return relevant
    .sort((a, b) => Number(Boolean(a.choice.problem)) - Number(Boolean(b.choice.problem)) || b.score - a.score)
    .map((s) => s.choice)
    .slice(0, o.max ?? 12)
}

/** L'outil peut être appelé automatiquement (lecture seule, paramètres remplissables). */
export function toolUsable(tool: McpToolInfo): AgendaToolArgs | null {
  if (writes(tool)) return null
  const spec = argsSpec(tool)
  return 'args' in spec ? spec.args : null
}

// ─── Connecteurs « passerelle » (catalogue → schéma → exécution) ─────────────

/** Les outils d'une passerelle. `learn` est facultatif : le catalogue peut donner les schémas. */
export interface Gateway {
  catalog: string
  learn?: { tool: string; key: string; array: boolean }
  execute: AgendaVia
}

const GATEWAY_NOUNS = new Set('tool tools action actions catalog'.split(' '))
const EXEC_VERBS = new Set('execute call run invoke use perform'.split(' '))
const LEARN_VERBS = new Set('learn describe schema schemas details inspect explain info'.split(' '))
const CATALOG_VERBS = new Set('catalog list get search browse discover find'.split(' '))
const NAME_KEYS = new Set('toolname tool name action actionname toolslug slug toolid'.split(' '))
const ARGS_KEYS = new Set('arguments args input inputs params parameters toolinput toolarguments payload'.split(' '))
const LEARN_KEYS = new Set('toolnames tools names toolname tool name slugs'.split(' '))

/**
 * Passerelle repérée d'après les noms et les schémas : un outil d'exécution (nom de
 * l'outil + ses paramètres) et un catalogue sans paramètre obligatoire. Aucun service
 * n'est connu d'avance.
 */
export function findGateway(tools: McpToolInfo[]): Gateway | null {
  let execute: AgendaVia | undefined
  let catalog: string | undefined
  let learn: Gateway['learn']
  for (const t of tools) {
    const w = words(t.name)
    if (!w.some((x) => GATEWAY_NOUNS.has(x))) continue
    const root = t.inputSchema
    const required = root?.required ?? []
    const params = Object.entries(root?.properties ?? {}).map(([key, raw]) => ({ key, n: norm(key), s: resolve(raw, root) }))
    if (!execute && w.some((x) => EXEC_VERBS.has(x))) {
      const name = params.find((p) => NAME_KEYS.has(p.n) && typeOf(p.s).includes('string'))
      const args = params.find(
        (p) => p !== name && ARGS_KEYS.has(p.n) && (typeOf(p.s).includes('object') || (!typeOf(p.s).length && p.s.additionalProperties !== undefined))
      )
      if (name && args) {
        execute = { tool: t.name, nameKey: name.key, argsKey: args.key }
        continue
      }
    }
    // Catalogue et schémas sont appelés tout seuls : jamais un outil qui pourrait écrire.
    if (writes(t)) continue
    if (!learn && w.some((x) => LEARN_VERBS.has(x))) {
      const key = params.find((p) => LEARN_KEYS.has(p.n) && required.includes(p.key))
      if (key) {
        learn = { tool: t.name, key: key.key, array: typeOf(key.s).includes('array') }
        continue
      }
    }
    if (!catalog && w.some((x) => CATALOG_VERBS.has(x)) && !required.length) catalog = t.name
  }
  return execute && catalog ? { catalog, execute, ...(learn ? { learn } : {}) } : null
}

const SCHEMA_KEYS = ['inputSchema', 'input_schema', 'schema', 'parameters', 'inputs']

/** Racines JSON d'une réponse d'outil : le contenu structuré, puis le JSON de chaque texte. */
function rootsOf(payload: ToolPayload): unknown[] {
  const roots: unknown[] = []
  if (payload.structuredContent !== undefined) roots.push(payload.structuredContent)
  for (const c of payload.content ?? []) if (c.type === 'text' && c.text) roots.push(jsonIn(c.text))
  return roots
}

/** Outils décrits dans la réponse d'un catalogue ou d'une demande de schémas : nom, description, schéma. */
export function catalogEntries(payload: ToolPayload): McpToolInfo[] {
  const out = new Map<string, McpToolInfo>()
  for (const root of rootsOf(payload))
    for (const list of arraysIn(root))
      for (const o of list) {
        const name = text(field(o, ['name', 'toolName', 'tool_name', 'slug']))
        if (!name || name.length > 200) continue
        const description = text(field(o, ['description', 'summary']))
        const schema = SCHEMA_KEYS.map((k) => o[k]).find(isObj) as InputSchema | undefined
        if (!description && !schema) continue
        const prev = out.get(name)
        const inputSchema = schema ?? prev?.inputSchema
        out.set(name, { name, description: description ?? prev?.description, ...(inputSchema ? { inputSchema } : {}) })
        if (out.size >= 2000) return [...out.values()]
      }
  return [...out.values()]
}

/** Réponse en JSON qui annonce un échec (« success: false », « error: … ») : son message, sinon null. */
export function payloadError(payload: ToolPayload): string | null {
  for (const r of rootsOf(payload)) {
    if (!isObj(r)) continue
    const err = r.error ?? r.errors
    if (r.success === false || r.ok === false || (err && (!Array.isArray(err) || err.length))) {
      const first = Array.isArray(err) ? err[0] : err
      const msg = typeof first === 'string' ? first : isObj(first) ? text(first.message) : text(r.message)
      return (msg ?? 'le service a répondu par une erreur').slice(0, 200)
    }
  }
  return null
}

// ─── Remplir les paramètres ──────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')
export const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Heure locale avec son décalage : « 2026-10-15T00:00:00+02:00 ». */
export function localIso(d: Date): string {
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

/** Fuseau horaire du PC, au format du service (« Europe/Paris »). */
export const pcTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Paramètres de chaque appel pour la période (un appel par jour si l'outil ne prend qu'un jour, 14 jours au plus). */
export function argsFor(spec: AgendaToolArgs, from: Date, to: Date, format = spec.format): Array<Record<string, unknown>> {
  const fmt = (d: Date): string => (format === 'date' ? localDay(d) : localIso(d))
  const fixed = { ...spec.fixed, ...(spec.zone ? { [spec.zone]: pcTimeZone() } : {}) }
  if (spec.day && !spec.from) {
    const calls: Array<Record<string, unknown>> = []
    for (
      let d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
      d < to && calls.length < 14;
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
    )
      calls.push({ ...fixed, [spec.day]: fmt(d) })
    return calls
  }
  // Filtre façon base de données : « startsAt: { gte: début, lt: fin } », ou une condition par
  // borne réunies par « and » quand le service n'accepte qu'un opérateur par champ.
  if (spec.range && !spec.from && !spec.to) {
    const { field, gte, lt, and, split } = spec.range
    return split && and
      ? [{ ...fixed, [and]: [{ [field]: { [gte]: fmt(from) } }, { [field]: { [lt]: fmt(to) } }] }]
      : [{ ...fixed, [field]: { [gte]: fmt(from), [lt]: fmt(to) } }]
  }
  return [{ ...fixed, ...(spec.from ? { [spec.from]: fmt(from) } : {}), ...(spec.to ? { [spec.to]: fmt(to) } : {}) }]
}

// ─── Lire la réponse ─────────────────────────────────────────────────────────

/** Réponse d'un outil MCP (`callTool`). */
export interface ToolPayload {
  structuredContent?: unknown
  content?: Array<{ type: string; text?: string }>
  isError?: boolean
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Valeur d'un champ, quel que soit son style d'écriture (startTime, start_time, StartTime). */
function field(o: Obj, names: string[]): unknown {
  const wanted = names.map(norm)
  for (const w of wanted) {
    const key = Object.keys(o).find((k) => norm(k) === w)
    if (key !== undefined && o[key] !== null && o[key] !== undefined && o[key] !== '') return o[key]
  }
  return undefined
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/

/** Date d'un champ : texte ISO, date seule, nombre (secondes ou millisecondes), ou objet { dateTime | date }. */
export function readDate(v: unknown): { iso: string; allDay: boolean } | null {
  if (isObj(v)) {
    const inner = field(v, ['dateTime', 'date_time', 'datetime', 'iso', 'value', 'date', 'start', 'time'])
    return inner === undefined || isObj(inner) ? null : readDate(inner)
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 1e9) return { iso: new Date(v > 1e12 ? v : v * 1000).toISOString(), allDay: false }
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (DATE_ONLY.test(s)) return { iso: s, allDay: true }
  const local = LOCAL_TIME.exec(s)
  if (local) {
    const [, y, mo, d, h, mi, sec] = local
    return { iso: new Date(+y, +mo - 1, +d, +h, +mi, +(sec ?? 0)).toISOString(), allDay: false }
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : { iso: new Date(t).toISOString(), allDay: false }
}

const startMs = (e: DayEvent): number => (e.allDay ? new Date(`${e.start}T00:00:00`).getTime() : Date.parse(e.start))
const endMs = (e: DayEvent): number => (e.allDay ? new Date(`${e.end}T00:00:00`).getTime() : Date.parse(e.end))

/** L'événement touche la période [from, to[ (un point dans le temps : son début y est). */
export function overlaps(e: DayEvent, from: Date, to: Date): boolean {
  const s = startMs(e)
  const end = Math.max(endMs(e), s)
  return s < to.getTime() && (end > from.getTime() || (end === s && s >= from.getTime()))
}

const nextDay = (day: string): string => {
  const d = new Date(`${day}T12:00:00`)
  return localDay(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1))
}

const START_FIELDS = [
  'start',
  'startTime',
  'startDate',
  'startsAt',
  'startAt',
  'start_datetime',
  'begin',
  'beginsAt',
  'date',
  'dueAt',
  'dueDate',
  'due',
  'datetime',
  'dateTime',
  'when',
  'scheduledAt',
  'scheduledFor'
]
const END_FIELDS = ['end', 'endTime', 'endDate', 'endsAt', 'endAt', 'end_datetime', 'finish', 'until']
const CLOCK = /^(\d{1,2})[:h](\d{2})/

/** Première date lisible parmi ces champs (« start_time: 10:00 » seul n'en est pas une). */
function dateField(o: Obj, names: string[]): { iso: string; allDay: boolean } | null {
  for (const n of names) {
    const d = readDate(field(o, [n]))
    if (d) return d
  }
  return null
}

/** Heure seule (« 10:00 », « 9h30 ») d'un de ces champs. */
function clockField(o: Obj, names: string[]): [number, number] | null {
  for (const n of names) {
    const v = text(field(o, [n]))
    const m = v && !/\d{4}-\d{2}-\d{2}/.test(v) ? CLOCK.exec(v) : null
    if (m && +m[1] < 24 && +m[2] < 60) return [+m[1], +m[2]]
  }
  return null
}

/** Date seule + heure seule → heure locale. */
const withClock = (day: string, [h, m]: [number, number]): { iso: string; allDay: boolean } => {
  const d = new Date(`${day}T12:00:00`)
  return { iso: new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString(), allDay: false }
}

/** Minuit UTC pile : souvent une date sans heure enregistrée comme un instant. */
const utcMidnight = (iso: string): boolean => iso.endsWith('T00:00:00.000Z')
/** Jour d'un instant : la date UTC si c'est minuit UTC pile, sinon le jour local. */
const dayOf = (iso: string): string => (utcMidnight(iso) ? iso.slice(0, 10) : localDay(new Date(iso)))
/** Fin (exclue) d'une journée entière donnée comme un instant : minuit = ce jour-là, sinon le lendemain. */
const dayAfter = (iso: string): string => (utcMidnight(iso) || localIso(new Date(iso)).includes('T00:00:00') ? dayOf(iso) : nextDay(dayOf(iso)))

/** Statuts qui retirent un élément de l'agenda : annulé, ou tâche terminée. */
const GONE = new Set(['cancelled', 'canceled', 'done', 'completed', 'complete'])
const LINK_FIELDS = [
  'htmlLink',
  'url',
  'link',
  'webLink',
  'web_url',
  'permalink',
  'meetingUrl',
  'meetingLink',
  'joinUrl',
  'joinWebUrl',
  'onlineMeetingUrl',
  'hangoutLink',
  'conferenceUrl',
  'conferenceLink',
  'videoLink'
]

/** Un objet de la réponse → événement, s'il a au moins un titre et un début. */
export function toEvent(o: Obj, label?: string): DayEvent | null {
  const status = text(field(o, ['status', 'state']))?.toLowerCase()
  if (status && GONE.has(status)) return null
  if (field(o, ['isCanceled', 'isCancelled', 'canceled', 'cancelled']) === true) return null
  const title = text(field(o, ['summary', 'title', 'name', 'subject', 'label', 'eventName', 'event_name', 'text']))
  let start = dateField(o, START_FIELDS)
  if (!title || !start) return null
  let end = dateField(o, END_FIELDS)
  // Date et heures dans des champs séparés : « date: 2026-10-15, start_time: 10:00, end_time: 11:00 ».
  if (start.allDay) {
    const day = start.iso.slice(0, 10)
    const from = clockField(o, ['startTime', 'start_time', 'time', 'heure', 'heureDebut', 'from'])
    const until = clockField(o, ['endTime', 'end_time', 'heureFin', 'to'])
    if (from) {
      start = withClock(day, from)
      if (until && (!end || end.allDay)) end = withClock(day, until)
    }
  }
  const allDayFlag = field(o, ['allDay', 'isAllDay', 'all_day', 'fullDay', 'isFullDay', 'isAllDayEvent'])
  // Échéance sans fin à minuit UTC pile (« dueAt: 2026-10-15T00:00:00Z ») : une date, pas une heure.
  const allDay = allDayFlag === true || (start.allDay && (!end || end.allDay)) || (!end && utcMidnight(start.iso))
  const startIso = allDay ? (start.allDay ? start.iso : dayOf(start.iso)) : start.iso
  let endIso: string
  if (allDay) {
    const endDay = !end ? '' : end.allDay ? end.iso : dayAfter(end.iso)
    endIso = endDay > startIso ? endDay : nextDay(startIso)
  } else endIso = end && !end.allDay && Date.parse(end.iso) >= Date.parse(start.iso) ? end.iso : start.iso
  const loc = field(o, ['location', 'place', 'address', 'where', 'venue', 'lieu'])
  const location = text(loc) ?? (isObj(loc) ? text(field(loc, ['name', 'displayName', 'address', 'title'])) : undefined)
  // Un lien peut être un objet (« conferenceLink: { primaryLinkUrl } »).
  const links = LINK_FIELDS.map((k) => {
    const v = field(o, [k])
    return text(v) ?? (isObj(v) ? text(field(v, ['url', 'href', 'uri', 'primaryLinkUrl', 'link', 'joinUrl'])) : undefined)
  }).filter((u): u is string => Boolean(u && /^https:\/\//i.test(u)))
  const id = field(o, ['id', 'uid', 'eventId', '_id'])
  return {
    id: `${typeof id === 'string' || typeof id === 'number' ? id : title}`,
    title: title.slice(0, 300),
    start: startIso,
    end: endIso,
    allDay,
    ...(location ? { location: location.slice(0, 200) } : {}),
    ...(label ? { calendar: label } : {}),
    meetUrl: findMeetingUrl(links, [location, text(field(o, ['description', 'notes', 'body', 'details']))]),
    ...(links[0] ? { htmlLink: links[0] } : {})
  }
}

/** JSON du texte d'une réponse : le texte entier, sinon le premier bloc { … } ou [ … ] qu'il contient. */
function jsonIn(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    const start = s.search(/[[{]/)
    if (start < 0) return undefined
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'))
    try {
      return end > start ? JSON.parse(s.slice(start, end + 1)) : undefined
    } catch {
      return undefined
    }
  }
}

/** Tous les tableaux d'objets de la réponse (5 niveaux au plus). */
function arraysIn(v: unknown, depth = 0, out: Obj[][] = []): Obj[][] {
  if (depth > 5) return out
  if (Array.isArray(v)) {
    const objs = v.filter(isObj)
    if (objs.length) out.push(objs)
    for (const x of v) if (isObj(x) || Array.isArray(x)) arraysIn(x, depth + 1, out)
  } else if (isObj(v)) for (const x of Object.values(v)) arraysIn(x, depth + 1, out)
  return out
}

/**
 * Événements d'une réponse d'outil, pour la période : on prend le tableau d'objets
 * qui donne le plus d'événements lisibles (titre + début). `readable` : la réponse
 * est structurée (JSON), même vide ; sinon c'est du texte libre, inutilisable.
 * `found` : événements lisibles dans toute la réponse, avant le filtre de période.
 */
export function extractEvents(payload: ToolPayload, from: Date, to: Date, label?: string): { events: DayEvent[]; readable: boolean; found: number } {
  const roots: unknown[] = []
  if (payload.structuredContent !== undefined) roots.push(payload.structuredContent)
  for (const c of payload.content ?? []) if (c.type === 'text' && c.text) roots.push(jsonIn(c.text))
  const readable = roots.some((r) => isObj(r) || Array.isArray(r))
  let best: DayEvent[] = []
  for (const root of roots) {
    const candidates = [...arraysIn(root), ...(isObj(root) ? [[root]] : [])]
    for (const list of candidates) {
      const events = list.map((o) => toEvent(o, label)).filter((e): e is DayEvent => e !== null)
      if (events.length > best.length) best = events
    }
  }
  const seen = new Set<string>()
  const events = best
    .filter((e) => overlaps(e, from, to))
    .filter((e) => {
      const key = `${e.id}|${e.start}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => startMs(a) - startMs(b))
  return { events, readable, found: best.length }
}

/** Fusionne plusieurs sources : sans doublon (même titre, même début), du plus tôt au plus tard. */
export function mergeEvents(lists: DayEvent[][]): DayEvent[] {
  const seen = new Set<string>()
  return lists
    .flat()
    .filter((e) => {
      const key = `${e.title.toLowerCase()}|${startMs(e)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => startMs(a) - startMs(b))
}

/** Un rendez-vous avec une durée (pas une échéance ponctuelle ni une journée entière) : sujet d'une alerte de réunion. */
export const isTimedMeeting = (e: DayEvent): boolean => !e.allDay && endMs(e) > startMs(e)

/** Lien d'agenda .ics : https (webcal:// devient https://), ou http sur 127.0.0.1 ; sinon la raison du refus. */
export function icsUrl(raw: string): { url: string } | { problem: string } {
  const s = raw.trim().replace(/^webcals?:\/\//i, 'https://')
  try {
    const u = new URL(s)
    const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return { problem: 'Le lien doit commencer par https:// (ou webcal://).' }
    return { url: u.toString() }
  } catch {
    return { problem: 'Ce n’est pas un lien valide.' }
  }
}
