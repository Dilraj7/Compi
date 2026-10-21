// Utilisation de Claude Code (vue Activité) : lecture seule des fichiers de
// session de Claude Code (~/.claude/projects/**/*.jsonl). Compi n'y écrit
// jamais, ne garde que des nombres (jetons, coût, nom du projet) et n'envoie
// rien. Lecture incrémentale : seule la fin ajoutée d'un fichier est relue.

import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import { addTokens, dayKey, hourStart, NO_TOKENS, parseUsageLine, totalTokens, type ClaudeCodeUsage, type UsageRow } from '../../shared/usage'
import { emit } from '../bus'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'

/** On garde 40 jours : la vue montre au plus les 30 derniers. */
const KEEP_MS = 40 * 86_400_000
const STATE_VERSION = 1

interface State {
  version: number
  files: Record<string, { size: number; offset: number }>
  /** Réponses déjà comptées (une réponse est écrite sur plusieurs lignes) : clé → heure. */
  keys: Record<string, number>
  rows: Record<string, UsageRow>
  /** Sessions actives par jour. */
  sessions: Record<string, string[]>
}

const stateFile = (): string => join(app.getPath('userData'), 'usage-claude-code.json')

/** Dossier de Claude Code : CLAUDE_CONFIG_DIR, sinon ~/.claude (COMPI_CLAUDE_DIR pour les tests). */
export function claudeDir(): string {
  return process.env.COMPI_CLAUDE_DIR || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

let state: State | null = null
let scanning: Promise<void> | null = null
let lastScan = 0
let lastError: string | undefined
let timer: NodeJS.Timeout | null = null

function load(): State {
  if (state) return state
  const raw = readJson<State | null>(stateFile(), null)
  state = raw && raw.version === STATE_VERSION ? raw : { version: STATE_VERSION, files: {}, keys: {}, rows: {}, sessions: {} }
  return state
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number): void => {
    let entries
    try {
      entries = readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory() && depth < 3) walk(p, depth + 1)
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p)
    }
  }
  walk(dir, 0)
  return out
}

/** Lit un fichier depuis `offset` ; renvoie le nouvel offset (jusqu'à la dernière ligne complète). */
async function readFrom(file: string, offset: number, onLine: (line: string) => void): Promise<number> {
  let pos = offset
  let rest = ''
  let lines = 0
  const stream = createReadStream(file, {
    start: offset,
    encoding: 'utf8',
    highWaterMark: 256 * 1024
  })
  for await (const chunk of stream as AsyncIterable<string>) {
    const text = rest + chunk
    let start = 0
    let nl = text.indexOf('\n', start)
    while (nl !== -1) {
      const line = text.slice(start, nl)
      pos += Buffer.byteLength(line, 'utf8') + 1
      onLine(line)
      start = nl + 1
      nl = text.indexOf('\n', start)
      // Laisser respirer le processus principal pendant un long premier passage.
      if (++lines % 4000 === 0) await new Promise((r) => setImmediate(r))
    }
    rest = text.slice(start)
  }
  // Dernière ligne sans retour à la ligne : comptée si elle est complète, sinon
  // (en cours d'écriture) relue la prochaine fois.
  if (rest.trim()) {
    try {
      JSON.parse(rest)
      onLine(rest)
      pos += Buffer.byteLength(rest, 'utf8')
    } catch {
      // incomplète
    }
  }
  return pos
}

function addRecord(s: State, line: string, now: number): void {
  const rec = parseUsageLine(line)
  if (!rec || rec.at < now - KEEP_MS || s.keys[rec.key] !== undefined) return
  const hour = hourStart(rec.at)
  s.keys[rec.key] = hour
  const id = `${hour}|${rec.model}|${rec.project}`
  const row = s.rows[id] ?? {
    hour,
    model: rec.model,
    project: rec.project,
    tokens: NO_TOKENS,
    cost: 0,
    unpriced: 0,
    messages: 0
  }
  row.tokens = addTokens(row.tokens, rec.tokens)
  if (rec.cost === null) row.unpriced += totalTokens(rec.tokens)
  else row.cost += rec.cost
  row.messages += 1
  s.rows[id] = row
  if (rec.session) {
    const day = dayKey(rec.at)
    const list = (s.sessions[day] ??= [])
    if (!list.includes(rec.session)) list.push(rec.session)
  }
}

function prune(s: State, now: number): void {
  const since = now - KEEP_MS
  for (const [k, h] of Object.entries(s.keys)) if (h < since) delete s.keys[k]
  for (const [k, r] of Object.entries(s.rows)) if (r.hour < since) delete s.rows[k]
  const oldest = dayKey(since)
  for (const d of Object.keys(s.sessions)) if (d < oldest) delete s.sessions[d]
}

async function scan(): Promise<void> {
  const s = load()
  const dir = join(claudeDir(), 'projects')
  if (!existsSync(dir)) return
  const now = Date.now()
  const files = listFiles(dir)
  for (const file of files) {
    let size: number
    let mtime: number
    try {
      const st = statSync(file)
      size = st.size
      mtime = st.mtimeMs
    } catch {
      continue
    }
    const known = s.files[file]
    // Fichier ancien jamais lu : rien dans les 40 derniers jours.
    if (!known && mtime < now - KEEP_MS) {
      s.files[file] = { size, offset: size }
      continue
    }
    if (known && known.size === size && known.offset >= size) continue
    // Fichier raccourci ou remplacé : relu depuis le début (les doublons sont ignorés).
    const from = known && known.offset <= size ? known.offset : 0
    try {
      const offset = await readFrom(file, from, (line) => addRecord(s, line, now))
      s.files[file] = { size, offset }
    } catch (e) {
      log('warn', `utilisation Claude Code : ${file} illisible`, (e as Error).message)
    }
  }
  for (const f of Object.keys(s.files)) if (!files.includes(f)) delete s.files[f]
  prune(s, now)
  writeJson(stateFile(), s)
}

export function claudeCodeUsage(): ClaudeCodeUsage {
  const s = load()
  const sessionsByDay: Record<string, number> = {}
  for (const [d, list] of Object.entries(s.sessions)) sessionsByDay[d] = list.length
  return {
    available: existsSync(join(claudeDir(), 'projects')),
    scannedAt: lastScan || undefined,
    scanning: Boolean(scanning) && !lastScan,
    rows: Object.values(s.rows).sort((a, b) => a.hour - b.hour),
    sessionsByDay,
    error: lastError
  }
}

/** Relit les fichiers modifiés (une fois par minute au plus, sauf `force`). */
export function refreshClaudeCodeUsage(force = false): Promise<void> {
  if (scanning) return scanning
  if (!force && Date.now() - lastScan < 60_000) return Promise.resolve()
  scanning = scan()
    .then(() => {
      lastError = undefined
    })
    .catch((e) => {
      lastError = 'Lecture impossible pour l’instant.'
      log('warn', 'utilisation Claude Code', (e as Error).message)
    })
    .finally(() => {
      lastScan = Date.now()
      scanning = null
      emit(IPC.usageChanged, claudeCodeUsage())
    })
  emit(IPC.usageChanged, claudeCodeUsage())
  return scanning
}

/** Premier passage 20 s après le démarrage, puis toutes les 10 minutes. */
export function startUsageWatch(): void {
  if (timer) return
  timer = setTimeout(function tick() {
    void refreshClaudeCodeUsage(true)
    timer = setTimeout(tick, 10 * 60_000)
  }, 20_000)
}

export function stopUsageWatch(): void {
  if (timer) clearTimeout(timer)
  timer = null
}

/** Tests : oublie l'état en mémoire. */
export function resetClaudeCodeUsageForTests(): void {
  state = null
  scanning = null
  lastScan = 0
  lastError = undefined
}
