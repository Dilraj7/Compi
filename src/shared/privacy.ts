// Garde-fou de confidentialité : quelles données personnelles un cerveau en
// ligne (Claude ou un autre service) peut recevoir. Avec un cerveau local,
// rien ne quitte le PC et rien n'est demandé. Fonctions pures, testées dans
// tests/privacy.test.ts.

import type { ProviderId } from './types'

export type PrivacyCategory = 'screen' | 'files' | 'mail' | 'calendar' | 'clipboard' | 'window' | 'memory' | 'messages'
export type PrivacyChoice = 'ask' | 'always' | 'never'
export type PrivacySettings = Record<PrivacyCategory, PrivacyChoice>

export const DEFAULT_PRIVACY: PrivacySettings = {
  screen: 'ask',
  files: 'ask',
  mail: 'ask',
  calendar: 'ask',
  clipboard: 'ask',
  window: 'ask',
  memory: 'ask',
  messages: 'ask'
}

/** `noAlways` : pas de « Toujours » possible, une carte à chaque fois. */
export const PRIVACY_CATEGORIES: { id: PrivacyCategory; label: string; what: string; noAlways?: boolean }[] = [
  { id: 'screen', label: 'Écran', what: 'captures et texte lu à l’écran' },
  { id: 'files', label: 'Fichiers', what: 'contenu de tes documents et résultats de recherche' },
  { id: 'mail', label: 'E-mails', what: 'expéditeurs, objets et contenu de tes e-mails' },
  { id: 'calendar', label: 'Agenda', what: 'tes rendez-vous et leurs détails' },
  { id: 'clipboard', label: 'Presse-papier', what: 'ce que tu as copié' },
  { id: 'window', label: 'Fenêtres', what: 'titres des fenêtres ouvertes et état du PC' },
  { id: 'memory', label: 'Mémoire', what: 'ce que Compi a retenu sur toi' },
  { id: 'messages', label: 'Messages', what: 'tes messages reçus (WhatsApp, SMS…) : une carte à chaque fois', noAlways: true }
]

/** Libellé court pour la puce « Envoyé à … ». */
export const CATEGORY_SENT_LABEL: Record<PrivacyCategory, string> = {
  screen: 'écran',
  files: 'fichiers',
  mail: 'e-mails',
  calendar: 'agenda',
  clipboard: 'presse-papier',
  window: 'fenêtres',
  memory: 'mémoire',
  messages: 'messages'
}

const compi = (t: string): string => `mcp__compi__${t}`

/** Outils qui transmettent des données personnelles au modèle, par catégorie. */
export const TOOL_CATEGORY: Record<string, PrivacyCategory> = {
  [compi('screen_capture')]: 'screen',
  [compi('read_screen_text')]: 'screen',
  [compi('clipboard_read')]: 'clipboard',
  [compi('clipboard_history')]: 'clipboard',
  [compi('messages_recent')]: 'messages',
  [compi('read_document')]: 'files',
  [compi('search_documents')]: 'files',
  [compi('search_files')]: 'files',
  [compi('folder_inventory')]: 'files',
  Read: 'files',
  Glob: 'files',
  Grep: 'files',
  [compi('active_window')]: 'window',
  [compi('list_windows')]: 'window',
  [compi('windows_status')]: 'window',
  [compi('now_playing')]: 'window',
  [compi('memory_search')]: 'memory',
  [compi('mail_search')]: 'mail',
  [compi('mail_read')]: 'mail',
  [compi('calendar_events')]: 'calendar'
}

/**
 * Outils qui renvoient un contenu écrit par d'autres (e-mails, invitations) : il peut
 * contenir des consignes piégées. Après eux, les outils « sortants » demandent un OK.
 */
export const EXTERNAL_CONTENT_TOOLS = [compi('mail_search'), compi('mail_read'), compi('calendar_events')]

/** Outils par lesquels des données peuvent quitter le PC, hors cerveau : pages web, liens, connecteurs, commandes. */
export function isOutbound(toolName: string): boolean {
  if (['WebFetch', 'WebSearch', 'Bash', 'PowerShell'].includes(toolName)) return true
  if (toolName === compi('fetch_page') || toolName === compi('open_url')) return true
  return toolName.startsWith('mcp__') && !toolName.startsWith('mcp__compi__')
}

export const isOnline = (provider: ProviderId): boolean => provider !== 'local'

export type PrivacyDecision = 'allow' | 'ask' | 'deny'

/**
 * Décision pour un outil : `null` s'il ne touche à aucune donnée personnelle
 * ou si le cerveau est local (rien ne quitte le PC).
 */
export function privacyDecision(provider: ProviderId, toolName: string, privacy: Partial<PrivacySettings> | undefined): PrivacyDecision | null {
  if (!isOnline(provider)) return null
  const category = TOOL_CATEGORY[toolName]
  if (!category) return null
  const choice = privacy?.[category] ?? 'ask'
  // Messages : jamais « Toujours » vers un cerveau en ligne, même si le réglage le dit.
  if (category === 'messages') return choice === 'never' ? 'deny' : 'ask'
  return choice === 'always' ? 'allow' : choice === 'never' ? 'deny' : 'ask'
}

/** La mémoire va dans les consignes d'un cerveau en ligne seulement si l'utilisateur l'a choisi. */
export function shareMemoryInPrompt(provider: ProviderId, privacy: Partial<PrivacySettings> | undefined): boolean {
  return !isOnline(provider) || privacy?.memory === 'always'
}

/**
 * Outils que le moteur autorise d'office (sans carte). Pour un cerveau en ligne, on en
 * retire ceux qui transmettent des données personnelles tant que l'utilisateur n'a pas
 * choisi « toujours », pour que la carte de confidentialité passe ; et `blocked` (les
 * actions sur Windows) n'y figure jamais.
 */
export function filterAutoAllowed(tools: string[], provider: ProviderId, privacy: Partial<PrivacySettings> | undefined, blocked: string[]): string[] {
  return [...new Set(tools)].filter((t) => !blocked.includes(t) && (privacyDecision(provider, t, privacy) ?? 'allow') === 'allow')
}
