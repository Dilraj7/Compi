// Passerelle locale entre le moteur Claude Code et un cerveau local ou « Autre ».
// Elle applique le style de réponse (le moteur ne sait pas demander « sans
// réflexion », ce qui rend les modèles locaux bien plus rapides), choisit les
// outils qui tiennent dans la fenêtre d'un modèle local, et mesure la vitesse de
// chaque réponse. Elle n'écoute que sur 127.0.0.1, derrière une adresse secrète
// par discussion.

import { randomBytes } from 'node:crypto'
import http from 'node:http'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { app, net } from 'electron'
import {
  localToolsNote,
  presentGroups,
  selectLocalTools,
  splitServerInstructions,
  withServerInstructions,
  type ToolDef,
  type ToolServer
} from '../../shared/localTools'
import type { Effort, RunStats } from '../../shared/types'
import { log } from '../log'

export interface RouteOptions {
  /** Adresse du moteur local ou du service (sans /v1). */
  target: string
  provider: 'local' | 'custom'
  effort: Effort
  /** Le modèle sait réfléchir (capacité `thinking` d'Ollama). Toujours vrai pour un service en ligne. */
  canThink: boolean
  /** Le modèle règle sa réflexion par niveaux (gpt-oss) plutôt que oui/non. */
  levels: boolean
  /** OpenRouter : seulement les fournisseurs qui ne conservent pas les messages. */
  denyDataCollection?: boolean
  /** Garder ces consignes pour préparer le cache du modèle local (faux pour une routine). */
  remember?: boolean
  /** Fenêtre de contexte du modèle local : les outils des connecteurs sont choisis pour y tenir. */
  contextTokens?: number
  /** Connecteurs branchés (clé MCP, nom, mots qui les désignent). */
  servers?: ToolServer[]
  /** Routine : seuls ces outils de connecteur sont utilisables (les autres demanderaient une carte). */
  allowedConnectorTools?: string[]
}

// ─── Réécriture des requêtes (fonctions pures) ───────────────────────────────

const BUDGETS: Record<Effort, number> = { low: 0, medium: 2048, high: 8192, xhigh: 16_384, max: 32_000 }
const LEVELS: Record<Effort, 'low' | 'medium' | 'high'> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' }

type Body = Record<string, unknown>

/** Applique le style de réponse à une requête /v1/messages. */
export function applyStyle(body: Body, o: Pick<RouteOptions, 'effort' | 'canThink' | 'levels'>): Body {
  const out: Body = { ...body }
  delete out.thinking
  delete out.output_config
  if (o.levels) {
    // gpt-oss ne sait pas « ne pas réfléchir » : Ollama traduit l'effort en niveau de réflexion.
    out.output_config = { effort: LEVELS[o.effort] }
    return out
  }
  if (!o.canThink) return out
  if (o.effort === 'low') {
    out.thinking = { type: 'disabled' }
    return out
  }
  const budget = BUDGETS[o.effort]
  out.thinking = { type: 'enabled', budget_tokens: budget }
  // Le budget de réflexion doit rester sous max_tokens.
  const max = typeof out.max_tokens === 'number' ? out.max_tokens : 0
  if (max <= budget) out.max_tokens = budget + 4096
  return out
}

/**
 * Remonte dans les consignes les messages système placés avant la première réponse
 * (environnement, compétences) : le moteur les met après la première question, si bien
 * qu'un modèle local devait les relire à chaque nouvelle discussion. En tête, ils
 * restent dans son cache. Les messages système suivants ne bougent pas, pour que la
 * conversation ne fasse que s'allonger d'un tour à l'autre.
 */
export function hoistSystem(body: Body): Body {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : null
  if (!messages) return body
  const firstAssistant = messages.findIndex((m) => m.role === 'assistant')
  const end = firstAssistant < 0 ? messages.length : firstAssistant
  const lifted = messages.slice(0, end).filter((m) => m.role === 'system')
  if (!lifted.length) return body
  return {
    ...body,
    system: [...textBlocks(body.system), ...lifted.flatMap((m) => textBlocks(m.content))],
    messages: messages.filter((m, i) => i >= end || m.role !== 'system')
  }
}

const textBlocks = (c: unknown): { type: 'text'; text: string }[] =>
  typeof c === 'string'
    ? [{ type: 'text', text: c }]
    : Array.isArray(c)
      ? (c as { type?: string; text?: string }[]).filter((p) => p.type === 'text' && p.text).map((p) => ({ type: 'text', text: p.text! }))
      : []

/**
 * Modèle local : outils essentiels de Compi, plus ceux des groupes de Compi et des
 * connecteurs que la discussion demande, dans la place de sa fenêtre (sinon Ollama coupe le début de la requête,
 * consignes comprises). Les instructions des connecteurs quittent les consignes et
 * accompagnent leurs outils ; la liste des extensions branchées les remplace.
 * `allowed` (routine) : seuls ces outils de connecteur peuvent passer.
 */
export function fitLocalTools(
  body: Body,
  contextTokens: number,
  servers: ToolServer[],
  allowed?: string[]
): { body: Body; summary: string | null; wanted: boolean } {
  if (!Array.isArray(body.tools) || !body.tools.length) return { body, summary: null, wanted: false }
  const all = body.tools as ToolDef[]
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string; content?: unknown }[]) : []
  const keys = servers.map((s) => s.key)
  const sections: Record<string, string> = {}
  const system = textBlocks(body.system).map((b) => {
    const split = splitServerInstructions(b.text, keys)
    Object.assign(sections, split.sections)
    return { type: 'text' as const, text: split.text }
  })
  const sel = selectLocalTools({ tools: all, system, messages, contextTokens, servers, allowed, groups: true })
  const note = localToolsNote({ servers, omitted: sel.omitted, groups: presentGroups(all) })
  const out: Body = {
    ...body,
    system: note ? [...system, { type: 'text', text: note }] : system,
    tools: withServerInstructions(sel.tools, sections, servers, sel.missing)
  }
  const summary = `${sel.tools.length}/${all.length} outils (≈ ${sel.tokens} jetons, fenêtre ${contextTokens})${sel.loaded.length ? ` · chargés : ${sel.loaded.join(', ')}` : ''}${sel.omitted.length ? ` · trop gros : ${sel.omitted.join(', ')}` : ''}${sel.partial.length ? ` · en partie : ${sel.partial.join(', ')}` : ''}`
  return { body: out, summary, wanted: sel.wanted.length > 0 }
}

/** OpenRouter : n'utiliser que les fournisseurs qui ne gardent pas les messages. */
export function applyDataPolicy(body: Body, target: string, deny: boolean | undefined): Body {
  if (!deny || body.provider !== undefined) return body
  try {
    if (!/(^|\.)openrouter\.ai$/i.test(new URL(target).hostname)) return body
  } catch {
    return body
  }
  return { ...body, provider: { data_collection: 'deny' } }
}

/** Le service refuse le réglage de réflexion : on réessaie sans. */
export function rejectsThinking(status: number, text: string): boolean {
  return status === 400 && /thinking|reasoning|budget_tokens/i.test(text)
}

/** Début d'une requête que le modèle local garde en cache : consignes, outils, style. */
export interface PromptPrefix {
  system: string[]
  tools: { name?: string }[]
  thinking: string
}

export function promptPrefix(body: Body): PromptPrefix {
  return {
    system: textBlocks(body.system).map((b) => b.text),
    tools: Array.isArray(body.tools) ? (body.tools as { name?: string }[]) : [],
    thinking: JSON.stringify(body.thinking ?? null)
  }
}

/**
 * Premier endroit où deux débuts de requête diffèrent (là où le modèle local doit
 * tout relire), sans rien citer du contenu : il peut contenir la mémoire ou des chemins.
 */
export function prefixGap(before: PromptPrefix, now: PromptPrefix): string | null {
  if (before.thinking !== now.thinking) return 'réglage de réflexion'
  for (let i = 0; i < Math.max(before.system.length, now.system.length); i++) {
    const a = before.system[i] ?? ''
    const b = now.system[i] ?? ''
    if (a === b) continue
    let at = 0
    while (at < a.length && at < b.length && a[at] === b[at]) at++
    return `consignes, bloc ${i + 1}, caractère ${at}`
  }
  for (let i = 0; i < Math.max(before.tools.length, now.tools.length); i++) {
    if (JSON.stringify(before.tools[i]) === JSON.stringify(now.tools[i])) continue
    return `outil n° ${i + 1} (${now.tools[i]?.name ?? before.tools[i]?.name ?? '?'})`
  }
  return null
}

/** Première requête d'une discussion : une seule demande, encore aucune réponse. */
export function isFirstTurn(body: Body): boolean {
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: string }[]) : []
  return messages.length > 0 && !messages.some((m) => m.role === 'assistant')
}

// ─── Mesures ─────────────────────────────────────────────────────────────────

interface RequestMeter {
  inputTokens: number
  outputTokens: number
  /** Premier fragment produit (texte ou réflexion), pour la vitesse d'écriture. */
  firstDeltaAt?: number
  /** Premier fragment de texte visible. */
  firstTextAt?: number
  endAt?: number
}

/** Lit un flux SSE de /v1/messages au fil de l'eau et en tire les mesures. */
export function createSseMeter(now: () => number = Date.now): { feed: (chunk: string) => void; result: () => RequestMeter } {
  const m: RequestMeter = { inputTokens: 0, outputTokens: 0 }
  let buffer = ''
  const onEvent = (data: string): void => {
    let ev: { type?: string; message?: { usage?: Record<string, number> }; usage?: Record<string, number>; delta?: { type?: string } }
    try {
      ev = JSON.parse(data)
    } catch {
      return
    }
    if (ev.type === 'message_start') {
      m.inputTokens = ev.message?.usage?.input_tokens ?? 0
    } else if (ev.type === 'content_block_delta') {
      const t = now()
      m.firstDeltaAt ??= t
      if (ev.delta?.type === 'text_delta') m.firstTextAt ??= t
    } else if (ev.type === 'message_delta') {
      if (ev.usage?.output_tokens) m.outputTokens = ev.usage.output_tokens
      if (ev.usage?.input_tokens) m.inputTokens = ev.usage.input_tokens
    } else if (ev.type === 'message_stop') {
      m.endAt = now()
    }
  }
  return {
    feed: (chunk) => {
      buffer += chunk
      let i: number
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (line.startsWith('data:')) onEvent(line.slice(5).trim())
      }
    },
    result: () => m
  }
}

/** Cumule les mesures des appels d'une même réponse. */
export function summarize(startedAt: number, meters: RequestMeter[]): RunStats {
  const firstText = meters.map((m) => m.firstTextAt).find((t) => t !== undefined)
  let genTokens = 0
  let genSeconds = 0
  for (const m of meters) {
    if (m.firstDeltaAt === undefined || m.endAt === undefined || m.outputTokens < 5) continue
    genTokens += m.outputTokens
    genSeconds += (m.endAt - m.firstDeltaAt) / 1000
  }
  return {
    firstTokenMs: firstText !== undefined ? firstText - startedAt : undefined,
    tokensPerSec: genSeconds > 0.05 ? Math.round(genTokens / genSeconds) : undefined,
    inputTokens: meters.reduce((n, m) => n + m.inputTokens, 0),
    outputTokens: meters.reduce((n, m) => n + m.outputTokens, 0),
    requests: meters.length
  }
}

// ─── Serveur ─────────────────────────────────────────────────────────────────

interface Route extends RouteOptions {
  startedAt: number
  meters: RequestMeter[]
  /** Le service a refusé le réglage de réflexion : on ne l'envoie plus. */
  noThinking: boolean
  /** Dernier choix d'outils noté dans le journal (une ligne par changement). */
  toolsLogged?: string
  /** Version de la mémoire à l'ouverture : ses consignes ne servent plus au cache si elle a changé depuis. */
  memoryVersion: number
}

const routes = new Map<string, Route>()
let server: http.Server | null = null
let serverReady: Promise<number> | null = null

const HOP_HEADERS = new Set(['host', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'keep-alive'])

function forwardHeaders(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined || HOP_HEADERS.has(k)) continue
    out[k] = Array.isArray(v) ? v.join(', ') : v
  }
  return out
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const match = /^\/r\/([a-f0-9]{32})(\/.*)$/.exec(req.url ?? '')
  const route = match ? routes.get(match[1]) : undefined
  if (!match || !route) {
    res.writeHead(404).end()
    return
  }
  const path = match[2]
  const raw = await readBody(req)
  const isMessages = req.method === 'POST' && path.split('?')[0] === '/v1/messages'

  let body: Body | null = null
  if (isMessages) {
    try {
      body = JSON.parse(raw.toString('utf8')) as Body
    } catch {
      body = null
    }
  }

  const abort = new AbortController()
  res.on('close', () => abort.abort())
  const send = (payload: Buffer | string): Promise<Response> =>
    net.fetch(`${route.target}${path}`, {
      method: req.method,
      headers: forwardHeaders(req),
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : payload,
      signal: abort.signal
    })

  // Discussion qui demande un connecteur précis : ses consignes ne servent pas de modèle au cache.
  let wanted = false
  if (body) {
    // Identifiants de session et d'appareil du moteur : inutiles au modèle, ils ne partent pas.
    delete body.metadata
    if (route.provider === 'local') {
      body = hoistSystem(body)
      if (route.contextTokens) {
        const fit = fitLocalTools(body, route.contextTokens, route.servers ?? [], route.allowedConnectorTools)
        body = fit.body
        wanted = fit.wanted
        if (fit.summary && fit.summary !== route.toolsLogged) log('info', `modèle local : ${fit.summary}`)
        route.toolsLogged = fit.summary ?? undefined
      }
    } else body = applyDataPolicy(body, route.target, route.denyDataCollection)
  }

  try {
    const styled = body && !route.noThinking ? applyStyle(body, route) : body
    if (route.provider === 'local' && styled) noteLocalPrefix(route.target, styled)
    if (route.provider === 'local' && styled && route.remember !== false && !wanted && route.memoryVersion === memoryVersion)
      rememberPrompt(route.target, styled)
    let upstream = await send(styled ? JSON.stringify(styled) : raw)
    if (body && styled && !upstream.ok && !route.noThinking) {
      const text = await upstream.text()
      if (rejectsThinking(upstream.status, text)) {
        route.noThinking = true
        log('warn', `passerelle : ${route.target} refuse le réglage de réflexion, envoi sans`)
        upstream = await send(JSON.stringify(applyStyle(body, { ...route, canThink: false, levels: false })))
      } else {
        res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }).end(text)
        return
      }
    }

    const headers: Record<string, string> = {}
    upstream.headers.forEach((v, k) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k)) headers[k] = v
    })
    res.writeHead(upstream.status, headers)
    if (!upstream.body) {
      res.end()
      return
    }

    const meter = isMessages && upstream.ok ? createSseMeter() : null
    const decoder = new TextDecoder()
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
      meter?.feed(decoder.decode(value, { stream: true }))
    }
    res.end()
    if (meter) route.meters.push(meter.result())
  } catch (e) {
    if (abort.signal.aborted) return
    const message = (e as Error).message ?? String(e)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: `connect ECONNREFUSED ${route.target} : ${message}` } }))
  }
}

// ─── Cache du modèle local ───────────────────────────────────────────────────

/**
 * Début de requête commun à toutes les discussions : consignes, outils, style.
 * Version 3 : sans les outils ni les instructions des connecteurs, chargés à la
 * demande (une version 2 en contenait jusqu'à ~26 000 jetons : on ne la rejoue pas).
 * Version 4 : use_extension accepte `tools` (outils précis d'une extension chargée en partie).
 * Version 5 : les réglages (prénom, Google, dossiers…) quittent les consignes pour le message.
 * Version 6 : une partie des outils de Compi passe en groupes chargés à la demande.
 */
const WARM_VERSION = 6

/** Début de la dernière requête lue par le modèle local : c'est ce qu'il a en cache. */
let lastPrefix: (PromptPrefix & { key: string }) | null = null
let lastGapLogged = ''

/**
 * Une nouvelle discussion qui ne reprend pas le début de la précédente oblige le modèle
 * local à tout relire (~45 s sur une carte graphique moyenne). Le journal dit où.
 */
function noteLocalPrefix(target: string, body: Body): void {
  const key = `${target}|${String(body.model)}`
  const now = { ...promptPrefix(body), key }
  if (lastPrefix?.key === key && isFirstTurn(body)) {
    const gap = prefixGap(lastPrefix, now)
    if (gap && gap !== lastGapLogged) log('info', `cache du modèle local : nouvelle discussion différente de la requête précédente (${gap}), le début est relu`)
    lastGapLogged = gap ?? ''
  }
  lastPrefix = now
}
/**
 * Lire d'avance ~12 000 jetons prend 2 à 3 min sur un PC sans grosse carte
 * graphique. Coupée avant la fin (3 min auparavant), la lecture était perdue et
 * retardait la question suivante d'autant.
 */
const PRIME_TIMEOUT_MS = 15 * 60_000
interface WarmPrompt {
  v?: number
  target: string
  model: string
  system: unknown
  tools: unknown
  thinking?: unknown
  output_config?: unknown
}

const warmFile = (): string => join(app.getPath('userData'), 'warm-prompt.json')
let warmPrompt: WarmPrompt | null | undefined
let warmSaved = ''
/**
 * Change à chaque modification de la mémoire. Les consignes d'une réponse en cours
 * contiennent encore l'ancienne mémoire : après un « oublie… », la requête suivante
 * de la même réponse ne doit pas les réenregistrer sur le disque.
 */
let memoryVersion = 0

function rememberPrompt(target: string, body: Body): void {
  const next: WarmPrompt = {
    v: WARM_VERSION,
    target,
    model: String(body.model),
    system: body.system,
    tools: body.tools,
    thinking: body.thinking,
    output_config: body.output_config
  }
  const json = JSON.stringify(next)
  warmPrompt = next
  if (json === warmSaved) return
  warmSaved = json
  try {
    writeFileSync(warmFile(), json)
  } catch (e) {
    log('warn', 'consignes du modèle local non enregistrées', (e as Error).message)
  }
}

/**
 * Oublie les consignes gardées pour le cache : elles contiennent la mémoire de
 * l'utilisateur, qui vient de changer (un souvenir effacé ne doit pas rester là).
 */
export function forgetWarmPrompt(): void {
  memoryVersion++
  warmPrompt = null
  warmSaved = ''
  try {
    rmSync(warmFile(), { force: true })
  } catch (e) {
    log('warn', 'consignes du modèle local non effacées', (e as Error).message)
  }
}

function loadWarmPrompt(): WarmPrompt | null {
  if (warmPrompt !== undefined) return warmPrompt
  try {
    warmSaved = readFileSync(warmFile(), 'utf8')
    const saved = JSON.parse(warmSaved) as WarmPrompt
    warmPrompt = saved.v === WARM_VERSION ? saved : null
  } catch {
    warmPrompt = null
  }
  return warmPrompt
}

/**
 * Fait lire au modèle local, d'avance, le début commun des requêtes (consignes et
 * outils) : il le garde en cache et la prochaine question démarre presque tout de
 * suite au lieu de relire plusieurs milliers de jetons. Ne génère qu'un jeton.
 */
export async function primeLocalCache(target: string, model: string): Promise<boolean> {
  const p = loadWarmPrompt()
  if (!p || p.model !== model || p.target !== target.replace(/\/+$/, '')) return false
  const started = Date.now()
  const primeBody: Body = {
    model,
    system: p.system,
    tools: p.tools,
    thinking: p.thinking,
    output_config: p.output_config,
    messages: [{ role: 'user', content: [{ type: 'text', text: '.' }] }],
    max_tokens: 1,
    stream: false
  }
  lastPrefix = { ...promptPrefix(primeBody), key: `${p.target}|${model}` }
  const r = await net.fetch(`${p.target}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(primeBody),
    signal: AbortSignal.timeout(PRIME_TIMEOUT_MS)
  })
  const body = await r.text()
  const sec = ((Date.now() - started) / 1000).toFixed(1)
  if (r.ok) log('info', `cache du modèle local préparé : ${model} en ${sec} s`)
  else log('warn', `cache du modèle local non préparé (${r.status} en ${sec} s)`, body.slice(0, 300))
  return r.ok
}

function ensureServer(): Promise<number> {
  if (serverReady) return serverReady
  serverReady = new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      handle(req, res).catch((e) => {
        log('error', 'passerelle', e)
        if (!res.headersSent) res.writeHead(500)
        res.end()
      })
    })
    server.on('error', (e) => {
      serverReady = null
      reject(e)
    })
    server.listen(0, '127.0.0.1', () => resolve((server!.address() as AddressInfo).port))
  })
  return serverReady
}

export interface OpenRoute {
  /** Adresse à donner au moteur (ANTHROPIC_BASE_URL). */
  url: string
  stats: () => RunStats
  /** Nouvelle réponse sur la même adresse (moteur gardé ouvert) : les mesures repartent de zéro. */
  restart: () => void
  close: () => void
}

/** Ouvre une adresse de passerelle pour une réponse (ou pour la vie d'un moteur gardé ouvert). */
export async function openRoute(o: RouteOptions): Promise<OpenRoute> {
  const port = await ensureServer()
  const id = randomBytes(16).toString('hex')
  const route: Route = { ...o, target: o.target.replace(/\/+$/, ''), startedAt: Date.now(), meters: [], noThinking: false, memoryVersion }
  routes.set(id, route)
  return {
    url: `http://127.0.0.1:${port}/r/${id}`,
    stats: () => summarize(route.startedAt, route.meters),
    restart: () => {
      route.startedAt = Date.now()
      route.meters = []
    },
    close: () => routes.delete(id)
  }
}

export function stopGateway(): void {
  server?.close()
  server = null
  serverReady = null
  routes.clear()
}
