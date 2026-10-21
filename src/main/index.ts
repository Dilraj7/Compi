import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { app, globalShortcut, ipcMain, shell } from 'electron'
import { IPC } from '../shared/ipc'
import { recommend } from '../shared/recommend'
import type {
  AgendaDraft,
  Brain,
  BrainQuizAnswers,
  ConnectorConfig,
  ApprovalKeysSettings,
  DaySettings,
  KeepAlive,
  MediaAction,
  PublicSettings,
  RoutineDraft,
  Settings,
  SkillDraft,
  SoundSettings,
  VoiceModelId,
  VoiceSettings,
  VoiceVariant
} from '../shared/types'
import { runRoutineAgent, sendMessage, stopAll, stopConversation } from './agent/assistant'
import { normalizeWorkspaceId } from './agent/errors'
import { cancelReminder, listReminders, restoreReminders, snoozeReminder } from './day/reminders'
import { inMeeting, startMeetings, stopMeetings } from './day/meetings'
import { getTimer, pauseTimer, restoreTimer, resumeTimer, startPomodoro, startTimer, stopTimer, stopTimers } from './day/timer'
import { buildToday, startMorning } from './day/today'
import { addSource, agendaTools, calendarChoices, previewSource, removeSource, setGoogleCalendars, updateSource } from './day/agenda'
import { findCity } from './day/weather'
import { GOOGLE_ENDPOINTS } from './google/auth'
import { cancelGoogleConnect, connectGoogle, disconnectGoogle, googleEndpoints, hasGoogleClient, importGoogleClient } from './google/connect'
import { approvals } from './approvals'
import { hardwareInfo } from './brains/hardware'
import { stopGateway } from './brains/gateway'
import { cancelPull, keepWarm, localStatus, ollamaBase, runInstall, startLocalEngine, startPull } from './brains/local'
import { ollamaFolder, resolveModelsDir, restartOllama } from './brains/modelsDir'
import { testBrain } from './brains/probe'
import { startHookServer, stopHookServer } from './bridge/hookServer'
import { installHooks, previewHooks, uninstallHooks } from './bridge/installHooks'
import { sessions } from './bridge/sessions'
import { emit, setBusTarget } from './bus'
import { searchRegistry } from './connectors/mcpRegistry'
import { cancelOAuth, connectOAuth, forgetOAuth } from './connectors/oauth'
import { connectorAuthStates, testConnector } from './connectors/registry'
import { clearClips, copyClip, deleteClip, flushClipboardHistory, listClips, pinClip, startClipboardHistory, stopClipboardHistory } from './clipboard/history'
import { log } from './log'
import { addMemory, clearMemory, deleteMemory, listMemory, updateMemory } from './memory/store'
import { deleteRoutine, listRoutines, restoreRoutines, runRoutineNow, saveRoutine, setRoutineRunner, stopRoutineRun, stopRoutines } from './routines/store'
import { checkSemantic, clearSemantic, enableSemantic, semanticSearch, semanticStatus, startSemantic, stopSemantic, syncSemantic } from './semantic'
import { allowedFolders, insideAny } from './agent/folders'
import { deleteModel } from './brains/ollama'
import { deleteSkill, ensureSkillsPlugin, getSkill, importSkill, listSkills, pluginDir, saveSkill } from './skills/store'
import {
  approvalKeyFree,
  armApprovalKeys,
  disarmApprovalKeys,
  initQuickShortcut,
  initShortcut,
  initVoiceShortcut,
  isMainShortcut,
  onApprovalShortcut,
  prettyShortcut,
  quickShortcutActive,
  setQuickShortcut,
  setShortcut,
  setVoiceShortcut,
  shortcutActive,
  voiceShortcutActive
} from './shortcut'
import { copyQuick, onQuickShortcut, replaceQuick, runQuick, stopQuick } from './quick/actions'
import { stopHost, warmHost } from './windows/host'
import { controlMedia, currentMedia, hookMediaPower, listVoices, synthesize, watchMedia } from './windows/media'
import {
  cancelVoiceDownload,
  cleanPartialDownloads,
  deleteVoiceModel,
  downloadVoiceModel,
  handleModelScheme,
  registerModelScheme,
  voiceModelStatus
} from './voice/model'
import { isVoiceModel } from '../shared/voice'
import { restrictPermissions } from './permissions'
import { clearSent, listSent } from './privacy/log'
import { clearApprovalLog, listApprovalLog } from './privacy/approvalLog'
import { claudeCodeUsage, refreshClaudeCodeUsage, startUsageWatch, stopUsageWatch } from './usage/claudeCode'
import { compiUsage } from './usage/compi'
import {
  activateMessages,
  hookMessagesPower,
  ignoreMessage,
  messagesStatus,
  openMessageApp,
  refreshAccess,
  snoozeMessage,
  stopMessages,
  syncMessages
} from './messages/watch'
import { cleanMessagesPatch } from '../shared/messages'
import { keyTarget } from '../shared/attention'
import { SOUND_KINDS, shouldPlay, type SoundKind } from '../shared/sounds'
import type { PillId } from '../shared/pills'
import { fullscreenNow, hookPerfPower, perfWatch, stopPerf, unloadLocal } from './system/monitor'
import { createNotchWindow, onPanelOpen, registerIslandIpc, sendIslandCommand, showOpenDialog } from './notchWindow'
import { conversations } from './store/conversations'
import { secrets } from './store/secrets'
import { OLLAMA_URL, settings } from './store/settings'
import { createTray } from './tray'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

app.setAppUserModelId('com.compi.app')
// Avant « ready » : le protocole qui sert les modèles de dictée installés.
registerModelScheme()

function publicSettings(): PublicSettings {
  const s = settings.get()
  const connectorSecrets: Record<string, string[]> = {}
  for (const c of s.connectors) connectorSecrets[c.id] = secrets.listConnectorSecretNames(c.id)
  return {
    ...s,
    hasApiKey: secrets.hasApiKey(),
    hasCustomKey: secrets.hasCustomKey(),
    shortcutActive: shortcutActive(),
    quickShortcutActive: quickShortcutActive(),
    voiceShortcutActive: voiceShortcutActive(),
    approvalKeysTaken,
    hasGoogleClient: hasGoogleClient(),
    connectorSecrets,
    connectorAuth: connectorAuthStates()
  }
}

/** Réglages « Ta journée » modifiables depuis l'interface, validés. */
function cleanDay(d: Partial<DaySettings>): Partial<DaySettings> {
  const out: Partial<DaySettings> = {}
  if (typeof d.morning === 'boolean') out.morning = d.morning
  if (typeof d.morningTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.morningTime)) out.morningTime = d.morningTime
  if (typeof d.meetingAlerts === 'boolean') out.meetingAlerts = d.meetingAlerts
  if (typeof d.meetingMinutes === 'number' && d.meetingMinutes >= 0 && d.meetingMinutes <= 60) out.meetingMinutes = Math.round(d.meetingMinutes)
  return out
}

/** Source d'agenda proposée par l'interface, validée. */
function cleanAgendaDraft(d: AgendaDraft): AgendaDraft {
  const name = typeof d?.name === 'string' ? d.name.slice(0, 60) : undefined
  if (d?.kind === 'ics' && typeof d.url === 'string') return { kind: 'ics', url: d.url.slice(0, 2000), name }
  if (d?.kind === 'connector' && typeof d.connectorId === 'string' && typeof d.tool === 'string')
    return {
      kind: 'connector',
      connectorId: d.connectorId,
      tool: d.tool.slice(0, 200),
      ...(typeof d.via === 'string' ? { via: d.via.slice(0, 200) } : {}),
      name
    }
  throw new Error('Source d’agenda invalide.')
}

/** Réglages de la voix, validés. */
function cleanVoice(v: Partial<VoiceSettings>): Partial<VoiceSettings> {
  const out: Partial<VoiceSettings> = {}
  if (v.speak === 'never' || v.speak === 'voice' || v.speak === 'always') out.speak = v.speak
  if (typeof v.voice === 'string' && v.voice.length < 300) out.voice = v.voice
  if (typeof v.rate === 'number' && v.rate >= 0.5 && v.rate <= 2) out.rate = Math.round(v.rate * 100) / 100
  if (isVoiceModel(v.model)) out.model = v.model
  return out
}

/** Sons, validés (heures « HH:MM »). */
function cleanSounds(p: Partial<SoundSettings>): SoundSettings {
  const next = { ...settings.get().sounds }
  for (const k of ['enabled', 'approvals', 'reminders', 'messages', 'routines'] as const) if (typeof p[k] === 'boolean') next[k] = p[k]
  if (p.volume === 'very-low' || p.volume === 'low' || p.volume === 'medium') next.volume = p.volume
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/
  if (typeof p.quietStart === 'string' && hhmm.test(p.quietStart)) next.quietStart = p.quietStart
  if (typeof p.quietEnd === 'string' && hhmm.test(p.quietEnd)) next.quietEnd = p.quietEnd
  return next
}

const KEEP_ALIVE: KeepAlive[] = ['30m', '2h', '8h']

// ─── Autorisations au clavier ────────────────────────────────────────────────

/** Combinaisons qu'une autre application utilisait au dernier essai. */
let approvalKeysTaken: string[] = []

function setApprovalKeysTaken(taken: string[]): void {
  if (taken.join('|') === approvalKeysTaken.join('|')) return
  approvalKeysTaken = taken
  if (taken.length) log('warn', `raccourci d’autorisation déjà utilisé par une autre application : ${taken.map(prettyShortcut).join(', ')}`)
  emit(IPC.settingsChanged, publicSettings())
}

/** Les raccourcis ne sont pris que tant qu'une carte ou une question attend. */
function syncApprovalKeys(): void {
  const k = settings.get().approvalKeys
  const waiting = approvals.pendingApprovals().length + approvals.pendingQuestions().length > 0
  if (!k.enabled || !waiting) return disarmApprovalKeys()
  setApprovalKeysTaken(armApprovalKeys(k.allow, k.deny))
}

function onApprovalKey(decision: 'allow' | 'deny'): void {
  const t = keyTarget(approvals.pendingApprovals(), approvals.pendingQuestions(), Date.now())
  if (!t) return
  // Une question ne se répond pas à l'aveugle : le panneau s'ouvre dessus.
  if (t.kind === 'question') return sendIslandCommand('focus-pending')
  if (t.kind === 'too-soon') {
    emit(IPC.islandNotify, { pill: 'approval', text: 'Une demande vient d’arriver : lis-la, puis réessaie', duration: 2500, sound: null })
    return
  }
  approvals.decide(t.request.id, decision)
  log('info', `demande ${decision === 'allow' ? 'autorisée' : 'refusée'} au clavier : ${t.request.toolName}`)
  emit(IPC.islandNotify, { pill: 'approval', text: `${decision === 'allow' ? 'Autorisé' : 'Refusé'} : ${t.request.title}`, duration: 2500, sound: 'ok' })
}

/** Réglages des raccourcis d'autorisation, vérifiés : libres, différents, pas déjà à Compi. */
function cleanApprovalKeys(p: Partial<ApprovalKeysSettings>): ApprovalKeysSettings {
  const cur = settings.get().approvalKeys
  const next = { ...cur }
  if (typeof p.enabled === 'boolean') next.enabled = p.enabled
  for (const which of ['allow', 'deny'] as const) {
    const v = p[which]
    if (typeof v !== 'string' || v === cur[which]) continue
    if (v && isMainShortcut(v)) throw new Error(`« ${prettyShortcut(v)} » sert déjà à Compi. Choisis une autre combinaison.`)
    if (v && !approvalKeyFree(v)) throw new Error(`« ${prettyShortcut(v)} » est déjà utilisé par une autre application. Choisis une autre combinaison.`)
    next[which] = v
  }
  if (next.allow && next.allow === next.deny) throw new Error('Autoriser et refuser ont besoin de deux combinaisons différentes.')
  // Combinaisons vérifiées libres à l'instant : on oublie les anciennes alertes.
  setApprovalKeysTaken(approvalKeysTaken.filter((k) => (k === next.allow && next.allow === cur.allow) || (k === next.deny && next.deny === cur.deny)))
  return next
}

/** Un raccourci principal ne doit pas reprendre une touche d'autorisation. */
function checkNotApprovalKey(accelerator: string): void {
  const k = settings.get().approvalKeys
  if (accelerator && k.enabled && (accelerator === k.allow || accelerator === k.deny))
    throw new Error(`« ${prettyShortcut(accelerator)} » sert déjà à répondre aux autorisations. Choisis une autre combinaison.`)
}

// ─── Sons ────────────────────────────────────────────────────────────────────

async function soundAllowed(kind: SoundKind, pill?: PillId): Promise<boolean> {
  if (!SOUND_KINDS.includes(kind)) return false
  const t = getTimer()
  const ctx = {
    settings: settings.get().sounds,
    now: Date.now(),
    focus: Boolean(t?.pomodoro?.phase === 'focus' && t.endsAt),
    meeting: inMeeting(),
    fullscreen: false,
    pill
  }
  if (!shouldPlay(kind, ctx)) return false
  // Le plein écran se demande à Windows, seulement quand le reste dit oui.
  return kind === 'ok' || !(await fullscreenNow())
}

const syncMedia = (): void => watchMedia(settings.get().showMusic, (m) => emit(IPC.mediaChanged, m))
const syncClipboardHistory = (): void => (settings.get().clipboardHistory ? void startClipboardHistory() : stopClipboardHistory())

// ─── Pont Claude Code ────────────────────────────────────────────────────────

async function syncHookServer(): Promise<void> {
  const { claudeCode } = settings.get()
  if (claudeCode.connected) {
    try {
      await startHookServer(claudeCode)
    } catch (e) {
      console.error('[compi] serveur de hooks indisponible :', e)
    }
  } else {
    stopHookServer()
  }
}

sessions.on((event, s) => {
  if (event === 'done') {
    emit(IPC.islandNotify, { pill: 'claude-done', text: `${s.project} : terminé` })
    // Réponse terminée : l'utilisation de Claude Code a changé.
    void refreshClaudeCodeUsage()
  }
})

// ─── IPC ─────────────────────────────────────────────────────────────────────

function registerIpc(): void {
  ipcMain.handle(IPC.getSettings, () => publicSettings())

  ipcMain.handle(IPC.updateSettings, async (_e, patch: Partial<Settings>) => {
    const before = settings.get().claudeCode
    // Le jeton et la connexion du pont ne se modifient pas depuis l'interface.
    if (patch.claudeCode) {
      const { connected: _c, token: _t, ...rest } = patch.claudeCode
      patch = { ...patch, claudeCode: { ...before, ...rest } }
    }
    if (patch.workspaceId !== undefined) patch = { ...patch, workspaceId: normalizeWorkspaceId(patch.workspaceId) }
    // Le compte Google ne change que par la connexion ; la ville, par IPC.setCity.
    if (patch.google) {
      const { google: _g, ...rest } = patch
      patch = rest
    }
    // Les sources de l'agenda passent par leurs propres fonctions (essai, lien chiffré).
    if (patch.agenda) {
      const { agenda: _a, ...rest } = patch
      patch = rest
    }
    if (patch.day) patch = { ...patch, day: { ...settings.get().day, ...cleanDay(patch.day) } }
    if (patch.voice) {
      const wanted = patch.voice.shortcut
      if (typeof wanted === 'string' && wanted !== settings.get().voice.shortcut && !setVoiceShortcut(wanted)) {
        throw new Error(`« ${prettyShortcut(wanted)} » est déjà utilisé (par une autre application ou par Compi). Choisis une autre combinaison.`)
      }
      const clean = cleanVoice(patch.voice)
      if (typeof wanted === 'string') clean.shortcut = wanted
      patch = { ...patch, voice: { ...settings.get().voice, ...clean } }
    }
    if (patch.approvalKeys) patch = { ...patch, approvalKeys: cleanApprovalKeys(patch.approvalKeys) }
    if (patch.sounds) patch = { ...patch, sounds: cleanSounds(patch.sounds) }
    if (patch.monitor) patch = { ...patch, monitor: { island: Boolean(patch.monitor.island) } }
    if (patch.local && patch.local.keepAlive !== undefined && !KEEP_ALIVE.includes(patch.local.keepAlive))
      patch = { ...patch, local: { ...patch.local, keepAlive: settings.get().local.keepAlive } }
    for (const k of [patch.shortcut, patch.quickShortcut, patch.voice?.shortcut]) if (typeof k === 'string') checkNotApprovalKey(k)
    if (patch.shortcut !== undefined && patch.shortcut !== settings.get().shortcut && !setShortcut(patch.shortcut)) {
      throw new Error(`« ${prettyShortcut(patch.shortcut)} » est déjà utilisé par une autre application (1Password, Claude…). Choisis une autre combinaison.`)
    }
    if (patch.quickShortcut !== undefined && patch.quickShortcut !== settings.get().quickShortcut && !setQuickShortcut(patch.quickShortcut)) {
      throw new Error(
        `« ${prettyShortcut(patch.quickShortcut)} » est déjà utilisé (par une autre application ou pour ouvrir Compi). Choisis une autre combinaison.`
      )
    }
    // La recherche par le sens s'active et se désactive par ses propres boutons.
    if (patch.semantic) {
      const { semantic: _s, ...rest } = patch
      patch = rest
    }
    // Messages : activés seulement par « Activer » (accès de Windows vérifié) ; jamais « Toujours » en ligne.
    if (patch.messages) patch = { ...patch, messages: cleanMessagesPatch(patch.messages, settings.get().messages) }
    if (patch.privacy?.messages === 'always') patch = { ...patch, privacy: { ...patch.privacy, messages: 'ask' } }
    const dayBefore = settings.get().day
    const foldersBefore = settings.get().folders.join('|')
    const next = settings.update(patch).claudeCode
    if (patch.day && (dayBefore.meetingAlerts !== settings.get().day.meetingAlerts || dayBefore.meetingMinutes !== settings.get().day.meetingMinutes))
      startMeetings()
    if (patch.showMusic !== undefined) syncMedia()
    if (patch.clipboardHistory !== undefined) syncClipboardHistory()
    if (patch.messages) syncMessages()
    if (patch.approvalKeys) syncApprovalKeys()
    if (patch.folders && settings.get().folders.join('|') !== foldersBefore) void syncSemantic()
    // Nouveau délai : les hooks portent ce délai, on les réécrit et on relance le serveur.
    if (next.connected && next.permissionTimeoutSec !== before.permissionTimeoutSec) {
      installHooks(next)
      await syncHookServer()
    }
    return publicSettings()
  })

  ipcMain.handle(IPC.setApiKey, (_e, key: string | null) => {
    try {
      secrets.setApiKey(key)
    } catch (e) {
      log('error', 'clé API non enregistrée', e)
      throw e
    }
    log('info', `clé API ${key ? 'enregistrée' : 'supprimée'}`)
    return publicSettings()
  })

  ipcMain.handle(IPC.listConversations, () => conversations.list())
  ipcMain.handle(IPC.getConversation, (_e, id: string) => conversations.get(id) ?? null)
  ipcMain.handle(IPC.deleteConversation, (_e, id: string) => {
    stopConversation(id)
    conversations.delete(id)
  })
  ipcMain.handle(IPC.send, (_e, req) => sendMessage(req))
  ipcMain.handle(IPC.stop, (_e, id: string) => stopConversation(id))

  ipcMain.handle(IPC.decide, (_e, id: string, decision) => approvals.decide(id, decision))
  ipcMain.handle(IPC.answer, (_e, answer) => approvals.answer(answer))

  ipcMain.handle(IPC.perfWatch, (_e, id: string, on: boolean, every?: number) =>
    perfWatch(`ui:${String(id).slice(0, 40)}`, Boolean(on), typeof every === 'number' && every > 0 ? every : 2000)
  )
  ipcMain.handle(IPC.perfUnload, (_e, which: string) => unloadLocal(which === 'embed' ? 'embed' : 'all'))
  ipcMain.handle(IPC.soundAllowed, (_e, kind: SoundKind, pill?: PillId) => soundAllowed(kind, pill))

  ipcMain.handle(IPC.previewHooks, () => previewHooks(settings.get().claudeCode))
  ipcMain.handle(IPC.connectClaudeCode, async () => {
    installHooks(settings.get().claudeCode)
    settings.update({ claudeCode: { ...settings.get().claudeCode, connected: true } })
    await syncHookServer()
    return publicSettings()
  })
  ipcMain.handle(IPC.disconnectClaudeCode, async () => {
    uninstallHooks()
    settings.update({ claudeCode: { ...settings.get().claudeCode, connected: false } })
    await syncHookServer()
    sessions.clear()
    return publicSettings()
  })

  ipcMain.handle(IPC.saveConnector, (_e, config: ConnectorConfig, values: Record<string, string>) => {
    const id = config.id || randomUUID()
    const cfg: ConnectorConfig = { ...config, id }
    const list = settings.get().connectors
    const next = list.some((c) => c.id === id) ? list.map((c) => (c.id === id ? cfg : c)) : [...list, cfg]
    secrets.setConnectorSecrets(id, values)
    settings.update({ connectors: next })
    return publicSettings()
  })
  ipcMain.handle(IPC.deleteConnector, (_e, id: string) => {
    secrets.deleteConnectorSecrets(id)
    forgetOAuth(id)
    settings.update({ connectors: settings.get().connectors.filter((c) => c.id !== id) })
    return publicSettings()
  })
  ipcMain.handle(IPC.testConnector, (_e, id: string) => testConnector(id))
  // Connexion par compte (OAuth) : la page du service s'ouvre dans le navigateur ; le
  // connecteur n'est enregistré qu'une fois l'accès accordé.
  ipcMain.handle(IPC.connectorOAuth, async (_e, config: ConnectorConfig) => {
    let url: URL
    try {
      url = new URL(String(config?.url ?? ''))
    } catch {
      return { ok: false, message: 'Adresse du serveur invalide.', settings: publicSettings() }
    }
    const loopback = ['127.0.0.1', 'localhost'].includes(url.hostname)
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) {
      return { ok: false, message: 'La connexion par compte demande une adresse https://.', settings: publicSettings() }
    }
    const name = String(config.name || url.hostname).slice(0, 80)
    const existing = config.id ? settings.get().connectors.find((c) => c.id === config.id) : undefined
    const id = existing?.id ?? randomUUID()
    const result = await connectOAuth(id, name, url.toString())
    if (!result.ok) {
      if (!existing) forgetOAuth(id)
      return { ...result, settings: publicSettings() }
    }
    const cfg: ConnectorConfig = {
      ...(existing ?? {}),
      ...config,
      id,
      name,
      transport: 'http',
      url: url.toString(),
      auth: 'oauth',
      enabled: existing?.enabled ?? true
    }
    const list = settings.get().connectors
    settings.update({ connectors: existing ? list.map((c) => (c.id === id ? cfg : c)) : [...list, cfg] })
    return { ok: true, settings: publicSettings() }
  })
  ipcMain.handle(IPC.connectorOAuthCancel, () => cancelOAuth())
  ipcMain.handle(IPC.searchRegistry, (_e, query: string) => searchRegistry(query))

  const pick = showOpenDialog

  ipcMain.handle(IPC.pickFolders, async () => {
    const { canceled, filePaths } = await pick({ title: 'Dossiers que Compi peut lire', properties: ['openDirectory', 'multiSelections'] })
    if (!canceled && filePaths.length) settings.update({ folders: [...new Set([...settings.get().folders, ...filePaths])] })
    return publicSettings()
  })

  // Trombone du chat : sélecteur rattaché à l'îlot, qui garde le panneau ouvert (un
  // <input type="file"> le laissait se refermer, et le choix était perdu).
  ipcMain.handle(IPC.pickFiles, async () => {
    // Tests de bout en bout : fichiers fournis, sans fenêtre de Windows.
    const testPick = process.env.COMPI_TEST_PICK
    if (testPick) return testPick.split(';').filter(Boolean)
    const { canceled, filePaths } = await pick({ title: 'Fichiers à joindre', properties: ['openFile', 'multiSelections'] })
    return canceled ? [] : filePaths
  })

  ipcMain.handle(IPC.listSkills, () => listSkills())
  ipcMain.handle(IPC.getSkill, (_e, name: string) => getSkill(name))
  ipcMain.handle(IPC.saveSkill, (_e, draft: SkillDraft) => {
    const name = saveSkill(draft)
    // Une compétence renommée garde son état activé ou désactivé.
    const disabled = settings.get().disabledSkills
    if (draft.previousName && draft.previousName !== name && disabled.includes(draft.previousName)) {
      settings.update({ disabledSkills: disabled.map((n) => (n === draft.previousName ? name : n)) })
    }
    return listSkills()
  })
  ipcMain.handle(IPC.deleteSkill, (_e, name: string) => {
    deleteSkill(name)
    settings.update({ disabledSkills: settings.get().disabledSkills.filter((n) => n !== name) })
    return listSkills()
  })
  ipcMain.handle(IPC.importSkill, async (_e, kind: 'folder' | 'archive') => {
    const { canceled, filePaths } = await pick(
      kind === 'folder'
        ? { title: 'Dossier de la compétence (contient SKILL.md)', properties: ['openDirectory'] }
        : { title: 'Archive de compétence', properties: ['openFile'], filters: [{ name: 'Compétence', extensions: ['zip', 'skill'] }] }
    )
    if (!canceled && filePaths[0]) await importSkill(filePaths[0])
    return listSkills()
  })
  ipcMain.handle(IPC.openSkillsFolder, () => shell.openPath(pluginDir()).then(() => undefined))

  // ─── Cerveaux ───
  ipcMain.handle(IPC.localStatus, () => localStatus())
  // Installation et téléchargement durent : on répond tout de suite, la progression suit par événements.
  ipcMain.handle(IPC.installOllama, () => void runInstall())
  ipcMain.handle(IPC.startLocalEngine, () => startLocalEngine())
  // Dossier des modèles : seulement pour Ollama (LM Studio a son propre réglage).
  ipcMain.handle(IPC.modelsFolder, () => (settings.get().local.engine === 'ollama' ? ollamaFolder(ollamaBase()) : null))
  ipcMain.handle(IPC.openModelsFolder, async () => {
    const { dir } = await resolveModelsDir()
    if (existsSync(dir)) await shell.openPath(dir)
  })
  ipcMain.handle(IPC.restartOllama, async () => {
    if (settings.get().local.engine !== 'ollama') return null
    return restartOllama(ollamaBase())
  })
  ipcMain.handle(IPC.pullModel, (_e, name: string) => {
    if (/^[\w./:-]{1,120}$/.test(name)) void startPull(name)
  })
  ipcMain.handle(IPC.cancelPull, () => cancelPull())
  ipcMain.handle(IPC.hardwareInfo, () => hardwareInfo())
  ipcMain.handle(IPC.recommendBrain, async (_e, answers: BrainQuizAnswers) => {
    settings.update({ brainQuiz: answers })
    return recommend(answers, await hardwareInfo())
  })
  ipcMain.handle(IPC.testBrain, (_e, brain: Brain) => testBrain(brain))
  ipcMain.handle(IPC.setCustomKey, (_e, key: string | null) => {
    secrets.setCustomKey(key)
    log('info', `clé du service « Autre » ${key ? 'enregistrée' : 'supprimée'}`)
    return publicSettings()
  })
  ipcMain.handle(IPC.setConversationBrain, (_e, id: string, brain: Brain) => {
    const conv = conversations.get(id)
    // Même fournisseur seulement : un autre fournisseur ouvre une nouvelle discussion (côté interface).
    if (conv && (conv.brain?.provider ?? 'anthropic') === brain.provider) conversations.setBrain(id, brain)
  })

  ipcMain.handle(IPC.approvalLog, () => listApprovalLog())
  ipcMain.handle(IPC.approvalLogClear, () => clearApprovalLog())
  ipcMain.handle(IPC.usage, () => claudeCodeUsage())
  ipcMain.handle(IPC.usageRefresh, async () => {
    await refreshClaudeCodeUsage()
    return claudeCodeUsage()
  })
  ipcMain.handle(IPC.compiUsage, () => compiUsage())

  // Messages en attente (notifications des messageries)
  ipcMain.handle(IPC.messagesStatus, () => (settings.get().messages.enabled ? messagesStatus() : refreshAccess()))
  ipcMain.handle(IPC.messagesActivate, () => activateMessages())
  ipcMain.handle(IPC.messagesOpen, (_e, key: string) => openMessageApp(String(key)))
  ipcMain.handle(IPC.messagesSnooze, (_e, key: string) => snoozeMessage(String(key)))
  ipcMain.handle(IPC.messagesIgnore, (_e, key: string) => ignoreMessage(String(key)))
  ipcMain.handle(IPC.messagesWindowsSettings, (_e, page?: string) =>
    shell.openExternal(page === 'notifications' ? 'ms-settings:notifications' : 'ms-settings:privacy-notifications')
  )

  ipcMain.handle(IPC.sentLog, () => listSent())
  ipcMain.handle(IPC.clearSentLog, () => {
    clearSent()
    emit(IPC.sentLogChanged, [])
  })

  ipcMain.handle(IPC.quickRun, (_e, id: string, action: string) => runQuick(id, action))
  ipcMain.handle(IPC.quickStop, () => stopQuick())
  ipcMain.handle(IPC.quickReplace, (_e, id: string) => replaceQuick(id))
  ipcMain.handle(IPC.quickCopy, (_e, id: string) => copyQuick(id))

  // Compte Google
  ipcMain.handle(IPC.googleImportClient, async () => {
    // Tests de bout en bout (faux Google sur ce PC) : fichier donné par l'environnement.
    const testClient = googleEndpoints() !== GOOGLE_ENDPOINTS ? process.env.COMPI_GOOGLE_TEST_CLIENT : undefined
    if (testClient) {
      await importGoogleClient(testClient)
      return publicSettings()
    }
    const r = await showOpenDialog({
      title: 'Fichier JSON du client Google',
      filters: [{ name: 'Fichier client Google', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (r.canceled || !r.filePaths[0]) return publicSettings()
    await importGoogleClient(r.filePaths[0])
    return publicSettings()
  })
  ipcMain.handle(IPC.googleConnect, async (_e, want: { calendar: boolean; mail: boolean }) => {
    const result = await connectGoogle({ calendar: Boolean(want?.calendar), mail: Boolean(want?.mail) })
    if (result.ok) startMeetings()
    return result
  })
  ipcMain.handle(IPC.googleCancel, () => cancelGoogleConnect())
  ipcMain.handle(IPC.googleDisconnect, async () => {
    stopMeetings()
    await disconnectGoogle()
    return publicSettings()
  })

  // Sources de l'agenda (une source ajoutée sert aussi aux alertes de réunion)
  const agendaChanged = (): PublicSettings => {
    startMeetings()
    return publicSettings()
  }
  ipcMain.handle(IPC.agendaGoogleCalendars, () => (settings.get().google.calendar ? calendarChoices() : []))
  ipcMain.handle(IPC.agendaSetGoogleCalendars, (_e, ids: unknown) => {
    setGoogleCalendars(Array.isArray(ids) ? ids.map(String) : null)
    return agendaChanged()
  })
  ipcMain.handle(IPC.agendaTools, (_e, connectorId: string) => agendaTools(String(connectorId)))
  ipcMain.handle(IPC.agendaPreview, (_e, draft: AgendaDraft) => previewSource(cleanAgendaDraft(draft)))
  ipcMain.handle(IPC.agendaAdd, async (_e, draft: AgendaDraft) => {
    await addSource(cleanAgendaDraft(draft))
    return agendaChanged()
  })
  ipcMain.handle(IPC.agendaUpdate, (_e, id: string, patch: { enabled?: unknown; name?: unknown }) => {
    updateSource(String(id), {
      ...(typeof patch?.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      ...(typeof patch?.name === 'string' ? { name: patch.name } : {})
    })
    return agendaChanged()
  })
  ipcMain.handle(IPC.agendaRemove, (_e, id: string) => {
    removeSource(String(id))
    return agendaChanged()
  })

  // Ta journée
  ipcMain.handle(IPC.todayGet, () => buildToday())
  ipcMain.handle(IPC.setCity, async (_e, name: string) => {
    if (!name?.trim()) {
      settings.update({ day: { ...settings.get().day, city: '', cityLat: undefined, cityLon: undefined } })
      return publicSettings()
    }
    const place = await findCity(name)
    if (!place) throw new Error(`Ville introuvable : « ${name.trim()} ».`)
    settings.update({ day: { ...settings.get().day, city: place.label, cityLat: place.lat, cityLon: place.lon } })
    return publicSettings()
  })
  ipcMain.handle(IPC.remindersList, () => listReminders())
  ipcMain.handle(IPC.reminderCancel, (_e, id: string) => cancelReminder(id))
  ipcMain.handle(IPC.reminderSnooze, (_e, id: string, minutes: number) => snoozeReminder(id, Number(minutes) || 10))

  // Îlot vivant : musique, minuteur, voix
  ipcMain.handle(IPC.mediaGet, () => currentMedia())
  ipcMain.handle(IPC.mediaControl, (_e, action: MediaAction) => controlMedia(action))
  ipcMain.handle(IPC.timerGet, () => getTimer())
  ipcMain.handle(IPC.timerStart, (_e, minutes: number, label?: string) => {
    const m = Number(minutes)
    if (!Number.isFinite(m) || m <= 0) throw new Error('Durée invalide.')
    return startTimer(m * 60_000, typeof label === 'string' ? label : '')
  })
  ipcMain.handle(IPC.pomodoroStart, () => startPomodoro())
  ipcMain.handle(IPC.timerPause, () => pauseTimer())
  ipcMain.handle(IPC.timerResume, () => resumeTimer())
  ipcMain.handle(IPC.timerStop, () => stopTimer())
  ipcMain.handle(IPC.voices, () => listVoices())
  ipcMain.handle(IPC.speak, async (_e, text: string) => {
    const { voice, rate } = settings.get().voice
    return new Uint8Array(await synthesize(String(text ?? ''), voice, rate))
  })
  const modelId = (id: unknown): VoiceModelId => (isVoiceModel(id) ? id : settings.get().voice.model)
  ipcMain.handle(IPC.voiceModelStatus, (_e, id?: VoiceModelId) => voiceModelStatus(modelId(id)))
  ipcMain.handle(IPC.voiceModelDownload, (_e, id: VoiceModelId, variant: VoiceVariant) =>
    downloadVoiceModel(modelId(id), variant === 'gpu' ? 'gpu' : 'cpu', (st) => emit(IPC.voiceModelProgress, st))
  )
  ipcMain.handle(IPC.voiceModelCancel, () => cancelVoiceDownload())
  ipcMain.handle(IPC.voiceModelDelete, (_e, id: VoiceModelId) => deleteVoiceModel(modelId(id)))

  // Ce que je sais de toi
  ipcMain.handle(IPC.memoryList, () => listMemory())
  ipcMain.handle(IPC.memoryAdd, (_e, fact: string) => {
    const { duplicate } = addMemory(String(fact ?? ''), 'manual')
    if (duplicate) throw new Error('C’est déjà noté.')
    return listMemory()
  })
  ipcMain.handle(IPC.memoryUpdate, (_e, id: string, fact: string) => updateMemory(String(id), String(fact ?? '')))
  ipcMain.handle(IPC.memoryDelete, (_e, id: string) => deleteMemory(String(id)))
  ipcMain.handle(IPC.memoryClear, () => clearMemory())

  // Routines
  ipcMain.handle(IPC.routinesList, () => listRoutines())
  ipcMain.handle(IPC.routineSave, (_e, draft: RoutineDraft) => {
    saveRoutine(draft)
    return listRoutines()
  })
  ipcMain.handle(IPC.routineDelete, (_e, id: string) => {
    stopRoutineRun(String(id))
    deleteRoutine(String(id))
    return listRoutines()
  })
  ipcMain.handle(IPC.routineRun, (_e, id: string) => runRoutineNow(String(id)))
  ipcMain.handle(IPC.routineStop, (_e, id: string) => stopRoutineRun(String(id)))

  // Historique du presse-papier
  ipcMain.handle(IPC.clipList, () => listClips())
  ipcMain.handle(IPC.clipCopy, (_e, id: string) => copyClip(String(id)))
  ipcMain.handle(IPC.clipPin, (_e, id: string, pinned: boolean) => pinClip(String(id), Boolean(pinned)))
  ipcMain.handle(IPC.clipDelete, (_e, id: string) => deleteClip(String(id)))
  ipcMain.handle(IPC.clipClear, () => clearClips())

  // Recherche par le sens (le modèle se télécharge par brain:pull, après le clic de l'utilisateur)
  ipcMain.handle(IPC.semanticStatus, () => checkSemantic())
  ipcMain.handle(IPC.semanticEnable, () => {
    void enableSemantic(startPull)
    return semanticStatus()
  })
  ipcMain.handle(IPC.semanticReindex, () => {
    void syncSemantic()
    return semanticStatus()
  })
  // Essai depuis la carte : tout se calcule sur le PC, rien ne part vers un cerveau.
  ipcMain.handle(IPC.semanticTry, async (_e, query: string) => {
    const q = String(query ?? '')
      .trim()
      .slice(0, 300)
    if (!q) return []
    const hits = await semanticSearch(q, allowedFolders(), 5)
    return hits?.map((h) => ({ file: h.file, page: h.page, score: h.score, text: h.text.replace(/\s+/g, ' ').slice(0, 240) })) ?? null
  })
  ipcMain.handle(IPC.semanticOpen, async (_e, file: string) => {
    const f = String(file ?? '')
    if (!insideAny(f, allowedFolders())) return false
    return (await shell.openPath(f)) === ''
  })
  ipcMain.handle(IPC.semanticDisable, async (_e, removeModel?: boolean) => {
    const { model } = settings.get().semantic
    // Modèle en cours de téléchargement pour la recherche par le sens : on l'arrête.
    if (semanticStatus().state === 'no-model') cancelPull()
    settings.update({ semantic: { ...settings.get().semantic, enabled: false } })
    clearSemantic()
    if (removeModel) {
      const l = settings.get().local
      await deleteModel(l.engine === 'ollama' && l.baseUrl ? l.baseUrl : OLLAMA_URL, model).catch((e) =>
        log('warn', 'modèle de recherche non supprimé', (e as Error).message)
      )
    }
    return checkSemantic()
  })

  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//.test(url)) return shell.openExternal(url)
  })
  ipcMain.on(IPC.quit, () => app.quit())
}

// ─── Démarrage ───────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  settings.load()
  secrets.load()
  conversations.load()
  try {
    ensureSkillsPlugin()
  } catch (e) {
    log('error', 'compétences non installées', e)
  }
  log(
    'info',
    `Compi ${app.getVersion()} démarré · données : ${app.getPath('userData')} · cerveau : ${settings.get().provider} · clé API : ${secrets.apiKeySource()} · ${conversations.list().length} discussion(s)`
  )

  registerIslandIpc()
  registerIpc()

  // Raccourci pris par une autre app : on bascule sur une alternative libre et on le dit.
  const wanted = settings.get().shortcut
  const shortcut = initShortcut(wanted)
  if (shortcut?.replaced) settings.update({ shortcut: shortcut.accelerator })
  const shortcutNotice = !shortcut
    ? `${prettyShortcut(wanted)} est pris par une autre app : choisis un raccourci dans mes réglages`
    : shortcut.replaced
      ? `${prettyShortcut(wanted)} est pris par une autre app : utilise ${prettyShortcut(shortcut.accelerator)}`
      : ''
  // Actions rapides sur la sélection : même logique de repli.
  const quick = initQuickShortcut(settings.get().quickShortcut, () => void onQuickShortcut())
  if (quick?.replaced) settings.update({ quickShortcut: quick.accelerator })
  const voiceKey = initVoiceShortcut(settings.get().voice.shortcut)
  if (voiceKey?.replaced) settings.update({ voice: { ...settings.get().voice, shortcut: voiceKey.accelerator } })
  handleModelScheme()
  cleanPartialDownloads()
  restrictPermissions()

  const win = createNotchWindow()
  setBusTarget(win)
  win.webContents.on('did-finish-load', () => {
    emit(IPC.approvals, approvals.pendingApprovals())
    emit(IPC.questions, approvals.pendingQuestions())
    sessions.broadcast()
    emit(IPC.mediaChanged, currentMedia())
    emit(IPC.timerChanged, getTimer())
    if (shortcutNotice) setTimeout(() => emit(IPC.islandNotify, { pill: 'chat', text: shortcutNotice }), 1500)
  })

  createTray()
  restoreReminders()
  restoreTimer()
  setRoutineRunner(runRoutineAgent, stopConversation)
  restoreRoutines()
  if (settings.get().clipboardHistory) void startClipboardHistory()
  // Recherche par le sens : index mis à jour 3 minutes après le démarrage (Compi d'abord).
  startSemantic(180_000)
  startUsageWatch()
  startMorning()
  startMeetings()
  hookMediaPower()
  hookMessagesPower()
  hookPerfPower()
  syncMessages()
  onApprovalShortcut(onApprovalKey)
  approvals.onChange(syncApprovalKeys)
  syncMedia()

  // Cerveau local : charger le modèle dès que l'îlot s'ouvre, pour qu'il soit prêt à répondre.
  let lastWarm = 0
  onPanelOpen(() => {
    // L'hôte Windows (PowerShell) démarre d'avance : les outils Windows répondent tout de suite.
    warmHost()
    if (settings.get().provider !== 'local' || Date.now() - lastWarm < 120_000) return
    lastWarm = Date.now()
    void keepWarm()
  })

  // Démarrage avec Windows : on n'écrit dans le registre que si l'état réel diffère du réglage
  // (pas à chaque lancement ni à chaque réglage modifié).
  let appliedLogin: boolean | undefined
  const applySystemSettings = (s: Settings): void => {
    if (app.isPackaged && s.launchAtLogin !== appliedLogin) {
      if (app.getLoginItemSettings().openAtLogin !== s.launchAtLogin) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin })
      appliedLogin = s.launchAtLogin
    }
    emit(IPC.settingsChanged, publicSettings())
  }
  applySystemSettings(settings.get())
  settings.onChange(applySystemSettings)

  await syncHookServer()
})

app.on('second-instance', () => sendIslandCommand('open-chat'))

// Compi vit dans la zone de notification : fermer la fenêtre ne quitte pas l'app.
app.on('window-all-closed', () => undefined)

app.on('before-quit', () => {
  stopRoutines()
  stopAll()
  stopSemantic()
  stopUsageWatch()
  stopMessages()
  stopPerf()
  cancelOAuth()
  flushClipboardHistory()
  stopGateway()
  stopQuick()
  watchMedia(false, () => undefined)
  cancelVoiceDownload()
  stopHost()
  stopMeetings()
  stopTimers()
  approvals.cancelAll()
  stopHookServer()
  conversations.flush()
  globalShortcut.unregisterAll()
})
