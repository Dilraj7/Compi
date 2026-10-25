// Connecteurs lancés par « npx -y paquet » : une fois le paquet dans le cache de npx, Compi
// lance directement son serveur avec node. Sous Windows, npx garde sinon ouverts, pour
// chaque connecteur, deux cmd.exe et un node (~35 Mo) qui ne servent qu'à lancer le
// serveur, et il interroge le registre npm à chaque démarrage. Paquet absent du cache,
// incomplet ou forme inhabituelle : npx, comme avant. Sans Electron : testé dans
// tests/npxDirect.test.ts.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join, resolve, sep } from 'node:path'

interface PackageJson {
  name?: string
  version?: string
  bin?: string | Record<string, string>
  dependencies?: Record<string, string>
}

const readJson = (file: string): PackageJson | null => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as PackageJson
  } catch {
    return null
  }
}

/** « -y @scope/paquet@1.2.3 --opt » → le paquet, sa version exacte et les arguments du serveur ; autre forme : null. */
export function parseNpx(args: string[]): { name: string; version?: string; rest: string[] } | null {
  let i = 0
  while (i < args.length && (args[i] === '-y' || args[i] === '--yes')) i++
  const spec = args[i]
  // Autre option de npx (-p, --package, -c…) : on laisse npx faire.
  if (!spec || spec.startsWith('-')) return null
  const m = /^(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*|[a-z0-9][\w.-]*)(?:@(.+))?$/i.exec(spec)
  if (!m) return null
  const v = m[2]
  if (v && v !== 'latest' && !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(v)) return null
  return { name: m[1], version: v && v !== 'latest' ? v : undefined, rest: args.slice(i + 1) }
}

/** Script lancé par npx : le seul `bin`, ou celui qui porte le nom du paquet. */
export function binScript(pkg: PackageJson, name: string): string | null {
  if (typeof pkg.bin === 'string') return pkg.bin
  if (!pkg.bin || typeof pkg.bin !== 'object') return null
  const entries = Object.entries(pkg.bin)
  if (entries.length === 1) return entries[0][1]
  return pkg.bin[name.split('/').pop()!] ?? null
}

/** Serveur déjà installé par npx (installation terminée) : chemin de son script, le plus récent d'abord. */
export function findCached(cacheDir: string, name: string, version?: string): string | null {
  const root = join(cacheDir, '_npx')
  let dirs: string[]
  try {
    dirs = readdirSync(root)
  } catch {
    return null
  }
  let best: { script: string; at: number } | null = null
  for (const dir of dirs) {
    const base = join(root, dir)
    const deps = readJson(join(base, 'package.json'))?.dependencies
    if (!deps || Object.keys(deps).length !== 1 || !(name in deps)) continue
    // npm écrit ce fichier à la fin d'une installation réussie.
    if (!existsSync(join(base, 'node_modules', '.package-lock.json'))) continue
    const pkgDir = join(base, 'node_modules', ...name.split('/'))
    const pkg = readJson(join(pkgDir, 'package.json'))
    if (!pkg || pkg.name !== name || (version && pkg.version !== version)) continue
    const rel = binScript(pkg, name)
    if (!rel) continue
    const script = resolve(pkgDir, rel)
    // Le script reste dans le paquet.
    if (!script.startsWith(pkgDir + sep) || !existsSync(script)) continue
    const at = statSync(join(base, 'package.json')).mtimeMs
    if (!best || at > best.at) best = { script, at }
  }
  return best?.script ?? null
}

/** node.exe trouvé dans le PATH (celui que npx aurait utilisé). */
export function nodeOnPath(pathVar = process.env.PATH ?? process.env.Path ?? ''): string | null {
  for (const dir of pathVar.split(delimiter)) {
    const d = dir.trim().replace(/^"|"$/g, '')
    if (!d) continue
    const exe = join(d, process.platform === 'win32' ? 'node.exe' : 'node')
    if (existsSync(exe)) return exe
  }
  return null
}

const npmCache = (): string =>
  process.env.npm_config_cache ||
  (process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'npm-cache') : join(homedir(), '.npm'))

/** `npx -y paquet …` → `node <script du paquet> …` si le paquet est déjà dans le cache ; sinon null (npx). */
export function npxDirect(command: string, args: string[] = []): { command: string; args: string[] } | null {
  if (process.platform !== 'win32' || command.toLowerCase() !== 'npx' || process.env.COMPI_NPX_DIRECT === '0') return null
  const p = parseNpx(args)
  if (!p) return null
  const node = nodeOnPath()
  const script = node && findCached(npmCache(), p.name, p.version)
  return node && script ? { command: node, args: [script, ...p.rest] } : null
}
