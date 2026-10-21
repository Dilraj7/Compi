// Connexion au compte Google (OAuth 2.0 pour application de bureau) :
// - le navigateur de l'utilisateur ouvre l'écran de consentement de Google ;
// - Google renvoie vers un petit serveur sur 127.0.0.1 (port libre), vérifié par `state` ;
// - le code est échangé avec PKCE contre un jeton durable, chiffré par Windows.
// Compi ne voit jamais le mot de passe Google.

import http from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { net, shell } from 'electron'
import type { GoogleConnectResult } from '../../shared/types'
import { log } from '../log'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'
import {
  authUrl,
  emailFromIdToken,
  endpointsFor,
  GOOGLE_ENDPOINTS,
  googleErrorMessage,
  grantedFrom,
  parseClientFile,
  pkcePair,
  randomState,
  scopesFor,
  type GoogleEndpoints,
  type GoogleWants
} from './auth'

const CONSENT_TIMEOUT_MS = 5 * 60_000

export class GoogleAuthError extends Error {}

export const googleEndpoints = (): GoogleEndpoints => endpointsFor(process.env.COMPI_GOOGLE_TEST_BASE)

let cached: { token: string; expiresAt: number } | null = null
let refreshing: Promise<string> | null = null
let pending: AbortController | null = null

interface TokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  id_token?: string
  error?: string
  error_description?: string
}

async function postForm(url: string, form: Record<string, string>): Promise<TokenResponse> {
  const res = await net.fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(20_000)
  })
  const text = await res.text()
  let json: TokenResponse = {}
  try {
    json = JSON.parse(text)
  } catch {
    /* réponse non JSON */
  }
  if (!res.ok) throw Object.assign(new Error(json.error_description || json.error || `Google a répondu ${res.status}`), { code: json.error })
  return json
}

// ─── Fichier du client ───────────────────────────────────────────────────────

/** Importe le fichier JSON du client « Application de bureau ». */
export async function importGoogleClient(path: string): Promise<void> {
  if ((await stat(path)).size > 64 * 1024) throw new Error('Ce fichier est trop gros pour être un fichier client de Google.')
  const client = parseClientFile(await readFile(path, 'utf8'))
  const previous = settings.get().google.clientId
  // Un autre client : l'ancienne connexion ne vaut plus rien.
  if (previous && previous !== client.clientId) await disconnectGoogle()
  secrets.setGoogleClientSecret(client.clientSecret)
  settings.update({ google: { ...settings.get().google, clientId: client.clientId } })
}

export const hasGoogleClient = (): boolean => Boolean(settings.get().google.clientId && secrets.getGoogleClientSecret())

// ─── Connexion ───────────────────────────────────────────────────────────────

const page = (title: string, body: string): string =>
  `<!doctype html><html lang="fr"><meta charset="utf-8"><title>Compi</title>` +
  `<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0b0d12;color:#e7e9ee;font:16px system-ui,sans-serif">` +
  `<div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:22px;margin-bottom:10px">${title}</div>` +
  `<div style="color:#9aa0ab">${body}</div></div></body></html>`

/** Petit serveur de retour sur 127.0.0.1 : attend le code, vérifie `state`. */
function waitForCode(state: string, signal: AbortSignal): Promise<{ port: number; code: Promise<string> }> {
  return new Promise((ready, failStart) => {
    let settle: { resolve: (c: string) => void; reject: (e: Error) => void }
    const code = new Promise<string>((resolve, reject) => (settle = { resolve, reject }))
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (u.pathname !== '/' || u.searchParams.get('state') !== state) {
        // Requête parasite (favicon, autre onglet…) : on continue d'attendre.
        res.writeHead(404).end()
        return
      }
      const error = u.searchParams.get('error')
      const c = u.searchParams.get('code')
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      if (c && !error) {
        res.end(page('Compi est connecté à Google ✓', 'Tu peux fermer cet onglet et revenir à Compi.'))
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
    }
    signal.addEventListener('abort', onAbort, { once: true })
    server.on('error', failStart)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      ready({ port: typeof addr === 'object' && addr ? addr.port : 0, code })
    })
  })
}

function connectMessage(e: Error & { code?: string }): string {
  switch (e.code) {
    case 'cancelled':
      return 'Connexion annulée.'
    case 'timeout':
      return "Pas de réponse de Google après 5 minutes. Réessaie, et termine la connexion dans l'onglet qui s'ouvre."
    case 'access_denied':
      return "Tu as refusé l'accès sur l'écran de Google. Rien n'a été partagé."
    case 'invalid_client':
    case 'unauthorized_client':
      return 'Google ne reconnaît pas ce client. Vérifie que tu as importé le bon fichier JSON (client « Application de bureau »).'
    case 'invalid_grant':
      return 'Le code de Google a expiré. Réessaie.'
    default:
      return `Connexion à Google impossible : ${e.message}`
  }
}

/** Ouvre l'écran de Google dans le navigateur et attend le retour (5 minutes au plus). */
export async function connectGoogle(want: GoogleWants): Promise<GoogleConnectResult> {
  const g = settings.get().google
  const clientSecret = secrets.getGoogleClientSecret()
  if (!g.clientId || !clientSecret) return { ok: false, message: "Importe d'abord le fichier JSON de ton client Google." }
  if (!want.calendar && !want.mail) return { ok: false, message: 'Choisis au moins l’agenda ou les e-mails.' }

  pending?.abort()
  const controller = new AbortController()
  pending = controller
  const endpoints = googleEndpoints()
  try {
    const state = randomState()
    const { verifier, challenge } = pkcePair()
    const { port, code: codePromise } = await waitForCode(state, controller.signal)
    const redirectUri = `http://127.0.0.1:${port}`
    const url = authUrl(endpoints, { clientId: g.clientId, redirectUri, scopes: scopesFor(want), state, challenge, loginHint: g.email || undefined })
    if (endpoints === GOOGLE_ENDPOINTS) await shell.openExternal(url)
    // Faux Google des tests (sur ce PC) : il redirige tout de suite, sans navigateur.
    else void net.fetch(url).catch(() => undefined)

    const code = await codePromise
    const tokens = await postForm(endpoints.token, {
      code,
      client_id: g.clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier
    })
    if (!tokens.access_token || !tokens.refresh_token) return { ok: false, message: "Google n'a pas fourni de connexion durable. Réessaie." }
    const granted = grantedFrom(tokens.scope)
    if (!granted.calendar && !granted.mail) {
      // Rien d'utile accordé : on ne garde pas le jeton.
      await postForm(endpoints.revoke, { token: tokens.refresh_token }).catch(() => undefined)
      return { ok: false, message: "Tu n'as coché ni l'agenda ni les e-mails sur l'écran de Google : rien n'est connecté." }
    }
    const email = emailFromIdToken(tokens.id_token) ?? ''
    secrets.setGoogleRefreshToken(tokens.refresh_token)
    cached = { token: tokens.access_token, expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000 }
    settings.update({ google: { ...settings.get().google, email, calendar: granted.calendar, mail: granted.mail } })
    log(
      'info',
      `Google : connecté (agenda : ${granted.calendar ? 'oui' : 'non'}, e-mails : ${granted.mail ? 'oui' : 'non'}, brouillons : ${granted.drafts ? 'oui' : 'non'})`
    )
    return { ok: true, email, calendar: granted.calendar, mail: granted.mail }
  } catch (e) {
    const message = connectMessage(e as Error & { code?: string })
    log('warn', `Google : connexion échouée : ${(e as Error & { code?: string }).code ?? (e as Error).message}`)
    return { ok: false, message }
  } finally {
    if (pending === controller) pending = null
  }
}

/** Annule une connexion en attente (bouton « Annuler »). */
export function cancelGoogleConnect(): void {
  pending?.abort()
}

/** Déconnecte le compte : le jeton est révoqué chez Google puis effacé. */
export async function disconnectGoogle(): Promise<void> {
  const token = secrets.getGoogleRefreshToken()
  cached = null
  if (token) await postForm(googleEndpoints().revoke, { token }).catch((e) => log('warn', `Google : révocation : ${(e as Error).message}`))
  secrets.setGoogleRefreshToken(null)
  settings.update({ google: { ...settings.get().google, email: '', calendar: false, mail: false } })
}

// ─── Jetons et appels ────────────────────────────────────────────────────────

async function refresh(): Promise<string> {
  const g = settings.get().google
  const refreshToken = secrets.getGoogleRefreshToken()
  const clientSecret = secrets.getGoogleClientSecret()
  if (!refreshToken || !g.clientId || !clientSecret) throw new GoogleAuthError('Compte Google non connecté : connecte-le dans Réglages › Comptes.')
  try {
    const r = await postForm(googleEndpoints().token, {
      client_id: g.clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
    if (!r.access_token) throw new Error('jeton absent')
    cached = { token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 }
    return r.access_token
  } catch (e) {
    if ((e as { code?: string }).code === 'invalid_grant') {
      // Accès retiré, mot de passe changé, ou application en mode « Test » (7 jours).
      secrets.setGoogleRefreshToken(null)
      settings.update({ google: { ...settings.get().google, email: '', calendar: false, mail: false } })
      throw new GoogleAuthError('La connexion Google a expiré ou a été retirée : reconnecte-toi dans Réglages › Comptes.')
    }
    throw new Error(`Google ne répond pas : ${(e as Error).message}`, { cause: e })
  }
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token
  refreshing ??= refresh().finally(() => (refreshing = null))
  return refreshing
}

/** Appel à une API Google (JSON), avec renouvellement du jeton si besoin. */
/** Erreur de l'API Google, avec son code HTTP (404 ou 410 : déjà supprimé, par exemple). */
export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

export async function googleApi<T>(url: string, init: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken()
    let res: Response
    try {
      res = await net.fetch(url, {
        method: init.method ?? 'GET',
        headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(20_000)
      })
    } catch (e) {
      throw new Error(`Google ne répond pas : ${(e as Error).message}`, { cause: e })
    }
    if (res.status === 401 && attempt === 0) {
      cached = null
      continue
    }
    if (!res.ok) throw new GoogleApiError(googleErrorMessage(res.status, await res.text()), res.status)
    // Une suppression répond 204, sans corps.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }
}
