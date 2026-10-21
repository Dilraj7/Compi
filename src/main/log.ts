// Journal local : %APPDATA%\Compi\logs\compi.log. Les clés API sont masquées
// avant écriture ; le fichier est remis à zéro au-delà de 1 Mo.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 1024 * 1024
let file = ''

function logFile(): string {
  if (!file) {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    file = join(dir, 'compi.log')
  }
  return file
}

export const redact = (s: string): string => s.replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…')

export function log(level: 'info' | 'warn' | 'error', message: string, detail?: unknown): void {
  const extra = detail === undefined ? '' : ` ${detail instanceof Error ? (detail.stack ?? detail.message) : typeof detail === 'string' ? detail : JSON.stringify(detail)}`
  const line = redact(`${new Date().toISOString()} [${level}] ${message}${extra}`)
  if (level === 'error') console.error(line)
  try {
    const path = logFile()
    try {
      if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.1`)
    } catch {
      // Pas encore de journal.
    }
    appendFileSync(path, `${line}\n`, 'utf8')
  } catch {
    // Le journal ne doit jamais faire planter l'app.
  }
}

export const logPath = (): string => logFile()
