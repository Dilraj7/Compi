import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_PRIVACY } from '../../shared/privacy'
import type { Settings } from '../../shared/types'
import { readJson, writeJson } from './jsonFile'

export const DEFAULT_SHORTCUT = 'Alt+Shift+Space'
export const DEFAULT_QUICK_SHORTCUT = 'Alt+Shift+C'
export const DEFAULT_VOICE_SHORTCUT = 'Alt+Shift+V'
export const DEFAULT_ALLOW_KEY = 'Alt+Shift+O'
export const DEFAULT_DENY_KEY = 'Alt+Shift+N'

/**
 * v2 : l'ancien raccourci par défaut (Ctrl+Maj+Espace) est celui de 1Password.
 * v3 : choix du cerveau (Claude, local, autre service).
 * v4 : style de réponse des cerveaux local et « Autre ».
 * v5 : actions rapides sur la sélection, garde-fou de confidentialité.
 * v6 : compte Google (agenda, e-mails) et « Ta journée ».
 * v7 : musique dans l'îlot, dictée et lecture des réponses à voix haute.
 * v8 : historique du presse-papier, recherche par le sens, connecteurs par compte.
 * v9 : messages en attente (notifications des messageries), catégorie « messages ».
 * v10 : sons, raccourcis des autorisations, activité du PC, durée de chargement du modèle local.
 * v11 : sources de l'agenda (agendas Google choisis, connecteurs, liens .ics).
 */
export const SETTINGS_VERSION = 11

/** Modèle d'Ollama pour la recherche par le sens : multilingue, bon en français, ~640 Mo. */
export const DEFAULT_EMBED_MODEL = 'qwen3-embedding:0.6b'

export const OLLAMA_URL = 'http://127.0.0.1:11434'
export const LMSTUDIO_URL = 'http://127.0.0.1:1234'

export const DEFAULT_SETTINGS: Settings = {
  settingsVersion: SETTINGS_VERSION,
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  effort: 'low',
  local: { engine: 'ollama', baseUrl: OLLAMA_URL, model: '', cloudHelp: true, effort: 'low', keepAlive: '30m' },
  custom: { name: '', baseUrl: '', model: '', effort: 'medium' },
  shortcut: DEFAULT_SHORTCUT,
  quickShortcut: DEFAULT_QUICK_SHORTCUT,
  launchAtLogin: true,
  autoHide: false,
  advancedMode: false,
  alwaysAllow: [],
  userName: '',
  workspaceId: '',
  folders: [],
  disabledSkills: [],
  connectors: [],
  claudeCode: {
    connected: false,
    port: 47474,
    token: '',
    permissionTimeoutSec: 90
  },
  privacy: DEFAULT_PRIVACY,
  google: { clientId: '', email: '', calendar: false, mail: false },
  day: { morning: true, morningTime: '08:30', city: '', meetingAlerts: true, meetingMinutes: 5 },
  agenda: { googleCalendars: null, sources: [] },
  showMusic: true,
  voice: { speak: 'voice', voice: '', rate: 1, shortcut: DEFAULT_VOICE_SHORTCUT, model: 'small' },
  clipboardHistory: false,
  semantic: { enabled: false, model: DEFAULT_EMBED_MODEL },
  messages: { enabled: false, apps: [], remindAfterMin: 60, quietStart: '22:00', quietEnd: '08:00', preview: false, readByCompi: false },
  sounds: {
    enabled: true,
    volume: 'low',
    approvals: true,
    reminders: true,
    messages: true,
    routines: false,
    quietStart: '22:00',
    quietEnd: '08:00'
  },
  approvalKeys: { enabled: true, allow: DEFAULT_ALLOW_KEY, deny: DEFAULT_DENY_KEY },
  monitor: { island: false }
}

type Listener = (s: Settings) => void

class SettingsStore {
  private data: Settings = DEFAULT_SETTINGS
  private listeners = new Set<Listener>()
  private path = ''

  load(): Settings {
    this.path = join(app.getPath('userData'), 'settings.json')
    const raw = readJson<Partial<Settings>>(this.path, {})
    this.data = {
      ...DEFAULT_SETTINGS,
      ...raw,
      local: { ...DEFAULT_SETTINGS.local, ...raw.local },
      custom: { ...DEFAULT_SETTINGS.custom, ...raw.custom },
      claudeCode: { ...DEFAULT_SETTINGS.claudeCode, ...raw.claudeCode },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...raw.privacy },
      google: { ...DEFAULT_SETTINGS.google, ...raw.google },
      day: { ...DEFAULT_SETTINGS.day, ...raw.day },
      agenda: {
        ...DEFAULT_SETTINGS.agenda,
        ...raw.agenda,
        // Fichier modifié à la main : une liste abîmée ne doit pas empêcher Compi de démarrer.
        sources: Array.isArray(raw.agenda?.sources) ? raw.agenda.sources : []
      },
      voice: { ...DEFAULT_SETTINGS.voice, ...raw.voice },
      semantic: { ...DEFAULT_SETTINGS.semantic, ...raw.semantic },
      messages: { ...DEFAULT_SETTINGS.messages, ...raw.messages },
      sounds: { ...DEFAULT_SETTINGS.sounds, ...raw.sounds },
      approvalKeys: { ...DEFAULT_SETTINGS.approvalKeys, ...raw.approvalKeys },
      monitor: { ...DEFAULT_SETTINGS.monitor, ...raw.monitor }
    }
    if ((raw.settingsVersion ?? 1) < SETTINGS_VERSION) {
      if (this.data.shortcut === 'Control+Shift+Space') this.data.shortcut = DEFAULT_SHORTCUT
      this.data.settingsVersion = SETTINGS_VERSION
      this.save()
    }
    if (!this.data.claudeCode.token) {
      this.data.claudeCode.token = randomBytes(18).toString('base64url')
      this.save()
    }
    return this.data
  }

  get(): Settings {
    return this.data
  }

  update(patch: Partial<Settings>): Settings {
    this.data = {
      ...this.data,
      ...patch,
      local: { ...this.data.local, ...patch.local },
      custom: { ...this.data.custom, ...patch.custom },
      claudeCode: { ...this.data.claudeCode, ...patch.claudeCode },
      privacy: { ...this.data.privacy, ...patch.privacy },
      google: { ...this.data.google, ...patch.google },
      day: { ...this.data.day, ...patch.day },
      agenda: { ...this.data.agenda, ...patch.agenda },
      voice: { ...this.data.voice, ...patch.voice },
      semantic: { ...this.data.semantic, ...patch.semantic },
      messages: { ...this.data.messages, ...patch.messages },
      sounds: { ...this.data.sounds, ...patch.sounds },
      approvalKeys: { ...this.data.approvalKeys, ...patch.approvalKeys },
      monitor: { ...this.data.monitor, ...patch.monitor }
    }
    this.save()
    for (const l of this.listeners) l(this.data)
    return this.data
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  private save(): void {
    writeJson(this.path, this.data)
  }
}

export const settings = new SettingsStore()

/** Sons de Compi actifs : ses notifications Windows restent muettes (pas de double son). */
export const toastSilent = (): boolean => settings.get().sounds.enabled
