import { isAbsolute } from 'node:path'
import { settings } from '../store/settings'
import { isInside } from './docSearch'

/**
 * Dossiers que Compi lit sans demander : ceux confiés dans Connecteurs ›
 * Dossiers, et ceux des connecteurs MCP « Fichiers » déjà configurés.
 */
export function allowedFolders(): string[] {
  const s = settings.get()
  const fromConnectors = s.connectors
    .filter((c) => c.enabled && c.transport === 'stdio' && (c.templateId === 'filesystem' || (c.args ?? []).some((a) => a.includes('server-filesystem'))))
    .flatMap((c) => (c.args ?? []).filter((a) => isAbsolute(a)))
  return [...new Set([...s.folders, ...fromConnectors])]
}

export const insideAny = (path: string, roots: string[]): boolean => Boolean(path) && roots.some((r) => isInside(path, r))
