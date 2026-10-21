import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.' }, net: { fetch: vi.fn() } }))
const { applyStyle, createSseMeter, fitLocalTools, hoistSystem, rejectsThinking, summarize } = await import('../src/main/brains/gateway')

const engineBody = { model: 'gemma4:12b-compi', max_tokens: 8192, thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, messages: [] }

describe('style de réponse', () => {
  it('Vif coupe la réflexion (Ollama : think=false)', () => {
    const out = applyStyle(engineBody, { effort: 'low', canThink: true, levels: false })
    expect(out.thinking).toEqual({ type: 'disabled' })
    expect(out.output_config).toBeUndefined()
    expect(out.messages).toBe(engineBody.messages)
  })

  it('Réfléchi et au-delà : réflexion activée, budget croissant et toujours sous max_tokens', () => {
    const medium = applyStyle(engineBody, { effort: 'medium', canThink: true, levels: false })
    expect(medium.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 })
    expect(medium.max_tokens).toBe(8192)
    const expert = applyStyle(engineBody, { effort: 'xhigh', canThink: true, levels: false })
    expect((expert.thinking as { budget_tokens: number }).budget_tokens).toBe(16_384)
    expect(expert.max_tokens as number).toBeGreaterThan(16_384)
  })

  it('modèle qui ne réfléchit pas : aucun champ de réflexion', () => {
    for (const effort of ['low', 'medium', 'xhigh'] as const) {
      const out = applyStyle(engineBody, { effort, canThink: false, levels: false })
      expect(out.thinking).toBeUndefined()
      expect(out.output_config).toBeUndefined()
    }
  })

  it('gpt-oss : la réflexion passe par niveaux', () => {
    expect(applyStyle(engineBody, { effort: 'low', canThink: true, levels: true }).output_config).toEqual({ effort: 'low' })
    expect(applyStyle(engineBody, { effort: 'xhigh', canThink: true, levels: true }).output_config).toEqual({ effort: 'high' })
    expect(applyStyle(engineBody, { effort: 'low', canThink: true, levels: true }).thinking).toBeUndefined()
  })

  it('repère un refus du réglage de réflexion par le service', () => {
    expect(rejectsThinking(400, '{"error":{"message":"thinking is not supported for this model"}}')).toBe(true)
    expect(rejectsThinking(400, '{"error":{"message":"invalid api key"}}')).toBe(false)
    expect(rejectsThinking(500, 'thinking')).toBe(false)
  })
})

describe('consignes en tête (cache du modèle local)', () => {
  const text = (t: string): { type: 'text'; text: string } => ({ type: 'text', text: t })
  const firstTurn = {
    system: [text('Tu es Compi.')],
    messages: [
      { role: 'user', content: [text('Bonjour')] },
      { role: 'system', content: [text('# Environment')] }
    ]
  }

  it('remonte l’environnement placé après la première question', () => {
    const out = hoistSystem(firstTurn)
    expect(out.system).toEqual([text('Tu es Compi.'), text('# Environment')])
    expect(out.messages).toEqual([{ role: 'user', content: [text('Bonjour')] }])
  })

  it('les tours suivants ne font que s’allonger : même début, messages système tardifs en place', () => {
    const secondTurn = {
      ...firstTurn,
      messages: [
        ...firstTurn.messages,
        { role: 'assistant', content: [text('Salut !')] },
        { role: 'user', content: [text('Et ensuite ?')] },
        { role: 'system', content: 'tokens left' }
      ]
    }
    const one = hoistSystem(firstTurn)
    const two = hoistSystem(secondTurn)
    expect(two.system).toEqual(one.system)
    expect((two.messages as unknown[]).slice(0, 1)).toEqual(one.messages)
    expect((two.messages as { role: string }[]).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'system'])
  })

  it('consignes en texte simple et requête sans message système', () => {
    const out = hoistSystem({
      system: 'Tu es Compi.',
      messages: [
        { role: 'system', content: 'Env' },
        { role: 'user', content: 'Bonjour' }
      ]
    })
    expect(out.system).toEqual([text('Tu es Compi.'), text('Env')])
    const plain = { system: 'Tu es Compi.', messages: [{ role: 'user', content: 'Bonjour' }] }
    expect(hoistSystem(plain)).toBe(plain)
  })
})

describe('outils du modèle local', () => {
  const big = (name: string): { name: string; description: string; input_schema: object } => ({
    name,
    description: 'd'.repeat(500),
    input_schema: { type: 'object' }
  })
  const servers = [{ key: 'notion-741c', name: 'Notion', keywords: ['notion'] }]
  const env = ['# MCP Server Instructions', '', '## compi', 'Outils du bureau.', '', '## notion-741c', 'Cherche avant de créer.'].join('\n')
  const body = {
    system: [
      { type: 'text', text: 'Tu es Compi.' },
      { type: 'text', text: env }
    ],
    // Ordre du moteur : par clé de connecteur (Notion peut passer avant Compi).
    tools: [big('mcp__compi__timer'), ...Array.from({ length: 40 }, (_, i) => big(`mcp__notion-741c__t${i}`))].sort((a, b) => b.name.localeCompare(a.name)),
    messages: [{ role: 'user', content: [{ type: 'text', text: 'minuteur 1 min' }] }]
  }

  it('par défaut : outils de Compi seulement, liste des extensions à la fin des consignes, sans leurs instructions', () => {
    const fit = fitLocalTools(body, 65_536, servers)
    expect((fit.body.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['mcp__compi__timer'])
    const system = fit.body.system as Array<{ text: string }>
    expect(system[0].text).toBe('Tu es Compi.')
    expect(system[1].text).toContain('## compi')
    expect(system[1].text).not.toContain('Cherche avant de créer')
    expect(system.at(-1)!.text).toContain("Extensions branchées par l'utilisateur : Notion.")
    expect(fit.summary).toMatch(/^1\/41 outils \(≈ \d+ jetons, fenêtre 65536\)$/)
    expect(fit.wanted).toBe(false)
  })

  it('connecteur nommé : ses outils après ceux de Compi, avec ses instructions ; signalé pour ne pas servir de modèle au cache', () => {
    const fit = fitLocalTools({ ...body, messages: [{ role: 'user', content: 'ouvre ma page Notion' }] }, 65_536, servers)
    const tools = fit.body.tools as Array<{ name: string; description: string }>
    expect(tools).toHaveLength(41)
    expect(tools[0].name).toBe('mcp__compi__timer')
    expect(tools[1].name.startsWith('mcp__notion-741c__')).toBe(true)
    expect(tools[1].description.startsWith("Consignes de l'extension Notion : Cherche avant de créer.")).toBe(true)
    // Mêmes consignes qu'avant le chargement : le modèle garde son cache.
    expect(fit.body.system).toEqual(fitLocalTools(body, 65_536, servers).body.system)
    expect(fit.summary).toContain('chargés : Notion')
    expect(fit.wanted).toBe(true)
  })

  it('routine : seuls les outils de connecteur autorisés d’office', () => {
    const fit = fitLocalTools({ ...body, messages: [{ role: 'user', content: 'dans Notion' }] }, 65_536, servers, ['mcp__notion-741c__t3'])
    expect((fit.body.tools as Array<{ name: string }>).map((t) => t.name)).toEqual(['mcp__compi__timer', 'mcp__notion-741c__t3'])
  })
})

describe('mesure de la vitesse', () => {
  const sse = (events: object[]): string => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join('')

  it('lit le flux SSE, même découpé n’importe où', () => {
    let t = 1000
    const meter = createSseMeter(() => t)
    const stream = sse([
      { type: 'message_start', message: { usage: { input_tokens: 5300, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Bon' } }
    ])
    const tail = sse([
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'jour' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 60 } },
      { type: 'message_stop' }
    ])
    meter.feed(stream.slice(0, 37))
    t = 2500
    meter.feed(stream.slice(37))
    t = 3500
    meter.feed(tail)
    const m = meter.result()
    expect(m.inputTokens).toBe(5300)
    expect(m.outputTokens).toBe(60)
    expect(m.firstTextAt).toBe(2500)
    expect(m.endAt).toBe(3500)
  })

  it('cumule les appels d’une réponse (outil puis texte)', () => {
    const stats = summarize(0, [
      { inputTokens: 5000, outputTokens: 40, firstDeltaAt: 2000, endAt: 3000 },
      { inputTokens: 300, outputTokens: 60, firstDeltaAt: 4000, firstTextAt: 4000, endAt: 5000 }
    ])
    expect(stats).toEqual({ firstTokenMs: 4000, tokensPerSec: 50, inputTokens: 5300, outputTokens: 100, requests: 2 })
  })
})
