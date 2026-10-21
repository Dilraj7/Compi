// Connecteurs « en un clic » : connexion par compte (OAuth 2.1) aux serveurs MCP
// distants, comme Notion ou Todoist.
// - Compi s'enregistre tout seul auprès du service (enregistrement dynamique) ;
// - le navigateur de l'utilisateur ouvre la page du service, qui renvoie vers
//   un petit serveur sur 127.0.0.1 (port libre), vérifié par `state` et PKCE ;
// - les jetons sont chiffrés par Windows et renouvelés avant chaque réponse.
// Compi ne voit jamais le mot de passe du service.

import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { net, shell } from 'electron'
import { auth, type OAuthClientProvider, type OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js'
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js'
import { log } from '../log'
import { secrets } from '../store/secrets'

const CONSENT_TIMEOUT_MS = 5 * 60_000
/** Un jeton qui expire dans moins de 5 minutes est renouvelé avant d'être utilisé. */
const REFRESH_MARGIN_MS = 5 * 60_000

/** Ce qui est gardé (chiffré) pour un connecteur. */
export interface StoredOAuth {
  client?: OAuthClientInformationMixed
  /** Adresse de retour déclarée lors de l'enregistrement du client. */
  redirectUri?: string
  tokens?: OAuthTokens & { expires_at?: number }
  discovery?: OAuthDiscoveryState
  /** Le service a retiré l'accès : il faut se reconnecter. */
  expired?: boolean
}

export function loadOAuth(id: string): StoredOAuth {
  try {
    return JSON.parse(secrets.getConnectorOAuth(id) ?? '{}') as StoredOAuth
  } catch {
    return {}
  }
}

function saveOAuth(id: string, patch: Partial<StoredOAuth>): void {
  secrets.setConnectorOAuth(id, JSON.stringify({ ...loadOAuth(id), ...patch }))
}

export const forgetOAuth = (id: string): void => secrets.setConnectorOAuth(id, null)

/** Jeton encore valable assez longtemps pour une réponse (pur, testé). */
export function tokenUsable(t: StoredOAuth['tokens'], now = Date.now()): boolean {
  if (!t?.access_token) return false
  return t.expires_at === undefined || t.expires_at - now > REFRESH_MARGIN_MS
}

class NeedsLogin extends Error {}

const netFetch: FetchLike = (url, init) => net.fetch(String(url), init as RequestInit)

/** Le pont entre le kit MCP et le coffre de Compi, pour un connecteur. */
class CompiOAuthProvider implements OAuthClientProvider {
  private verifier = ''
  readonly stateValue = randomBytes(24).toString('base64url')

  constructor(
    private readonly id: string,
    private readonly redirect: string,
    private readonly onRedirect: ((url: URL) => void) | null
  ) {}

  get redirectUrl(): string {
    return this.redirect
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Compi',
      redirect_uris: [this.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }
  }

  state(): string {
    return this.stateValue
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const s = loadOAuth(this.id)
    // Client enregistré avec une autre adresse de retour (autre port) : on en réenregistre un.
    return s.client && s.redirectUri === this.redirect ? s.client : undefined
  }

  saveClientInformation(client: OAuthClientInformationMixed): void {
    saveOAuth(this.id, { client, redirectUri: this.redirect })
  }

  tokens(): OAuthTokens | undefined {
    return loadOAuth(this.id).tokens
  }

  saveTokens(tokens: OAuthTokens): void {
    saveOAuth(this.id, { tokens: { ...tokens, ...(tokens.expires_in ? { expires_at: Date.now() + tokens.expires_in * 1000 } : {}) }, expired: false })
  }

  redirectToAuthorization(url: URL): void {
    // Renouvellement en arrière-plan : jamais de page qui s'ouvre sans que l'utilisateur l'ait demandé.
    if (!this.onRedirect) throw new NeedsLogin('reconnexion nécessaire')
    this.onRedirect(url)
  }

  saveCodeVerifier(v: string): void {
    this.verifier = v
  }

  codeVerifier(): string {
    return this.verifier
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState): void {
    saveOAuth(this.id, { discovery })
  }

  discoveryState(): OAuthDiscoveryState | undefined {
    return loadOAuth(this.id).discovery
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): void {
    if (scope === 'all') forgetOAuth(this.id)
    else if (scope === 'client') saveOAuth(this.id, { client: undefined, redirectUri: undefined })
    else if (scope === 'tokens') saveOAuth(this.id, { tokens: undefined })
    else if (scope === 'discovery') saveOAuth(this.id, { discovery: undefined })
  }
}

// ─── Connexion ───────────────────────────────────────────────────────────────

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Compi</title>` +
  `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0d12;color:#e7e9ee;font:16px system-ui,sans-serif">` +
  `<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:22px;margin-bottom:10px">${title}</div>` +
  `<div style="color:#9aa0ab">${body}</div></div></body></html>`

/**
 * Port de retour d'une connexion précédente : le reprendre garde le même client chez le
 * service. Notion le demande : se réenregistrer laisse l'ancien accès orphelin.
 */
export function previousPort(redirectUri: string | undefined): number | undefined {
  if (!redirectUri) return undefined
  try {
    const u = new URL(redirectUri)
    const port = Number(u.port)
    return u.hostname === '127.0.0.1' && Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined
  } catch {
    return undefined
  }
}

/** Petit serveur de retour sur 127.0.0.1 (port précédent si libre) : attend le code, vérifie `state`. */
function waitForCode(name: string, getState: () => string, signal: AbortSignal, preferred?: number): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((ready, failStart) => {
    let settle: { resolve: (c: string) => void; reject: (e: Error) => void }
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
    code.catch(() => undefined)
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/callback' || u.searchParams.get('state') !== getState()) {
        res.writeHead(404).end()
        return
      }
      const error = u.searchParams.get('error')
      const c = u.searchParams.get('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
      const safeName = name.replace(/[<>&"]/g, '')
      if (c && !error) {
        res.end(page(`Compi est connecté à ${safeName} ✓`, 'Tu peux fermer cet onglet et revenir à Compi.'))
        settle.resolve(c)
      } else {
        res.end(page('Connexion annulée', 'Tu peux fermer cet onglet. Rien n’a été partagé avec Compi.'))
        settle.reject(Object.assign(new Error(error ?? 'sans code'), { code: error ?? 'no_code' }))
      }
      done()
    })
    const timer = setTimeout(() => {
      settle.reject(Object.assign(new Error('délai dépassé'), { code: 'timeout' }))
      done()
    }, CONSENT_TIMEOUT_MS)
    const onAbort = (): void => {
      settle.reject(Object.assign(new Error('annulé'), { code: 'cancelled' }))
      done()
    }
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      server.close()
      // Une connexion gardée ouverte par le navigateur viserait ce serveur fini à la
      // prochaine connexion, sur le même port : le code n'arriverait jamais.
      setImmediate(() => server.closeAllConnections())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    // Port précédent déjà pris : un port libre, avec un nouveau client chez le service.
    let fallback = preferred !== undefined
    server.on('error', (e: NodeJS.ErrnoException) => {
      if (fallback && e.code === 'EADDRINUSE') {
        fallback = false
        server.listen(0, '127.0.0.1')
      } else failStart(e)
    })
    server.on('listening', () => {
      const addr = server.address()
      ready({ port: typeof addr === 'object' && addr ? addr.port : 0, code })
    })
    server.listen(preferred ?? 0, '127.0.0.1')
  })
}

function connectMessage(name: string, e: Error & { code?: string }): string {
  switch (e.code) {
    case 'cancelled':
      return 'Connexion annulée.'
    case 'timeout':
      return `Pas de réponse de ${name} après 5 minutes. Réessaie, et termine la connexion dans l’onglet qui s’ouvre.`
    case 'access_denied':
      return `Tu as refusé l’accès sur la page de ${name}. Rien n’a été partagé.`
  }
  const m = e.message ?? ''
  if (/registration|register/i.test(m)) return `${name} n’accepte pas que Compi s’enregistre tout seul : ce service n’est pas encore pris en charge en un clic.`
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(m)) return `${name} ne répond pas. Vérifie ta connexion à Internet.`
  return `Connexion à ${name} impossible : ${m}`
}

let pending: AbortController | null = null

/**
 * Connecte un serveur MCP distant par compte : ouvre la page du service dans le
 * navigateur et attend l'accord de l'utilisateur (5 minutes au plus).
 */
export async function connectOAuth(id: string, name: string, serverUrl: string): Promise<{ ok: true } | { ok: false; message: string }> {
  pending?.abort()
  const controller = new AbortController()
  pending = controller
  let provider: CompiOAuthProvider | null = null
  try {
    const { port, code } = await waitForCode(name, () => provider?.stateValue ?? '', controller.signal, previousPort(loadOAuth(id).redirectUri))
    const redirect = `http://127.0.0.1:${port}/callback`
    provider = new CompiOAuthProvider(id, redirect, (url) => {
      // Tests de bout en bout (faux service sur ce PC) : il redirige tout de suite, sans navigateur.
      if (process.env.COMPI_OAUTH_TEST === '1' && ['127.0.0.1', 'localhost'].includes(url.hostname)) void net.fetch(url.toString()).catch(() => undefined)
      else void shell.openExternal(url.toString())
    })
    // Nouvelle connexion : les anciens jetons ne servent plus.
    saveOAuth(id, { tokens: undefined, expired: false })
    const first = await auth(provider, { serverUrl, fetchFn: netFetch })
    if (first === 'REDIRECT') {
      const authorizationCode = await code
      await auth(provider, { serverUrl, authorizationCode, fetchFn: netFetch })
    }
    if (!loadOAuth(id).tokens?.access_token) return { ok: false, message: `${name} n’a pas fourni d’accès.` }
    log('info', `connecteur ${name} : connecté par compte`)
    return { ok: true }
  } catch (e) {
    const err = e as Error & { code?: string }
    log('warn', `connecteur ${name} : connexion échouée : ${err.code ?? err.message}`)
    return { ok: false, message: connectMessage(name, err) }
  } finally {
    if (pending === controller) pending = null
  }
}

export function cancelOAuth(): void {
  pending?.abort()
}

const refreshing = new Map<string, Promise<string | null>>()

/**
 * Jeton d'accès valable pour une réponse, renouvelé si besoin (sans jamais ouvrir
 * de page). `null` : pas connecté, ou l'utilisateur doit se reconnecter.
 */
export function accessTokenFor(id: string, serverUrl: string): Promise<string | null> {
  const s = loadOAuth(id)
  if (!s.tokens?.access_token || s.expired) return Promise.resolve(null)
  if (tokenUsable(s.tokens)) return Promise.resolve(s.tokens.access_token)
  if (!s.tokens.refresh_token || !s.redirectUri) return Promise.resolve(null)
  let p = refreshing.get(id)
  if (!p) {
    p = (async () => {
      try {
        const provider = new CompiOAuthProvider(id, s.redirectUri!, null)
        const r = await auth(provider, { serverUrl, fetchFn: netFetch })
        return r === 'AUTHORIZED' ? (loadOAuth(id).tokens?.access_token ?? null) : null
      } catch (e) {
        if (e instanceof NeedsLogin || /invalid_grant|unauthorized|invalid_client/i.test((e as Error).message)) {
          saveOAuth(id, { expired: true })
          log('warn', `connecteur ${id} : accès retiré, reconnexion nécessaire`)
        } else {
          log('warn', `connecteur ${id} : renouvellement du jeton impossible : ${(e as Error).message}`)
        }
        return null
      } finally {
        refreshing.delete(id)
      }
    })()
    refreshing.set(id, p)
  }
  return p
}
