// Connecteurs MCP choisis par l'utilisateur : conversion vers la config de
// l'Agent SDK, et test de connexion (liste des outils exposés).

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import type { ConnectorAuthState, ConnectorConfig, ConnectorTestResult } from '../../shared/types'
import { hostEnv } from '../brains/brain'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'
import { accessTokenFor, loadOAuth } from './oauth'

/** Lanceurs de paquets qui, sous Windows, sont des scripts .cmd à passer par cmd.exe. */
const CMD_SHIMS = new Set(['npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx', 'uvx'])

export function resolveCommand(command: string, args: string[] = []): { command: string; args: string[] } {
  if (process.platform === 'win32' && CMD_SHIMS.has(command.toLowerCase())) {
    return { command: 'cmd', args: ['/c', command, ...args] }
  }
  return { command, args }
}

/** Identifiant MCP stable et lisible : sert de préfixe aux outils (`mcp__<clé>__outil`). */
export function serverKey(c: ConnectorConfig): string {
  const slug = c.name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'connecteur'}-${c.id.slice(0, 4)}`
}

/** En-têtes d'un connecteur distant : secrets saisis, ou jeton de la connexion par compte. */
async function httpHeaders(c: ConnectorConfig): Promise<Record<string, string> | null> {
  const headers = secrets.getConnectorSecrets(c.id, c.headerKeys)
  if (c.auth !== 'oauth' || !c.url) return headers
  const token = await accessTokenFor(c.id, c.url)
  return token ? { ...headers, Authorization: `Bearer ${token}` } : null
}

async function toSdkConfig(c: ConnectorConfig): Promise<McpServerConfig | null> {
  if (c.transport === 'stdio') {
    if (!c.command) return null
    const { command, args } = resolveCommand(c.command, c.args)
    return { type: 'stdio', command, args, env: secrets.getConnectorSecrets(c.id, c.envKeys) }
  }
  if (!c.url) return null
  const headers = await httpHeaders(c)
  // Connexion par compte expirée : le connecteur est ignoré (l'interface propose de se reconnecter).
  return headers ? { type: 'http', url: c.url, headers } : null
}

/** Serveurs MCP actifs, au format `options.mcpServers` de l'Agent SDK (jetons renouvelés si besoin). */
export async function buildUserMcpServers(): Promise<Record<string, McpServerConfig>> {
  const out: Record<string, McpServerConfig> = {}
  const active = settings.get().connectors.filter((c) => c.enabled)
  const configs = await Promise.all(active.map((c) => toSdkConfig(c).catch(() => null)))
  active.forEach((c, i) => {
    const cfg = configs[i]
    if (cfg) out[serverKey(c)] = cfg
  })
  return out
}

/** État des connexions par compte, pour l'interface. */
export function connectorAuthStates(): Record<string, ConnectorAuthState> {
  const out: Record<string, ConnectorAuthState> = {}
  for (const c of settings.get().connectors) {
    if (c.auth !== 'oauth') continue
    const s = loadOAuth(c.id)
    out[c.id] = { connected: Boolean(s.tokens?.access_token) && !s.expired, ...(s.expired ? { expired: true } : {}) }
  }
  return out
}

type McpClient = InstanceType<(typeof import('@modelcontextprotocol/sdk/client/index.js'))['Client']>

/** Erreur de connexion à un connecteur, avec un message pour l'utilisateur. */
export class ConnectorError extends Error {
  constructor(
    message: string,
    readonly needsLogin = false
  ) {
    super(message)
  }
}

/**
 * Ouvre une session avec le serveur MCP du connecteur, exécute `fn`, puis ferme.
 * Sert au test de connexion et aux sources de l'agenda (sans aucun cerveau).
 */
export async function withConnector<T>(id: string, fn: (client: McpClient, timeout: Promise<never>) => Promise<T>, ms = 20_000): Promise<T> {
  const c = settings.get().connectors.find((x) => x.id === id)
  if (!c) throw new ConnectorError('Connecteur introuvable.')
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const client = new Client({ name: 'compi', version: '0.1.0' })
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorError(`Délai dépassé (${Math.round(ms / 1000)} s).`)), ms)
  })
  timeout.catch(() => undefined)
  try {
    if (c.transport === 'stdio') {
      if (!c.command) throw new ConnectorError('Commande manquante.')
      const missing = await missingRuntime(c.command)
      if (missing) throw new ConnectorError(missing)
      const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
      const { command, args } = resolveCommand(c.command, c.args)
      const env = { ...(hostEnv(process.env) as Record<string, string>), ...secrets.getConnectorSecrets(c.id, c.envKeys) }
      await Promise.race([client.connect(new StdioClientTransport({ command, args, env, stderr: 'ignore' })), timeout])
    } else {
      if (!c.url) throw new ConnectorError('URL manquante.')
      const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js')
      const headers = await httpHeaders(c)
      if (!headers) throw new ConnectorError('La connexion à ce service a expiré : clique sur « Se reconnecter ».', true)
      await Promise.race([client.connect(new StreamableHTTPClientTransport(new URL(c.url), { requestInit: { headers } })), timeout])
    }
    return await fn(client, timeout)
  } catch (e) {
    if (e instanceof ConnectorError) throw e
    const msg = (e as Error).message
    if (/\b401\b|unauthori[sz]ed|invalid_token/i.test(msg)) {
      throw c.auth === 'oauth'
        ? new ConnectorError('Accès refusé par le service : clique sur « Se reconnecter ».', true)
        : new ConnectorError('Accès refusé (401). Ce service demande peut-être une connexion par compte : clique sur « Se connecter ».', c.transport === 'http')
    }
    throw new ConnectorError(`Échec : ${msg}`)
  } finally {
    clearTimeout(timer)
    await client.close().catch(() => undefined)
  }
}

/** Se connecte au serveur MCP et liste ses outils, sans appeler Claude. */
export async function testConnector(id: string): Promise<ConnectorTestResult> {
  try {
    const names = await withConnector(id, async (client, timeout) => (await Promise.race([client.listTools(), timeout])).tools.map((t) => t.name))
    return { ok: true, message: `Connecté : ${names.length} outil${names.length > 1 ? 's' : ''} disponible${names.length > 1 ? 's' : ''}.`, tools: names }
  } catch (e) {
    const err = e as ConnectorError
    return { ok: false, message: err.message, ...(err.needsLogin ? { needsLogin: true } : {}) }
  }
}

const RUNTIMES: Record<string, string> = {
  npx: 'Node.js n’est pas installé : télécharge-le sur nodejs.org (version LTS), puis redémarre Compi.',
  node: 'Node.js n’est pas installé : télécharge-le sur nodejs.org (version LTS), puis redémarre Compi.',
  uvx: 'uv (pour Python) n’est pas installé : voir docs.astral.sh/uv, puis redémarre Compi.',
  docker: 'Docker n’est pas installé ou pas démarré.'
}

/** Message d'aide si la commande d'un connecteur local n'est pas installée sur le PC. */
async function missingRuntime(command: string): Promise<string | null> {
  const name = command.toLowerCase().replace(/\.(cmd|exe)$/, '')
  if (!RUNTIMES[name]) return null
  const { execFile } = await import('node:child_process')
  const found = await new Promise<boolean>((resolve) =>
    execFile(process.platform === 'win32' ? 'where' : 'which', [name], { windowsHide: true }, (err) => resolve(!err))
  )
  return found ? null : RUNTIMES[name]
}
