// Recherche web des cerveaux autres que Claude, avec le service choisi par
// l'utilisateur. La requête quitte le PC : canUseTool montre la carte
// « Recherches web » avant. Le journal ne garde jamais la requête.

import { net } from 'electron'
import type { WebSearchSettings } from '../../shared/types'
import {
  cleanQuery,
  DEFAULT_RESULTS,
  MAX_RESULTS,
  normalizeSearxUrl,
  OLLAMA_SEARCH_URL,
  parseResults,
  searchError,
  searxSearchUrl,
  type WebResult
} from '../../shared/webSearch'
import { log } from '../log'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'

const TIMEOUT_MS = 15_000
const MAX_BYTES = 2 * 1024 * 1024

/** Essais de bout en bout : un faux service à la place d'ollama.com. */
const ollamaUrl = (): string => process.env.COMPI_WEBSEARCH_TEST_URL || OLLAMA_SEARCH_URL

async function call(url: string, init: RequestInit): Promise<Response> {
  try {
    // Ni cache disque (la requête y resterait en clair), ni redirection pour la clé d'Ollama.
    return await net.fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    if ((e as Error).name === 'TimeoutError') throw new Error('Le service de recherche n’a pas répondu à temps. Réessaie plus tard.', { cause: e })
    throw new Error(`Service de recherche injoignable : ${(e as Error).message}`, { cause: e })
  }
}

async function readJson(res: Response, provider: WebSearchSettings['provider']): Promise<unknown> {
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > MAX_BYTES) throw new Error('Réponse du service de recherche trop lourde.')
  try {
    return JSON.parse(body.toString('utf8'))
  } catch {
    throw new Error(
      provider === 'searxng'
        ? 'Ton SearXNG n’a pas renvoyé de JSON : vérifie l’adresse, et que « json » est dans search.formats de son settings.yml.'
        : 'Réponse illisible du service de recherche.'
    )
  }
}

/** Cherche avec le service réglé ; lève une erreur au message clair. */
export async function searchWeb(query: string, max = DEFAULT_RESULTS, ws: WebSearchSettings = settings.get().webSearch): Promise<WebResult[]> {
  const q = cleanQuery(query)
  if (!q) throw new Error('Recherche vide.')
  const n = Math.min(MAX_RESULTS, Math.max(1, Math.round(max)))
  const started = Date.now()
  let res: Response
  if (ws.provider === 'ollama') {
    const key = secrets.getWebSearchKey()
    if (!key) throw new Error('Aucune clé Ollama : ajoute-la dans Réglages › Cerveau › Recherche web.')
    res = await call(ollamaUrl(), {
      method: 'POST',
      redirect: 'error',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: q, max_results: n })
    })
  } else if (ws.provider === 'searxng') {
    const base = normalizeSearxUrl(ws.searxngUrl)
    if (!base) throw new Error('Adresse SearXNG invalide : corrige-la dans Réglages › Cerveau › Recherche web.')
    res = await call(searxSearchUrl(base, q), { headers: { accept: 'application/json' } })
  } else {
    throw new Error('La recherche web est désactivée (Réglages › Cerveau › Recherche web).')
  }
  if (!res.ok) {
    log('warn', `recherche web refusée : HTTP ${res.status} (${ws.provider})`)
    throw new Error(searchError(ws.provider, res.status))
  }
  const results = parseResults(await readJson(res, ws.provider), n)
  log('info', `recherche web : ${results.length} résultat(s) en ${Date.now() - started} ms (${ws.provider})`)
  return results
}
