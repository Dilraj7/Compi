// Outils des connecteurs qui détruisent des données (mise à la corbeille, suppression),
// et ressources qu'on peut lire sans carte (documentation du service). Fonctions pures,
// testées dans tests/connectorRisk.test.ts.

import { words } from './agenda'
import { shortToolName } from './localTools'

/** Ce que le serveur MCP déclare d'un outil (annotations lues par le moteur). */
export interface ToolHints {
  destructive?: boolean
  readOnly?: boolean
}

/** Outil d'un connecteur branché par l'utilisateur (pas un outil de Compi ni du moteur). */
export function isConnectorTool(name: string, core = 'compi'): boolean {
  const key = /^mcp__(.+?)__/.exec(name)?.[1]
  return Boolean(key && key !== core)
}

/** Verbes d'un nom d'outil qui détruisent : « notion-delete-pages », « trashItem », « remove_label »… */
const DESTRUCTIVE_VERBS = new Set(['delete', 'trash', 'remove', 'destroy', 'purge', 'erase', 'wipe'])

/**
 * Outil de connecteur qui supprime ou détruit : le service le déclare (Notion le fait
 * pour ses suppressions), ou son nom le dit (beaucoup de services ne déclarent rien).
 * Compi demande alors l'accord à chaque fois, sans « Toujours », et jamais en routine.
 */
export function destructiveTool(name: string, hints?: ToolHints, core = 'compi'): boolean {
  if (!isConnectorTool(name, core)) return false
  return hints?.destructive === true || words(shortToolName(name)).some((w) => DESTRUCTIVE_VERBS.has(w))
}

/**
 * Ressource de documentation d'un service (« notion://docs/enhanced-markdown-spec ») :
 * le mode d'emploi de ses outils, pas des données de l'utilisateur. Lue sans carte.
 */
export function docsResource(uri: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\/docs\/[^\s]+$/i.test(uri.trim())
}
