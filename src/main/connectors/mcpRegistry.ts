// Recherche dans le registre officiel des serveurs MCP
// (registry.modelcontextprotocol.io). Chaque résultat est converti en
// brouillon de connecteur que l'utilisateur vérifie avant d'enregistrer.

import type { ConnectorConfig, RegistryEntry } from '../../shared/types'

const REGISTRY = 'https://registry.modelcontextprotocol.io/v0/servers'

interface RegistryInput {
  name?: string
  description?: string
  isRequired?: boolean
  isSecret?: boolean
  value?: string
  default?: string
  valueHint?: string
  type?: string
}

interface RegistryPackage {
  registryType: string
  identifier: string
  version?: string
  runtimeHint?: string
  transport?: { type: string }
  packageArguments?: RegistryInput[]
  environmentVariables?: RegistryInput[]
}

export interface RegistryServer {
  name: string
  title?: string
  description?: string
  version?: string
  remotes?: Array<{ type: string; url: string; headers?: RegistryInput[] }>
  packages?: RegistryPackage[]
}

const hintOf = (i: RegistryInput): string => [i.value, i.description, i.default && `défaut : ${i.default}`].filter(Boolean).join(' · ').slice(0, 140)

/** Nom lisible : « io.github.org/notion-mcp » → « notion-mcp ». */
function displayName(s: RegistryServer): string {
  return s.title || s.name.split('/').pop() || s.name
}

function packageArgs(p: RegistryPackage): string[] {
  const out: string[] = []
  for (const a of p.packageArguments ?? []) {
    const value = a.value ?? a.default ?? `<${a.valueHint ?? a.name ?? 'valeur'}>`
    if (a.type === 'named' && a.name) out.push(a.name, value)
    else out.push(value)
  }
  return out
}

/** Convertit une entrée du registre en brouillon de connecteur (null si non pris en charge). */
export function toRegistryEntry(s: RegistryServer): RegistryEntry | null {
  const base = { id: s.name, title: displayName(s), description: s.description ?? '' }
  const config = (patch: Partial<ConnectorConfig>): ConnectorConfig => ({
    id: '',
    name: displayName(s),
    enabled: true,
    transport: 'stdio',
    templateId: `registry:${s.name}`,
    ...patch
  })

  const remote = s.remotes?.find((r) => r.type === 'streamable-http')
  if (remote) {
    const headers = (remote.headers ?? []).filter((h) => h.name)
    return {
      ...base,
      kind: 'remote',
      config: config({ transport: 'http', url: remote.url }),
      secrets: headers.map((h) => h.name!),
      hints: Object.fromEntries(headers.map((h) => [h.name!, hintOf(h)]))
    }
  }

  const npm = s.packages?.find((p) => p.registryType === 'npm' && (p.transport?.type ?? 'stdio') === 'stdio')
  const pypi = s.packages?.find((p) => p.registryType === 'pypi' && (p.transport?.type ?? 'stdio') === 'stdio')
  const pkg = npm ?? pypi
  if (!pkg) return null
  const env = (pkg.environmentVariables ?? []).filter((e) => e.name)
  const spec = pkg.version ? `${pkg.identifier}@${pkg.version}` : pkg.identifier
  return {
    ...base,
    kind: npm ? 'npm' : 'python',
    requirement: npm ? 'Demande Node.js (nodejs.org)' : 'Demande uv pour Python (docs.astral.sh/uv)',
    config: npm
      ? config({ command: 'npx', args: ['-y', spec, ...packageArgs(pkg)] })
      : config({ command: 'uvx', args: [spec, ...packageArgs(pkg)] }),
    secrets: env.map((e) => e.name!),
    hints: Object.fromEntries(env.map((e) => [e.name!, hintOf(e)]))
  }
}

export async function searchRegistry(query: string): Promise<RegistryEntry[]> {
  const q = query.trim()
  if (!q) return []
  const url = `${REGISTRY}?search=${encodeURIComponent(q)}&limit=40&version=latest`
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Le registre MCP a répondu ${res.status}.`)
  const data = (await res.json()) as { servers?: Array<{ server: RegistryServer }> }
  const seen = new Set<string>()
  const out: RegistryEntry[] = []
  for (const { server } of data.servers ?? []) {
    if (seen.has(server.name)) continue
    seen.add(server.name)
    const entry = toRegistryEntry(server)
    if (entry) out.push(entry)
  }
  return out.slice(0, 25)
}
