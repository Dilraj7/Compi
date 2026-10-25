import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.' }, net: { fetch: vi.fn() } }))
const {
  applyStyle,
  createSseMeter,
  fitLocalTools,
  hoistSystem,
  isFirstTurn,
  keepPrefixStable,
  prefixGap,
  promptPrefix,
  readWarmPrompts,
  rejectsThinking,
  summarize
} = await import('../src/main/brains/gateway')

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

describe('début stable pour tous les modèles locaux', () => {
  const text = (t: string): { type: 'text'; text: string } => ({ type: 'text', text: t })
  const note = { role: 'system', content: '<total_tokens>15000000 tokens left</total_tokens>' }
  const call = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'get_time', input: {} }] }
  const result = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '11:01' }] }
  const roles = (b: Record<string, unknown>): string[] => (b.messages as { role: string }[]).map((m) => m.role)

  it('retire la note de comptage du moteur, après une question comme après un résultat d’outil', () => {
    const out = keepPrefixStable({
      messages: [
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: [text('Salut')] },
        { role: 'user', content: 'Quelle heure ?' },
        note,
        call,
        result,
        { role: 'system', content: [text('<total_tokens>14999000 tokens left</total_tokens>')] }
      ]
    })
    expect(roles(out)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect((out.messages as unknown[])[4]).toBe(result)
  })

  it('chaque appel ne fait qu’allonger le précédent', () => {
    const turn1 = {
      messages: [{ role: 'user', content: 'Bonjour' }, { role: 'assistant', content: [text('Salut')] }, { role: 'user', content: 'Heure ?' }, note]
    }
    const turn2 = { messages: [...turn1.messages, call, result, note] }
    const a = keepPrefixStable(turn1).messages as unknown[]
    const b = keepPrefixStable(turn2).messages as unknown[]
    expect(b.slice(0, a.length)).toEqual(a)
  })

  it('un autre message système tardif rejoint, en texte, le message qui le précède', () => {
    const out = keepPrefixStable({
      messages: [
        { role: 'user', content: 'Bonjour' },
        { role: 'assistant', content: [text('Salut')] },
        { role: 'user', content: 'Range mes fichiers' },
        { role: 'system', content: 'Rappel : demande avant de déplacer.' },
        call,
        { role: 'system', content: [text('Après l’outil')] }
      ]
    })
    expect(roles(out)).toEqual(['user', 'assistant', 'user', 'assistant', 'user'])
    expect((out.messages as { content: unknown }[])[2].content).toEqual([text('Range mes fichiers'), text('Rappel : demande avant de déplacer.')])
    expect((out.messages as { content: unknown }[])[4].content).toEqual([text('Après l’outil')])
  })

  it('les messages système d’avant la première réponse restent pour la remontée en tête', () => {
    const first = { system: 'Tu es Compi.', messages: [{ role: 'user', content: 'Bonjour' }, { role: 'system', content: '# Environment' }, note] }
    const out = hoistSystem(keepPrefixStable(first))
    expect(out.system).toEqual([text('Tu es Compi.'), text('# Environment')])
    expect(roles(out)).toEqual(['user'])
    const plain = { messages: [{ role: 'user', content: 'Bonjour' }] }
    expect(keepPrefixStable(plain)).toBe(plain)
  })
})

describe('consignes gardées pour les derniers modèles', () => {
  const warm = (model: string, v = 7) => ({ v, target: 'http://127.0.0.1:11434', model, system: [], tools: [] })

  it('lit l’ancien fichier (un seul modèle) et la liste', () => {
    expect(readWarmPrompts(warm('gemma4:12b-compi'))).toEqual([warm('gemma4:12b-compi')])
    expect(readWarmPrompts({ prompts: [warm('qwen3:8b-compi'), warm('gemma4:12b-compi')] }).map((p) => p.model)).toEqual(['qwen3:8b-compi', 'gemma4:12b-compi'])
  })

  it('écarte une ancienne version, un contenu abîmé, et garde 4 modèles au plus', () => {
    // Version 6 : les groupes d'outils de Compi se chargeaient à la demande, la liste n'est plus la même.
    expect(readWarmPrompts(warm('qwen3:8b-compi', 6))).toEqual([])
    expect(readWarmPrompts({ prompts: [null, { v: 7 }, warm('a')] }).map((p) => p.model)).toEqual(['a'])
    expect(readWarmPrompts(null)).toEqual([])
    expect(readWarmPrompts({ prompts: ['a', 'b', 'c', 'd', 'e'].map((m) => warm(m)) })).toHaveLength(4)
  })
})

describe('écart avec la requête précédente (cache du modèle local)', () => {
  const body = (system: string, tools: { name: string }[] = [{ name: 'a' }, { name: 'b' }], thinking: unknown = { type: 'disabled' }) => ({
    system: [
      { type: 'text', text: 'You are…' },
      { type: 'text', text: system }
    ],
    tools,
    thinking,
    messages: [{ role: 'user', content: 'bonjour' }]
  })

  it('même début : aucun écart', () => {
    expect(prefixGap(promptPrefix(body('Tu es Compi.')), promptPrefix(body('Tu es Compi.')))).toBeNull()
  })

  it('dit où les consignes diffèrent, sans citer leur contenu', () => {
    const gap = prefixGap(promptPrefix(body('Tu es Compi. Agenda : non connecté.')), promptPrefix(body('Tu es Compi. Agenda : Google.')))
    expect(gap).toBe('consignes, bloc 2, caractère 22')
    expect(gap).not.toMatch(/Google|connecté/)
  })

  it('outil ajouté, retiré ou changé : son rang et son nom', () => {
    expect(prefixGap(promptPrefix(body('x')), promptPrefix(body('x', [{ name: 'a' }, { name: 'c' }])))).toBe('outil n° 2 (c)')
    expect(prefixGap(promptPrefix(body('x')), promptPrefix(body('x', [{ name: 'a' }])))).toBe('outil n° 2 (b)')
  })

  it('réglage de réflexion changé (le modèle relit tout)', () => {
    expect(prefixGap(promptPrefix(body('x')), promptPrefix(body('x', undefined, { type: 'enabled', budget_tokens: 2048 })))).toBe('réglage de réflexion')
  })

  it('première requête d’une discussion : aucune réponse encore', () => {
    expect(isFirstTurn({ messages: [{ role: 'user', content: 'bonjour' }] })).toBe(true)
    expect(isFirstTurn({ messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }] })).toBe(false)
    expect(isFirstTurn({ messages: [] })).toBe(false)
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

  it('outils de Compi : tous d’office avec une fenêtre de 32 000 jetons, à la demande en dessous', () => {
    const withGroup = { ...body, tools: [big('mcp__compi__timer'), big('mcp__compi__open_app'), big('mcp__compi__move_items')] }
    const names = (b: Record<string, unknown>): string[] => (b.tools as Array<{ name: string }>).map((t) => t.name)
    const wide = fitLocalTools(withGroup, 32_768, servers)
    expect(names(wide.body)).toEqual(['mcp__compi__timer', 'mcp__compi__open_app', 'mcp__compi__move_items'])
    expect((wide.body.system as Array<{ text: string }>).some((b) => b.text.includes('chargés à la demande : si la demande en a besoin'))).toBe(false)
    // « ouvre » charge le groupe Windows : la liste d'outils reste la même qu'au tour précédent.
    const later = fitLocalTools({ ...withGroup, messages: [{ role: 'user', content: 'ouvre la calculatrice' }] }, 32_768, servers)
    expect(later.body.tools).toEqual(wide.body.tools)
    expect(later.body.system).toEqual(wide.body.system)
    const small = fitLocalTools(withGroup, 16_384, servers)
    expect(names(small.body)).toEqual(['mcp__compi__timer'])
    expect(names(fitLocalTools({ ...withGroup, messages: [{ role: 'user', content: 'ouvre la calculatrice' }] }, 16_384, servers).body)).toEqual([
      'mcp__compi__timer',
      'mcp__compi__open_app'
    ])
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
