// Rubriques des Réglages et onglets d'Activité : quelle rubrique montre quel
// réglage, pour que chaque lien (Ctrl+K, « Gérer », Aujourd'hui…) ouvre la
// bonne. Sans React, pour être testé.

/** Partie des réglages à montrer en ouvrant Réglages. */
export type SettingsFocus =
  | 'brain'
  | 'quiz'
  | 'websearch'
  | 'voice'
  | 'dictation'
  | 'speak'
  | 'converse'
  | 'meetings'
  | 'accounts'
  | 'morning'
  | 'agenda'
  | 'messages'
  | 'general'
  | 'keys'
  | 'island'
  | 'zoom'
  | 'sounds'
  | 'claude'
  | 'privacy'

export type SettingsTab = 'brain' | 'voice' | 'day' | 'island' | 'general' | 'privacy'

export const SETTINGS_TABS: Array<{ value: SettingsTab; label: string }> = [
  { value: 'brain', label: 'Cerveau' },
  { value: 'voice', label: 'Voix' },
  { value: 'day', label: 'Journée' },
  { value: 'island', label: 'Îlot' },
  { value: 'general', label: 'Général' },
  { value: 'privacy', label: 'Confidentialité' }
]

export const SETTINGS_TAB_OF: Record<SettingsFocus, SettingsTab> = {
  brain: 'brain',
  quiz: 'brain',
  websearch: 'brain',
  voice: 'voice',
  dictation: 'voice',
  speak: 'voice',
  converse: 'voice',
  meetings: 'voice',
  accounts: 'day',
  morning: 'day',
  agenda: 'day',
  messages: 'day',
  general: 'general',
  keys: 'general',
  island: 'island',
  zoom: 'island',
  sounds: 'island',
  claude: 'general',
  privacy: 'privacy'
}

export type ActivityTab = 'perf' | 'claude' | 'time' | 'usage' | 'journal'

/** Dans l'ordre de l'ancienne page unique. */
export const ACTIVITY_TABS: Array<{ value: ActivityTab; label: string }> = [
  { value: 'perf', label: 'Ce PC' },
  { value: 'claude', label: 'Claude Code' },
  { value: 'time', label: 'Temps gagné' },
  { value: 'usage', label: 'Utilisation' },
  { value: 'journal', label: 'Journal' }
]
