// Ajout / retrait des hooks Compi dans ~/.claude/settings.json.
// Les fonctions de fusion sont pures (testées) ; les écritures disque font
// toujours une sauvegarde préalable et ne touchent à aucune autre clé.

import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { HooksPreview } from '../../shared/types'

/** Chemin des URL de hooks Compi : `http://127.0.0.1:<port>/compi/<jeton>/<événement>`. */
export const HOOK_PATH_PREFIX = '/compi/'

export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
  'Notification',
  'Stop',
  'SessionEnd'
] as const

/** Événements qui attendent une réponse de l'utilisateur (délai long). */
const BLOCKING = new Set<string>(['PermissionRequest', 'PreToolUse'])
/** Événements liés à un outil : `matcher` sur tous les outils. */
const TOOL_EVENTS = new Set<string>(['PreToolUse', 'PostToolUse', 'PermissionRequest'])

export interface HookInstallConfig {
  port: number
  token: string
  permissionTimeoutSec: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

const COMPI_URL = /^http:\/\/127\.0\.0\.1:\d+\/compi\//

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isCompiHook(h: any): boolean {
  return h?.type === 'http' && typeof h.url === 'string' && COMPI_URL.test(h.url)
}

/** Retire tous les hooks Compi, en préservant le reste du fichier. */
export function removeCompiHooks(settings: Json): Json {
  const out: Json = structuredClone(settings ?? {})
  if (!out.hooks || typeof out.hooks !== 'object') return out
  for (const event of Object.keys(out.hooks)) {
    const groups = Array.isArray(out.hooks[event]) ? out.hooks[event] : []
    const kept = groups
      .map((g: Json) => ({ ...g, hooks: Array.isArray(g?.hooks) ? g.hooks.filter((h: Json) => !isCompiHook(h)) : g?.hooks }))
      .filter((g: Json) => !Array.isArray(g.hooks) || g.hooks.length > 0)
    if (kept.length) out.hooks[event] = kept
    else delete out.hooks[event]
  }
  if (!Object.keys(out.hooks).length) delete out.hooks
  return out
}

/** Ajoute (ou remplace) les hooks Compi. Idempotent. */
export function mergeCompiHooks(settings: Json, cfg: HookInstallConfig): Json {
  const out = removeCompiHooks(settings)
  out.hooks ??= {}
  for (const event of HOOK_EVENTS) {
    const group: Json = {
      hooks: [
        {
          type: 'http',
          url: `http://127.0.0.1:${cfg.port}${HOOK_PATH_PREFIX}${cfg.token}/${event}`,
          timeout: BLOCKING.has(event) ? cfg.permissionTimeoutSec + 15 : 10
        }
      ]
    }
    if (TOOL_EVENTS.has(event)) group.matcher = '*'
    out.hooks[event] = [...(Array.isArray(out.hooks[event]) ? out.hooks[event] : []), group]
  }
  return out
}

export function hasCompiHooks(settings: Json): boolean {
  return JSON.stringify(removeCompiHooks(settings)) !== JSON.stringify(settings ?? {})
}

// ─── Disque ──────────────────────────────────────────────────────────────────

export function claudeSettingsPath(): string {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  return join(base, 'settings.json')
}

function readSettings(path: string): { exists: boolean; data: Json } {
  if (!existsSync(path)) return { exists: false, data: {} }
  const raw = readFileSync(path, 'utf8')
  if (!raw.trim()) return { exists: true, data: {} }
  // Volontairement strict : si le fichier n'est pas du JSON valide, on n'y touche pas.
  return { exists: true, data: JSON.parse(raw) as Json }
}

function backup(path: string): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(path, `${path}.compi-backup-${stamp}`)
}

export function previewHooks(cfg: HookInstallConfig, path = claudeSettingsPath()): HooksPreview {
  const { exists, data } = readSettings(path)
  return {
    settingsPath: path,
    exists,
    before: JSON.stringify(data, null, 2),
    after: JSON.stringify(mergeCompiHooks(data, cfg), null, 2)
  }
}

export function installHooks(cfg: HookInstallConfig, path = claudeSettingsPath()): void {
  const { exists, data } = readSettings(path)
  if (exists) backup(path)
  else mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(mergeCompiHooks(data, cfg), null, 2)}\n`, 'utf8')
}

export function uninstallHooks(path = claudeSettingsPath()): void {
  const { exists, data } = readSettings(path)
  if (!exists || !hasCompiHooks(data)) return
  backup(path)
  writeFileSync(path, `${JSON.stringify(removeCompiHooks(data), null, 2)}\n`, 'utf8')
}
