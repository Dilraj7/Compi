// API simulée pour l'aperçu dans un navigateur (npm run dev:web).
// Elle imite le processus principal : réponses en streaming, approbations,
// sessions Claude Code… sans Electron ni clé API.

import type { CompiApi } from '../../../preload/api'
import { defaultBrain } from '@shared/brains'
import { CATALOG } from '@shared/catalog'
import { recommend } from '@shared/recommend'
import { stageDetail } from '@shared/stage'
import type {
  AgendaDraft,
  AgendaPreview,
  AgendaSource,
  AgentEvent,
  ApprovalRequest,
  BrainProgress,
  ClaudeSession,
  ClipItem,
  Conversation,
  DictationStatRow,
  HardwareInfo,
  IslandCommand,
  IslandNotice,
  LocalModelInfo,
  MediaInfo,
  MemoryItem,
  PublicSettings,
  QuestionRequest,
  QuickEvent,
  QuickSelection,
  RegistryEntry,
  Reminder,
  TaskItem,
  Routine,
  SemanticStatus,
  MessagesStatus,
  SkillDraft,
  SkillInfo,
  SpeechPackId,
  SpeechModelStatus,
  Meeting,
  MeetingEvent,
  MeetingMeta,
  MeetingSummary,
  TimerState,
  TodayInfo,
  VoiceInfo,
  VoiceModelId,
  VoiceModelStatus,
  VoiceVariant
} from '@shared/types'
import type { MissedInfo } from '@shared/missed'
import { VOICE_MODELS } from '@shared/voice'
import { addDictation, DEFAULT_DICTATION } from '@shared/dictation'
import { DEFAULT_MEETINGS, defaultMeetingTitle, nameVoice } from '@shared/meetings'
import { LEGACY_VOICES_PACK, SPEECH_PACKS } from '@shared/speechModels'
import { DEFAULT_NATURAL_VOICE } from '@shared/naturalVoice'
import type { OllamaFolder } from '@shared/ollamaFolder'
import { newPomodoro, newTimer, paused, resumed } from '@shared/timer'
import { cleanFact, sameFact } from '@shared/memory'
import { cleanDraft } from '@shared/routines'
import { icsUrl } from '@shared/agenda'
import { pickPrevious, prepKey } from '@shared/meetingPrep'
import { addDays, localDay, sortTasks } from '@shared/tasks'
import { stepZoom } from '@shared/zoom'
import { hourStart, messageCost, type ClaudeCodeUsage, type CompiUsageRow, type UsageRow } from '@shared/usage'
import type { ApprovalLogEntry, Reread } from '@shared/types'
import type { PerfSnapshot } from '@shared/perf'

type Cb<T> = (v: T) => void

/** Journal des autorisations fictif. */
function demoApprovalLog(): ApprovalLogEntry[] {
  const now = Date.now()
  const e = (min: number, x: Omit<ApprovalLogEntry, 'id' | 'at'>): ApprovalLogEntry => ({ id: `log-${min}`, at: now - min * 60_000, ...x })
  return [
    e(3, {
      source: 'claude-code',
      title: 'Claude veut exécuter une commande',
      tool: 'Bash',
      target: 'npm test -- --run',
      session: 'mon-app',
      outcome: 'allow'
    }),
    e(9, {
      source: 'claude-code',
      title: 'Claude veut modifier un fichier',
      tool: 'Edit',
      target: 'notchWindow.ts',
      session: 'mon-app',
      outcome: 'always',
      rule: 'Autoriser Edit dans ce projet, sur ce PC'
    }),
    e(26, {
      source: 'compi',
      title: 'Compi veut lire « Bail-appartement.pdf »',
      tool: 'mcp__compi__read_document',
      target: undefined,
      destination: 'Claude (Anthropic)',
      outcome: 'allow'
    }),
    e(48, { source: 'compi', title: 'Compi veut régler le volume', tool: 'mcp__compi__set_volume', outcome: 'deny' }),
    e(95, {
      source: 'routine',
      title: 'Compi veut ouvrir un lien',
      tool: 'mcp__compi__open_url',
      target: undefined,
      session: 'Mes e-mails du matin',
      outcome: 'auto-deny'
    }),
    e(180, {
      source: 'claude-code',
      title: 'Claude veut lire une page web',
      tool: 'WebFetch',
      target: 'docs.anthropic.com',
      session: 'site-perso',
      outcome: 'timeout'
    }),
    e(60 * 26, {
      source: 'compi',
      title: 'Compi veut consulter l’historique de ton presse-papier',
      tool: 'mcp__compi__clipboard_history',
      destination: 'OpenRouter',
      outcome: 'always',
      rule: 'Toujours envoyer les données « presse-papier » à OpenRouter'
    })
  ]
}

/** Utilisation de Claude Code fictive : 30 jours, trois projets, deux modèles. */
function demoClaudeCodeUsage(): ClaudeCodeUsage {
  const now = Date.now()
  const rows: UsageRow[] = []
  const sessionsByDay: Record<string, number> = {}
  const projects = ['mon-app', 'site-perso', 'recettes']
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now)
    day.setHours(0, 0, 0, 0)
    day.setDate(day.getDate() - d)
    const weekend = day.getDay() === 0 || day.getDay() === 6
    if (weekend && d % 3) continue
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    sessionsByDay[key] = 2 + ((d * 7) % 5)
    for (const h of [9, 10, 14, 15, 16]) {
      const hour = hourStart(day.getTime() + h * 3600_000)
      if (hour > now) continue
      const project = projects[(d + h) % 3]
      const model = (d + h) % 4 === 0 ? 'claude-sonnet-5' : 'claude-opus-5-5'
      const k = 1 + ((d * 13 + h * 7) % 9) / 3
      const raw = {
        input: Math.round(900 * k),
        output: Math.round(14_000 * k),
        cacheRead: Math.round(380_000 * k),
        cacheWrite5m: 0,
        cacheWrite1h: Math.round(42_000 * k)
      }
      rows.push({
        hour,
        model,
        project,
        tokens: { input: raw.input, output: raw.output, cacheRead: raw.cacheRead, cacheWrite: raw.cacheWrite1h },
        cost: messageCost(model, raw) ?? 0,
        unpriced: 0,
        messages: Math.round(12 * k)
      })
    }
  }
  return { available: true, scannedAt: now - 40_000, rows, sessionsByDay }
}

function demoCompiUsage(): CompiUsageRow[] {
  const out: CompiUsageRow[] = []
  for (let d = 20; d >= 0; d--) {
    const day = new Date(Date.now() - d * 86_400_000)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    out.push({ day: key, brain: 'Claude · Opus 5.5', provider: 'anthropic', replies: 3 + (d % 4), costUsd: 0.06 * (3 + (d % 4)), input: 40_000, output: 3_000 })
    if (d % 2 === 0) out.push({ day: key, brain: 'Sur ce PC · gemma4:12b', provider: 'local', replies: 2 + (d % 3), costUsd: 0, input: 20_000, output: 2_000 })
  }
  return out
}

/** Carte « Ce que tu as manqué » de démonstration : la réunion d'Alex vient de finir. */
function demoMissed(): MissedInfo {
  const now = Date.now()
  const min = 60_000
  return {
    cause: 'meeting',
    title: 'Point équipe',
    from: now - 61 * min,
    to: now - min,
    at: now,
    messages: [
      { key: 'phone:41', appKey: 'phone', app: 'Mobile connecté', sender: 'Maman', at: now - 48 * min },
      { key: 'whatsapp:7', appKey: 'whatsapp', app: 'WhatsApp', sender: 'Paul', at: now - 30 * min },
      { key: 'whatsapp:8', appKey: 'whatsapp', app: 'WhatsApp', sender: 'Paul', at: now - 29 * min }
    ],
    mails: [
      { id: 'm9a8b7c6', from: 'Claire Martin <claire@exemple.fr>', subject: 'Compte rendu à relire avant 17 h', important: true },
      { id: 'm8b7c6d5', from: 'Banque <info@banque.fr>', subject: 'Votre relevé est disponible', important: false }
    ],
    mailTotal: 2,
    reminders: [{ message: 'Appeler le garage', at: now - 20 * min }]
  }
}

function channel<T>() {
  const subs = new Set<Cb<T>>()
  return {
    on(cb: Cb<T>) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    emit(v: T) {
      for (const s of subs) s(v)
    }
  }
}

const uid = (): string => Math.random().toString(36).slice(2, 10)

let skills: Array<SkillInfo & { body: string }> = [
  {
    name: 'analyse-tableur',
    description: 'Analyse un fichier Excel ou CSV : chiffres clés, anomalies et pistes.',
    builtin: true,
    valid: true,
    hasFiles: false,
    body: '# Analyser un tableur\n\n1. Lis le fichier…'
  },
  {
    name: 'compte-rendu-reunion',
    description: 'Transforme des notes de réunion en compte-rendu avec décisions et actions.',
    builtin: true,
    valid: true,
    hasFiles: false,
    body: '# Compte-rendu\n\n…'
  },
  {
    name: 'recherche-documents',
    description: 'Retrouve une information dans les dossiers de documents confiés à Compi.',
    builtin: true,
    valid: true,
    hasFiles: false,
    body: '# Chercher\n\n…'
  },
  {
    name: 'redaction-email',
    description: 'Rédige ou reformule un e-mail professionnel.',
    builtin: true,
    valid: true,
    hasFiles: false,
    body: '# Rédiger un e-mail\n\n…'
  },
  {
    name: 'resume-document',
    description: 'Résume un document en une synthèse claire et fidèle.',
    builtin: true,
    valid: true,
    hasFiles: false,
    body: '# Résumer\n\n…'
  }
]
const skillInfos = (): SkillInfo[] => skills.map(({ body: _b, ...info }) => info)

const REGISTRY_DEMO: RegistryEntry[] = [
  {
    id: 'com.notion/mcp',
    title: 'Notion (officiel)',
    description: 'Official Notion MCP server',
    kind: 'remote',
    config: { id: '', name: 'Notion (officiel)', enabled: true, transport: 'http', url: 'https://mcp.notion.com/mcp', templateId: 'registry:com.notion/mcp' },
    secrets: [],
    hints: {}
  },
  {
    id: 'io.github.example/notion-mcp',
    title: 'notion-mcp',
    description: 'Notion API via a local server',
    kind: 'npm',
    requirement: 'Demande Node.js (nodejs.org)',
    config: {
      id: '',
      name: 'notion-mcp',
      enabled: true,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'notion-mcp@1.2.0'],
      templateId: 'registry:io.github.example/notion-mcp'
    },
    secrets: ['NOTION_TOKEN'],
    hints: { NOTION_TOKEN: 'Jeton d’intégration Notion' }
  }
]

export function createMockApi(): CompiApi {
  const agent = channel<AgentEvent>()
  const commands = channel<IslandCommand>()
  const notices = channel<IslandNotice>()
  const approvalsCh = channel<ApprovalRequest[]>()
  const questionsCh = channel<QuestionRequest[]>()
  const sessionsCh = channel<ClaudeSession[]>()
  const settingsCh = channel<PublicSettings>()
  const brainCh = channel<BrainProgress>()
  const quickOpenCh = channel<QuickSelection>()
  const quickCh = channel<QuickEvent>()

  // Scénarios de l'aperçu : ?local=running (Ollama prêt avec un modèle), ?brain=none (premier lancement).
  const params = new URLSearchParams(location.search)
  const HW: HardwareInfo = { ramGb: 15.9, gpu: { name: 'AMD Radeon RX 6800', vramGb: 16, vendor: 'amd' }, freeDiskGb: 143.4 }
  let localRunning = params.get('local') === 'running'
  // ?ollamadir=stale : Ollama tourne encore sur l'ancien dossier après un changement de « Model location ».
  let folderStale = params.get('ollamadir') === 'stale'
  const demoFolder = (): OllamaFolder => ({
    dir: 'D:\\.ollama\\models',
    source: 'app',
    exists: true,
    sizeGb: 12.9,
    freeGb: 143.4,
    models: folderStale ? 0 : 3,
    runningDir: folderStale ? 'C:\\Users\\vous\\.ollama\\models' : undefined,
    restartNeeded: folderStale
  })
  let localModels: LocalModelInfo[] = localRunning
    ? [
        { name: 'qwen3.5:9b', sizeBytes: 6.6 * 1024 ** 3, params: '9.7B', tools: true, vision: true, thinking: true },
        { name: 'llama2:7b', sizeBytes: 3.8 * 1024 ** 3, params: '7B', tools: false, vision: false, thinking: false }
      ]
    : []
  let pullTimer: ReturnType<typeof setInterval> | undefined

  let settings: PublicSettings = {
    provider: 'anthropic',
    local: { engine: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: '', cloudHelp: true, effort: 'low', keepAlive: '30m' },
    custom:
      params.get('custom') === 'on'
        ? { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', effort: 'medium' }
        : { name: '', baseUrl: '', model: '', effort: 'medium' },
    hasCustomKey: params.get('custom') === 'on',
    model: 'claude-opus-5-5',
    effort: 'low',
    settingsVersion: 12,
    shortcut: 'Alt+Shift+Space',
    quickShortcut: 'Alt+Shift+C',
    fullShortcut: 'Alt+Shift+Return',
    launchAtLogin: true,
    autoHide: false,
    advancedMode: false,
    alwaysAllow: ['mcp__compi__clipboard_read'],
    userName: 'Alex',
    workspaceId: '',
    folders: ['D:\\Documents\\Factures'],
    disabledSkills: [],
    connectors: [
      {
        id: 'a1b2c3d4',
        name: 'Fichiers',
        enabled: true,
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\Users\\demo\\Projets'],
        templateId: 'filesystem'
      },
      { id: 'n0t10n00', name: 'Notion', enabled: true, transport: 'http', url: 'https://mcp.notion.com/mcp', templateId: 'notion-account', auth: 'oauth' },
      { id: 'l1n3ar00', name: 'Linear', enabled: true, transport: 'http', url: 'https://mcp.linear.app/mcp', templateId: 'linear-account', auth: 'oauth' }
    ],
    connectorAuth: { n0t10n00: { connected: true }, l1n3ar00: { connected: true, expired: true } },
    claudeCode: { connected: true, port: 47474, token: 'demo', permissionTimeoutSec: 90 },
    hasApiKey: params.get('brain') !== 'none',
    shortcutActive: true,
    quickShortcutActive: true,
    fullShortcutActive: true,
    connectorSecrets: {},
    privacy: {
      screen: 'ask',
      files: 'always',
      mail: 'ask',
      calendar: 'always',
      clipboard: 'ask',
      window: 'ask',
      memory: 'never',
      messages: 'ask',
      meetings: 'ask',
      web: 'ask'
    },
    hasGoogleClient: params.get('google') !== 'none',
    google:
      params.get('google') === 'none' || params.get('google') === 'client'
        ? { clientId: '', email: '', calendar: false, mail: false, tasks: false }
        : // ?tasks=on : les tâches Google sont accordées aussi.
          { clientId: 'demo.apps.googleusercontent.com', email: 'alex@example.com', calendar: true, mail: true, tasks: params.get('tasks') === 'on' },
    // ?agenda=on : une source ajoutée (lien .ics) en plus de Google.
    agenda: {
      googleCalendars: null,
      sources: params.get('agenda') === 'on' ? [{ id: 'ag1c5000', kind: 'ics', name: 'Club de natation', enabled: true, host: 'agenda.club-exemple.fr' }] : []
    },
    day: {
      morning: true,
      morningTime: '08:30',
      city: 'Nantes, Pays de la Loire, France',
      cityLat: 47.22,
      cityLon: -1.55,
      meetingAlerts: true,
      meetingMinutes: 5,
      // ?prep=on : « Préparer mes réunions » activé (participants, e-mails, fois d'avant).
      meetingPrep: params.get('prep') === 'on',
      prepMinutes: 10,
      missed: true
    },
    showMusic: true,
    // ?tts=natural : la voix naturelle choisie et téléchargée (l'aperçu lit en silence).
    voice: {
      speak: 'voice',
      voice: '',
      rate: 1,
      shortcut: 'Alt+Shift+V',
      model: 'small',
      engine: params.get('tts') === 'natural' ? 'natural' : 'windows',
      naturalVoice: DEFAULT_NATURAL_VOICE,
      // ?converse=on : conversation vocale activée.
      conversation: params.get('converse') === 'on',
      bargeIn: true
    },
    voiceShortcutActive: true,
    dictation: { ...DEFAULT_DICTATION, enabled: params.get('dictation') === 'on' },
    dictationKeyActive: params.get('dictation') === 'on',
    meetings: DEFAULT_MEETINGS,
    clipboardHistory: params.get('clip') === 'on',
    semantic: { enabled: params.get('semantic') === 'ready', model: 'qwen3-embedding:0.6b' },
    messages: {
      enabled: params.get('messages') === 'on',
      apps: params.get('messages') === 'on' ? ['phone', 'whatsapp'] : [],
      remindAfterMin: 60,
      quietStart: '22:00',
      quietEnd: '08:00',
      preview: false,
      readByCompi: false
    },
    sounds: {
      enabled: params.get('sounds') !== 'off',
      volume: 'low',
      approvals: true,
      reminders: true,
      messages: true,
      routines: false,
      quietStart: '22:00',
      quietEnd: '08:00'
    },
    approvalKeys: { enabled: true, allow: 'Alt+Shift+O', deny: 'Alt+Shift+N' },
    approvalKeysTaken: params.get('keys') === 'taken' ? ['Alt+Shift+N'] : [],
    monitor: { island: params.get('monitor') === 'on', memoryAlert: true },
    // ?web=ollama (clé enregistrée) ou ?web=searxng : recherche web réglée.
    webSearch: {
      provider: params.get('web') === 'ollama' ? 'ollama' : params.get('web') === 'searxng' ? 'searxng' : 'off',
      searxngUrl: params.get('web') === 'searxng' ? 'http://localhost:8080' : ''
    },
    hasWebSearchKey: params.get('web') === 'ollama',
    zoom: { notch: 100, full: 100 }
  }
  // Taille du texte : la maquette garde le choix (le vrai zoom est celui de la fenêtre d'Electron).
  const zoomCh = channel<{ mode: 'notch' | 'full'; pct: number }>()
  let mockFull = false

  // Ce PC (scénarios : ?perf=ok, ?perf=spill, ?perf=nogpu) : instantanés simulés, qui bougent un peu.
  const perfCh = channel<PerfSnapshot>()
  // ?perf=reread : discussion qui remplit la fenêtre (relue à chaque question) et extension trop grosse.
  const perfMode = params.get('perf') ?? 'ok'
  const DEMO_REREAD = (tokens: number): Reread => ({ tokens, promptTokens: tokens + 1500, cause: 'full' })
  const perfWatchers = new Set<string>()
  let perfTimer: ReturnType<typeof setInterval> | undefined
  let embedLoaded = perfMode === 'spill'
  let chatLoaded = true
  // Mémoire des conversations d'Ollama (?perf=full : 6 Go gardés, sans limite réglée).
  let cacheConfigured: number | undefined = perfMode === 'full' ? undefined : 2048
  let cacheUsedMb = perfMode === 'full' ? 6250 : 900
  const jitter = (base: number, spread: number): number => Math.max(0, Math.min(100, base + (Math.random() - 0.5) * spread))
  const demoPerf = (): PerfSnapshot => {
    const spill = perfMode === 'spill'
    const full = perfMode === 'full'
    const now = Date.now()
    const cacheMb = chatLoaded ? cacheUsedMb : 0
    const modelRam = chatLoaded ? 1.1 + cacheMb / 1024 : 0
    const models = [
      ...(chatLoaded
        ? [
            {
              name: 'gemma4:12b',
              sizeGb: spill ? 11.2 : 8.4,
              gpuShare: spill ? 0.62 : 1,
              expiresAt: now + 22 * 60_000,
              contextLength: 16384,
              role: 'chat' as const
            }
          ]
        : []),
      ...(embedLoaded ? [{ name: 'qwen3-embedding:0.6b', sizeGb: 1.1, gpuShare: 1, expiresAt: now + 7 * 60_000, role: 'embed' as const }] : [])
    ]
    const modelVram = models.reduce((n, m) => n + m.sizeGb * m.gpuShare, 0)
    const vram = [
      ...(modelVram ? [{ label: 'Modèle local', gb: modelVram, kind: 'model' as const }] : []),
      { label: 'Windows (affichage)', gb: 1.8, kind: 'windows' as const },
      ...(spill
        ? [
            { label: 'Steam', gb: 1.1, kind: 'app' as const },
            { label: 'Comet', gb: 0.9, kind: 'app' as const }
          ]
        : [{ label: 'Comet', gb: 0.4, kind: 'app' as const }])
    ]
    return {
      at: now,
      cpu: Math.round(jitter(spill ? 64 : 18, 12)),
      ram: {
        usedGb: (full ? 7.9 : spill ? 12.3 : 8.1) + modelRam,
        totalGb: 15.9,
        top: [
          { name: 'Modèle local', gb: modelRam },
          { name: 'Comet', gb: 3.2 },
          { name: 'Claude', gb: 2.2 },
          { name: 'Edge', gb: 1.1 }
        ]
          .sort((a, b) => b.gb - a.gb)
          .slice(0, 3),
        modelGb: modelRam
      },
      gpu:
        perfMode === 'nogpu'
          ? undefined
          : {
              name: 'AMD Radeon RX 6800',
              util: Math.round(jitter(spill ? 48 : 12, 16)),
              vramUsedGb: vram.reduce((n, v) => n + v.gb, 0) + 0.3,
              vramTotalGb: 16,
              vram,
              busyApp: spill ? { name: 'Steam', util: 31 } : undefined
            },
      local: {
        engine: 'ollama',
        models,
        chatModel: 'gemma4:12b',
        keepAlive: settings.local.keepAlive,
        cache: { prompts: cacheMb ? (full ? 4 : 1) : 0, usedMb: cacheMb, limitMb: cacheConfigured ?? 8192, configuredMb: cacheConfigured, canSet: true }
      },
      runs: spill
        ? [
            { at: now - 40 * 60_000, model: 'gemma4:12b', firstTokenMs: 4200, tokensPerSec: 61, inputTokens: 2100 },
            { at: now - 9 * 60_000, model: 'gemma4:12b', firstTokenMs: 412_000, tokensPerSec: 15, inputTokens: 3400, coldStart: true, gpuShare: 0.62 }
          ]
        : perfMode === 'reread'
          ? [
              { at: now - 14 * 60_000, model: 'gemma4:12b', firstTokenMs: 44_000, tokensPerSec: 35, inputTokens: 26_100, reread: DEMO_REREAD(26_100) },
              { at: now - 9 * 60_000, model: 'gemma4:12b', firstTokenMs: 2400, tokensPerSec: 36, inputTokens: 600, toolsOmitted: ['Notion'] },
              {
                at: now - 3 * 60_000,
                model: 'gemma4:12b',
                firstTokenMs: 48_000,
                tokensPerSec: 34,
                inputTokens: 27_900,
                reread: DEMO_REREAD(27_900),
                toolsOmitted: ['Notion']
              }
            ]
          : [{ at: now - 6 * 60_000, model: 'gemma4:12b', firstTokenMs: 2600, tokensPerSec: 72, inputTokens: 1800, coldStart: false, gpuShare: 1 }]
    }
  }
  const syncPerfTimer = (): void => {
    if (perfWatchers.size && !perfTimer) perfTimer = setInterval(() => perfCh.emit(demoPerf()), 2000)
    if (!perfWatchers.size && perfTimer) {
      clearInterval(perfTimer)
      perfTimer = undefined
    }
  }

  // Ta journée (scénarios : ?google=none, ?google=client).
  const at = (h: number, m = 0): string => {
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.toISOString()
  }
  // Arrondi à la minute : l'événement garde le même début (et la même clé de préparation) d'un rafraîchissement à l'autre.
  const inMinutes = (min: number): string => new Date(Math.ceil((Date.now() + min * 60_000) / 60_000) * 60_000).toISOString()
  let reminders: Reminder[] = [
    { id: 'r1', message: 'Appeler le garage', dueAt: Date.now() + 2 * 3600_000 },
    { id: 'r2', message: 'Sortir les poubelles', dueAt: Date.now() + 26 * 3600_000, repeat: { every: 'week', days: [1, 4], time: '19:30' } }
  ]
  const remindersCh = channel<Reminder[]>()
  // « Ce que tu as manqué » de démonstration (?missed=on) : une réunion qui vient de finir.
  let missed: MissedInfo | null = new URLSearchParams(location.search).get('missed') === 'on' ? demoMissed() : null
  const missedCh = channel<MissedInfo | null>()
  // Tâches Google de démonstration (?tasks=on) : deux listes, retards, aujourd'hui, plus tard, sans date.
  const tasksCh = channel<void>()
  const dayIn = (n: number): string => addDays(localDay(new Date()), n)
  const demoTasks: TaskItem[] = [
    {
      id: 'tk1',
      listId: 'travail',
      list: 'Travail',
      title: 'Envoyer les captures d’écran à Léa',
      due: dayIn(0),
      done: false,
      link: 'https://tasks.google.com/task/tk1'
    },
    { id: 'tk2', listId: 'maison', list: 'Maison', title: 'Payer la cantine', due: dayIn(-1), done: false },
    { id: 'tk3', listId: 'maison', list: 'Maison', title: 'Réserver le restaurant pour samedi', due: dayIn(2), done: false },
    { id: 'tk4', listId: 'travail', list: 'Travail', title: 'Relire le texte de la page', due: dayIn(5), done: false, notes: 'Surtout la partie tarifs.' },
    { id: 'tk5', listId: 'maison', list: 'Maison', title: 'Acheter des ampoules', done: false },
    { id: 'tk6', listId: 'travail', list: 'Travail', title: 'Rappeler le garage', done: false },
    { id: 'tk7', listId: 'travail', list: 'Travail', title: 'Préparer la démo', due: dayIn(12), done: false },
    { id: 'tk8', listId: 'maison', list: 'Maison', title: 'Renouveler le passeport', done: false }
  ]

  // Îlot vivant (scénario ?music=playing|paused, ?timer=on) : musique, minuteur, voix.
  const mediaCh = channel<MediaInfo | null>()
  const timerCh = channel<TimerState | null>()
  const demoArt =
    'data:image/svg+xml;base64,' +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7a59"/><stop offset="1" stop-color="#7b2ff7"/></linearGradient></defs><rect width="40" height="40" fill="url(#g)"/><circle cx="20" cy="20" r="9" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="2"/></svg>'
    )
  const musicParam = params.get('music')
  let media: MediaInfo | null = musicParam
    ? {
        status: musicParam === 'paused' ? 'paused' : 'playing',
        title: 'Naan Pizhai (Flute)',
        artist: 'Flute Siva',
        album: 'Naan Pizhai',
        app: 'Spotify',
        art: demoArt,
        position: 74,
        duration: 242,
        at: Date.now(),
        canNext: true,
        canPrevious: true
      }
    : null
  let timer: TimerState | null = params.get('timer') ? newTimer(12 * 60_000 + 34_000, 'Pâtes', Date.now()) : null
  const setTimer = (t: TimerState | null): TimerState | null => {
    timer = t
    timerCh.emit(t)
    return t
  }
  // WAV silencieux, d'une durée proportionnelle au texte (l'aperçu n'a pas de voix).
  const silentWav = (text: string): Uint8Array => {
    const rate = 8000
    const samples = Math.min(rate * 8, Math.round(rate * 0.06 * text.length))
    const buf = new ArrayBuffer(44 + samples * 2)
    const v = new DataView(buf)
    const w = (o: number, str: string): void => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
    w(0, 'RIFF')
    v.setUint32(4, 36 + samples * 2, true)
    w(8, 'WAVEfmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, rate, true)
    v.setUint32(28, rate * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    w(36, 'data')
    v.setUint32(40, samples * 2, true)
    return new Uint8Array(buf)
  }
  const voiceCh = channel<VoiceModelStatus>()
  let voiceInstalled: Partial<Record<VoiceModelId, VoiceVariant>> = params.get('voice') === 'installed' ? { small: 'gpu' } : {}
  let voiceDl: VoiceModelStatus['downloading'] | null = null
  let voiceCancelled = false
  const voiceStatus = (model: VoiceModelId): VoiceModelStatus => ({
    model,
    installed: Boolean(voiceInstalled[model]),
    variant: voiceInstalled[model],
    sizeBytes: voiceInstalled[model] ? VOICE_MODELS[model].variants[voiceInstalled[model]!].approxMb * 1e6 : undefined,
    downloading: voiceDl ?? undefined
  })
  // Dictée partout (scénarios ?speech=installed, ?stats=demo, ?voices=old pour l'ancien pack des voix) : rien n'est téléchargé.
  const speechCh = channel<SpeechModelStatus>()
  let speechInstalled: Partial<Record<SpeechPackId, boolean>> = {
    ...(params.get('speech') === 'installed' && { parakeet: true }),
    ...(params.get('tts') === 'natural' && { supertonic: true })
  }
  let voicesOld = params.get('voices') === 'old'
  let speechDl: SpeechModelStatus['downloading'] | null = null
  let speechCancelled = false
  const speechStatus = (model: SpeechPackId): SpeechModelStatus => {
    const old = model === 'voices' && voicesOld && !speechInstalled.voices
    return {
      model,
      installed: Boolean(speechInstalled[model]) || old,
      sizeBytes: old ? LEGACY_VOICES_PACK.approxMb * 1e6 : speechInstalled[model] ? SPEECH_PACKS[model].approxMb * 1e6 : undefined,
      outdated: old || undefined,
      downloading: speechDl ?? undefined
    }
  }
  // Réunions (scénario ?meetings=demo) : rien n'est enregistré ; un appel simulé à « Commencer ».
  const meetingCh = channel<MeetingEvent>()
  const meetingsCh = channel<MeetingMeta[]>()
  const demoMeetings: Meeting[] = params.get('meetings') === 'demo' ? DEMO_MEETINGS() : []
  const metaOf = (m: Meeting): MeetingMeta => {
    const { lines: _l, names: _n, summary, ...meta } = m
    return { ...meta, hasSummary: Boolean(summary) }
  }
  const meetingList = (): MeetingMeta[] => demoMeetings.map(metaOf).sort((a, b) => b.startedAt - a.startedAt)
  let recording: { meeting: Meeting; timer: ReturnType<typeof setInterval> } | null = null
  const DEMO_LIVE = [
    { who: 'others', text: 'Bonjour à tous, on commence par le point sur le lancement.' },
    { who: 'me', text: 'Oui, la page est prête, il manque juste les captures.' },
    { who: 'others', text: 'Parfait. Tu peux les envoyer à Léa avant jeudi ?' },
    { who: 'me', text: 'Je m’en occupe demain matin.' }
  ]
  const statsCh = channel<DictationStatRow[]>()
  let dictationRows: DictationStatRow[] = []
  if (params.get('stats') === 'demo') {
    const apps = ['outlook', 'teams', 'code', 'chrome']
    for (let i = 0; i < 30; i++)
      for (const [j, app] of apps.entries()) {
        const words = Math.round(((i * 37 + j * 53) % 90) + (i % 7 === 6 ? 0 : 40) / (j + 1))
        if (words > 15) dictationRows = addDictation(dictationRows, { at: Date.now() - (29 - i) * 86_400_000, app, words, speakingMs: words * 400 })
      }
  }
  const VOICES: VoiceInfo[] = [
    { id: 'julie', name: 'Julie', lang: 'fr-FR', gender: 'Female' },
    { id: 'paul', name: 'Paul', lang: 'fr-FR', gender: 'Male' },
    { id: 'hortense', name: 'Hortense', lang: 'fr-FR', gender: 'Female' },
    { id: 'zira', name: 'Zira', lang: 'en-US', gender: 'Female' }
  ]
  const demoAgendaPreview = async (d: AgendaDraft): Promise<AgendaPreview> => {
    await new Promise((r) => setTimeout(r, 1200))
    if (d.kind === 'ics') {
      const u = icsUrl(d.url)
      if ('problem' in u) return { ok: false, message: u.problem, events: [], count: 0 }
    } else if (d.tool === 'get_overview')
      return {
        ok: false,
        message: 'Cet outil répond en texte libre : Compi ne sait pas en tirer des dates et des titres. Essaie un autre outil.',
        events: [],
        count: 0
      }
    const name = d.name?.trim() || (d.kind === 'ics' ? 'Agenda du club' : (settings.connectors.find((c) => c.id === d.connectorId)?.name ?? 'Agenda'))
    const day = (n: number, h: number, m = 0): string => new Date(new Date(at(h, m)).getTime() + n * 86_400_000).toISOString()
    const events = [
      { id: 'p1', title: 'Entraînement', start: at(18, 30), end: at(20), allDay: false, calendar: name },
      { id: 'p2', title: 'Réunion de parents', start: day(2, 19), end: day(2, 20), allDay: false, calendar: name },
      { id: 'p3', title: 'Sortie au musée', start: new Date(Date.now() + 4 * 86_400_000).toISOString().slice(0, 10), end: '', allDay: true, calendar: name }
    ]
    return { ok: true, message: '7 éléments aujourd’hui et dans les 7 prochains jours.', events, count: 7, name }
  }
  const demoToday = (): TodayInfo => ({
    date: new Date().toISOString().slice(0, 10),
    google: { email: settings.google.email, calendar: settings.google.calendar, mail: settings.google.mail },
    agenda: settings.google.calendar || settings.agenda.sources.some((x) => x.enabled),
    events: [
      ...settings.agenda.sources
        .filter((x) => x.enabled)
        .map((x, i) => ({
          id: `src-${x.id}`,
          title: i ? 'Réunion de parents' : 'Entraînement',
          start: at(18 + i, 30),
          end: at(19 + i, 30),
          allDay: false,
          calendar: x.name
        })),
      ...(settings.google.calendar
        ? [
            {
              id: 'e0',
              title: 'Anniversaire de Léa',
              start: new Date().toISOString().slice(0, 10),
              end: new Date().toISOString().slice(0, 10),
              allDay: true,
              calendar: 'Anniversaires'
            },
            { id: 'e1', title: 'Café avec Thomas', start: at(8, 30), end: at(9), allDay: false, location: 'Café des Arts' },
            {
              id: 'e2',
              title: 'Point équipe',
              start: inMinutes(4),
              end: inMinutes(34),
              allDay: false,
              meetUrl: 'https://meet.google.com/abc-defg-hij',
              calendar: 'Travail',
              seriesId: 'serie-point-equipe',
              attendees: [
                { email: 'claire@exemple.fr', name: 'Claire Martin', organizer: true },
                { email: 'paul@exemple.fr', name: 'Paul' },
                { email: 'lea@exemple.fr' }
              ]
            },
            { id: 'e3', title: 'Dentiste', start: at(17, 30), end: at(18), allDay: false, location: '12 rue Garibaldi' }
          ]
        : [])
    ].sort((x, y) => (x.allDay ? -1 : y.allDay ? 1 : x.start.localeCompare(y.start))),
    unread: settings.google.mail
      ? {
          count: 7,
          latest: [
            { id: 'm1a2b3c4', from: 'Claire Martin <claire@exemple.fr>', subject: 'Ordre du jour de jeudi', important: true },
            { id: 'm2b3c4d5', from: 'EDF <noreply@edf.fr>', subject: 'Votre facture d’octobre est disponible', important: false },
            { id: 'm3c4d5e6', from: 'Paul <paul@exemple.fr>', subject: 'Photos du week-end', important: false }
          ]
        }
      : undefined,
    reminders: reminders.filter((r) => r.dueAt < new Date().setHours(24, 0, 0, 0)),
    weather: settings.day.city ? { city: settings.day.city, label: 'Averses', min: 9, max: 15, rain: 70 } : undefined,
    errors: []
  })

  let approvals: ApprovalRequest[] = []
  let questions: QuestionRequest[] = []
  const conversations: Conversation[] = [
    {
      id: 'c-old',
      title: 'Idées de cadeaux pour la fête des pères',
      updatedAt: Date.now() - 3600_000 * 26,
      brain: { provider: 'local', model: 'qwen3.5:9b' },
      messages: [
        { id: uid(), role: 'user', text: 'Idées de cadeaux pour la fête des pères ?', createdAt: Date.now() - 3600_000 * 26 },
        {
          id: uid(),
          role: 'assistant',
          text: '- Une **expérience** (cours de cuisine, baptême de l’air)\n- Un objet du quotidien premium\n- Un album photo souvenir',
          createdAt: Date.now() - 3600_000 * 26
        }
      ]
    }
  ]

  const sessions: ClaudeSession[] = [
    {
      id: 's1',
      cwd: 'C:\\Users\\demo\\Projets\\crm-sync',
      project: 'crm-sync',
      // ?cc=idle : aucune session au travail (l'îlot replié a sa place à gauche).
      status: params.get('cc') === 'idle' ? 'idle' : 'working',
      currentTool: 'Commande : npm test',
      lastPrompt: 'Ajoute la synchronisation des contacts avec le CRM',
      edits: [
        { file: 'src/sync/contacts.ts', added: 84, removed: 12 },
        { file: 'src/sync/mapper.ts', added: 23, removed: 5 }
      ],
      startedAt: Date.now() - 600_000,
      updatedAt: Date.now() - 4_000
    },
    {
      id: 's2',
      cwd: 'C:\\Users\\demo\\Projets\\site-perso',
      project: 'site-perso',
      status: 'done',
      lastMessage: 'J’ai corrigé le menu mobile et ajouté la page Contact.',
      edits: [{ file: 'src/pages/contact.astro', added: 41, removed: 0 }],
      startedAt: Date.now() - 3_600_000,
      updatedAt: Date.now() - 900_000
    }
  ]

  const pushApprovals = (): void => approvalsCh.emit([...approvals])
  const pushQuestions = (): void => questionsCh.emit([...questions])

  // Démo : une demande de permission de Claude Code (__compiDemo.approval()).
  const demoApproval = (): void => {
    approvals = [
      ...approvals,
      {
        id: uid(),
        source: 'claude-code',
        title: 'Claude veut exécuter une commande',
        detail: 'npm install @salesforce/core --save',
        toolName: 'Bash',
        sessionLabel: 'crm-sync',
        canAlwaysAllow: true,
        createdAt: Date.now()
      }
    ]
    pushApprovals()
    commands.emit('attention')
  }

  const reply = async (conversationId: string, messageId: string, text: string): Promise<void> => {
    const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
    agent.emit({ type: 'thinking', conversationId, messageId })
    await wait(700)
    // Démo de l'alerte ambre : « range mon bureau » répond sans outil ; la relance fait l'inventaire.
    if (/bureau/i.test(text) && !/aucun outil|sans la faire/i.test(text)) {
      for (const chunk of "C'est fait ! J'ai rangé ton Bureau : tes dossiers sont dans **01_PROJETS** et **02_ADMIN**.".match(/.{1,6}/gs) ?? []) {
        agent.emit({ type: 'text', conversationId, messageId, delta: chunk })
        await wait(28)
      }
      agent.emit({ type: 'done', conversationId, messageId, sentTo: { destination: null, categories: [] }, notice: 'no-action' })
      return
    }
    if (/aucun outil|sans la faire/i.test(text)) {
      const inv = { id: 't3', name: 'mcp__compi__folder_inventory', label: 'Inventaire de Desktop', status: 'running' as const }
      agent.emit({ type: 'tool', conversationId, messageId, tool: inv })
      await wait(900)
      agent.emit({ type: 'tool', conversationId, messageId, tool: { ...inv, status: 'done' } })
      const plan =
        'Tu as raison, je n’avais rien fait. Voici ce que contient vraiment ton Bureau : **15 dossiers, 38 fichiers, 21 raccourcis**.\n\n| Élément | Vers |\n|---|---|\n| facture-edf.pdf | Documents |\n| Capture 2026-10-02.png | Images |\n| tmp1 | À trier |\n\nLes raccourcis restent en place. Je déplace ces 3 éléments ?'
      for (const chunk of plan.match(/.{1,6}/gs) ?? []) {
        agent.emit({ type: 'text', conversationId, messageId, delta: chunk })
        await wait(20)
      }
      agent.emit({ type: 'done', conversationId, messageId, sentTo: { destination: null, categories: [] } })
      return
    }
    // Démo de la scène du plein écran : six étapes, détaillées comme par l'assistant (stageDetail).
    if (/factures/i.test(text)) {
      const steps: Array<{ name: string; label: string; input: Record<string, unknown>; result: string; card?: string }> = [
        {
          name: 'mcp__compi__web_search',
          label: 'Recherche web : ranger ses factures',
          input: { query: 'ranger ses factures' },
          result:
            'Résultats web pour « ranger ses factures » (Ollama) :\n\n1. Combien de temps garder ses factures\n   https://example.com/garder-factures\n\n2. Classer ses papiers à la maison\n   https://example.org/classer-papiers'
        },
        {
          name: 'mcp__compi__move_items',
          label: 'Rangement de 3 éléments',
          input: {},
          result:
            'Déplacés (3) :\n- D:\\Docs\\facture-edf-octobre.pdf → D:\\Docs\\Factures\\facture-edf-octobre.pdf\n- D:\\Docs\\orange-2026-10.pdf → D:\\Docs\\Factures\\orange-2026-10.pdf\n- D:\\Docs\\loyer-octobre.pdf → D:\\Docs\\Factures\\loyer-octobre.pdf\n\nPour annuler : undo_moves (rangement m7).'
        },
        {
          name: 'mcp__compi__write_text_file',
          label: 'Écriture de factures.md',
          input: { path: 'D:\\Docs\\Factures\\factures.md' },
          result: 'Contenu écrit dans D:\\Docs\\Factures\\factures.md (5 ligne(s), modification e9). L’utilisateur peut l’annuler.',
          card: 'D:\\Docs\\Factures\\factures.md\nContenu remplacé · 3 → 5 ligne(s)\n\n  # Factures 2026\n  - septembre : EDF, Orange\n+ - octobre : EDF, Orange, loyer\n+ Total octobre : 1 012 €'
        },
        {
          name: 'mcp__compi__calendar_create_event',
          label: 'Ajout à l’agenda',
          input: {},
          result: "Ajouté à l'agenda : « Payer le loyer », samedi 31 octobre, 10:00 – 10:15."
        },
        {
          name: 'mcp__compi__reminder_create',
          label: 'Rappel',
          input: { message: 'Vérifier la facture Orange' },
          result: 'Rappel programmé : mardi 27 octobre à 09:00.'
        },
        {
          name: 'mcp__compi__open_folder',
          label: 'Ouverture du dossier',
          input: { path: 'D:\\Docs\\Factures' },
          result: "Dossier ouvert dans l'Explorateur : D:\\Docs\\Factures"
        }
      ]
      for (const [i, s] of steps.entries()) {
        const tool = { id: `s${i}`, name: s.name, label: s.label, status: 'running' as const }
        agent.emit({ type: 'tool', conversationId, messageId, tool })
        await wait(650)
        const detail = stageDetail(s.name, s.input, s.result, { card: s.card })
        agent.emit({
          type: 'tool',
          conversationId,
          messageId,
          tool: { ...tool, status: 'done', ...(detail ? { detail } : {}), ...(s.card ? { undo: 'e9' } : {}) }
        })
      }
      for (const chunk of 'C’est rangé : **3 factures** dans **Factures**, le récapitulatif est à jour et le loyer est dans ton agenda.'.match(/.{1,6}/gs) ??
        []) {
        agent.emit({ type: 'text', conversationId, messageId, delta: chunk })
        await wait(24)
      }
      agent.emit({ type: 'done', conversationId, messageId, sentTo: { destination: null, categories: [] } })
      return
    }
    if (/presse|clipboard/i.test(text)) {
      agent.emit({
        type: 'tool',
        conversationId,
        messageId,
        tool: { id: 't1', name: 'mcp__compi__clipboard_read', label: 'Lecture du presse-papier', status: 'running' }
      })
      await wait(900)
      agent.emit({
        type: 'tool',
        conversationId,
        messageId,
        tool: { id: 't1', name: 'mcp__compi__clipboard_read', label: 'Lecture du presse-papier', status: 'done' }
      })
    } else {
      agent.emit({
        type: 'tool',
        conversationId,
        messageId,
        tool: { id: 't2', name: 'WebSearch', label: `Recherche web : ${text.slice(0, 40)}`, status: 'running' }
      })
      await wait(1200)
      agent.emit({
        type: 'tool',
        conversationId,
        messageId,
        tool: { id: 't2', name: 'WebSearch', label: `Recherche web : ${text.slice(0, 40)}`, status: 'done' }
      })
    }
    const answer =
      "Voici ce que j'ai trouvé :\n\n- **Demain** : 17 °C, éclaircies l'après-midi\n- Pluie possible en soirée, prends un parapluie ☂️\n\n```bash\nnpm run dev\n```\n\nTu veux que je te **rappelle** de le prendre à 18 h ?"
    for (const chunk of answer.match(/.{1,6}/gs) ?? []) {
      agent.emit({ type: 'text', conversationId, messageId, delta: chunk })
      await wait(28)
    }
    const brain = defaultBrain(settings)
    agent.emit({
      type: 'done',
      conversationId,
      messageId,
      costUsd: 0.0042,
      sentTo: brain.provider === 'local' ? { destination: null, categories: [] } : { destination: 'Claude (Anthropic)', categories: ['files'], masked: 1 },
      ...(perfMode === 'reread' && {
        stats: { firstTokenMs: 48_000, tokensPerSec: 34, inputTokens: 27_900, outputTokens: 120, requests: 1, reread: DEMO_REREAD(27_900) }
      })
    })
  }

  // Actions rapides : résultat factice, écrit au fil de l'eau.
  const QUICK_RESULTS: Record<string, string> = {
    fix: 'Bonjour Claire,\n\nMerci pour ton message. Je te confirme notre rendez-vous de jeudi à 14 h.\n\nBonne journée,\nAlex',
    rephrase: 'Bonjour Claire,\n\nMerci pour ton retour : c’est noté pour jeudi, 14 h.\n\nBelle journée,\nAlex',
    translate: 'Hi Claire,\n\nThanks for your message. I confirm our meeting on Thursday at 2 pm.\n\nHave a nice day,\nAlex',
    summarize: '- Rendez-vous confirmé **jeudi à 14 h**\n- Ton cordial, rien à préparer',
    explain: 'C’est un court e-mail qui **confirme un rendez-vous** jeudi à 14 h. Rien de particulier à faire.',
    reply: 'Bonjour Alex,\n\nParfait, à jeudi 14 h. Je t’envoie l’ordre du jour d’ici [mercredi].\n\nBonne journée,\nClaire'
  }
  let quickTimer: ReturnType<typeof setInterval> | undefined

  // Déclencheurs de démo depuis la console : __compiDemo.notice({ pill: 'reminder', text: '…' })
  ;(window as unknown as Record<string, unknown>).__compiDemo = {
    notice: notices.emit,
    command: commands.emit,
    approval: demoApproval,
    // Cerveau local : demande d'accord avant d'envoyer un scan à Claude.
    cloudHelp: () => {
      approvals = [
        ...approvals,
        {
          id: uid(),
          source: 'compi',
          title: 'Envoyer facture-edf.pdf à Claude pour le lire ?',
          detail: 'Ce PDF est scanné : le modèle choisi ne sait pas lire les scans.',
          toolName: 'compi:cloud_help',
          canAlwaysAllow: false,
          createdAt: Date.now()
        }
      ]
      pushApprovals()
      commands.emit('attention')
    },
    // Résumé du matin et alerte de réunion.
    music: (status: MediaInfo['status'] = 'playing') => {
      media = {
        title: 'Naan Pizhai (Flute)',
        artist: 'Flute Siva',
        album: '',
        app: 'Spotify',
        art: demoArt,
        position: 74,
        duration: 242,
        at: Date.now(),
        canNext: true,
        canPrevious: true,
        status
      }
      mediaCh.emit(media)
    },
    noMusic: () => {
      media = null
      mediaCh.emit(null)
    },
    timer: (seconds = 754) => setTimer(newTimer(seconds * 1000, 'Pâtes', Date.now())),
    morning: () => notices.emit({ pill: 'today', text: 'Bonjour Alex ! 3 rendez-vous · 7 e-mails non lus · averses, 15 °C', duration: 15_000, view: 'today' }),
    meeting: () =>
      notices.emit({
        pill: 'meeting',
        text: 'Point équipe dans 5 min',
        duration: 60_000,
        view: 'today',
        action: { label: 'Rejoindre', url: 'https://meet.google.com/abc-defg-hij' }
      }),
    // Préparation (?prep=on) : même clé que le « Point équipe » de demoToday().
    prep: () => {
      const e = demoToday().events.find((x) => x.id === 'e2')
      if (e)
        notices.emit({ pill: 'meeting', text: 'Point équipe dans 4 min', duration: 60_000, view: 'today', action: { label: 'Préparer', prep: prepKey(e) } })
    },
    // Actions rapides sur une sélection (Alt+Maj+C).
    quick: () =>
      quickOpenCh.emit({
        id: uid(),
        text: 'bonjour claire,\n\nmerci pour ton message. je te confirme notre rdv de jeudi a 14h.\n\nbonne journée\nAlex',
        source: 'Re: Point projet - Mailbird',
        canReplace: true,
        brainLabel: 'Qwen 3.5 9B',
        online: false
      }),
    question: () => {
      questions = [
        ...questions,
        {
          id: uid(),
          source: 'claude-code',
          sessionLabel: 'crm-sync',
          createdAt: Date.now(),
          questions: [
            {
              question: 'Quelle stratégie pour les doublons de contacts ?',
              header: 'Doublons',
              multiSelect: false,
              options: [
                { label: 'Fusionner', description: 'Garde la fiche la plus récente' },
                { label: 'Ignorer', description: 'Ne synchronise pas les doublons' }
              ]
            }
          ]
        }
      ]
      pushQuestions()
      commands.emit('attention')
    }
  }

  // Étape 4 : mémoire, routines, presse-papier, recherche par le sens (scénarios ?clip=on, ?semantic=ready).
  const memoryCh = channel<MemoryItem[]>()
  const routinesCh = channel<Routine[]>()
  const clipsCh = channel<ClipItem[]>()
  const semanticCh = channel<SemanticStatus>()
  const openConvCh = channel<string>()
  const day = 86_400_000
  let memory: MemoryItem[] = [
    { id: 'm1', fact: 'Préfère qu’on le tutoie', createdAt: Date.now() - 12 * day, source: 'chat', conversation: 'Présentations' },
    { id: 'm2', fact: 'Travaille sur Compi, un assistant pour Windows', createdAt: Date.now() - 5 * day, source: 'chat', conversation: 'Idées de nom' },
    { id: 'm3', fact: 'Habite à Nantes', createdAt: Date.now() - 3 * day, source: 'manual' },
    {
      id: 'm4',
      fact: 'Café sans sucre, réunion d’équipe le lundi à 10 h',
      createdAt: Date.now() - 3600_000,
      updatedAt: Date.now() - 1800_000,
      source: 'chat',
      conversation: 'Organisation de la semaine'
    }
  ]
  const memoryList = (): MemoryItem[] => [...memory].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
  const pushMemory = (): MemoryItem[] => {
    memoryCh.emit(memoryList())
    return memoryList()
  }
  let routines: Routine[] = [
    {
      id: 'rt1',
      title: 'Résumé des e-mails',
      prompt: 'Résume mes e-mails non lus importants en quelques lignes.',
      repeat: { every: 'weekdays', time: '08:30' },
      enabled: true,
      nextAt: Date.now() + 14 * 3600_000,
      createdAt: Date.now() - 6 * day,
      lastRun: { at: Date.now() - 10 * 3600_000, ok: true, conversationId: 'c1', preview: '3 e-mails importants : la facture EDF, la réponse de Paul…' }
    },
    {
      id: 'rt2',
      title: 'Ma semaine',
      prompt: 'Prépare ma semaine : rendez-vous, rappels, e-mails en attente.',
      repeat: { every: 'week', days: [1], time: '08:00' },
      enabled: false,
      nextAt: Date.now() + 4 * day,
      createdAt: Date.now() - 20 * day
    }
  ]
  const pushRoutines = (): Routine[] => {
    routinesCh.emit([...routines])
    return [...routines]
  }
  let clips: ClipItem[] = [
    { id: 'k1', text: 'https://github.com/anthropics/claude-agent-sdk-typescript', at: Date.now() - 120_000, source: 'chrome.exe' },
    { id: 'k2', text: 'Bonjour Paul,\nMerci pour ton retour, je regarde ça demain matin.', at: Date.now() - 3600_000, source: 'Mailbird.exe', pinned: true },
    { id: 'k3', text: 'npm run build:win', at: Date.now() - 5 * 3600_000, source: 'WindowsTerminal.exe' }
  ]
  const pushClips = (): ClipItem[] => {
    clipsCh.emit([...clips])
    return [...clips]
  }
  let semantic: SemanticStatus = settings.semantic.enabled
    ? { state: 'ready', model: settings.semantic.model, files: 48, indexed: 48, passages: 1312, updatedAt: Date.now() - 20 * 60_000 }
    : { state: 'off', model: settings.semantic.model, files: 0, indexed: 0, passages: 0, modelInstalled: false }
  const setSemantic = (patch: Partial<SemanticStatus>): SemanticStatus => {
    semantic = { ...semantic, ...patch }
    semanticCh.emit(semantic)
    return semantic
  }

  // Messages en attente fictifs (?messages=on) : rien n'est lu dans l'aperçu.
  const messagesCh = channel<MessagesStatus>()
  const ago = (min: number): number => Date.now() - min * 60_000
  // ?winnotif=off : notifications de Windows coupées ; ?winnotif=app : WhatsApp hors du centre de notifications.
  const winNotif = params.get('winnotif')
  let messages: MessagesStatus = {
    access: 'allowed',
    reading: false,
    windows: {
      toasts: winNotif !== 'off',
      blocked: winNotif === 'app' ? [{ key: 'whatsapp', app: 'WhatsApp', reason: 'center' }] : []
    },
    pending:
      settings.messages.enabled && !winNotif
        ? [
            { key: 'phone:1', appKey: 'phone', app: 'Mobile connecté', sender: 'Maman', at: ago(95) },
            { key: 'wa:2', appKey: 'whatsapp', app: 'WhatsApp', sender: 'Julien', at: ago(70) },
            { key: 'wa:6', appKey: 'whatsapp', app: 'WhatsApp', sender: 'Julien', at: ago(50) },
            // Mobile connecté ne donne pas toujours l'expéditeur : une seule ligne regroupée, sans « Inconnu ».
            { key: 'phone:4', appKey: 'phone', app: 'Mobile connecté', sender: '', at: ago(40) },
            { key: 'phone:5', appKey: 'phone', app: 'Mobile connecté', sender: '', at: ago(25) },
            { key: 'wa:3', appKey: 'whatsapp', app: 'WhatsApp', sender: 'Équipe foot', at: ago(12) }
          ]
        : [],
    seenApps: [
      { key: 'phone', app: 'Mobile connecté' },
      { key: 'whatsapp', app: 'WhatsApp' },
      { key: 'Microsoft.Windows.SecHealthUI_cw5n1h2txyewy!SecHealthUI', app: 'Sécurité Windows' }
    ]
  }
  const setMessages = (patch: Partial<MessagesStatus>): MessagesStatus => {
    messages = { ...messages, ...patch }
    messagesCh.emit(messages)
    return messages
  }

  return {
    platform: 'web',
    setInteractive: () => undefined,
    setFocusable: () => undefined,
    setActivatable: () => undefined,
    setFull: (v) => {
      mockFull = v
    },
    zoomStep: async (dir) => {
      const mode = mockFull ? 'full' : 'notch'
      const pct = stepZoom(settings.zoom[mode], dir, mode)
      settings = { ...settings, zoom: { ...settings.zoom, [mode]: pct } }
      settingsCh.emit(settings)
      zoomCh.emit({ mode, pct })
      return pct
    },
    onZoomStepped: zoomCh.on,
    onIslandCommand: commands.on,
    onIslandNotice: notices.on,

    perfWatch: async (id, on) => {
      if (on) perfWatchers.add(id)
      else perfWatchers.delete(id)
      syncPerfTimer()
      return demoPerf()
    },
    onPerf: perfCh.on,
    perfUnload: async (which) => {
      embedLoaded = false
      if (which === 'all') chatLoaded = false
      const p = demoPerf()
      perfCh.emit(p)
      return p
    },
    modelHealth: async () => ({}),
    perfOllamaCache: async (mb) => {
      await new Promise((r) => setTimeout(r, 900))
      if (mb !== undefined) cacheConfigured = mb ?? undefined
      // Ollama redémarre : le modèle et ses discussions gardées sont déchargés.
      chatLoaded = false
      cacheUsedMb = 0
      const p = demoPerf()
      perfCh.emit(p)
      return p
    },
    soundAllowed: async () => true,

    getSettings: async () => settings,
    updateSettings: async (patch) => {
      settings = { ...settings, ...patch } as PublicSettings
      settingsCh.emit(settings)
      if (patch.clipboardHistory !== undefined) clipsCh.emit(patch.clipboardHistory ? [...clips] : [])
      return settings
    },
    setApiKey: async (key) => {
      settings = { ...settings, hasApiKey: Boolean(key) }
      return settings
    },
    onSettings: settingsCh.on,

    sentLog: async () => [
      { at: Date.now() - 600_000, destination: 'Claude (Anthropic)', categories: ['files'], masked: 1, conversation: 'Résumé du contrat de bail' },
      { at: Date.now() - 3600_000 * 5, destination: 'OpenRouter', categories: ['clipboard'], conversation: 'Traduction du message de Paul' }
    ],
    clearSentLog: async () => undefined,

    approvalLog: async () => demoApprovalLog(),
    clearApprovalLog: async () => [],
    onApprovalLog: () => () => true,
    claudeCodeUsage: async () => demoClaudeCodeUsage(),
    refreshClaudeCodeUsage: async () => {
      await new Promise((r) => setTimeout(r, 500))
      return demoClaudeCodeUsage()
    },
    onClaudeCodeUsage: () => () => true,
    compiUsage: async () => demoCompiUsage(),
    messagesStatus: async () => messages,
    activateMessages: async () => {
      await new Promise((r) => setTimeout(r, 700))
      settings = { ...settings, messages: { ...settings.messages, enabled: true } }
      settingsCh.emit(settings)
      return setMessages({ access: 'allowed' })
    },
    openMessage: async () => true,
    snoozeMessage: async (key) => setMessages({ pending: messages.pending.filter((p) => p.key !== key) }),
    ignoreMessage: async (key) => setMessages({ pending: messages.pending.filter((p) => p.key !== key) }),
    openNotificationSettings: async () => undefined,
    onMessages: messagesCh.on,
    onCompiUsage: () => () => true,

    googleImportClient: async () => {
      settings = { ...settings, hasGoogleClient: true, google: { ...settings.google, clientId: 'demo.apps.googleusercontent.com' } }
      settingsCh.emit(settings)
      return settings
    },
    googleConnect: async (want) => {
      await new Promise((r) => setTimeout(r, 2500))
      settings = { ...settings, google: { ...settings.google, email: 'alex@example.com', calendar: want.calendar, mail: want.mail, tasks: want.tasks } }
      settingsCh.emit(settings)
      return { ok: true, email: 'alex@example.com', calendar: want.calendar, mail: want.mail, tasks: want.tasks }
    },
    googleCancel: async () => undefined,
    googleDisconnect: async () => {
      settings = { ...settings, google: { ...settings.google, email: '', calendar: false, mail: false, tasks: false } }
      settingsCh.emit(settings)
      return settings
    },
    tasks: async () => {
      await new Promise((r) => setTimeout(r, 500))
      return {
        items: sortTasks(
          demoTasks.filter((t) => !t.done),
          localDay(new Date())
        )
      }
    },
    setTaskDone: async (listId, id, done) => {
      await new Promise((r) => setTimeout(r, 300))
      const t = demoTasks.find((x) => x.id === id && x.listId === listId)
      if (!t) throw new Error('Introuvable chez Google (supprimé, ou mauvais identifiant).')
      t.done = done
      tasksCh.emit()
      return { ...t }
    },
    addTask: async (title, due) => {
      await new Promise((r) => setTimeout(r, 400))
      const t: TaskItem = { id: `demo${Date.now()}`, listId: 'travail', list: 'Travail', title, ...(due ? { due } : {}), done: false }
      demoTasks.push(t)
      tasksCh.emit()
      return t
    },
    onTasks: (cb) => tasksCh.on(() => cb()),
    today: async () => {
      await new Promise((r) => setTimeout(r, 400))
      return demoToday()
    },
    missed: async () => missed,
    dismissMissed: async () => {
      missed = null
      missedCh.emit(null)
    },
    onMissed: missedCh.on,
    agendaGoogleCalendars: async () => {
      await new Promise((r) => setTimeout(r, 300))
      const chosen = settings.agenda.googleCalendars
      return [
        { id: 'primary', name: 'alex@example.com', primary: true, selected: true },
        { id: 'travail', name: 'Travail', primary: false, selected: true },
        { id: 'anniv', name: 'Anniversaires', primary: false, selected: true },
        { id: 'feries', name: 'Jours fériés en France', primary: false, selected: false }
      ].map(({ selected, ...c }) => ({ ...c, shown: chosen === null ? selected : chosen.includes(c.id) }))
    },
    agendaSetGoogleCalendars: async (ids) => {
      settings = { ...settings, agenda: { ...settings.agenda, googleCalendars: ids } }
      settingsCh.emit(settings)
      return settings
    },
    agendaTools: async () => {
      await new Promise((r) => setTimeout(r, 900))
      return [
        { tool: 'list_events', description: 'Liste les événements entre deux dates.' },
        { tool: 'get_overview', description: 'Vue d’ensemble : événements à venir, tâches et listes.' },
        { tool: 'find_many_tasks', description: 'Tâches avec leur échéance (trouvé dans le catalogue du connecteur).', via: 'execute_tool' },
        { tool: 'create_event', description: 'Crée un événement.', problem: 'peut modifier des données : Compi ne l’appellera pas tout seul' }
      ]
    },
    agendaPreview: demoAgendaPreview,
    agendaAdd: async (d) => {
      const id = Math.random().toString(36).slice(2, 10)
      const preview = await demoAgendaPreview(d)
      if (!preview.ok) throw new Error(preview.message)
      const name = (d.name?.trim() || preview.name || 'Agenda').slice(0, 60)
      const source: AgendaSource =
        d.kind === 'ics'
          ? { id, kind: 'ics', name, enabled: true, host: new URL(d.url.replace(/^webcal:/i, 'https:')).hostname }
          : {
              id,
              kind: 'connector',
              name,
              enabled: true,
              connectorId: d.connectorId,
              tool: d.tool,
              args: { from: 'start', to: 'end', format: 'datetime', fixed: {} }
            }
      settings = { ...settings, agenda: { ...settings.agenda, sources: [...settings.agenda.sources, source] } }
      settingsCh.emit(settings)
      return settings
    },
    agendaUpdate: async (id, patch) => {
      const sources = settings.agenda.sources.map((x) => (x.id === id ? { ...x, ...patch, name: patch.name?.trim() || x.name } : x))
      settings = { ...settings, agenda: { ...settings.agenda, sources } }
      settingsCh.emit(settings)
      return settings
    },
    agendaRemove: async (id) => {
      settings = { ...settings, agenda: { ...settings.agenda, sources: settings.agenda.sources.filter((x) => x.id !== id) } }
      settingsCh.emit(settings)
      return settings
    },
    setCity: async (name) => {
      settings = { ...settings, day: { ...settings.day, city: name.trim() ? `${name.trim()}, France` : '', cityLat: 45, cityLon: 5 } }
      settingsCh.emit(settings)
      return settings
    },
    reminders: async () => reminders,
    onReminders: remindersCh.on,
    cancelReminder: async (id) => {
      reminders = reminders.filter((r) => r.id !== id)
      remindersCh.emit(reminders)
      return true
    },
    snoozeReminder: async (id, minutes) => {
      reminders = reminders.map((r) => (r.id === id ? { ...r, dueAt: Date.now() + minutes * 60_000 } : r)).sort((a, b) => a.dueAt - b.dueAt)
      remindersCh.emit(reminders)
      return reminders.find((r) => r.id === id) ?? null
    },
    onSentLog: () => () => true,
    media: async () => media,
    onMedia: mediaCh.on,
    mediaControl: async (action) => {
      if (!media) return false
      if (action === 'play_pause')
        media = {
          ...media,
          status: media.status === 'playing' ? 'paused' : 'playing',
          position: media.position + (media.status === 'playing' ? (Date.now() - media.at) / 1000 : 0),
          at: Date.now()
        }
      else
        media = { ...media, title: action === 'next' ? 'Kannaana Kanney' : 'Vaseegara', artist: 'Flute Navin', position: 0, at: Date.now(), status: 'playing' }
      mediaCh.emit(media)
      return true
    },
    timer: async () => timer,
    onTimer: timerCh.on,
    startTimer: async (minutes, label) => setTimer(newTimer(minutes * 60_000, label ?? '', Date.now()))!,
    startPomodoro: async () => setTimer(newPomodoro({}, Date.now()))!,
    pauseTimer: async () => setTimer(timer && paused(timer, Date.now())),
    resumeTimer: async () => setTimer(timer && resumed(timer, Date.now())),
    stopTimer: async () => {
      const was = timer
      setTimer(null)
      return was
    },
    voices: async () => VOICES,
    // Dictée (scénario ?voice=installed) : téléchargement simulé, sans rien télécharger.
    voiceModelStatus: async (model) => voiceStatus(model ?? settings.voice.model),
    voiceModelDownload: async (model, variant) => {
      const total = VOICE_MODELS[model].variants[variant].approxMb * 1e6
      for (let received = 0; received <= total; received += total / 25) {
        if (voiceCancelled) {
          voiceCancelled = false
          voiceDl = null
          voiceCh.emit(voiceStatus(model))
          throw new Error('Téléchargement annulé.')
        }
        voiceDl = { model, variant, received, total }
        voiceCh.emit(voiceStatus(model))
        await new Promise((r) => setTimeout(r, 120))
      }
      voiceDl = null
      voiceInstalled = { ...voiceInstalled, [model]: variant }
      voiceCh.emit(voiceStatus(model))
      return voiceStatus(model)
    },
    voiceModelCancel: async () => {
      voiceCancelled = Boolean(voiceDl)
    },
    voiceModelDelete: async (model) => {
      const { [model]: _gone, ...rest } = voiceInstalled
      voiceInstalled = rest
      return voiceStatus(model)
    },
    onVoiceModelProgress: voiceCh.on,
    speechModelStatus: async (model) => speechStatus(model),
    speechModelDownload: async (model) => {
      const total = SPEECH_PACKS[model].approxMb * 1e6
      for (let received = 0; received <= total; received += total / 25) {
        if (speechCancelled) {
          speechCancelled = false
          speechDl = null
          speechCh.emit(speechStatus(model))
          throw new Error('Téléchargement annulé.')
        }
        speechDl = { model, received, total }
        speechCh.emit(speechStatus(model))
        await new Promise((r) => setTimeout(r, 120))
      }
      speechDl = null
      speechInstalled = { ...speechInstalled, [model]: true }
      if (model === 'voices') voicesOld = false
      speechCh.emit(speechStatus(model))
      return speechStatus(model)
    },
    speechModelCancel: async () => {
      speechCancelled = Boolean(speechDl)
    },
    speechModelDelete: async (model) => {
      speechInstalled = { ...speechInstalled, [model]: false }
      if (model === 'voices') voicesOld = false
      return speechStatus(model)
    },
    onSpeechModelProgress: speechCh.on,
    meetingStart: async (opts) => {
      if (recording) throw new Error('Un enregistrement est déjà en cours.')
      const startedAt = Date.now()
      const meeting: Meeting = {
        id: crypto.randomUUID(),
        title: opts.event?.title ?? defaultMeetingTitle(startedAt),
        startedAt,
        durationMs: 0,
        status: 'recording',
        engine: opts.engine,
        others: opts.others,
        hasSummary: false,
        audio: true,
        lines: [],
        names: {},
        people: opts.others ? opts.people : undefined,
        ...(opts.event ? { event: opts.event } : {})
      }
      let i = 0
      const timer = setInterval(() => {
        const next = DEMO_LIVE[i++ % DEMO_LIVE.length]
        const t = (Date.now() - startedAt) / 1000
        const line = { start: Math.max(0, t - 3), end: t, who: opts.others || next.who === 'me' ? next.who : 'me', text: next.text }
        meeting.lines.push(line)
        meetingCh.emit({ type: 'line', id: meeting.id, line })
      }, 3500)
      recording = { meeting, timer }
      demoMeetings.push(meeting)
      meetingsCh.emit(meetingList())
      return { id: meeting.id, startedAt, systemAudio: opts.others ? 'windows' : 'none' }
    },
    meetingAudio: () => undefined,
    meetingStop: async () => {
      if (!recording) return null
      const { meeting, timer } = recording
      clearInterval(timer)
      recording = null
      meeting.durationMs = Date.now() - meeting.startedAt
      meeting.status = 'processing'
      meetingCh.emit({ type: 'processing', id: meeting.id, step: 'Je termine la transcription…' })
      await new Promise((r) => setTimeout(r, 1200))
      meeting.status = 'done'
      meeting.audio = false
      meetingsCh.emit(meetingList())
      meetingCh.emit({ type: 'done', id: meeting.id, meta: metaOf(meeting) })
      return metaOf(meeting)
    },
    meetingDiscard: async () => {
      if (!recording) return
      clearInterval(recording.timer)
      const id = recording.meeting.id
      demoMeetings.splice(
        demoMeetings.findIndex((m) => m.id === id),
        1
      )
      recording = null
      meetingsCh.emit(meetingList())
      meetingCh.emit({ type: 'stopped', id, message: 'Enregistrement annulé : rien n’a été gardé.' })
    },
    meetingPeople: async (id, people) => {
      if (recording?.meeting.id !== id || !recording.meeting.others) return false
      recording.meeting.people = people
      return true
    },
    onMeetingEvent: meetingCh.on,
    meetingPrep: async (ev) => {
      await new Promise((r) => setTimeout(r, 600))
      const prev = pickPrevious(ev, meetingList())
      const full = prev ? demoMeetings.find((m) => m.id === prev.id) : undefined
      return {
        mails: settings.google.mail
          ? [
              {
                id: 'p1a2b3c4',
                from: 'Claire Martin <claire@exemple.fr>',
                subject: 'Ordre du jour de jeudi',
                date: new Date(Date.now() - 86_400_000).toISOString()
              },
              { id: 'p2b3c4d5', from: 'Paul <paul@exemple.fr>', subject: 'Re: Captures de la page', date: new Date(Date.now() - 3 * 86_400_000).toISOString() }
            ]
          : null,
        previous: prev ? { id: prev.id, title: prev.title, startedAt: prev.startedAt, tasks: full?.summary?.tasks ?? [] } : null
      }
    },
    meetings: async () => meetingList(),
    meeting: async (id) => demoMeetings.find((m) => m.id === id) ?? null,
    deleteMeeting: async (id) => {
      const i = demoMeetings.findIndex((m) => m.id === id)
      if (i >= 0) demoMeetings.splice(i, 1)
      meetingsCh.emit(meetingList())
      return meetingList()
    },
    renameMeeting: async (id, title) => {
      const m = demoMeetings.find((x) => x.id === id)
      if (m && title.trim()) m.title = title.trim()
      meetingsCh.emit(meetingList())
      return m ? { ...m } : null
    },
    nameMeetingVoice: async (id, who, name) => {
      const i = demoMeetings.findIndex((x) => x.id === id)
      if (i < 0) return null
      demoMeetings[i] = nameVoice(demoMeetings[i], who, name.trim())
      return { ...demoMeetings[i] }
    },
    resumeMeeting: async (id) => {
      const m = demoMeetings.find((x) => x.id === id)
      if (!m) return null
      await new Promise((r) => setTimeout(r, 1500))
      m.status = 'done'
      m.audio = false
      meetingsCh.emit(meetingList())
      return metaOf(m)
    },
    summarizeMeeting: async (id) => {
      const m = demoMeetings.find((x) => x.id === id)
      if (!m) throw new Error('Réunion introuvable.')
      await new Promise((r) => setTimeout(r, 1500))
      m.summary = DEMO_SUMMARY
      m.hasSummary = true
      meetingsCh.emit(meetingList())
      return { ...m }
    },
    exportMeeting: async () => true,
    onMeetings: meetingsCh.on,
    onDictationCommand: () => () => undefined,
    dictationTranscribe: async () => '',
    dictationPrepare: () => undefined,
    dictationDeliver: async () => ({ kind: 'empty' }),
    dictationEnded: () => undefined,
    dictationStop: () => undefined,
    dictationStats: async () => dictationRows,
    clearDictationStats: async () => {
      dictationRows = []
      statsCh.emit(dictationRows)
      return dictationRows
    },
    onDictationStats: statsCh.on,
    speak: async (text) => {
      await new Promise((r) => setTimeout(r, 150))
      return silentWav(text)
    },
    onQuickOpen: quickOpenCh.on,
    onQuickEvent: quickCh.on,
    quickRun: async (id, action) => {
      clearInterval(quickTimer)
      const chunks = (QUICK_RESULTS[action] ?? '').match(/.{1,5}/gs) ?? []
      let i = 0
      quickTimer = setInterval(() => {
        if (i < chunks.length) quickCh.emit({ type: 'delta', id, delta: chunks[i++] })
        else {
          clearInterval(quickTimer)
          quickCh.emit({ type: 'done', id, text: QUICK_RESULTS[action] ?? '' })
        }
      }, 30)
    },
    quickStop: async () => clearInterval(quickTimer),
    quickReplace: async () => ({ ok: false, message: 'Aperçu web : rien à remplacer ici.' }),
    quickCopy: async () => true,

    listConversations: async () => conversations.map(({ id, title, updatedAt, brain }) => ({ id, title, updatedAt, brain })),
    getConversation: async (id) => conversations.find((c) => c.id === id) ?? null,
    deleteConversation: async (id) => {
      const i = conversations.findIndex((c) => c.id === id)
      if (i >= 0) conversations.splice(i, 1)
    },
    send: async (req) => {
      const conversationId = req.conversationId ?? uid()
      const userMessage = { id: uid(), role: 'user' as const, text: req.text, attachments: req.attachments, createdAt: Date.now() }
      const assistantMessageId = uid()
      if (!conversations.some((c) => c.id === conversationId)) {
        conversations.unshift({ id: conversationId, title: req.text.slice(0, 60), updatedAt: Date.now(), messages: [], brain: defaultBrain(settings) })
      }
      void reply(conversationId, assistantMessageId, req.text)
      return { conversationId, userMessage, assistantMessageId }
    },
    stop: async () => undefined,
    undoTextEdit: async () => ({ ok: true, message: 'Idées.md est revenu à sa version d’avant.' }),
    onAgentEvent: agent.on,
    onOpenConversation: openConvCh.on,

    memory: async () => memoryList(),
    addMemory: async (fact) => {
      const text = cleanFact(fact)
      if (!text) throw new Error('Souvenir vide.')
      if (memory.some((m) => sameFact(m.fact, text))) throw new Error('C’est déjà noté.')
      memory = [...memory, { id: uid(), fact: text, createdAt: Date.now(), source: 'manual' }]
      return pushMemory()
    },
    updateMemory: async (id, fact) => {
      memory = memory.map((m) => (m.id === id ? { ...m, fact: cleanFact(fact), updatedAt: Date.now() } : m)).filter((m) => m.fact)
      return pushMemory()
    },
    deleteMemory: async (id) => {
      memory = memory.filter((m) => m.id !== id)
      return pushMemory()
    },
    clearMemory: async () => {
      memory = []
      return pushMemory()
    },
    onMemory: memoryCh.on,

    routines: async () => [...routines],
    saveRoutine: async (draft) => {
      const clean = cleanDraft(draft)
      // Heure fixe ou événement : l'un remplace l'autre.
      if (clean.id)
        routines = routines.map((r) => {
          if (r.id !== clean.id) return r
          const { repeat: _repeat, trigger: _trigger, ...rest } = r
          return { ...rest, ...clean, enabled: clean.enabled ?? true, nextAt: clean.trigger ? 0 : r.nextAt || Date.now() + day }
        })
      else
        routines = [
          ...routines,
          {
            id: uid(),
            title: clean.title,
            prompt: clean.prompt,
            ...(clean.trigger ? { trigger: clean.trigger } : { repeat: clean.repeat }),
            enabled: true,
            nextAt: clean.trigger ? 0 : Date.now() + day,
            createdAt: Date.now(),
            allow: clean.allow
          }
        ]
      return pushRoutines()
    },
    deleteRoutine: async (id) => {
      routines = routines.filter((r) => r.id !== id)
      return pushRoutines()
    },
    runRoutine: async (id) => {
      routines = routines.map((r) => (r.id === id ? { ...r, running: true } : r))
      setTimeout(() => {
        routines = routines.map((r) =>
          r.id === id && r.running
            ? { ...r, running: undefined, lastRun: { at: Date.now(), ok: true, conversationId: 'c1', preview: 'Rien d’urgent ce matin.' } }
            : r
        )
        pushRoutines()
        notices.emit({ pill: 'routine', text: `${routines.find((r) => r.id === id)?.title ?? 'Routine'} : rien d’urgent ce matin.`, conversationId: 'c1' })
      }, 2500)
      return pushRoutines()
    },
    stopRoutine: async (id) => {
      routines = routines.map((r) => (r.id === id ? { ...r, running: undefined, lastRun: { at: Date.now(), ok: false, error: 'Routine arrêtée.' } } : r))
      return pushRoutines()
    },
    onRoutines: routinesCh.on,

    clips: async () => (settings.clipboardHistory ? [...clips] : []),
    copyClip: async (id) => clips.some((c) => c.id === id),
    pinClip: async (id, pinned) => {
      clips = clips.map((c) => (c.id === id ? { ...c, pinned: pinned || undefined } : c))
      return pushClips()
    },
    deleteClip: async (id) => {
      clips = clips.filter((c) => c.id !== id)
      return pushClips()
    },
    clearClips: async () => {
      clips = []
      return pushClips()
    },
    onClips: clipsCh.on,

    semanticStatus: async () => semantic,
    enableSemantic: async () => {
      // Téléchargement et lecture simulés : rien n'est téléchargé dans l'aperçu.
      let p = 0
      setSemantic({ state: 'no-model', error: undefined })
      const model = settings.semantic.model
      const dl = setInterval(() => {
        p = Math.min(1, p + 0.2)
        if (p < 1) return brainCh.emit({ kind: 'pull', model, status: 'Téléchargement', progress: p })
        clearInterval(dl)
        brainCh.emit({ kind: 'pull', model, status: 'Terminé', progress: 1, done: true })
        let n = 0
        const read = setInterval(() => {
          n += 6
          if (n < 48) return setSemantic({ state: 'indexing', files: 48, indexed: n, passages: n * 27, current: `Contrat-${n}.pdf` })
          clearInterval(read)
          setSemantic({ state: 'ready', files: 48, indexed: 48, passages: 1312, current: undefined, updatedAt: Date.now() })
        }, 350)
      }, 400)
      return semantic
    },
    disableSemantic: async (removeModel) =>
      setSemantic({ state: 'off', files: 0, indexed: 0, passages: 0, updatedAt: undefined, modelInstalled: !removeModel }),
    reindexSemantic: async () => setSemantic({ updatedAt: Date.now() }),
    trySemantic: async (query) => {
      await new Promise((r) => setTimeout(r, 600))
      if (semantic.state !== 'ready') return null
      if (/zzz/i.test(query)) return []
      const base = 'C:\\Users\\Moi\\Documents\\Contrats\\'
      return [
        {
          file: `${base}Bail-appartement.pdf`,
          page: 4,
          score: 0.71,
          text: 'Article 9 – Fin du contrat. Le locataire peut donner congé à tout moment, avec un préavis de trois mois, réduit à un mois en zone tendue.'
        },
        {
          file: `${base}Assurance-habitation.pdf`,
          page: 2,
          score: 0.58,
          text: 'Résiliation : le contrat peut être résilié à tout moment après la première année, sans frais ni pénalités (loi Hamon).'
        },
        {
          file: `${base}Box-internet.pdf`,
          score: 0.49,
          text: 'Vous pouvez mettre fin à votre abonnement à tout moment ; des frais de résiliation de 49 € s’appliquent.'
        }
      ]
    },
    openSemanticFile: async () => true,
    onSemantic: semanticCh.on,

    onApprovals: (cb) => {
      const off = approvalsCh.on(cb)
      cb([...approvals])
      return off
    },
    decide: async (id) => {
      approvals = approvals.filter((a) => a.id !== id)
      pushApprovals()
    },
    onQuestions: (cb) => {
      const off = questionsCh.on(cb)
      cb([...questions])
      return off
    },
    answer: async ({ id }) => {
      questions = questions.filter((q) => q.id !== id)
      pushQuestions()
    },

    onSessions: (cb) => {
      const off = sessionsCh.on(cb)
      setTimeout(() => cb([...sessions]), 0)
      return off
    },
    previewHooks: async () => ({
      settingsPath: 'C:\\Users\\demo\\.claude\\settings.json',
      exists: true,
      before: '{\n  "autoCompactWindow": 500000\n}',
      after: '{\n  "autoCompactWindow": 500000,\n  "hooks": { "…": "…" }\n}'
    }),
    connectClaudeCode: async () => {
      settings = { ...settings, claudeCode: { ...settings.claudeCode, connected: true } }
      return settings
    },
    disconnectClaudeCode: async () => {
      settings = { ...settings, claudeCode: { ...settings.claudeCode, connected: false } }
      return settings
    },

    saveConnector: async (config) => {
      const id = config.id || uid()
      const next = settings.connectors.some((c) => c.id === id)
        ? settings.connectors.map((c) => (c.id === id ? { ...config, id } : c))
        : [...settings.connectors, { ...config, id }]
      settings = { ...settings, connectors: next }
      return settings
    },
    deleteConnector: async (id) => {
      settings = { ...settings, connectors: settings.connectors.filter((c) => c.id !== id) }
      return settings
    },
    testConnector: async (id) =>
      settings.connectorAuth[id]?.expired
        ? { ok: false, needsLogin: true, message: 'Accès retiré par le service : reconnecte-toi.' }
        : { ok: true, message: 'Connecté : 11 outils disponibles.', tools: ['read_file', 'list_directory'] },
    connectorOAuth: async (input, clientSecret) => {
      await new Promise((r) => setTimeout(r, 2500))
      const id = input.id || uid()
      const previous = settings.connectors.find((c) => c.id === id)?.oauthClient
      const config = { ...input, oauthClient: input.oauthClient && { ...input.oauthClient, secret: Boolean(clientSecret || previous?.secret) || undefined } }
      const next = settings.connectors.some((c) => c.id === id)
        ? settings.connectors.map((c) => (c.id === id ? { ...config, id } : c))
        : [...settings.connectors, { ...config, id }]
      settings = { ...settings, connectors: next, connectorAuth: { ...settings.connectorAuth, [id]: { connected: true } } }
      settingsCh.emit(settings)
      return { ok: true, settings }
    },
    connectorOAuthCancel: async () => undefined,
    searchRegistry: async (query) => {
      await new Promise((r) => setTimeout(r, 500))
      return REGISTRY_DEMO.filter((e) => `${e.title} ${e.description}`.toLowerCase().includes(query.toLowerCase().trim()))
    },
    pickFolders: async () => {
      settings = { ...settings, folders: [...new Set([...settings.folders, 'C:\\Users\\demo\\Documents\\Contrats'])] }
      settingsCh.emit(settings)
      return settings
    },
    pickFiles: async () => ['C:\\Users\\demo\\Documents\\Bail-appartement.pdf'],
    listSkills: async () => skillInfos(),
    getSkill: async (name) => {
      const s = skills.find((x) => x.name === name)
      return s ? { name: s.name, description: s.description, body: s.body } : null
    },
    saveSkill: async (draft: SkillDraft) => {
      const name = draft.name
        .toLowerCase()
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
      skills = [
        ...skills.filter((x) => x.name !== draft.previousName && x.name !== name),
        { name, description: draft.description, body: draft.body, builtin: false, valid: true, hasFiles: false }
      ].sort((a, b) => a.name.localeCompare(b.name))
      return skillInfos()
    },
    deleteSkill: async (name) => {
      skills = skills.filter((x) => x.name !== name)
      return skillInfos()
    },
    importSkill: async () => skillInfos(),
    openSkillsFolder: async () => undefined,

    localStatus: async () => ({
      engine: localRunning || localModels.length ? 'ollama' : null,
      baseUrl: 'http://127.0.0.1:11434',
      running: localRunning,
      installed: localRunning,
      version: localRunning ? '0.32.1' : undefined,
      outdated: false,
      canInstall: true,
      models: localModels
    }),
    modelsFolder: async () => (localRunning ? demoFolder() : null),
    openModelsFolder: async () => undefined,
    restartOllama: async () => {
      await new Promise((r) => setTimeout(r, 1500))
      folderStale = false
      return demoFolder()
    },
    installOllama: async () => {
      const steps: Array<[string, number | undefined]> = [
        ['Préparation', undefined],
        ['Téléchargement', 0.2],
        ['Téléchargement', 0.55],
        ['Téléchargement', 0.9],
        ['Installation', undefined],
        ['Démarrage d’Ollama', undefined]
      ]
      steps.forEach(([status, progress], i) => setTimeout(() => brainCh.emit({ kind: 'install', status, progress }), i * 500))
      setTimeout(() => {
        localRunning = true
        brainCh.emit({ kind: 'install', status: 'Prêt', progress: 1, done: true })
      }, steps.length * 500)
    },
    startLocalEngine: async () => {
      localRunning = true
      return {
        engine: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        running: true,
        installed: true,
        version: '0.32.1',
        outdated: false,
        canInstall: true,
        models: localModels
      }
    },
    pullModel: async (name) => {
      let p = 0
      brainCh.emit({ kind: 'pull', model: name, status: 'Préparation', progress: 0 })
      pullTimer = setInterval(() => {
        p = Math.min(1, p + 0.17)
        if (p < 1) return brainCh.emit({ kind: 'pull', model: name, status: 'Téléchargement', progress: p })
        clearInterval(pullTimer)
        const c = CATALOG.find((m) => m.id === name)
        localModels = [
          ...localModels.filter((m) => m.name !== name),
          { name, sizeBytes: (c?.sizeGb ?? 5) * 1024 ** 3, tools: true, vision: c?.vision ?? false, thinking: c?.thinking ?? false }
        ]
        brainCh.emit({ kind: 'pull', model: name, status: 'Terminé', progress: 1, done: true })
      }, 450)
    },
    cancelPull: async () => {
      clearInterval(pullTimer)
      brainCh.emit({ kind: 'pull', status: 'Annulé', done: true })
    },
    onBrainProgress: brainCh.on,
    hardwareInfo: async () => HW,
    recommendBrain: async (answers) => {
      settings = { ...settings, brainQuiz: answers }
      await new Promise((r) => setTimeout(r, 300))
      return recommend(answers, HW)
    },
    testBrain: async (brain) => {
      await new Promise((r) => setTimeout(r, 1200))
      return brain.provider === 'local'
        ? { ok: true, tokensPerSec: 41, tools: true, message: 'Ça marche : première réponse en 0,8 s · 41 jetons/s · sait utiliser mes outils.' }
        : { ok: true, tokensPerSec: 78, tools: true, message: 'Ça marche : première réponse en 1,1 s · 78 jetons/s · sait utiliser mes outils.' }
    },
    setCustomKey: async (key) => {
      settings = { ...settings, hasCustomKey: Boolean(key) }
      return settings
    },
    setWebSearchKey: async (key) => {
      settings = { ...settings, hasWebSearchKey: Boolean(key) }
      return settings
    },
    testWebSearch: async () => {
      await new Promise((r) => setTimeout(r, 900))
      return { ok: true, message: 'Ça marche : 3 résultat(s) reçu(s).' }
    },
    setConversationBrain: async (id, brain) => {
      const conv = conversations.find((c) => c.id === id)
      if (conv) conv.brain = brain
    },

    getPathForFile: (file) => `C:\\Users\\demo\\Downloads\\${file.name}`,
    openExternal: async (url) => void window.open(url, '_blank'),
    openFolder: async () => undefined,
    quit: () => undefined
  }
}

const DEMO_SUMMARY: MeetingSummary = {
  title: 'Lancement de la nouvelle page',
  summary:
    'Point d’équipe sur le lancement de la page produit. La page est prête ; il manque les captures d’écran. Le lancement est maintenu au lundi 3 novembre si les captures arrivent jeudi.',
  points: ['La page produit est prête', 'Les captures d’écran manquent encore', 'Lancement maintenu au lundi 3 novembre'],
  tasks: [
    { text: 'Envoyer les captures d’écran à Léa', owner: 'Alex', due: 'jeudi' },
    { text: 'Relire le texte de la page', owner: 'Léa', due: 'vendredi' }
  ],
  brain: 'Gemma 4 · sur ce PC',
  at: Date.now() - 3 * 3600_000
}

/** Réunions de démonstration (persona Alex) : une résumée, une interrompue. */
function DEMO_MEETINGS(): Meeting[] {
  const t0 = Date.now() - 3 * 3600_000
  return [
    {
      id: '6f1c2a10-0000-4000-8000-000000000001',
      title: 'Lancement de la nouvelle page',
      startedAt: t0,
      durationMs: 23 * 60_000,
      status: 'done',
      engine: 'parakeet',
      others: true,
      speakers: 2,
      hasSummary: true,
      audio: false,
      names: { s1: 'Léa' },
      summary: DEMO_SUMMARY,
      // La fois d'avant du « Point équipe » de démonstration (même série).
      event: {
        id: 'e2-prev',
        seriesId: 'serie-point-equipe',
        title: 'Point équipe',
        start: new Date(t0).toISOString(),
        attendees: ['claire@exemple.fr', 'paul@exemple.fr']
      },
      lines: [
        { start: 2, end: 6, who: 's1', text: 'Bonjour à tous, on commence par le point sur le lancement.' },
        { start: 7, end: 11, who: 'me', text: 'Oui, la page est prête, il manque juste les captures.' },
        { start: 12, end: 16, who: 's2', text: 'On garde la date du lundi 3 novembre ?' },
        { start: 17, end: 21, who: 's1', text: 'Oui, si les captures arrivent jeudi. Alex, tu me les envoies ?' },
        { start: 22, end: 25, who: 'me', text: 'Je m’en occupe demain matin.' },
        { start: 26, end: 30, who: 's1', text: 'Super. Moi je relis le texte de la page d’ici vendredi.' }
      ]
    },
    {
      id: '6f1c2a10-0000-4000-8000-000000000002',
      title: 'Appel du 20 oct., 17 h 40',
      startedAt: t0 - 26 * 3600_000,
      durationMs: 9 * 60_000,
      status: 'interrupted',
      engine: 'parakeet',
      others: true,
      hasSummary: false,
      audio: true,
      names: {},
      lines: [{ start: 1, end: 4, who: 'others', text: 'Merci d’avoir pris le temps de m’appeler.' }]
    }
  ]
}
