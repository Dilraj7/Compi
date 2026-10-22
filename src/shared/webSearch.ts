// Recherche web des cerveaux autres que Claude, avec le service choisi par
// l'utilisateur : Ollama (clé de son compte) ou sa propre instance SearXNG.
// Rien n'est préréglé. Fonctions pures, testées dans tests/webSearch.test.ts.

import { isPrivateHost } from './brains'
import type { WebSearchProvider, WebSearchSettings } from './types'

/** Nom court de l'outil de Compi (mcp__compi__web_search). */
export const WEB_SEARCH_TOOL = 'web_search'
export const OLLAMA_SEARCH_URL = 'https://ollama.com/api/web_search'
export const OLLAMA_KEYS_URL = 'https://ollama.com/settings/keys'
export const SEARXNG_DOCS_URL = 'https://docs.searxng.org/admin/settings/settings_search.html'

export const DEFAULT_WEB_SEARCH: WebSearchSettings = { provider: 'off', searxngUrl: '' }

export const DEFAULT_RESULTS = 5
/** Maximum d'Ollama ; SearXNG en renvoie plus, on coupe. */
export const MAX_RESULTS = 10
const SNIPPET_MAX = 400
const QUERY_MAX = 400

export interface WebResult {
  title: string
  url: string
  snippet: string
}

export const isWebSearchProvider = (v: unknown): v is WebSearchProvider => v === 'off' || v === 'ollama' || v === 'searxng'

/** Réglages vérifiés : un fichier modifié à la main ne bloque rien. */
export function cleanWebSearch(raw: Partial<WebSearchSettings> | undefined): WebSearchSettings {
  return {
    provider: isWebSearchProvider(raw?.provider) ? raw.provider : DEFAULT_WEB_SEARCH.provider,
    searxngUrl: typeof raw?.searxngUrl === 'string' ? raw.searxngUrl.trim().slice(0, 300) : ''
  }
}

/**
 * Adresse de base d'une instance SearXNG (`null` si invalide). Sans protocole :
 * http pour une adresse du PC ou du réseau local, https sinon. « /search » final retiré.
 */
export function normalizeSearxUrl(raw: string): string | null {
  const t = raw.trim()
  if (!t) return null
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `${isPrivateHost(t.split(/[/:]/)[0]) ? 'http' : 'https'}://${t}`)
  } catch {
    return null
  }
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) return null
  const path = url.pathname.replace(/\/+$/, '').replace(/\/search$/i, '')
  return `${url.protocol}//${url.host}${path}`
}

export function searxSearchUrl(base: string, query: string): string {
  return `${base}/search?q=${encodeURIComponent(query)}&format=json`
}

/** Prêt à chercher : service choisi, avec sa clé ou une adresse valide. */
export function webSearchReady(ws: WebSearchSettings, hasOllamaKey: boolean): boolean {
  if (ws.provider === 'ollama') return hasOllamaKey
  if (ws.provider === 'searxng') return normalizeSearxUrl(ws.searxngUrl) !== null
  return false
}

/** Destination des recherches, pour les cartes et la ligne « Envoyé à ». */
export function webSearchLabel(ws: WebSearchSettings): string {
  if (ws.provider === 'ollama') return 'Ollama (ollama.com)'
  const base = normalizeSearxUrl(ws.searxngUrl)
  return base ? `ton SearXNG (${new URL(base).host})` : 'ton SearXNG'
}

/** Requête nettoyée (`null` si vide). */
export function cleanQuery(q: string): string | null {
  const t = q.replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX)
  return t || null
}

const clampResults = (n: number | undefined): number => Math.min(MAX_RESULTS, Math.max(1, Math.round(n ?? DEFAULT_RESULTS)))

function snippet(s: unknown): string {
  if (typeof s !== 'string') return ''
  const t = s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX - 1).trimEnd()}…` : t
}

function webUrl(u: unknown): string | null {
  if (typeof u !== 'string') return null
  try {
    const url = new URL(u)
    return /^https?:$/.test(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

/** Résultats `{ results: [{ title, url, content }] }` : même forme chez Ollama et SearXNG. */
export function parseResults(json: unknown, max?: number): WebResult[] {
  const list = (json as { results?: unknown } | null)?.results
  if (!Array.isArray(list)) throw new Error('Réponse inattendue du service de recherche.')
  const seen = new Set<string>()
  const out: WebResult[] = []
  for (const r of list) {
    const url = webUrl((r as { url?: unknown })?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = snippet((r as { title?: unknown }).title) || new URL(url).hostname
    out.push({ title, url, snippet: snippet((r as { content?: unknown }).content) })
    if (out.length >= clampResults(max)) break
  }
  return out
}

/** Texte rendu au modèle : liste numérotée, puis la consigne de lire les pages et de citer. */
export function formatResults(query: string, results: WebResult[], source: string): string {
  if (!results.length) return `Aucun résultat pour « ${query} » (${source}). Essaie d'autres mots, ou réponds sans chercher en le disant.`
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ''}`)
  return `Résultats web pour « ${query} » (${source}) :\n\n${lines.join('\n\n')}\n\nLis les pages utiles avec fetch_page avant de répondre, et cite leurs adresses.`
}

/** Message clair pour un refus du service (HTTP). */
export function searchError(provider: WebSearchProvider, status: number): string {
  if (status === 429) return 'Le service de recherche refuse pour l’instant : trop de recherches (quota atteint). Réessaie plus tard, ou réponds sans chercher.'
  if (provider === 'ollama' && (status === 401 || status === 403))
    return 'Clé Ollama refusée : vérifie-la dans Réglages › Cerveau › Recherche web (ollama.com/settings/keys).'
  if (provider === 'searxng' && status === 403)
    return 'Ton SearXNG refuse les réponses JSON : ajoute « json » à search.formats dans son settings.yml, puis redémarre-le.'
  if (status === 404)
    return provider === 'searxng'
      ? 'Adresse SearXNG introuvable (HTTP 404) : vérifie-la dans Réglages › Cerveau › Recherche web.'
      : 'Service de recherche introuvable (HTTP 404).'
  if (status >= 500) return `Le service de recherche ne répond pas correctement (HTTP ${status}). Réessaie plus tard.`
  return `Le service de recherche a répondu HTTP ${status}.`
}
