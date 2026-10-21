// Utilisation de Claude Code et de Compi (vue Activité). Fonctions pures,
// testées dans tests/usage.test.ts.
//
// Claude Code note chaque réponse dans ~/.claude/projects/<projet>/<session>.jsonl,
// avec le modèle et les jetons. Compi les additionne, sans rien garder du texte.
// Le coût est estimé au tarif public de l'API : réel avec une clé API,
// indicatif avec un abonnement Pro ou Max (les fichiers ne disent pas lequel a servi).

/** Tarifs publics en dollars par million de jetons (vérifiés le 2026-10-14). */
interface Price {
  input: number
  output: number
  cacheRead: number
  /** Au-delà de ce nombre de jetons lus par la requête, tarif `above` (Haiku 5.5). */
  tier?: { over: number; above: Omit<Price, 'tier'> }
}

const PRICES: Array<[RegExp, Price]> = [
  [/fable-5-1|mythos-5-1/, { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable-5|mythos-5/, { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-(5|4-[5-9])/, { input: 5, output: 25, cacheRead: 0.5 }],
  [/opus-4/, { input: 15, output: 75, cacheRead: 1.5 }],
  [/sonnet-5/, { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet-[34]/, { input: 3, output: 15, cacheRead: 0.3 }],
  [
    /haiku-5-5/,
    {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      tier: {
        over: 100_000,
        above: { input: 0.5, output: 2.5, cacheRead: 0.05 }
      }
    }
  ],
  [/haiku-4-5/, { input: 1, output: 5, cacheRead: 0.1 }],
  [/haiku-3-5/, { input: 0.8, output: 4, cacheRead: 0.08 }]
]

export interface Tokens {
  input: number
  output: number
  /** Écriture dans le cache (5 min et 1 h confondus). */
  cacheWrite: number
  cacheRead: number
}

export const NO_TOKENS: Tokens = {
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0
}

export const totalTokens = (t: Tokens): number => t.input + t.output + t.cacheWrite + t.cacheRead

export function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead
  }
}

/** « Opus 5.5 », « Sonnet 4.6 »… ; le nom brut sinon. */
export function modelLabel(model: string): string {
  const m = /claude-(opus|sonnet|haiku|fable|mythos)-(\d+)(?:-(\d{1,2}))?(?!\d)/.exec(model)
  if (!m) return model
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}`
}

/**
 * Coût d'une réponse au tarif de l'API, ou `null` si le modèle est inconnu.
 * Écriture du cache : × 1,25 (5 minutes) ou × 2 (1 heure) le prix d'entrée.
 */
export function messageCost(
  model: string,
  u: {
    input: number
    output: number
    cacheRead: number
    cacheWrite5m: number
    cacheWrite1h: number
  }
): number | null {
  const found = PRICES.find(([re]) => re.test(model))?.[1]
  if (!found) return null
  const read = u.input + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h
  const p = found.tier && read > found.tier.over ? found.tier.above : found
  const usd = u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite5m * p.input * 1.25 + u.cacheWrite1h * p.input * 2
  return usd / 1_000_000
}

/** Une réponse de Claude Code, lue dans un fichier de session. */
export interface UsageRecord {
  /** Identifiant unique (message + requête) : une réponse est écrite sur plusieurs lignes. */
  key: string
  at: number
  model: string
  project: string
  session: string
  tokens: Tokens
  cost: number | null
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

/** Lit une ligne d'un fichier de session ; `null` si ce n'est pas une réponse avec des jetons. */
export function parseUsageLine(line: string): UsageRecord | null {
  // Tri rapide : la plupart des lignes (messages, résultats d'outils) n'ont pas de jetons.
  if (!line.includes('"usage"') || !line.includes('"assistant"')) return null
  let o: Record<string, unknown>
  try {
    o = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }
  if (o.type !== 'assistant') return null
  const msg = o.message as { id?: unknown; model?: unknown; usage?: Record<string, unknown> } | undefined
  const u = msg?.usage
  const model = typeof msg?.model === 'string' ? msg.model : ''
  if (!u || !model || model.startsWith('<')) return null
  const at = Date.parse(String(o.timestamp ?? ''))
  if (!Number.isFinite(at)) return null
  const creation = (u.cache_creation ?? {}) as Record<string, unknown>
  const write1h = num(creation.ephemeral_1h_input_tokens)
  const writeAll = num(u.cache_creation_input_tokens)
  const write5m = num(creation.ephemeral_5m_input_tokens) || Math.max(0, writeAll - write1h)
  const raw = {
    input: num(u.input_tokens),
    output: num(u.output_tokens),
    cacheRead: num(u.cache_read_input_tokens),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h
  }
  const tokens: Tokens = {
    input: raw.input,
    output: raw.output,
    cacheRead: raw.cacheRead,
    cacheWrite: write5m + write1h
  }
  if (!totalTokens(tokens)) return null
  const id = typeof msg?.id === 'string' ? msg.id : ''
  const request = typeof o.requestId === 'string' ? o.requestId : ''
  const session = typeof o.sessionId === 'string' ? o.sessionId : ''
  const cwd = typeof o.cwd === 'string' ? o.cwd : ''
  return {
    key: id || request ? `${id}:${request}` : `${session}:${at}`,
    at,
    model,
    project: cwd.split(/[\\/]/).filter(Boolean).pop() ?? '',
    session,
    tokens,
    cost: messageCost(model, raw)
  }
}

/** Jour local « 2026-10-14 ». */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Début de l'heure (locale) d'un instant. */
export const hourStart = (ts: number): number => {
  const d = new Date(ts)
  d.setMinutes(0, 0, 0)
  return d.getTime()
}

/** Une ligne agrégée : une heure, un modèle, un projet. */
export interface UsageRow {
  hour: number
  model: string
  project: string
  tokens: Tokens
  /** Partie au tarif connu ; `unpriced` : jetons d'un modèle au tarif inconnu. */
  cost: number
  unpriced: number
  messages: number
}

export interface ClaudeCodeUsage {
  /** Le dossier de Claude Code existe sur ce PC. */
  available: boolean
  scannedAt?: number
  /** Lecture en cours (premier passage). */
  scanning?: boolean
  rows: UsageRow[]
  /** Heures où chaque session a été active : { session: [heure, …] } réduit à des comptes par jour. */
  sessionsByDay: Record<string, number>
  error?: string
}

export const BLOCK_MS = 5 * 3600_000

export interface UsageBlock {
  start: number
  end: number
  tokens: number
  cost: number
}

/**
 * Bloc de 5 h en cours, à la manière des limites d'usage de l'abonnement : il
 * commence à la première activité après la fin du bloc précédent (arrondie à
 * l'heure) et dure 5 h. Estimation : les vraies limites ne sont pas publiques.
 */
export function currentBlock(rows: UsageRow[], now: number): UsageBlock | null {
  const hours = [...new Set(rows.map((r) => r.hour))].sort((a, b) => a - b)
  let start: number | null = null
  for (const h of hours) {
    if (h > now) break
    if (start === null || h >= start + BLOCK_MS) start = h
  }
  if (start === null || now >= start + BLOCK_MS) return null
  const inside = rows.filter((r) => r.hour >= start! && r.hour < start! + BLOCK_MS)
  return {
    start,
    end: start + BLOCK_MS,
    tokens: inside.reduce((n, r) => n + totalTokens(r.tokens), 0),
    cost: inside.reduce((n, r) => n + r.cost, 0)
  }
}

export type UsagePeriod = 'today' | 'week' | 'month'

/** Premier instant compris dans la période (aujourd'hui, 7 ou 30 derniers jours). */
export function periodStart(period: UsagePeriod, now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === 'week') d.setDate(d.getDate() - 6)
  if (period === 'month') d.setDate(d.getDate() - 29)
  return d.getTime()
}

export interface UsageSummary {
  tokens: Tokens
  total: number
  cost: number
  /** Jetons d'un modèle au tarif inconnu (non chiffrés). */
  unpriced: number
  messages: number
  sessions: number
  days: Array<{ day: string; total: number; cost: number }>
  projects: Array<{ name: string; total: number; cost: number }>
  models: Array<{ name: string; total: number; cost: number }>
}

/** Totaux, jours, projets et modèles d'une période. */
export function summarizeUsage(usage: Pick<ClaudeCodeUsage, 'rows' | 'sessionsByDay'>, period: UsagePeriod, now: number): UsageSummary {
  const from = periodStart(period, now)
  const rows = usage.rows.filter((r) => r.hour >= from && r.hour <= now)
  const days: UsageSummary['days'] = []
  const dayCount = period === 'today' ? 1 : period === 'week' ? 7 : 30
  for (let i = dayCount - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - i)
    days.push({ day: dayKey(d.getTime()), total: 0, cost: 0 })
  }
  const byDay = new Map(days.map((d) => [d.day, d]))
  const group = (key: (r: UsageRow) => string): Array<{ name: string; total: number; cost: number }> => {
    const m = new Map<string, { name: string; total: number; cost: number }>()
    for (const r of rows) {
      const name = key(r)
      const g = m.get(name) ?? { name, total: 0, cost: 0 }
      g.total += totalTokens(r.tokens)
      g.cost += r.cost
      m.set(name, g)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }
  let tokens = NO_TOKENS
  let cost = 0
  let unpriced = 0
  let messages = 0
  for (const r of rows) {
    tokens = addTokens(tokens, r.tokens)
    cost += r.cost
    unpriced += r.unpriced
    messages += r.messages
    const d = byDay.get(dayKey(r.hour))
    if (d) {
      d.total += totalTokens(r.tokens)
      d.cost += r.cost
    }
  }
  const sessions = days.reduce((n, d) => n + (usage.sessionsByDay[d.day] ?? 0), 0)
  return {
    tokens,
    total: totalTokens(tokens),
    cost,
    unpriced,
    messages,
    sessions,
    days,
    projects: group((r) => r.project || 'Sans projet'),
    models: group((r) => modelLabel(r.model))
  }
}

// ─── Compi ───────────────────────────────────────────────────────────────────

/** Une journée d'un cerveau de Compi. */
export interface CompiUsageRow {
  day: string
  /** « Claude · Opus 5.5 », « Sur ce PC · gemma4:12b »… */
  brain: string
  provider: string
  replies: number
  /** Coût réel donné par le moteur (Claude seulement). */
  costUsd: number
  input: number
  output: number
}

export interface CompiUsageSummary {
  replies: number
  costUsd: number
  brains: Array<{
    brain: string
    provider: string
    replies: number
    costUsd: number
    tokens: number
  }>
}

export function summarizeCompiUsage(rows: CompiUsageRow[], period: UsagePeriod, now: number): CompiUsageSummary {
  const from = dayKey(periodStart(period, now))
  const inside = rows.filter((r) => r.day >= from)
  const m = new Map<string, CompiUsageSummary['brains'][number]>()
  for (const r of inside) {
    const g = m.get(r.brain) ?? {
      brain: r.brain,
      provider: r.provider,
      replies: 0,
      costUsd: 0,
      tokens: 0
    }
    g.replies += r.replies
    g.costUsd += r.costUsd
    g.tokens += r.input + r.output
    m.set(r.brain, g)
  }
  const brains = [...m.values()].sort((a, b) => b.replies - a.replies)
  return {
    replies: brains.reduce((n, b) => n + b.replies, 0),
    costUsd: brains.reduce((n, b) => n + b.costUsd, 0),
    brains
  }
}

/** Ajoute une réponse aux agrégats du jour ; garde 400 jours. */
export function addCompiReply(rows: CompiUsageRow[], reply: Omit<CompiUsageRow, 'day' | 'replies'> & { at: number }): CompiUsageRow[] {
  const day = dayKey(reply.at)
  const next = rows.map((r) => ({ ...r }))
  let row = next.find((r) => r.day === day && r.brain === reply.brain)
  if (!row) {
    row = {
      day,
      brain: reply.brain,
      provider: reply.provider,
      replies: 0,
      costUsd: 0,
      input: 0,
      output: 0
    }
    next.push(row)
  }
  row.replies += 1
  row.costUsd += reply.costUsd
  row.input += reply.input
  row.output += reply.output
  const oldest = dayKey(reply.at - 400 * 86_400_000)
  return next.filter((r) => r.day >= oldest)
}

// ─── Affichage ───────────────────────────────────────────────────────────────

/** « 1,2 M », « 845 k », « 512 ». */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: n >= 10_000_000 ? 0 : 1 })} M`
  if (n >= 1000) return `${Math.round(n / 1000).toLocaleString('fr-FR')} k`
  return String(Math.round(n))
}

/** « 18,40 $ », « 0,42 $ », « < 0,01 $ ». */
export function formatUsd(n: number): string {
  if (n > 0 && n < 0.01) return '< 0,01 $'
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
}
