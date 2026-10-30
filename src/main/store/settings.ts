import { randomBytes } from 'node:crypto'
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { DEFAULT_DICTATION, isDictationKey, isDictationStyle } from '../../shared/dictation'
import { DEFAULT_MEETINGS } from '../../shared/meetings'
import { DEFAULT_NATURAL_VOICE } from '../../shared/naturalVoice'
import { DEFAULT_PRIVACY } from '../../shared/privacy'
import { isSpeechModel } from '../../shared/speechModels'
import type { DictationSettings, MeetingSettings, Settings } from '../../shared/types'
import { cleanWebSearch, DEFAULT_WEB_SEARCH } from '../../shared/webSearch'
import { cleanZoom, DEFAULT_ZOOM } from '../../shared/zoom'
import { readJson, writeJson } from './jsonFile'

export const DEFAULT_SHORTCUT = 'Alt+Shift+Space'
export const DEFAULT_QUICK_SHORTCUT = 'Alt+Shift+C'
export const DEFAULT_VOICE_SHORTCUT = 'Alt+Shift+V'
export const DEFAULT_FULL_SHORTCUT = 'Alt+Shift+Return'
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
 * v12 : dictée partout (désactivée par défaut). Copie settings.v11.bak.json avant la migration.
 * v13 : enregistreur d'appels (lancé seulement à la main), catégorie « réunions ».
 * v14 : voix naturelle pour la lecture à voix haute (voix de Windows par défaut).
 * v15 : recherche web des cerveaux hors Claude (désactivée), catégorie « recherches web ».
 * v16 : alerte de l'îlot quand la mémoire du PC est presque pleine (activée).
 * v17 : raccourci du plein écran (Alt+Maj+Entrée). Champ ajouté seulement : la version
 * précédente relit ces réglages sans rien perdre (retour arrière possible).
 * v18 : conversation vocale (désactivée) et « couper la lecture en parlant ». Champs
 * ajoutés seulement, comme en v17.
 * v19 : préparer mes réunions (désactivé), 10 min avant. Champs ajoutés seulement.
 * v20 : tâches Google (non accordées tant que l'utilisateur ne reconnecte pas son compte).
 * Champ ajouté seulement.
 * v21 : taille du texte et de l'interface, encoche et plein écran (100 %). Champ ajouté seulement.
 * v22 : « Ce que tu as manqué » (activé). Champ ajouté seulement.
 */
export const SETTINGS_VERSION = 22

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
  fullShortcut: DEFAULT_FULL_SHORTCUT,
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
  google: { clientId: '', email: '', calendar: false, mail: false, tasks: false },
  day: { morning: true, morningTime: '08:30', city: '', meetingAlerts: true, meetingMinutes: 5, meetingPrep: false, prepMinutes: 10, missed: true },
  agenda: { googleCalendars: null, sources: [] },
  showMusic: true,
  voice: {
    speak: 'voice',
    voice: '',
    rate: 1,
    shortcut: DEFAULT_VOICE_SHORTCUT,
    model: 'small',
    engine: 'windows',
    naturalVoice: DEFAULT_NATURAL_VOICE,
    conversation: false,
    bargeIn: true
  },
  dictation: DEFAULT_DICTATION,
  meetings: DEFAULT_MEETINGS,
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
  monitor: { island: false, memoryAlert: true },
  webSearch: DEFAULT_WEB_SEARCH,
  zoom: DEFAULT_ZOOM
}

type Listener = (s: Settings) => void

/** Réglages de la dictée partout, vérifiés : un fichier modifié à la main ne bloque pas le démarrage. */
function dictationFrom(raw: Partial<DictationSettings> | undefined): DictationSettings {
  const d = { ...DEFAULT_DICTATION, ...raw }
  return {
    ...d,
    enabled: d.enabled === true,
    key: isDictationKey(d.key) ? d.key : DEFAULT_DICTATION.key,
    engine: d.engine === 'parakeet' || d.engine === 'omnilingual' || d.engine === 'whisper' ? d.engine : DEFAULT_DICTATION.engine,
    style: isDictationStyle(d.style) ? d.style : DEFAULT_DICTATION.style,
    appStyles: Array.isArray(d.appStyles)
      ? d.appStyles
          .filter((r) => typeof r?.app === 'string' && r.app.trim() && isDictationStyle(r.style))
          .slice(0, 50)
          .map((r) => ({ app: r.app.trim().slice(0, 60), style: r.style }))
      : [],
    dictionary: Array.isArray(d.dictionary)
      ? d.dictionary
          .filter((r) => typeof r?.from === 'string' && typeof r.to === 'string')
          .slice(0, 300)
          .map((r) => ({ from: r.from.slice(0, 100), to: r.to.slice(0, 4000) }))
      : [],
    compiPrefix: d.compiPrefix !== false,
    polishOnline: d.polishOnline === true,
    typingWpm: Number.isFinite(d.typingWpm) && d.typingWpm >= 5 && d.typingWpm <= 250 ? Math.round(d.typingWpm) : DEFAULT_DICTATION.typingWpm
  }
}

/** Réglages des réunions, vérifiés (fichier modifié à la main). */
function meetingsFrom(raw: Partial<MeetingSettings> | undefined): MeetingSettings {
  const m = { ...DEFAULT_MEETINGS, ...raw }
  return {
    engine: isSpeechModel(m.engine) ? m.engine : DEFAULT_MEETINGS.engine,
    voices: m.voices !== false,
    keepAudio: m.keepAudio === true,
    autoSummary: m.autoSummary !== false
  }
}

/** Avant d'écrire un format plus récent : copie de l'ancien fichier, une seule fois par version. */
function backupBeforeMigration(path: string, from: number): void {
  const bak = join(dirname(path), `settings.v${from}.bak.json`)
  try {
    if (existsSync(path) && !existsSync(bak)) copyFileSync(path, bak)
  } catch {
    // copie impossible (disque plein…) : la migration garde de toute façon toutes les valeurs
  }
}

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
      dictation: dictationFrom(raw.dictation),
      meetings: meetingsFrom(raw.meetings),
      semantic: { ...DEFAULT_SETTINGS.semantic, ...raw.semantic },
      messages: { ...DEFAULT_SETTINGS.messages, ...raw.messages },
      sounds: { ...DEFAULT_SETTINGS.sounds, ...raw.sounds },
      approvalKeys: { ...DEFAULT_SETTINGS.approvalKeys, ...raw.approvalKeys },
      monitor: { ...DEFAULT_SETTINGS.monitor, ...raw.monitor },
      webSearch: cleanWebSearch(raw.webSearch),
      zoom: cleanZoom(raw.zoom)
    }
    if ((raw.settingsVersion ?? 1) < SETTINGS_VERSION) {
      backupBeforeMigration(this.path, raw.settingsVersion ?? 1)
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
      dictation: dictationFrom({ ...this.data.dictation, ...patch.dictation }),
      meetings: meetingsFrom({ ...this.data.meetings, ...patch.meetings }),
      semantic: { ...this.data.semantic, ...patch.semantic },
      messages: { ...this.data.messages, ...patch.messages },
      sounds: { ...this.data.sounds, ...patch.sounds },
      approvalKeys: { ...this.data.approvalKeys, ...patch.approvalKeys },
      monitor: { ...this.data.monitor, ...patch.monitor },
      webSearch: cleanWebSearch({ ...this.data.webSearch, ...patch.webSearch }),
      zoom: cleanZoom({ ...this.data.zoom, ...patch.zoom })
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
