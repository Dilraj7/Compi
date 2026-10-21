// Messages en attente (téléphone via Mobile connecté, WhatsApp, Telegram…).
// Compi relève toutes les 3 s le centre de notifications de Windows, seulement
// si l'utilisateur l'a activé, et seulement pour les applications cochées.
//
// - Rappels : application, expéditeur et heure, en mémoire. Sur le disque :
//   seulement des identifiants de notification et des heures (rappelé, reporté).
// - « Compi peut lire mes messages » : le texte, en mémoire 24 h, codes masqués.
// Une notification qui disparaît du centre (lue, fermée) n'est plus en attente.
// Rien n'est jamais fermé, modifié ni envoyé par Compi.

import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, powerMonitor, shell } from 'electron'
import script from '../windows/notifications.ps1?raw'
import { PowerShellHost } from '../windows/host'
import { IPC } from '../../shared/ipc'
import {
  appKeyOf,
  appLabelOf,
  dueReminders,
  findMessages,
  keepRecent,
  linesToNotification,
  maskCodes,
  notificationHealth,
  pruneMarks,
  reminderText,
  type AppNotificationSetting,
  type MessageItem,
  type PendingMessage,
  type RawNotification,
  type ReminderMark
} from '../../shared/messages'
import type { MessagesStatus } from '../../shared/types'
import { emit } from '../bus'
import { getTimer } from '../day/timer'
import { inMeeting } from '../day/meetings'
import { log } from '../log'
import { redact } from '../privacy/redact'
import { readJson, writeJson } from '../store/jsonFile'
import { settings } from '../store/settings'
import { launchApp } from '../windows/system'

type NotifFn = 'ping' | 'access' | 'request_access' | 'list' | 'health'
const host = new PowerShellHost<NotifFn>('hôte notifications', script, 5 * 60_000)

const POLL_MS = 3000
/** L'hôte est relancé toutes les 2 h : une longue interrogation de WinRT peut grossir. */
const RECYCLE_MS = 2 * 3600_000
/** Les réglages de notification de Windows sont relus toutes les 5 min. */
const HEALTH_MS = 5 * 60_000
const marksFile = (): string => join(app.getPath('userData'), 'messages-reminders.json')

let timer: NodeJS.Timeout | null = null
let running = false
let locked = false
let failures = 0
let hostSince = 0
let access: MessagesStatus['access'] = 'unknown'
/** En attente, en mémoire seulement. */
const pending = new Map<string, PendingMessage>()
/** Applications vues récemment (nom seulement), pour la liste des réglages. */
const seen = new Map<string, { key: string; app: string; aumid: string }>()
/** Identifiants Windows des applications suivies (le texte n'est lu que pour elles). */
const followed = new Set<string>()
let recent: MessageItem[] = []
let marks: Record<string, ReminderMark> = {}
/** Réglages de notification de Windows (interrupteur général, applications coupées). */
let health: { toastEnabled?: number; apps: AppNotificationSetting[] } | null = null
let healthAt = 0

const testFile = (): string | undefined => process.env.COMPI_NOTIF_TEST_FILE

async function list(apps: string[], text: boolean): Promise<RawNotification[]> {
  const file = testFile()
  if (file) {
    // Tests : notifications simulées, avec le même filtrage que l'hôte.
    // `lines` : les lignes brutes, comme Windows les donne (Mobile connecté…).
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Array<RawNotification & { lines?: string[] }>
    return raw.map(({ lines, ...n }) => {
      if (!apps.includes(n.aumid)) return { id: n.id, aumid: n.aumid, app: n.app, at: n.at }
      if (lines) return { id: n.id, aumid: n.aumid, app: n.app, at: n.at, ...linesToNotification(lines, text) }
      return { ...n, body: text ? n.body : undefined }
    })
  }
  if (hostSince && Date.now() - hostSince > RECYCLE_MS) {
    host.stop()
    hostSince = 0
  }
  if (!hostSince) hostSince = Date.now()
  const r = await host.call<{ items: RawNotification[] }>('list', { apps, text }, 8000)
  return Array.isArray(r.items) ? r.items : []
}

async function checkAccess(request: boolean): Promise<MessagesStatus['access']> {
  if (testFile()) return (access = 'allowed')
  try {
    let r = await host.call<{ status: string }>('access', {}, 8000)
    if (request && r.status !== 'Allowed' && r.status !== 'Denied') r = await host.call<{ status: string }>('request_access', {}, 70_000)
    access = r.status === 'Allowed' ? 'allowed' : r.status === 'Denied' ? 'denied' : 'unknown'
  } catch (e) {
    log('warn', 'notifications : accès impossible à vérifier', (e as Error).message)
    access = 'error'
  }
  return access
}

/**
 * Réglages de notification de Windows. Coupées, les messageries n'envoient rien
 * au centre de notifications : Compi ne voit rien et doit le dire.
 */
async function checkHealth(): Promise<boolean> {
  const before = JSON.stringify(health)
  healthAt = Date.now()
  if (testFile()) {
    health = { toastEnabled: process.env.COMPI_NOTIF_TEST_TOASTS === '0' ? 0 : 1, apps: [] }
  } else {
    try {
      const r = await host.call<{ toastEnabled?: number; apps?: AppNotificationSetting[] }>('health', {}, 8000)
      health = { toastEnabled: r.toastEnabled, apps: Array.isArray(r.apps) ? r.apps : [] }
    } catch (e) {
      log('warn', 'notifications : réglages de Windows illisibles', (e as Error).message)
    }
  }
  return JSON.stringify(health) !== before
}

const busy = (): boolean => {
  const t = getTimer()
  return Boolean(t?.pomodoro?.phase === 'focus' && t.endsAt) || inMeeting()
}

function saveMarks(): void {
  marks = pruneMarks(marks, new Set(pending.keys()))
  writeJson(marksFile(), marks)
}

export function messagesStatus(): MessagesStatus {
  const ignored = (k: string): boolean => Boolean(marks[k]?.ignored)
  return {
    access,
    pending: [...pending.values()].filter((p) => !ignored(p.key)).sort((a, b) => a.at - b.at),
    seenApps: [...seen.values()].sort((a, b) => a.app.localeCompare(b.app)).map(({ key, app }) => ({ key, app })),
    reading: settings.get().messages.readByCompi,
    windows: health ? notificationHealth(health.toastEnabled, health.apps, settings.get().messages.apps) : undefined
  }
}

const changed = (): void => emit(IPC.messagesChanged, messagesStatus())

async function tick(): Promise<void> {
  const s = settings.get().messages
  if (running || !s.enabled || locked) return
  running = true
  try {
    const items = await list([...followed], s.readByCompi)
    failures = 0
    const now = Date.now()
    const present = new Set<string>()
    const added: MessageItem[] = []
    let dirty = now - healthAt > HEALTH_MS ? await checkHealth() : false
    for (const n of items) {
      if (!n.aumid) continue
      const key = appKeyOf(n.aumid)
      if (!seen.has(key)) {
        seen.set(key, { key, app: appLabelOf(key, n.app), aumid: n.aumid })
        dirty = true
      }
      if (!s.apps.includes(key)) continue
      if (!followed.has(n.aumid)) {
        // Le texte n'est lu qu'au prochain relevé, une fois l'application suivie.
        followed.add(n.aumid)
        continue
      }
      const id = `${n.aumid}:${n.id}`
      present.add(id)
      if (!pending.has(id) && n.title !== undefined) {
        pending.set(id, { key: id, appKey: key, app: appLabelOf(key, n.app), sender: n.title.trim(), at: Math.min(n.at || now, now) })
        dirty = true
      }
      if (s.readByCompi && n.body)
        added.push({ key: id, at: n.at || now, appKey: key, app: appLabelOf(key, n.app), sender: (n.title ?? '').trim(), text: maskCodes(redact(n.body).text) })
    }
    for (const id of [...pending.keys()]) {
      if (!present.has(id)) {
        pending.delete(id)
        dirty = true
      }
    }
    if (added.length || recent.length) recent = keepRecent(recent, added, now)

    const due = dueReminders(
      messagesStatus().pending,
      marks,
      { remindAfterMin: s.remindAfterMin, quietStart: s.quietStart, quietEnd: s.quietEnd, busy: busy() },
      now
    )
    if (due.length) {
      for (const p of due) marks[p.key] = { remindedAt: now }
      emit(IPC.islandNotify, { pill: 'message', text: reminderText(due, s.preview, now), view: 'today', duration: 9000 })
      dirty = true
    }
    if (dirty) {
      saveMarks()
      changed()
    }
  } catch (e) {
    failures++
    if (failures === 3) log('warn', 'messages en attente : relevé impossible', (e as Error).message)
  } finally {
    running = false
    schedule(failures ? Math.min(60_000, POLL_MS * 2 ** Math.min(failures, 5)) : POLL_MS)
  }
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer)
  timer = settings.get().messages.enabled && !locked ? setTimeout(() => void tick(), ms) : null
}

/** Applique les réglages : démarre, arrête (et oublie tout), ou oublie le texte. */
export function syncMessages(): void {
  const s = settings.get().messages
  if (!s.enabled) {
    stopMessages(true)
    return
  }
  if (!s.readByCompi) recent = []
  // Applications décochées : on oublie leurs messages.
  for (const [id, p] of pending) if (!s.apps.includes(p.appKey)) pending.delete(id)
  for (const aumid of [...followed]) if (!s.apps.includes(appKeyOf(aumid))) followed.delete(aumid)
  recent = recent.filter((m) => s.apps.includes(m.appKey))
  if (!timer && !running) {
    marks = readJson<Record<string, ReminderMark>>(marksFile(), {})
    if (access === 'unknown') void checkAccess(false).then(changed)
    void checkHealth().then((c) => c && changed())
    schedule(500)
  }
  changed()
}

export function stopMessages(forget = false): void {
  if (timer) clearTimeout(timer)
  timer = null
  host.stop()
  hostSince = 0
  if (forget) {
    pending.clear()
    seen.clear()
    followed.clear()
    recent = []
    marks = {}
    rmSync(marksFile(), { force: true })
    changed()
  }
}

/** Clic sur « Activer » : vérifie (ou demande) l'accès aux notifications, puis active. */
export async function activateMessages(): Promise<MessagesStatus> {
  const a = await checkAccess(true)
  await checkHealth()
  if (a === 'allowed') {
    settings.update({ messages: { ...settings.get().messages, enabled: true } })
    syncMessages()
  }
  return messagesStatus()
}

export async function refreshAccess(): Promise<MessagesStatus> {
  await checkAccess(false)
  await checkHealth()
  return messagesStatus()
}

/** « Ouvrir » : lance l'application du message (clic de l'utilisateur). */
export async function openMessageApp(key: string): Promise<boolean> {
  const p = pending.get(key)
  if (!p) return false
  const aumid = key.slice(0, key.lastIndexOf(':'))
  try {
    await launchApp({ id: aumid, name: p.app })
    return true
  } catch {
    // Pas dans le menu Démarrer : on passe par le dossier des applications de Windows.
    await shell.openExternal(`shell:AppsFolder\\${aumid}`).catch(() => undefined)
    return true
  }
}

export function snoozeMessage(key: string, minutes = 60): MessagesStatus {
  if (pending.has(key)) {
    marks[key] = { remindedAt: Date.now(), snoozeUntil: Date.now() + minutes * 60_000 }
    saveMarks()
    changed()
  }
  return messagesStatus()
}

export function ignoreMessage(key: string): MessagesStatus {
  if (pending.has(key)) {
    marks[key] = { ignored: true }
    saveMarks()
    changed()
  }
  return messagesStatus()
}

/** Messages lisibles par Compi (outil messages_recent) : en mémoire seulement. */
export function recentMessages(q: { app?: string; sender?: string; sinceMin?: number; limit?: number }): MessageItem[] {
  if (!settings.get().messages.readByCompi) return []
  return findMessages(recent, q, Date.now())
}

/** Nombre de messages en attente (résumé du matin). */
export const pendingCount = (): number => messagesStatus().pending.length

let powerHooked = false
/** Pas de relevé quand le PC est verrouillé ou en veille. */
export function hookMessagesPower(): void {
  if (powerHooked) return
  powerHooked = true
  const pause = (): void => {
    locked = true
    schedule(0)
  }
  const resume = (): void => {
    locked = false
    schedule(2000)
  }
  powerMonitor.on('lock-screen', pause)
  powerMonitor.on('suspend', pause)
  powerMonitor.on('unlock-screen', resume)
  powerMonitor.on('resume', resume)
}
