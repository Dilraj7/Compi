// Secrets (clé API, jetons des connecteurs) chiffrés avec safeStorage,
// c'est-à-dire DPAPI sous Windows : seul l'utilisateur Windows courant peut
// les déchiffrer. Ils ne quittent jamais le processus principal.

import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { readJson, writeJson } from './jsonFile'

const API_KEY = 'anthropic.apiKey'
const CUSTOM_KEY = 'custom.apiKey'
const GOOGLE_CLIENT_SECRET = 'google.clientSecret'
const GOOGLE_REFRESH_TOKEN = 'google.refreshToken'

type Vault = Record<string, string> // clé → valeur chiffrée en base64

class SecretStore {
  private path = ''
  private vault: Vault = {}

  load(): void {
    this.path = join(app.getPath('userData'), 'secrets.json')
    this.vault = readJson<Vault>(this.path, {})
  }

  get(key: string): string | undefined {
    const enc = this.vault[key]
    if (!enc) return undefined
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'))
    } catch {
      return undefined
    }
  }

  set(key: string, value: string | null): void {
    if (value === null || value === '') {
      delete this.vault[key]
    } else {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Le chiffrement Windows (DPAPI) est indisponible : impossible de stocker le secret.')
      }
      this.vault[key] = safeStorage.encryptString(value).toString('base64')
    }
    writeJson(this.path, this.vault)
  }

  has(key: string): boolean {
    return Boolean(this.vault[key])
  }

  // ─── Clé API ───
  getApiKey(): string | undefined {
    return this.get(API_KEY) ?? process.env.ANTHROPIC_API_KEY
  }

  setApiKey(key: string | null): void {
    this.set(API_KEY, key?.trim() || null)
  }

  /** Provenance de la clé, pour le journal (jamais sa valeur). */
  apiKeySource(): 'coffre' | 'variable ANTHROPIC_API_KEY' | 'absente' {
    if (this.has(API_KEY)) return 'coffre'
    return process.env.ANTHROPIC_API_KEY ? 'variable ANTHROPIC_API_KEY' : 'absente'
  }

  hasApiKey(): boolean {
    return this.has(API_KEY) || Boolean(process.env.ANTHROPIC_API_KEY)
  }

  // ─── Service « Autre » (compatible Anthropic) ───
  getCustomKey(): string | undefined {
    return this.get(CUSTOM_KEY)
  }

  setCustomKey(key: string | null): void {
    this.set(CUSTOM_KEY, key?.trim() || null)
  }

  hasCustomKey(): boolean {
    return this.has(CUSTOM_KEY)
  }

  // ─── Compte Google ───
  // Le « secret » d'un client de bureau n'est pas vraiment secret (Google le dit),
  // mais on le range quand même dans le coffre, avec le jeton de renouvellement.
  getGoogleClientSecret(): string | undefined {
    return this.get(GOOGLE_CLIENT_SECRET)
  }

  setGoogleClientSecret(secret: string | null): void {
    this.set(GOOGLE_CLIENT_SECRET, secret?.trim() || null)
  }

  getGoogleRefreshToken(): string | undefined {
    return this.get(GOOGLE_REFRESH_TOKEN)
  }

  setGoogleRefreshToken(token: string | null): void {
    this.set(GOOGLE_REFRESH_TOKEN, token || null)
  }

  // ─── Connecteurs ───
  connectorKey(connectorId: string, name: string): string {
    return `connector.${connectorId}.${name}`
  }

  getConnectorSecrets(connectorId: string, names: string[] = []): Record<string, string> {
    const out: Record<string, string> = {}
    for (const n of names) {
      const v = this.get(this.connectorKey(connectorId, n))
      if (v !== undefined) out[n] = v
    }
    return out
  }

  setConnectorSecrets(connectorId: string, values: Record<string, string>): void {
    for (const [name, value] of Object.entries(values)) {
      // Une valeur vide signifie « garder l'existante » (le formulaire ne la renvoie jamais).
      if (value !== '') this.set(this.connectorKey(connectorId, name), value)
    }
  }

  deleteConnectorSecrets(connectorId: string): void {
    const prefix = `connector.${connectorId}.`
    for (const key of Object.keys(this.vault)) if (key.startsWith(prefix)) delete this.vault[key]
    writeJson(this.path, this.vault)
  }

  // ─── Connexion par compte (OAuth) d'un connecteur : client enregistré et jetons ───
  getConnectorOAuth(connectorId: string): string | undefined {
    return this.get(`oauth.${connectorId}`)
  }

  setConnectorOAuth(connectorId: string, json: string | null): void {
    this.set(`oauth.${connectorId}`, json)
  }

  hasConnectorOAuth(connectorId: string): boolean {
    return this.has(`oauth.${connectorId}`)
  }

  listConnectorSecretNames(connectorId: string): string[] {
    const prefix = `connector.${connectorId}.`
    return Object.keys(this.vault)
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length))
  }
}

export const secrets = new SecretStore()
