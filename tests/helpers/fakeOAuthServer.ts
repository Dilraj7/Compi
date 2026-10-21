// Faux serveur MCP protégé par OAuth 2.1, sur 127.0.0.1 : métadonnées,
// enregistrement dynamique du client, page d'accord (qui redirige tout de
// suite), jetons avec PKCE, et un point MCP qui exige le jeton.

import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'

export interface FakeOAuth {
  base: string
  mcpUrl: string
  /** Requêtes reçues, pour vérifier ce que Compi envoie. */
  log: Array<{ method: string; path: string; body?: string; auth?: string }>
  /** Refuse le renouvellement (jeton retiré par le service). */
  revoke(): void
  /** Refuse l'accord (l'utilisateur clique « Refuser »). */
  deny(on: boolean): void
  close(): Promise<void>
}

const b64url = (b: Buffer): string => b.toString('base64url')

export async function startFakeOAuth(): Promise<FakeOAuth> {
  const clients = new Map<string, string[]>()
  const codes = new Map<string, { challenge: string; clientId: string; redirect: string }>()
  const access = new Set<string>()
  const refresh = new Set<string>()
  const log: FakeOAuth['log'] = []
  let revoked = false
  let denied = false

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      const u = new URL(req.url ?? '/', base)
      log.push({ method: req.method ?? '', path: u.pathname, body: body || undefined, auth: req.headers.authorization })
      const json = (status: number, data: unknown, headers: Record<string, string> = {}): void => {
        res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(data))
      }

      if (u.pathname === '/.well-known/oauth-protected-resource/mcp' || u.pathname === '/.well-known/oauth-protected-resource') {
        return json(200, { resource: `${base}/mcp`, authorization_servers: [base] })
      }
      if (u.pathname === '/.well-known/oauth-authorization-server') {
        return json(200, {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none']
        })
      }
      if (u.pathname === '/register' && req.method === 'POST') {
        const meta = JSON.parse(body) as { redirect_uris: string[] }
        const id = `client-${randomBytes(4).toString('hex')}`
        clients.set(id, meta.redirect_uris)
        return json(201, { ...meta, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000) })
      }
      if (u.pathname === '/authorize') {
        const p = u.searchParams
        const redirect = p.get('redirect_uri') ?? ''
        const clientId = p.get('client_id') ?? ''
        if (!clients.get(clientId)?.includes(redirect) || p.get('code_challenge_method') !== 'S256' || !p.get('code_challenge')) {
          return json(400, { error: 'invalid_request' })
        }
        const back = new URL(redirect)
        back.searchParams.set('state', p.get('state') ?? '')
        if (denied) {
          back.searchParams.set('error', 'access_denied')
        } else {
          const code = b64url(randomBytes(12))
          codes.set(code, { challenge: p.get('code_challenge')!, clientId, redirect })
          back.searchParams.set('code', code)
        }
        res.writeHead(302, { location: back.toString() }).end()
        return
      }
      if (u.pathname === '/token' && req.method === 'POST') {
        const p = new URLSearchParams(body)
        const issue = (): void => {
          const at = `at-${b64url(randomBytes(8))}`
          const rt = `rt-${b64url(randomBytes(8))}`
          access.add(at)
          refresh.add(rt)
          json(200, { access_token: at, refresh_token: rt, token_type: 'Bearer', expires_in: 3600 })
        }
        if (p.get('grant_type') === 'authorization_code') {
          const c = codes.get(p.get('code') ?? '')
          codes.delete(p.get('code') ?? '')
          const verifier = p.get('code_verifier') ?? ''
          if (!c || c.redirect !== p.get('redirect_uri') || b64url(createHash('sha256').update(verifier).digest()) !== c.challenge) {
            return json(400, { error: 'invalid_grant' })
          }
          return issue()
        }
        if (p.get('grant_type') === 'refresh_token') {
          if (revoked || !refresh.has(p.get('refresh_token') ?? '')) return json(400, { error: 'invalid_grant' })
          refresh.delete(p.get('refresh_token') ?? '')
          return issue()
        }
        return json(400, { error: 'unsupported_grant_type' })
      }
      if (u.pathname === '/mcp') {
        const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
        if (!token || !access.has(token)) {
          return json(401, { error: 'invalid_token' }, { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` })
        }
        const msg = body ? (JSON.parse(body) as { id?: number; method: string }) : { method: '' }
        if (msg.method === 'initialize') {
          return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'faux-service', version: '1.0.0' } } })
        }
        if (msg.method === 'tools/list') {
          return json(200, { jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'list_pages', description: 'Liste les pages', inputSchema: { type: 'object', properties: {} } }] } })
        }
        if (msg.id === undefined) return res.writeHead(202).end()
        return json(200, { jsonrpc: '2.0', id: msg.id, result: {} })
      }
      json(404, { error: 'not_found' })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    base,
    mcpUrl: `${base}/mcp`,
    log,
    revoke: () => (revoked = true),
    deny: (on) => (denied = on),
    close: () => new Promise((r) => server.close(() => r()))
  }
}
