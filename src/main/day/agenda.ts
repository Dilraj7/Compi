// Sources de l'agenda : les agendas Google choisis, l'outil d'un connecteur
// (agenda familial, CRM… n'importe lequel, même derrière une passerelle), un lien
// .ics. Tout est lu sur le PC, sans cerveau. « Aujourd'hui », le résumé du matin,
// les alertes de réunion et l'outil calendar_events passent tous par ici : une
// source ajoutée sert partout.

import { randomUUID } from 'node:crypto'
import { net } from 'electron'
import {
  argsFor,
  catalogEntries,
  extractEvents,
  findGateway,
  icsUrl,
  mergeEvents,
  overlaps,
  payloadError,
  rankAgendaTools,
  toolUsable,
  type Gateway,
  type McpToolInfo,
  type ToolPayload
} from '../../shared/agenda'
import type { AgendaDraft, AgendaPreview, AgendaSource, AgendaToolArgs, AgendaToolChoice, AgendaVia, DayEvent } from '../../shared/types'
import { withConnector } from '../connectors/registry'
import { GoogleAuthError } from '../google/connect'
import { calendarChoices, listEvents } from '../google/calendar'
import { log } from '../log'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'
import { parseIcs } from './ics'

const MAX_SOURCES = 8
const CACHE_MS = 5 * 60_000
const ICS_MAX_BYTES = 5 * 1024 * 1024
/** Outils d'une passerelle dont Compi demande le schéma (les plus probables du catalogue). */
const MAX_LEARNED = 12
const icsKey = (id: string): string => `agenda-ics:${id}`

/** Événements par source et par jours entiers, gardés 5 minutes (les alertes relisent toutes les 5 minutes). */
const cache = new Map<string, { at: number; events: DayEvent[] }>()

export { calendarChoices }

/** Au moins une source d'agenda active : Google, ou une source ajoutée. */
export function agendaActive(): boolean {
  const s = settings.get()
  return s.google.calendar || s.agenda.sources.some((x) => x.enabled)
}

const startOfDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

const toolError = (r: ToolPayload): string =>
  (r.content ?? [])
    .map((c) => c.text ?? '')
    .join(' ')
    .trim()
    .slice(0, 200) || 'erreur sans détail'

async function fetchIcs(url: string): Promise<string> {
  // Sans cache HTTP : le lien est un secret, il ne doit pas finir en clair dans le cache de Chromium.
  const res = await net.fetch(url, { signal: AbortSignal.timeout(15_000), cache: 'no-store' })
  if (!res.ok) throw new Error(`le serveur répond ${res.status}`)
  if (res.url && 'problem' in icsUrl(res.url)) throw new Error('le lien redirige vers une adresse non sécurisée')
  if (Number(res.headers.get('content-length') ?? 0) > ICS_MAX_BYTES) throw new Error('agenda trop gros (5 Mo au plus)')
  const buf = await res.arrayBuffer()
  if (buf.byteLength > ICS_MAX_BYTES) throw new Error('agenda trop gros (5 Mo au plus)')
  const text = new TextDecoder('utf-8').decode(buf)
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('ce lien ne renvoie pas un agenda au format .ics')
  return text
}

type Client = Parameters<Parameters<typeof withConnector>[1]>[0]
type Invoke = (args: Record<string, unknown>) => Promise<ToolPayload>

const callRaw = async (client: Client, timeout: Promise<never>, name: string, args: Record<string, unknown>): Promise<ToolPayload> =>
  (await Promise.race([client.callTool({ name, arguments: args }), timeout])) as ToolPayload

/** Appel de l'outil, directement ou par l'outil d'exécution d'une passerelle. */
const invoker =
  (client: Client, timeout: Promise<never>, tool: string, via?: AgendaVia): Invoke =>
  (args) =>
    via ? callRaw(client, timeout, via.tool, { [via.nameKey]: tool, [via.argsKey]: args }) : callRaw(client, timeout, tool, args)

/**
 * Outils d'une passerelle : le catalogue, puis le schéma des plus probables (8 au
 * plus, un seul appel quand c'est possible). `wanted` : seulement ces outils.
 */
async function gatewayTools(client: Client, timeout: Promise<never>, gw: Gateway, wanted?: string[]): Promise<McpToolInfo[]> {
  let entries: McpToolInfo[] = []
  if (!wanted || !gw.learn) {
    const r = await callRaw(client, timeout, gw.catalog, {})
    if (r.isError) throw new Error(`catalogue des outils illisible : ${toolError(r)}`)
    entries = catalogEntries(r)
  }
  const names =
    wanted ??
    rankAgendaTools(entries, { strict: true, max: 40 })
      .filter((c) => !c.problem)
      .slice(0, MAX_LEARNED)
      .map((c) => c.tool)
  if (!gw.learn) return entries.filter((t) => names.includes(t.name))
  const learned: McpToolInfo[] = []
  for (const batch of gw.learn.array ? [names] : names.map((n) => [n])) {
    if (!batch.length) continue
    const r = await callRaw(client, timeout, gw.learn.tool, { [gw.learn.key]: gw.learn.array ? batch : batch[0] })
    if (!r.isError) learned.push(...catalogEntries(r))
  }
  return names.map((n) => learned.find((t) => t.name === n && t.inputSchema) ?? entries.find((t) => t.name === n) ?? { name: n })
}

/** Appels de l'outil pour la période, avec ce format de date. */
async function callConnectorTool(
  invoke: Invoke,
  args: AgendaToolArgs,
  from: Date,
  to: Date,
  label: string,
  format = args.format
): Promise<{ events: DayEvent[]; readable: boolean; found: number }> {
  const lists: DayEvent[][] = []
  let readable = false
  let found = 0
  for (const a of argsFor(args, from, to, format)) {
    const r = await invoke(a)
    if (r.isError) throw new Error(payloadError(r) ?? toolError(r))
    // « { success: false, error: … } » : une erreur, pas un agenda vide.
    const failed = payloadError(r)
    if (failed) throw new Error(failed)
    const x = extractEvents(r, from, to, label)
    lists.push(x.events)
    readable ||= x.readable
    found += x.found
  }
  return { events: mergeEvents(lists), readable, found }
}

/** Événements d'une source ajoutée, par jours entiers (cache de 5 minutes). */
async function sourceEvents(src: AgendaSource, from: Date, to: Date): Promise<DayEvent[]> {
  const dayFrom = startOfDay(from)
  const dayTo = addDays(startOfDay(new Date(to.getTime() - 1)), 1)
  // Avant le cache : un connecteur désactivé ou supprimé ne doit plus rien afficher.
  if (src.kind === 'connector') {
    const c = settings.get().connectors.find((x) => x.id === src.connectorId)
    if (!c) throw new Error('le connecteur a été supprimé')
    if (!c.enabled) throw new Error('le connecteur est désactivé dans Extensions')
  }
  const key = `${src.id}|${dayFrom.getTime()}|${dayTo.getTime()}`
  const hit = cache.get(key)
  let events: DayEvent[]
  if (hit && Date.now() - hit.at < CACHE_MS) events = hit.events
  else {
    if (src.kind === 'ics') {
      const url = secrets.get(icsKey(src.id))
      if (!url) throw new Error('lien introuvable : retire la source et ajoute-la de nouveau')
      events = parseIcs(await fetchIcs(url), dayFrom, dayTo, src.name)
    } else {
      events = await withConnector(
        src.connectorId,
        async (client, timeout) => (await callConnectorTool(invoker(client, timeout, src.tool, src.via), src.args, dayFrom, dayTo, src.name)).events,
        30_000
      )
    }
    cache.set(key, { at: Date.now(), events })
  }
  return events.filter((e) => overlaps(e, from, to))
}

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export interface AgendaResult {
  events: DayEvent[]
  /** « Maison : le connecteur est désactivé… » */
  errors: string[]
  /** La connexion Google a expiré ou a été retirée. */
  googleAuthLost?: boolean
}

/** Événements de toutes les sources actives, sans doublon, du plus tôt au plus tard. */
export async function agendaEvents(o: { from: Date; to: Date; query?: string; max?: number }): Promise<AgendaResult> {
  const s = settings.get()
  const sources = s.agenda.sources.filter((x) => x.enabled)
  const [google, ...others] = await Promise.allSettled([
    s.google.calendar ? listEvents(o) : Promise.resolve([] as DayEvent[]),
    ...sources.map((src) => sourceEvents(src, o.from, o.to))
  ])
  const errors: string[] = []
  const lists: DayEvent[][] = []
  let googleAuthLost = false
  if (google.status === 'fulfilled') lists.push(google.value)
  else {
    googleAuthLost = google.reason instanceof GoogleAuthError
    errors.push(`Agenda Google : ${(google.reason as Error).message}`)
  }
  const q = o.query?.trim() ? fold(o.query.trim()) : ''
  others.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors.push(`${sources[i].name} : ${(r.reason as Error).message}`)
      return
    }
    // Google cherche lui-même (titre, description…) ; pour les autres sources, titre et lieu.
    lists.push(q ? r.value.filter((e) => fold(`${e.title} ${e.location ?? ''}`).includes(q)) : r.value)
  })
  for (const e of errors) log('warn', `agenda : ${e}`)
  return { events: mergeEvents(lists).slice(0, o.max ?? 100), errors, ...(googleAuthLost ? { googleAuthLost } : {}) }
}

// ─── Réglages : ajouter, essayer, retirer une source ─────────────────────────

/**
 * Outils du connecteur qui pourraient fournir des événements. Pour une passerelle
 * (catalogue → schéma → exécution), ce sont les outils de son catalogue.
 */
export async function agendaTools(connectorId: string): Promise<AgendaToolChoice[]> {
  return withConnector(
    connectorId,
    async (client, timeout) => {
      const tools = (await Promise.race([client.listTools(), timeout])).tools as McpToolInfo[]
      const gw = findGateway(tools)
      if (!gw) return rankAgendaTools(tools)
      const meta = new Set([gw.catalog, gw.execute.tool, gw.learn?.tool])
      const inside = rankAgendaTools(await gatewayTools(client, timeout, gw), { strict: true }).map((c) => ({ ...c, via: gw.execute.tool }))
      const direct = rankAgendaTools(
        tools.filter((t) => !meta.has(t.name)),
        { strict: true }
      )
      const all = [...inside, ...direct]
      return [...all.filter((c) => !c.problem), ...all.filter((c) => c.problem)].slice(0, 12)
    },
    40_000
  )
}

/** Nom proposé : celui du connecteur, précisé pour des tâches (« Mon CRM · tâches »). */
function suggestedName(connector: string, tool: string): string {
  const w = tool.toLowerCase()
  return /tasks?|todos?|taches?/.test(w) ? `${connector} · tâches` : /deadlines?|echeances?/.test(w) ? `${connector} · échéances` : connector
}

const calendarName = (ics: string): string | undefined => /^X-WR-CALNAME:(.+)$/im.exec(ics)?.[1]?.trim().slice(0, 60) || undefined

/** Essaie une source sans l'enregistrer : aujourd'hui et les 7 jours suivants. */
async function tryDraft(d: AgendaDraft): Promise<AgendaPreview & { args?: AgendaToolArgs; url?: string; via?: AgendaVia }> {
  const from = startOfDay(new Date())
  const to = addDays(from, 8)
  const label = d.name?.trim() || ''
  const summary = (n: number): string =>
    n ? `${n} élément${n > 1 ? 's' : ''} aujourd’hui et dans les 7 prochains jours.` : 'Rien aujourd’hui ni dans les 7 prochains jours.'
  if (d.kind === 'ics') {
    const u = icsUrl(d.url)
    if ('problem' in u) return { ok: false, message: u.problem, events: [], count: 0 }
    const text = await fetchIcs(u.url)
    const name = label || calendarName(text) || new URL(u.url).hostname
    const events = parseIcs(text, from, to, name)
    return { ok: true, message: summary(events.length), events: events.slice(0, 5), count: events.length, name, url: u.url }
  }
  const c = settings.get().connectors.find((x) => x.id === d.connectorId)
  if (!c) return { ok: false, message: 'Connecteur introuvable.', events: [], count: 0 }
  const name = label || suggestedName(c.name, d.tool)
  return withConnector(
    d.connectorId,
    async (client, timeout) => {
      const tools = (await Promise.race([client.listTools(), timeout])).tools as McpToolInfo[]
      let tool: McpToolInfo | undefined
      let via: AgendaVia | undefined
      if (d.via) {
        // Outil d'une passerelle : son schéma vient du catalogue (ou de l'outil qui décrit les schémas).
        const gw = findGateway(tools)
        if (!gw || gw.execute.tool !== d.via)
          return { ok: false, message: 'Ce connecteur ne fonctionne plus de la même façon : choisis de nouveau l’outil.', events: [], count: 0 }
        tool = (await gatewayTools(client, timeout, gw, [d.tool])).find((t) => t.name === d.tool && t.name !== gw.execute.tool)
        via = gw.execute
      } else tool = tools.find((t) => t.name === d.tool)
      if (!tool) return { ok: false, message: `Le connecteur n’a pas d’outil « ${d.tool} ».`, events: [], count: 0 }
      const args = toolUsable(tool)
      if (!args)
        return { ok: false, message: 'Cet outil pourrait modifier des données, ou demande des paramètres que Compi ne sait pas remplir.', events: [], count: 0 }
      const invoke = invoker(client, timeout, d.tool, via)
      // Variantes essayées dans l'ordre, jusqu'à la première qui trouve quelque chose : format de
      // date deviné du schéma puis l'autre ; filtre de date avec deux opérateurs, puis une
      // condition par borne réunies par « and » (certains services n'acceptent qu'un opérateur).
      const dated = Boolean(args.from || args.to || args.day || args.range)
      const formats: Array<'date' | 'datetime'> = dated ? [args.format, args.format === 'date' ? 'datetime' : 'date'] : [args.format]
      const variants = formats.flatMap((format) =>
        (args.range?.and ? [false, true] : [false]).map((split): AgendaToolArgs => ({
          ...args,
          format,
          ...(args.range ? { range: { ...args.range, split } } : {})
        }))
      )
      let best: { events: DayEvent[]; readable: boolean; found: number; args: AgendaToolArgs } | null = null
      let lastError = ''
      for (const v of variants) {
        try {
          const r = await callConnectorTool(invoke, v, from, to, name)
          if (!best || r.found > best.found || (r.readable && !best.readable)) best = { ...r, args: v }
          if (r.found) break
        } catch (e) {
          lastError = (e as Error).message
        }
      }
      if (!best) return { ok: false, message: `L’outil a renvoyé une erreur : ${lastError}`, events: [], count: 0 }
      if (!best.readable)
        return {
          ok: false,
          message: 'Cet outil répond en texte libre : Compi ne sait pas en tirer des dates et des titres. Essaie un autre outil.',
          events: [],
          count: 0
        }
      return {
        ok: true,
        message: summary(best.events.length),
        events: best.events.slice(0, 5),
        count: best.events.length,
        name,
        args: best.args,
        ...(via ? { via } : {})
      }
    },
    40_000
  )
}

export async function previewSource(d: AgendaDraft): Promise<AgendaPreview> {
  try {
    const { args: _a, url: _u, via: _v, ...preview } = await tryDraft(d)
    return preview
  } catch (e) {
    return { ok: false, message: (e as Error).message, events: [], count: 0 }
  }
}

/** Ajoute la source après l'avoir essayée (le lien .ics est chiffré, jamais dans settings.json). */
export async function addSource(d: AgendaDraft): Promise<void> {
  const s = settings.get()
  if (s.agenda.sources.length >= MAX_SOURCES) throw new Error(`${MAX_SOURCES} sources au plus.`)
  const r = await tryDraft(d)
  if (!r.ok) throw new Error(r.message)
  const id = randomUUID().slice(0, 8)
  const name = (d.name?.trim() || r.name || 'Agenda').slice(0, 60)
  let source: AgendaSource
  if (d.kind === 'ics') {
    secrets.set(icsKey(id), r.url!)
    source = { id, kind: 'ics', name, enabled: true, host: new URL(r.url!).hostname }
  } else source = { id, kind: 'connector', name, enabled: true, connectorId: d.connectorId, tool: d.tool, args: r.args!, ...(r.via ? { via: r.via } : {}) }
  settings.update({ agenda: { ...s.agenda, sources: [...s.agenda.sources, source] } })
  log('info', `agenda : source ajoutée (${source.kind})`)
}

export function updateSource(id: string, patch: { enabled?: boolean; name?: string }): void {
  const s = settings.get()
  const sources = s.agenda.sources.map((x) =>
    x.id !== id
      ? x
      : {
          ...x,
          ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
          ...(typeof patch.name === 'string' && patch.name.trim() ? { name: patch.name.trim().slice(0, 60) } : {})
        }
  )
  for (const k of cache.keys()) if (k.startsWith(`${id}|`)) cache.delete(k)
  settings.update({ agenda: { ...s.agenda, sources } })
}

export function removeSource(id: string): void {
  const s = settings.get()
  secrets.set(icsKey(id), null)
  for (const k of cache.keys()) if (k.startsWith(`${id}|`)) cache.delete(k)
  settings.update({ agenda: { ...s.agenda, sources: s.agenda.sources.filter((x) => x.id !== id) } })
}

/** Agendas Google affichés : une liste d'identifiants, ou `null` (comme dans Google Agenda). */
export function setGoogleCalendars(ids: string[] | null): void {
  const s = settings.get()
  const clean = ids === null ? null : [...new Set(ids.filter((x) => typeof x === 'string' && x.length < 300))].slice(0, 30)
  settings.update({ agenda: { ...s.agenda, googleCalendars: clean } })
}
