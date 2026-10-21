// Connexion Google, partie « pure » : autorisations demandées, fichier du client,
// PKCE, adresse de l'écran de consentement, messages d'erreur. Le reste
// (navigateur, serveur de retour, jetons) est dans connect.ts.
// Testé dans tests/google.test.ts.

import { createHash, randomBytes } from 'node:crypto'

export interface GoogleEndpoints {
  auth: string
  token: string
  revoke: string
  gmail: string
  calendar: string
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  gmail: 'https://gmail.googleapis.com/gmail/v1',
  calendar: 'https://www.googleapis.com/calendar/v3'
}

/**
 * Adresses de Google, ou d'un faux serveur Google pour les tests de bout en bout.
 * Le faux serveur n'est accepté que sur cette machine (127.0.0.1, localhost).
 */
export function endpointsFor(testBase: string | undefined): GoogleEndpoints {
  if (!testBase) return GOOGLE_ENDPOINTS
  try {
    const u = new URL(testBase)
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return GOOGLE_ENDPOINTS
  } catch {
    return GOOGLE_ENDPOINTS
  }
  const b = testBase.replace(/\/+$/, '')
  return { auth: `${b}/o/oauth2/v2/auth`, token: `${b}/token`, revoke: `${b}/revoke`, gmail: `${b}/gmail/v1`, calendar: `${b}/calendar/v3` }
}

const G = 'https://www.googleapis.com/auth/'

/**
 * Autorisations, les plus étroites possibles :
 * - agenda : lire et créer des événements, voir la liste des agendas ;
 * - e-mails : lire, et créer des brouillons. Google n'a pas d'autorisation
 *   « brouillons seulement » : gmail.compose permettrait aussi d'envoyer, mais
 *   Compi n'a aucune fonction d'envoi (vérifié par un test).
 */
export const SCOPES = {
  base: ['openid', 'email'],
  calendar: [`${G}calendar.events`, `${G}calendar.calendarlist.readonly`],
  mail: [`${G}gmail.readonly`, `${G}gmail.compose`]
} as const

export interface GoogleWants {
  calendar: boolean
  mail: boolean
}

export function scopesFor(want: GoogleWants): string[] {
  return [...SCOPES.base, ...(want.calendar ? SCOPES.calendar : []), ...(want.mail ? SCOPES.mail : [])]
}

/** Ce que l'utilisateur a vraiment accordé (il peut décocher des cases sur l'écran de Google). */
export function grantedFrom(scope: string | undefined): GoogleWants & { drafts: boolean } {
  const list = (scope ?? '').split(/\s+/)
  return {
    calendar: list.includes(`${G}calendar.events`),
    mail: list.includes(`${G}gmail.readonly`),
    drafts: list.includes(`${G}gmail.compose`)
  }
}

export interface GoogleClient {
  clientId: string
  clientSecret: string
}

/** Lit le fichier JSON téléchargé dans la console Google (client « Application de bureau »). */
export function parseClientFile(raw: string): GoogleClient {
  let json: { installed?: { client_id?: unknown; client_secret?: unknown }; web?: unknown }
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error("Ce fichier n'est pas le fichier JSON téléchargé dans la console Google.")
  }
  if (json?.web) {
    throw new Error('Ce client est de type « Application Web ». Dans la console Google, crée un client de type « Application de bureau ».')
  }
  const c = json?.installed
  if (typeof c?.client_id !== 'string' || typeof c?.client_secret !== 'string') {
    throw new Error("Ce fichier ne contient pas d'identifiants de client Google « Application de bureau ».")
  }
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(c.client_id)) {
    throw new Error("L'identifiant du client Google est inattendu (il doit finir par .apps.googleusercontent.com).")
  }
  return { clientId: c.client_id, clientSecret: c.client_secret }
}

/** PKCE (RFC 7636) : le code reçu par le navigateur ne sert à rien sans ce secret. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: challengeFor(verifier) }
}

export const challengeFor = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url')

export const randomState = (): string => randomBytes(24).toString('base64url')

/** Adresse de l'écran de consentement de Google. */
export function authUrl(
  endpoints: GoogleEndpoints,
  o: { clientId: string; redirectUri: string; scopes: string[]; state: string; challenge: string; loginHint?: string }
): string {
  const params = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scopes.join(' '),
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    // Jeton durable, redemandé à chaque connexion pour être sûr de l'obtenir.
    access_type: 'offline',
    prompt: 'consent'
  })
  if (o.loginHint) params.set('login_hint', o.loginHint)
  return `${endpoints.auth}?${params}`
}

/** Adresse du compte, lue dans le jeton d'identité reçu directement de Google (TLS). */
export function emailFromIdToken(idToken: string | undefined): string | undefined {
  const payload = idToken?.split('.')[1]
  if (!payload) return undefined
  try {
    const email = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).email
    return typeof email === 'string' ? email : undefined
  } catch {
    return undefined
  }
}

/** Message clair pour une erreur de l'API Google. */
export function googleErrorMessage(status: number, body: string): string {
  if (status === 403 && /accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) {
    const api = /gmail/i.test(body) ? '« Gmail API »' : /calendar/i.test(body) ? '« Google Calendar API »' : 'l’API'
    return `${api} n'est pas activée dans ton projet Google Cloud. Active-la (console Google › API et services › Bibliothèque), puis réessaie.`
  }
  if (status === 403 && /forbiddenForNonOrganizer|requiredAccessLevel|writer access|organizer/i.test(body)) {
    return "Google refuse : tu n'es pas l'organisateur de cet événement, ou cet agenda est en lecture seule. Seul l'organisateur peut le déplacer ou le supprimer."
  }
  if (status === 403 && /insufficient|PERMISSION_DENIED|scope/i.test(body)) {
    return "Google refuse : cette autorisation n'a pas été accordée. Reconnecte ton compte dans Réglages › Comptes en cochant toutes les cases."
  }
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded/.test(body)) return 'Google limite le nombre de demandes : réessaie dans une minute.'
  if (status === 404) return 'Introuvable chez Google (supprimé, ou mauvais identifiant).'
  if (status >= 500) return 'Google rencontre un problème passager : réessaie dans un instant.'
  let detail = ''
  try {
    detail = JSON.parse(body)?.error?.message ?? ''
  } catch {
    /* corps non JSON */
  }
  return `Google a répondu ${status}${detail ? ` : ${String(detail).slice(0, 160)}` : '.'}`
}
