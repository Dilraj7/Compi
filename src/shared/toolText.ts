// Appels d'outils écrits en texte par un modèle local au lieu d'un vrai appel (qwen3 :
// `<tools>{"name": …, "arguments": …}</tools>`, bloc ```json…) : sans rien faire, rien ne
// s'exécute et l'utilisateur voit du code. La passerelle les rattrape, seulement quand c'est
// sans ambiguïté : le bloc ne contient que des appels, au JSON valide, d'outils proposés au
// modèle dans cette requête. Les actions passent ensuite par les cartes d'accord habituelles.
// Fonctions pures, testées dans tests/toolText.test.ts.

export interface TextCall {
  name: string
  input: Record<string, unknown>
}

/** Ce que contient un bloc de texte : des appels sûrs, une tentative ratée, ou une réponse normale. */
export type ToolTextVerdict = { kind: 'calls'; calls: TextCall[] } | { kind: 'failed'; reason: 'unknown-tool' | 'bad-json' | 'mixed' } | { kind: 'text' }

const MAX_CALLS = 8
const TAGS = 'tool_call|tools|tool|function_call|functions'
const TAGGED = new RegExp(`<(${TAGS})>\\s*([\\s\\S]*?)\\s*(?:</\\1>|$)`, 'g')
const FENCED = /^```(?:json|tool_code|tool_call|tool)?[ \t]*\n([\s\S]*?)\n?```$/
/** Un appel en balises au milieu d'une réponse : on ne l'exécute pas, mais on le signale. */
const BURIED = new RegExp(`<(?:${TAGS})>\\s*[[{][\\s\\S]*?"name"\\s*:`)

/**
 * Début d'un bloc de texte : faut-il le garder pour le lire en entier ? Seuls les débuts
 * possibles d'un appel (`<`, ``` ` ```, `{`, `[`) attendent ; une réponse normale passe aussitôt.
 */
export function holdStart(text: string): 'hold' | 'pass' | 'undecided' {
  const t = text.trimStart()
  if (!t) return 'undecided'
  return '<`{['.includes(t[0]) ? 'hold' : 'pass'
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Plusieurs objets à la suite, un par ligne.
    const lines = text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) return undefined
    try {
      return lines.map((l) => JSON.parse(l) as unknown)
    } catch {
      return undefined
    }
  }
}

/** `{name, arguments}` (et ses variantes) : l'appel, `null` si ce n'en est pas un. */
function asCall(v: unknown): { name: string; input: unknown } | null {
  if (!isObject(v)) return null
  const fn = isObject(v.function) ? v.function : v
  if (typeof fn.name !== 'string' || !fn.name.trim()) return null
  const key = ['arguments', 'parameters', 'input', 'args'].find((k) => k in fn)
  if (!key) return null
  let input = fn[key]
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input || '{}')
    } catch {
      return { name: fn.name.trim(), input: undefined }
    }
  }
  return { name: fn.name.trim(), input }
}

/** Nom d'un outil proposé : exact, ou sans son préfixe (`web_search` pour `mcp__compi__web_search`) s'il est unique. */
function offeredName(name: string, offered: ReadonlySet<string>): string | null {
  if (offered.has(name)) return name
  const tail = [...offered].filter((o) => o.endsWith(`__${name}`))
  return tail.length === 1 ? tail[0] : null
}

/** Lit un bloc de texte entier : appels sûrs, tentative ratée, ou texte normal. */
export function parseToolText(text: string, offered: ReadonlySet<string>): ToolTextVerdict {
  const trimmed = text.trim()
  if (!trimmed) return { kind: 'text' }
  let segments: string[]
  let tagged = false
  const tags = [...trimmed.matchAll(TAGGED)]
  if (tags.length) {
    tagged = true
    // Autre chose que des appels autour des balises : on ne devine pas.
    if (trimmed.replace(TAGGED, '').trim()) return { kind: 'failed', reason: 'mixed' }
    segments = tags.map((m) => m[2])
  } else {
    const fenced = FENCED.exec(trimmed)
    if (fenced) segments = [fenced[1].trim()]
    else if (trimmed[0] === '{' || trimmed[0] === '[') segments = [trimmed]
    else return { kind: 'text' }
  }

  const calls: TextCall[] = []
  for (const seg of segments) {
    const parsed = parseJson(seg)
    const items = Array.isArray(parsed) ? parsed : parsed === undefined ? [] : [parsed]
    const shaped = items.map(asCall)
    // Pas du JSON d'appels : dans des balises d'outil, c'est une tentative ratée ; ailleurs, du code ordinaire.
    if (!items.length || shaped.some((c) => c === null)) return tagged ? { kind: 'failed', reason: 'bad-json' } : { kind: 'text' }
    for (const c of shaped as Array<{ name: string; input: unknown }>) {
      if (!isObject(c.input)) return { kind: 'failed', reason: 'bad-json' }
      const name = offeredName(c.name, offered)
      if (!name) return { kind: 'failed', reason: 'unknown-tool' }
      calls.push({ name, input: c.input })
    }
  }
  if (!calls.length || calls.length > MAX_CALLS) return { kind: 'failed', reason: 'bad-json' }
  return { kind: 'calls', calls }
}

// ─── Flux SSE de /v1/messages ────────────────────────────────────────────────

export interface ToolTextStats {
  repaired: number
  failed: number
  reason?: Extract<ToolTextVerdict, { kind: 'failed' }>['reason']
}

interface SseEvent {
  type?: string
  index?: number
  content_block?: { type?: string; text?: string }
  delta?: { type?: string; text?: string; stop_reason?: string }
}

const sse = (ev: SseEvent): string => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`

/**
 * Relit le flux d'une réponse : chaque bloc de texte qui commence comme un appel est gardé
 * jusqu'à sa fin, puis remplacé par de vrais appels (`tool_use`) s'il en contient de sûrs ;
 * sinon il repart tel quel. Les blocs suivants sont renumérotés. Tout le reste passe sans délai.
 */
export function createToolTextRepair(offered: ReadonlySet<string>, newId: () => string) {
  let buffer = ''
  let shift = 0
  let held: { index: number; events: string[]; text: string; hold: boolean } | null = null
  /** Bloc de texte transmis au fil de l'eau : relu à sa fin pour signaler un appel enfoui. */
  let watch: { index: number; text: string } | null = null
  const stats: ToolTextStats = { repaired: 0, failed: 0 }
  const fail = (reason: ToolTextStats['reason']): void => {
    stats.failed++
    stats.reason = reason
  }

  const shifted = (raw: string, ev: SseEvent): string => {
    if (!shift || typeof ev.index !== 'number') return `${raw}\n\n`
    return sse({ ...ev, index: ev.index + shift })
  }

  const parse = (raw: string): SseEvent | null => {
    const data = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n')
    try {
      return data ? (JSON.parse(data) as SseEvent) : null
    } catch {
      return null
    }
  }

  const release = (): string => {
    if (!held) return ''
    const out = held.events.map((raw) => shifted(raw, parse(raw) ?? {})).join('')
    watch = { index: held.index, text: held.text }
    held = null
    return out
  }

  const close = (): string => {
    if (!held) return ''
    const verdict = parseToolText(held.text, offered)
    if (verdict.kind === 'failed') fail(verdict.reason)
    if (verdict.kind !== 'calls') {
      const out = release()
      watch = null
      return out
    }
    const base = held.index + shift
    held = null
    let out = ''
    verdict.calls.forEach((c, k) => {
      const index = base + k
      out += sse({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: newId(), name: c.name, input: {} } as SseEvent['content_block'] })
      out += sse({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(c.input) } as SseEvent['delta'] })
      out += sse({ type: 'content_block_stop', index })
    })
    shift += verdict.calls.length - 1
    stats.repaired += verdict.calls.length
    return out
  }

  const onEvent = (raw: string): string => {
    const ev = parse(raw)
    if (!ev) return held ? '' : `${raw}\n\n`
    if (held) {
      if (ev.index === held.index) {
        held.events.push(raw)
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') held.text += ev.delta.text ?? ''
        if (ev.type === 'content_block_stop') return close()
        if (!held.hold) {
          const d = holdStart(held.text)
          if (d === 'pass') return release()
          if (d === 'hold') held.hold = true
        }
        return ''
      }
      if (ev.type === 'ping') return `${raw}\n\n`
      // Un autre bloc commence sans fin du précédent : on rend ce qui était gardé.
      return release() + onEvent(raw)
    }
    if (watch && ev.index === watch.index) {
      if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') watch.text += ev.delta.text ?? ''
      if (ev.type === 'content_block_stop') {
        if (BURIED.test(watch.text)) fail('mixed')
        watch = null
      }
    }
    if (ev.type === 'content_block_start' && ev.content_block?.type === 'text' && typeof ev.index === 'number') {
      held = { index: ev.index, events: [raw], text: ev.content_block.text ?? '', hold: false }
      if (holdStart(held.text) === 'pass') return release()
      return ''
    }
    if (ev.type === 'message_delta' && stats.repaired && ev.delta?.stop_reason && ev.delta.stop_reason !== 'tool_use') {
      return sse({ ...ev, delta: { ...ev.delta, stop_reason: 'tool_use' } })
    }
    return shifted(raw, ev)
  }

  return {
    /** Morceau reçu du modèle → ce qu'il faut transmettre maintenant (peut être vide). */
    push(chunk: string): string {
      // « \r » et « \n » peuvent arriver dans deux morceaux.
      buffer = (buffer + chunk).replace(/\r\n/g, '\n')
      let out = ''
      let i: number
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, i)
        buffer = buffer.slice(i + 2)
        if (raw.trim()) out += onEvent(raw)
      }
      return out
    },
    /** Fin du flux : ce qui restait gardé repart tel quel. */
    flush(): string {
      const rest = buffer
      buffer = ''
      return release() + rest
    },
    stats: (): ToolTextStats => ({ ...stats })
  }
}
