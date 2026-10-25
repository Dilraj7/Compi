import { describe, expect, it } from 'vitest'
import { createToolTextRepair, holdStart, parseToolText } from '../src/shared/toolText'

const OFFERED = new Set(['mcp__compi__web_search', 'mcp__compi__get_time', 'Read', 'mcp__notion__search', 'mcp__brave__search'])

describe('appels écrits en texte', () => {
  it('rattrape la forme de qwen3 (<tools>, nom court)', () => {
    const v = parseToolText('<tools>\n{"name": "web_search", "arguments": {"query": "météo Paris"}}\n</tools>', OFFERED)
    expect(v).toEqual({ kind: 'calls', calls: [{ name: 'mcp__compi__web_search', input: { query: 'météo Paris' } }] })
  })

  it('rattrape <tool_call> non fermé, plusieurs appels et les arguments en chaîne', () => {
    const text =
      '<tool_call>{"name":"mcp__compi__get_time","arguments":{}}</tool_call>\n<tool_call>{"function":{"name":"Read","arguments":"{\\"file_path\\":\\"C:/a.txt\\"}"}}'
    expect(parseToolText(text, OFFERED)).toEqual({
      kind: 'calls',
      calls: [
        { name: 'mcp__compi__get_time', input: {} },
        { name: 'Read', input: { file_path: 'C:/a.txt' } }
      ]
    })
  })

  it('rattrape un bloc ```json et un JSON nu', () => {
    expect(parseToolText('```json\n{"name": "get_time", "parameters": {}}\n```', OFFERED)).toMatchObject({ kind: 'calls' })
    expect(parseToolText('[{"name": "get_time", "input": {}}, {"name": "Read", "input": {"file_path": "x"}}]', OFFERED)).toMatchObject({ kind: 'calls' })
  })

  it('refuse un outil non proposé ou ambigu', () => {
    expect(parseToolText('<tool_call>{"name": "Bash", "arguments": {"command": "del *"}}</tool_call>', OFFERED)).toEqual({
      kind: 'failed',
      reason: 'unknown-tool'
    })
    // « search » : deux connecteurs l'ont, on ne choisit pas à la place du modèle.
    expect(parseToolText('{"name": "search", "arguments": {"query": "x"}}', OFFERED)).toEqual({ kind: 'failed', reason: 'unknown-tool' })
  })

  it('refuse un JSON invalide dans des balises, ou des arguments qui ne sont pas un objet', () => {
    expect(parseToolText('<tools>{"name": "get_time", "arguments": {</tools>', OFFERED)).toEqual({ kind: 'failed', reason: 'bad-json' })
    expect(parseToolText('<tools>{"name": "get_time", "arguments": "maintenant"}</tools>', OFFERED)).toEqual({ kind: 'failed', reason: 'bad-json' })
  })

  it('du texte autour des balises : signalé, jamais exécuté', () => {
    expect(parseToolText('<tool_call>{"name":"get_time","arguments":{}}</tool_call> Voilà !', OFFERED)).toEqual({ kind: 'failed', reason: 'mixed' })
  })

  it('une réponse normale reste du texte (code, JSON d’exemple)', () => {
    expect(parseToolText('Bonjour Alex !', OFFERED)).toEqual({ kind: 'text' })
    expect(parseToolText('```python\nprint("hi")\n```', OFFERED)).toEqual({ kind: 'text' })
    expect(parseToolText('```json\n{"nom": "Alex", "ville": "Lyon"}\n```', OFFERED)).toEqual({ kind: 'text' })
    expect(parseToolText('{"name": "Alex"}', OFFERED)).toEqual({ kind: 'text' })
  })

  it('début de bloc : seuls les débuts possibles d’un appel attendent', () => {
    expect(holdStart('')).toBe('undecided')
    expect(holdStart('  \n')).toBe('undecided')
    expect(holdStart('<to')).toBe('hold')
    expect(holdStart('```')).toBe('hold')
    expect(holdStart('Il fait')).toBe('pass')
  })
})

// Flux SSE comme Ollama les envoie (/v1/messages).
const ev = (o: Record<string, unknown>): string => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`
const textBlock = (index: number, parts: string[]): string =>
  ev({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }) +
  parts.map((t) => ev({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })).join('') +
  ev({ type: 'content_block_stop', index })
const head = ev({ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 10 } } })
const tail = (stop = 'end_turn'): string =>
  ev({ type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 20 } }) + ev({ type: 'message_stop' })

/** Envoie le flux par petits morceaux (coupés au hasard), comme sur le réseau. */
function run(stream: string, size = 7): { out: string; stats: ReturnType<ReturnType<typeof createToolTextRepair>['stats']> } {
  let n = 0
  const r = createToolTextRepair(OFFERED, () => `toolu_test_${++n}`)
  let out = ''
  for (let i = 0; i < stream.length; i += size) out += r.push(stream.slice(i, i + size))
  out += r.flush()
  return { out, stats: r.stats() }
}

const events = (s: string): Array<Record<string, unknown>> =>
  s
    .split('\n\n')
    .filter(Boolean)
    .map((e) =>
      JSON.parse(
        e
          .split('\n')
          .find((l) => l.startsWith('data:'))!
          .slice(5)
      )
    )

describe('flux de la passerelle', () => {
  it('une réponse normale passe telle quelle, octet pour octet', () => {
    const stream = head + textBlock(0, ['Bonjour', ' Alex']) + tail()
    expect(run(stream).out).toBe(stream)
  })

  it('un appel en texte devient un vrai appel ; les blocs suivants sont renumérotés', () => {
    const thinking =
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }) +
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'je cherche' } }) +
      ev({ type: 'content_block_stop', index: 0 })
    const calls = '<tools>{"name":"get_time","arguments":{}}</tools>\n<tools>{"name":"web_search","arguments":{"query":"x"}}</tools>'
    const stream = head + thinking + textBlock(1, [calls.slice(0, 9), calls.slice(9)]) + textBlock(2, ['ok']) + tail()
    const { out, stats } = run(stream)
    expect(stats).toEqual({ repaired: 2, failed: 0 })
    const list = events(out)
    const starts = list.filter((e) => e.type === 'content_block_start')
    expect(starts.map((e) => [e.index, (e.content_block as { type: string }).type])).toEqual([
      [0, 'thinking'],
      [1, 'tool_use'],
      [2, 'tool_use'],
      [3, 'text']
    ])
    expect(starts[1].content_block).toEqual({ type: 'tool_use', id: 'toolu_test_1', name: 'mcp__compi__get_time', input: {} })
    const json = list.filter((e) => (e.delta as { type?: string })?.type === 'input_json_delta').map((e) => (e.delta as { partial_json: string }).partial_json)
    expect(json).toEqual(['{}', '{"query":"x"}'])
    expect(list.find((e) => e.type === 'message_delta')!.delta).toEqual({ stop_reason: 'tool_use' })
    // Le texte « ok » garde ses fragments, avec le nouveau numéro.
    expect(list.filter((e) => e.index === 3).map((e) => e.type)).toEqual(['content_block_start', 'content_block_delta', 'content_block_stop'])
  })

  it('un outil non proposé repart en texte et compte une erreur', () => {
    const stream = head + textBlock(0, ['<tool_call>{"name":"Bash","arguments":{"command":"x"}}</tool_call>']) + tail()
    const { out, stats } = run(stream)
    expect(out).toBe(stream)
    expect(stats).toEqual({ repaired: 0, failed: 1, reason: 'unknown-tool' })
  })

  it('un appel enfoui dans une réponse est signalé sans être exécuté', () => {
    const stream = head + textBlock(0, ['Je regarde.\n', '<tool_call>{"name":"get_time","arguments":{}}</tool_call>']) + tail()
    const { out, stats } = run(stream, 5)
    expect(out).toBe(stream)
    expect(stats).toEqual({ repaired: 0, failed: 1, reason: 'mixed' })
  })

  it('le texte d’une réponse normale n’attend pas la fin du bloc', () => {
    let n = 0
    const r = createToolTextRepair(OFFERED, () => `id${++n}`)
    const first = r.push(
      head +
        ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
        ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Il fait beau' } })
    )
    expect(first).toContain('Il fait beau')
  })

  it('les fins de ligne Windows et un flux coupé net ne perdent rien', () => {
    const stream =
      head +
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      ev({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"a":' } })
    const { out } = run(stream.replace(/\n/g, '\r\n'))
    expect(out).toBe(stream)
  })
})
