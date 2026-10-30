import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startFakeOAuth, type FakeOAuth } from './helpers/fakeOAuthServer'

// Coffre en mémoire (à la place du chiffrement de Windows).
const vault = new Map<string, string>()
const openExternal = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => '.' },
  // Le faux service redirige tout de suite : on suit la redirection comme un navigateur.
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) },
  shell: { openExternal: (...a: unknown[]) => openExternal(...a) }
}))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/store/secrets', () => ({
  secrets: {
    getConnectorOAuth: (id: string) => vault.get(id),
    setConnectorOAuth: (id: string, json: string | null) => (json === null ? vault.delete(id) : vault.set(id, json))
  }
}))

process.env.COMPI_OAUTH_TEST = '1'
const { accessTokenFor, connectOAuth, forgetOAuth, loadOAuth, previousPort, tokenUsable, validClientPort } = await import('../src/main/connectors/oauth')

describe('port de retour d’une connexion précédente', () => {
  it('repris s’il est sur ce PC (même client chez le service)', () => {
    expect(previousPort('http://127.0.0.1:51234/callback')).toBe(51234)
  })
  it('rien sinon', () => {
    expect(previousPort(undefined)).toBeUndefined()
    expect(previousPort('https://exemple.com/callback')).toBeUndefined()
    expect(previousPort('pas une adresse')).toBeUndefined()
  })
})

describe('jeton utilisable', () => {
  const now = 1_000_000_000
  it('sans expiration connue : utilisable', () => expect(tokenUsable({ access_token: 'a', token_type: 'Bearer' }, now)).toBe(true))
  it('expire dans plus de 5 minutes : utilisable', () =>
    expect(tokenUsable({ access_token: 'a', token_type: 'Bearer', expires_at: now + 6 * 60_000 }, now)).toBe(true))
  it('expire dans moins de 5 minutes : à renouveler', () =>
    expect(tokenUsable({ access_token: 'a', token_type: 'Bearer', expires_at: now + 4 * 60_000 }, now)).toBe(false))
  it('aucun jeton', () => expect(tokenUsable(undefined, now)).toBe(false))
})

describe('connexion par compte (faux service OAuth sur 127.0.0.1)', () => {
  let fake: FakeOAuth
  beforeAll(async () => {
    fake = await startFakeOAuth()
  })
  afterAll(async () => {
    await fake.close()
  })

  it('enregistre Compi, obtient un jeton avec PKCE et le garde dans le coffre', async () => {
    const r = await connectOAuth('c1', 'Faux service', fake.mcpUrl)
    expect(r).toEqual({ ok: true })
    const s = loadOAuth('c1')
    expect(s.tokens?.access_token).toMatch(/^at-/)
    expect(s.tokens?.expires_at).toBeGreaterThan(Date.now())
    expect(s.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(s.expired).toBe(false)
    // Enregistrement du client : sans secret, retour sur 127.0.0.1 seulement.
    const reg = JSON.parse(fake.log.find((l) => l.path === '/register')!.body!)
    expect(reg.token_endpoint_auth_method).toBe('none')
    expect(reg.redirect_uris).toEqual([s.redirectUri])
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('le jeton ouvre le serveur MCP', async () => {
    const token = await accessTokenFor('c1', fake.mcpUrl)
    const r = await fetch(fake.mcpUrl, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    })
    expect(r.status).toBe(200)
  })

  it('renouvelle un jeton bientôt expiré, sans ouvrir de page', async () => {
    const before = loadOAuth('c1')
    vault.set('c1', JSON.stringify({ ...before, tokens: { ...before.tokens, expires_at: Date.now() + 60_000 } }))
    const token = await accessTokenFor('c1', fake.mcpUrl)
    expect(token).toMatch(/^at-/)
    expect(token).not.toBe(before.tokens?.access_token)
    expect(fake.log.filter((l) => l.path === '/token' && l.body?.includes('grant_type=refresh_token'))).toHaveLength(1)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('se reconnecter garde le même client (Notion : se réenregistrer laisse l’ancien accès orphelin)', async () => {
    const before = loadOAuth('c1')
    const registrations = fake.log.filter((l) => l.path === '/register').length
    expect(await connectOAuth('c1', 'Faux service', fake.mcpUrl)).toEqual({ ok: true })
    const after = loadOAuth('c1')
    expect(fake.log.filter((l) => l.path === '/register')).toHaveLength(registrations)
    expect(after.redirectUri).toBe(before.redirectUri)
    expect(after.client?.client_id).toBe(before.client?.client_id)
    expect(after.tokens?.access_token).not.toBe(before.tokens?.access_token)
  })

  it('accès retiré par le service : « à reconnecter », toujours sans ouvrir de page', async () => {
    fake.revoke()
    const s = loadOAuth('c1')
    vault.set('c1', JSON.stringify({ ...s, tokens: { ...s.tokens, expires_at: Date.now() - 1000 } }))
    expect(await accessTokenFor('c1', fake.mcpUrl)).toBeNull()
    expect(loadOAuth('c1').expired).toBe(true)
    expect(await accessTokenFor('c1', fake.mcpUrl)).toBeNull()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('refus sur la page du service : message clair, aucun jeton', async () => {
    fake.deny(true)
    const r = await connectOAuth('c2', 'Faux service', fake.mcpUrl)
    fake.deny(false)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/refusé/)
    expect(loadOAuth('c2').tokens).toBeUndefined()
  })

  it('oublier un connecteur efface ses jetons', () => {
    forgetOAuth('c1')
    expect(vault.has('c1')).toBe(false)
  })
})

/** Un port libre sur ce PC (pour l'adresse de retour déclarée chez le faux service). */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:net')
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => resolve(port))
    })
  })
}

describe('application créée à la main chez le service (sans enregistrement automatique)', () => {
  let fake: FakeOAuth
  let port: number
  const redirect = (): string => `http://127.0.0.1:${port}/callback`
  beforeAll(async () => {
    port = await freePort()
    fake = await startFakeOAuth({ registration: false, client: { id: 'cid-123', secret: 's3cret', redirect: redirect() } })
  })
  afterAll(async () => {
    await fake.close()
  })

  it('port de retour : de 1024 à 65535', () => {
    expect(validClientPort(51234)).toBe(true)
    expect(validClientPort(80)).toBe(false)
    expect(validClientPort(70000)).toBe(false)
    expect(validClientPort('51234')).toBe(false)
  })

  it('sans identifiant : message qui dit quoi faire', async () => {
    const r = await connectOAuth('d0', 'Faux Salesforce', fake.mcpUrl)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/Identifiants de ton application/)
  })

  it('avec l’identifiant et le secret : jeton obtenu, sans enregistrement, sur l’adresse déclarée', async () => {
    const r = await connectOAuth('d1', 'Faux Salesforce', fake.mcpUrl, { clientId: 'cid-123', clientSecret: 's3cret', port })
    expect(r).toEqual({ ok: true })
    const s = loadOAuth('d1')
    expect(s.tokens?.access_token).toMatch(/^at-/)
    expect(s.redirectUri).toBe(redirect())
    expect(s.client).toBeUndefined()
    expect(fake.log.some((l) => l.path === '/register')).toBe(false)
    const token = fake.log.filter((l) => l.path === '/token').at(-1)!
    const sent = new URLSearchParams(token.body ?? '')
    expect(sent.get('client_secret') === 's3cret' || /^Basic /.test(token.auth ?? '')).toBe(true)
  })

  it('renouvelle le jeton avec la même application', async () => {
    const s = loadOAuth('d1')
    vault.set('d1', JSON.stringify({ ...s, tokens: { ...s.tokens, expires_at: Date.now() - 1000 } }))
    const token = await accessTokenFor('d1', fake.mcpUrl, { clientId: 'cid-123', clientSecret: 's3cret', port })
    expect(token).toMatch(/^at-/)
    expect(token).not.toBe(s.tokens?.access_token)
  })

  it('mauvais secret : message clair', async () => {
    const r = await connectOAuth('d2', 'Faux Salesforce', fake.mcpUrl, { clientId: 'cid-123', clientSecret: 'faux', port })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(/refuse l’identifiant ou le secret/)
  })

  it('port déclaré déjà pris : pas d’autre port en douce, message clair', async () => {
    const { createServer } = await import('node:net')
    const busy = createServer().listen(port, '127.0.0.1')
    await new Promise((r) => busy.once('listening', r))
    const r = await connectOAuth('d3', 'Faux Salesforce', fake.mcpUrl, { clientId: 'cid-123', clientSecret: 's3cret', port })
    await new Promise((r) => busy.close(r))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.message).toMatch(new RegExp(`port ${port} .*pris`))
  })
})
