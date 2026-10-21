import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  addCompiReply,
  currentBlock,
  dayKey,
  formatTokens,
  formatUsd,
  hourStart,
  messageCost,
  modelLabel,
  parseUsageLine,
  summarizeCompiUsage,
  summarizeUsage,
  type UsageRow
} from '../src/shared/usage'

/** Une ligne de fichier de session de Claude Code, comme il les écrit. */
function line(o: {
  id?: string
  req?: string
  at: string
  model?: string
  cwd?: string
  session?: string
  input?: number
  output?: number
  read?: number
  w5?: number
  w1h?: number
}): string {
  return JSON.stringify({
    type: 'assistant',
    sessionId: o.session ?? 's1',
    cwd: o.cwd ?? 'C:\\Projets\\mon-app',
    timestamp: o.at,
    requestId: o.req ?? 'req_1',
    message: {
      id: o.id ?? 'msg_1',
      model: o.model ?? 'claude-opus-5-5',
      content: [{ type: 'text', text: 'Bonjour, voici le correctif…' }],
      usage: {
        input_tokens: o.input ?? 10,
        output_tokens: o.output ?? 1000,
        cache_read_input_tokens: o.read ?? 100_000,
        cache_creation_input_tokens: (o.w5 ?? 0) + (o.w1h ?? 20_000),
        cache_creation: { ephemeral_5m_input_tokens: o.w5 ?? 0, ephemeral_1h_input_tokens: o.w1h ?? 20_000 }
      }
    }
  })
}

describe('utilisation : tarifs et noms', () => {
  it('nomme les modèles simplement', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
    expect(modelLabel('claude-opus-4-20250514')).toBe('Opus 4')
    expect(modelLabel('claude-sonnet-5')).toBe('Sonnet 5')
    expect(modelLabel('gpt-oss:20b')).toBe('gpt-oss:20b')
  })

  it('chiffre une réponse au tarif de l’API, cache compris', () => {
    // Opus 5.5 : 4 $ / 20 $ par million, lecture du cache 0,20 $, écriture 1 h = 2 × 4 $.
    const usd = messageCost('claude-opus-5-5', { input: 1_000_000, output: 100_000, cacheRead: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 1_000_000 })
    expect(usd).toBeCloseTo(4 + 2 + 0.2 + 8)
    expect(messageCost('claude-sonnet-4-6', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite5m: 1_000_000, cacheWrite1h: 0 })).toBeCloseTo(3 + 3.75)
    // Haiku 5.5 : tarif plus élevé au-delà de 100 000 jetons lus par la requête.
    expect(messageCost('claude-haiku-5-5', { input: 50_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeCloseTo(0.005)
    expect(messageCost('claude-haiku-5-5', { input: 200_000, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeCloseTo(0.1)
    expect(messageCost('modele-inconnu', { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })).toBeNull()
  })

  it('affiche les nombres à la française', () => {
    expect(formatTokens(1_234_567)).toBe('1,2 M')
    expect(formatTokens(845_300)).toBe('845 k')
    expect(formatUsd(18.4)).toBe('18,40 $')
    expect(formatUsd(0.004)).toBe('< 0,01 $')
  })
})

describe('utilisation : lecture des fichiers de Claude Code', () => {
  it('lit une réponse, son projet et son coût', () => {
    const r = parseUsageLine(line({ at: '2026-10-14T08:30:00.000Z' }))!
    expect(r).toMatchObject({ key: 'msg_1:req_1', model: 'claude-opus-5-5', project: 'mon-app', session: 's1' })
    expect(r.tokens).toEqual({ input: 10, output: 1000, cacheRead: 100_000, cacheWrite: 20_000 })
    expect(r.cost).toBeCloseTo((10 * 4 + 1000 * 20 + 100_000 * 0.2 + 20_000 * 8) / 1_000_000)
  })

  it('ignore ce qui n’est pas une réponse avec des jetons', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: { content: 'usage assistant' } }))).toBeNull()
    expect(parseUsageLine('{"type":"assistant","usage":')).toBeNull()
    expect(parseUsageLine(line({ at: '2026-10-14T08:30:00Z', model: '<synthetic>' }))).toBeNull()
    expect(parseUsageLine(line({ at: '2026-10-14T08:30:00Z', input: 0, output: 0, read: 0, w1h: 0 }))).toBeNull()
  })
})

describe('utilisation : bloc de 5 h et résumés', () => {
  const now = new Date(2026, 9, 14, 16, 20).getTime()
  const row = (h: number, d = 0, project = 'mon-app', model = 'claude-opus-5-5', tokens = 1000, cost = 1): UsageRow => ({
    hour: hourStart(new Date(2026, 9, 14 - d, h, 0).getTime()),
    model,
    project,
    tokens: { input: 0, output: tokens, cacheRead: 0, cacheWrite: 0 },
    cost,
    unpriced: 0,
    messages: 1
  })

  it('le bloc commence à la première activité après la fin du précédent', () => {
    // 8 h → 13 h, puis un nouveau bloc à 14 h (13 h 30 n'existe pas : activité à 14 h).
    const rows = [row(8), row(9), row(12), row(14), row(15), row(16)]
    const b = currentBlock(rows, now)!
    expect(new Date(b.start).getHours()).toBe(14)
    expect(new Date(b.end).getHours()).toBe(19)
    expect(b.tokens).toBe(3000)
    expect(b.cost).toBe(3)
  })

  it('pas de bloc en cours après 5 h sans activité', () => {
    expect(currentBlock([row(8), row(10)], now)).toBeNull()
  })

  it('résume la période : jours, projets, modèles, sessions', () => {
    const rows = [row(9), row(10, 0, 'site-perso', 'claude-sonnet-5', 3000, 0.5), row(11, 3), row(9, 40)]
    const sessionsByDay = { [dayKey(now)]: 2, [dayKey(now - 3 * 86_400_000)]: 1 }
    const today = summarizeUsage({ rows, sessionsByDay }, 'today', now)
    expect(today.total).toBe(4000)
    expect(today.cost).toBeCloseTo(1.5)
    expect(today.sessions).toBe(2)
    expect(today.projects.map((p) => p.name)).toEqual(['site-perso', 'mon-app'])
    expect(today.models.map((m) => m.name)).toEqual(['Sonnet 5', 'Opus 5.5'])

    const week = summarizeUsage({ rows, sessionsByDay }, 'week', now)
    expect(week.days).toHaveLength(7)
    expect(week.total).toBe(5000)
    expect(week.sessions).toBe(3)
    // La ligne d'il y a 40 jours n'entre dans aucune période.
    expect(summarizeUsage({ rows, sessionsByDay }, 'month', now).total).toBe(5000)
  })

  it('Compi : une ligne par jour et par cerveau', () => {
    const at = new Date(2026, 9, 14, 10).getTime()
    let rows = addCompiReply([], { at, brain: 'Claude · Opus 5.5', provider: 'anthropic', costUsd: 0.05, input: 1000, output: 200 })
    rows = addCompiReply(rows, { at: at + 60_000, brain: 'Claude · Opus 5.5', provider: 'anthropic', costUsd: 0.07, input: 1000, output: 300 })
    rows = addCompiReply(rows, { at, brain: 'Sur ce PC · gemma4:12b', provider: 'local', costUsd: 0, input: 500, output: 100 })
    expect(rows).toHaveLength(2)
    const s = summarizeCompiUsage(rows, 'today', at + 3600_000)
    expect(s.replies).toBe(3)
    expect(s.costUsd).toBeCloseTo(0.12)
    expect(s.brains[0]).toMatchObject({ brain: 'Claude · Opus 5.5', replies: 2 })
  })
})

// ─── Lecture incrémentale sur le disque ──────────────────────────────────────

const home = mkdtempSync(join(tmpdir(), 'compi-usage-'))
const claude = join(home, 'claude')
process.env.COMPI_CLAUDE_DIR = claude
vi.mock('electron', () => ({ app: { getPath: () => home } }))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/bus', () => ({ emit: vi.fn() }))

const cc = await import('../src/main/usage/claudeCode')

describe('utilisation : fichiers de Claude Code sur le disque', () => {
  afterAll(() => {
    delete process.env.COMPI_CLAUDE_DIR
    rmSync(home, { recursive: true, force: true })
  })
  const iso = (minAgo: number): string => new Date(Date.now() - minAgo * 60_000).toISOString()
  const file = join(claude, 'projects', 'C--Projets-mon-app', 'session-1.jsonl')

  it('compte chaque réponse une seule fois, même écrite sur plusieurs lignes', async () => {
    mkdirSync(join(claude, 'projects', 'C--Projets-mon-app'), { recursive: true })
    // Une même réponse (msg_1) écrite deux fois, puis une autre.
    writeFileSync(
      file,
      [line({ id: 'msg_1', at: iso(30) }), line({ id: 'msg_1', at: iso(30) }), line({ id: 'msg_2', req: 'req_2', at: iso(20) })].join('\n') + '\n'
    )
    await cc.refreshClaudeCodeUsage(true)
    const u = cc.claudeCodeUsage()
    expect(u.available).toBe(true)
    expect(u.rows.reduce((n, r) => n + r.messages, 0)).toBe(2)
    expect(u.rows.reduce((n, r) => n + r.tokens.output, 0)).toBe(2000)
  })

  it('ne relit que la fin ajoutée, et attend qu’une ligne soit complète', async () => {
    const third = line({ id: 'msg_3', req: 'req_3', at: iso(10) })
    appendFileSync(file, third.slice(0, 40)) // ligne en cours d'écriture
    await cc.refreshClaudeCodeUsage(true)
    expect(cc.claudeCodeUsage().rows.reduce((n, r) => n + r.messages, 0)).toBe(2)
    appendFileSync(file, third.slice(40) + '\n')
    await cc.refreshClaudeCodeUsage(true)
    expect(cc.claudeCodeUsage().rows.reduce((n, r) => n + r.messages, 0)).toBe(3)
  })

  it('reprend après un redémarrage sans recompter', async () => {
    cc.resetClaudeCodeUsageForTests()
    await cc.refreshClaudeCodeUsage(true)
    expect(cc.claudeCodeUsage().rows.reduce((n, r) => n + r.messages, 0)).toBe(3)
  })

  it('un fichier raccourci est relu sans doublon', async () => {
    writeFileSync(file, line({ id: 'msg_1', at: iso(30) }) + '\n')
    await cc.refreshClaudeCodeUsage(true)
    expect(cc.claudeCodeUsage().rows.reduce((n, r) => n + r.messages, 0)).toBe(3)
  })
})
