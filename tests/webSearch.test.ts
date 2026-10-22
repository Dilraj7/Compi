import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIVACY, isOutbound, privacyDecision, webSearchDecision } from '../src/shared/privacy'
import {
  cleanQuery,
  cleanWebSearch,
  formatResults,
  normalizeSearxUrl,
  parseResults,
  searchError,
  searxSearchUrl,
  webSearchLabel,
  webSearchReady
} from '../src/shared/webSearch'

const TOOL = 'mcp__compi__web_search'

describe('recherche web : réglages', () => {
  it('reste désactivée tant que rien n’est choisi, même avec un fichier abîmé', () => {
    expect(cleanWebSearch(undefined)).toEqual({ provider: 'off', searxngUrl: '' })
    expect(cleanWebSearch({ provider: 'bing' as never, searxngUrl: 7 as never })).toEqual({ provider: 'off', searxngUrl: '' })
  })

  it('n’est prête qu’avec la clé d’Ollama ou une adresse SearXNG valide', () => {
    expect(webSearchReady({ provider: 'off', searxngUrl: 'http://localhost:8080' }, true)).toBe(false)
    expect(webSearchReady({ provider: 'ollama', searxngUrl: '' }, false)).toBe(false)
    expect(webSearchReady({ provider: 'ollama', searxngUrl: '' }, true)).toBe(true)
    expect(webSearchReady({ provider: 'searxng', searxngUrl: '' }, true)).toBe(false)
    expect(webSearchReady({ provider: 'searxng', searxngUrl: 'localhost:8080' }, false)).toBe(true)
  })

  it('comprend les adresses SearXNG telles qu’on les tape', () => {
    expect(normalizeSearxUrl('localhost:8080')).toBe('http://localhost:8080')
    expect(normalizeSearxUrl('192.168.1.20:8888/')).toBe('http://192.168.1.20:8888')
    expect(normalizeSearxUrl('search.example.org')).toBe('https://search.example.org')
    expect(normalizeSearxUrl('https://search.example.org/searx/search')).toBe('https://search.example.org/searx')
    expect(normalizeSearxUrl('ftp://search.example.org')).toBeNull()
    expect(normalizeSearxUrl('http://user:pass@search.example.org')).toBeNull()
    expect(normalizeSearxUrl('   ')).toBeNull()
    expect(searxSearchUrl('http://localhost:8080', 'météo à Lyon & co')).toBe(
      'http://localhost:8080/search?q=m%C3%A9t%C3%A9o%20%C3%A0%20Lyon%20%26%20co&format=json'
    )
  })

  it('nomme la destination des recherches', () => {
    expect(webSearchLabel({ provider: 'ollama', searxngUrl: '' })).toBe('Ollama (ollama.com)')
    expect(webSearchLabel({ provider: 'searxng', searxngUrl: 'localhost:8080' })).toBe('ton SearXNG (localhost:8080)')
  })
})

describe('recherche web : résultats', () => {
  const ollama = {
    results: [
      { title: 'Ollama', url: 'https://ollama.com/', content: 'Get up and running with <b>large</b>   language models.' },
      { title: 'Doublon', url: 'https://ollama.com/', content: 'même adresse' },
      { title: 'Piège', url: 'javascript:alert(1)', content: 'x' },
      { title: '', url: 'https://example.com/page', content: 'x'.repeat(1000) }
    ]
  }

  it('garde les adresses web, sans doublon, avec des extraits courts et sans balises', () => {
    const r = parseResults(ollama)
    expect(r.map((x) => x.url)).toEqual(['https://ollama.com/', 'https://example.com/page'])
    expect(r[0].snippet).toBe('Get up and running with large language models.')
    expect(r[1].title).toBe('example.com')
    expect(r[1].snippet.length).toBeLessThanOrEqual(400)
    expect(r[1].snippet.endsWith('…')).toBe(true)
  })

  it('coupe au nombre demandé (10 au plus) et refuse une réponse inattendue', () => {
    const many = { results: Array.from({ length: 30 }, (_, i) => ({ title: `R${i}`, url: `https://example.com/${i}`, content: '' })) }
    expect(parseResults(many, 3)).toHaveLength(3)
    expect(parseResults(many, 50)).toHaveLength(10)
    expect(() => parseResults({ error: 'nope' })).toThrow(/inattendue/)
  })

  it('rend une liste numérotée qui demande de lire les pages et de citer', () => {
    const t = formatResults('ollama', parseResults(ollama), 'Ollama (ollama.com)')
    expect(t).toContain('1. Ollama\n   https://ollama.com/')
    expect(t).toContain('fetch_page')
    expect(formatResults('rien', [], 'ton SearXNG')).toMatch(/^Aucun résultat/)
  })

  it('nettoie la requête', () => {
    expect(cleanQuery('  météo\n Lyon  ')).toBe('météo Lyon')
    expect(cleanQuery('   ')).toBeNull()
    expect(cleanQuery('a'.repeat(1000))?.length).toBe(400)
  })

  it('explique clairement chaque refus', () => {
    expect(searchError('ollama', 429)).toMatch(/quota/)
    expect(searchError('ollama', 401)).toMatch(/Clé Ollama refusée/)
    expect(searchError('searxng', 403)).toMatch(/search\.formats/)
    expect(searchError('searxng', 404)).toMatch(/Adresse SearXNG/)
    expect(searchError('ollama', 503)).toMatch(/HTTP 503/)
  })
})

describe('recherche web : confidentialité', () => {
  it('demande avant chaque recherche par défaut, même avec un cerveau local', () => {
    expect(DEFAULT_PRIVACY.web).toBe('ask')
    expect(webSearchDecision(DEFAULT_PRIVACY)).toBe('ask')
    expect(webSearchDecision({ ...DEFAULT_PRIVACY, web: 'always' })).toBe('allow')
    expect(webSearchDecision({ ...DEFAULT_PRIVACY, web: 'never' })).toBe('deny')
    expect(webSearchDecision(undefined)).toBe('ask')
  })

  it('compte comme une sortie du PC (carte obligatoire après un e-mail)', () => {
    expect(isOutbound(TOOL)).toBe(true)
  })

  it('ne change rien aux données envoyées aux cerveaux en ligne', () => {
    expect(privacyDecision('anthropic', TOOL, DEFAULT_PRIVACY)).toBeNull()
    expect(privacyDecision('local', TOOL, DEFAULT_PRIVACY)).toBeNull()
  })
})
