// Messages en attente : notifications des messageries (téléphone via Mobile
// connecté, WhatsApp, Telegram…) restées dans le centre de notifications de
// Windows. Fonctions pures, testées dans tests/messages.test.ts.
//
// Niveau 1 (rappels) : seuls l'application, l'expéditeur et l'heure servent,
// en mémoire ; sur le disque, rien d'autre que des identifiants et des heures.
// Niveau 2 (« Compi peut lire mes messages ») : le texte, en mémoire 24 h.

/** Messageries connues, reconnues par leur identifiant d'application Windows. */
export const MESSAGING_APPS: Array<{ key: string; label: string; hint: string; match: RegExp }> = [
  { key: 'phone', label: 'Mobile connecté', hint: 'SMS et messageries de ton téléphone (Android ou iPhone)', match: /YourPhone|PhoneLink/i },
  { key: 'whatsapp', label: 'WhatsApp', hint: 'l’application WhatsApp pour Windows', match: /WhatsApp/i },
  { key: 'telegram', label: 'Telegram', hint: 'avec les notifications Windows activées dans Telegram', match: /Telegram/i },
  { key: 'signal', label: 'Signal', hint: 'Signal Desktop', match: /signal/i },
  { key: 'discord', label: 'Discord', hint: 'messages privés et mentions', match: /Discord/i },
  { key: 'teams', label: 'Teams', hint: 'discussions Microsoft Teams', match: /Teams/i }
]

/** Clé d'une application : celle d'une messagerie connue, sinon son identifiant Windows. */
export function appKeyOf(aumid: string): string {
  return MESSAGING_APPS.find((a) => a.match.test(aumid))?.key ?? aumid
}

export function appLabelOf(key: string, displayName = ''): string {
  return MESSAGING_APPS.find((a) => a.key === key)?.label ?? (displayName || key.split('!')[0].split('_')[0] || 'Application')
}

/** Ce que l'hôte PowerShell renvoie pour une notification. */
export interface RawNotification {
  id: number
  aumid: string
  app: string
  at: number
  /**
   * Première ligne (l'expéditeur, le plus souvent) : seulement pour les applications
   * suivies. Vide quand la notification n'a qu'une ligne (on ne sait pas si c'est un nom).
   */
  title?: string
  /** Le reste du texte : seulement si « Compi peut lire mes messages ». */
  body?: string
}

/**
 * Lignes d'une notification → expéditeur et texte (même règle que l'hôte PowerShell).
 * Les lignes vides sont ignorées : Mobile connecté entoure son unique ligne de lignes
 * faites de retours à la ligne et de tabulations. Une seule ligne peut être le message
 * lui-même : ce n'est donc pas un expéditeur, et elle ne sort que si le texte est lu.
 */
export function linesToNotification(lines: string[], withText: boolean): Pick<RawNotification, 'title' | 'body'> {
  const texts = lines.map((l) => l.trim()).filter(Boolean)
  if (texts.length >= 2) return { title: texts[0].slice(0, 120), ...(withText ? { body: texts.slice(1).join('\n').slice(0, 600) } : {}) }
  if (texts.length === 1) return { title: '', ...(withText ? { body: texts[0].slice(0, 600) } : {}) }
  return {}
}

/** Une ligne de « Messages en attente » : les messages d'un même expéditeur (ou sans nom) d'une même application. */
export interface PendingGroup {
  keys: string[]
  appKey: string
  app: string
  sender: string
  /** Le plus ancien. */
  at: number
  count: number
}

/** Regroupe par application et expéditeur : cinq notifications sans nom de Mobile connecté font une seule ligne. */
export function groupPending(items: PendingMessage[]): PendingGroup[] {
  const groups = new Map<string, PendingGroup>()
  for (const p of [...items].sort((a, b) => a.at - b.at)) {
    const id = `${p.appKey}\u0000${p.sender.toLowerCase()}`
    const g = groups.get(id)
    if (g) {
      g.keys.push(p.key)
      g.count++
    } else groups.set(id, { keys: [p.key], appKey: p.appKey, app: p.app, sender: p.sender, at: p.at, count: 1 })
  }
  return [...groups.values()]
}

/** « Marie », « Marie · 3 messages », « Nouveau message », « 4 messages ». */
export function groupLabel(g: PendingGroup): string {
  if (g.sender) return g.count > 1 ? `${g.sender} · ${g.count} messages` : g.sender
  return g.count > 1 ? `${g.count} messages` : 'Nouveau message'
}

export interface PendingMessage {
  /** `aumid:id` : unique tant que la notification existe. */
  key: string
  appKey: string
  app: string
  sender: string
  at: number
}

/** Ce que Compi retient d'un rappel, sur le disque : des heures, rien d'autre. */
export interface ReminderMark {
  remindedAt?: number
  snoozeUntil?: number
  ignored?: boolean
}

export interface ReminderOptions {
  remindAfterMin: number
  quietStart: string
  quietEnd: string
  /** Pomodoro en phase de concentration, réunion… : on attend. */
  busy: boolean
}

const minutesOf = (hhmm: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  return h < 24 && min < 60 ? h * 60 + min : null
}

/** Heures calmes : pas de rappel (la plage peut passer minuit : 22:00 → 08:00). */
export function inQuietHours(now: number, start: string, end: string): boolean {
  const s = minutesOf(start)
  const e = minutesOf(end)
  if (s === null || e === null || s === e) return false
  const d = new Date(now)
  const t = d.getHours() * 60 + d.getMinutes()
  return s < e ? t >= s && t < e : t >= s || t < e
}

/** Messages à rappeler maintenant : en attente depuis le délai choisi, pas ignorés, pas déjà rappelés (sauf report échu). */
export function dueReminders(pending: PendingMessage[], marks: Record<string, ReminderMark>, opts: ReminderOptions, now: number): PendingMessage[] {
  if (opts.busy || inQuietHours(now, opts.quietStart, opts.quietEnd)) return []
  const after = Math.max(5, opts.remindAfterMin) * 60_000
  return pending.filter((p) => {
    const m = marks[p.key]
    if (m?.ignored) return false
    if (m?.snoozeUntil) return now >= m.snoozeUntil
    return !m?.remindedAt && now - p.at >= after
  })
}

/** « en attente depuis 1 h 20 », « depuis 25 min ». */
export function waitingFor(at: number, now: number): string {
  const min = Math.max(1, Math.round((now - at) / 60_000))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`
}

/**
 * Texte de la pastille. Sans aperçu (par défaut), seulement les applications :
 * l'îlot est visible de tous, pas les noms de tes contacts.
 */
export function reminderText(items: PendingMessage[], preview: boolean, now: number): string {
  if (!items.length) return ''
  const oldest = Math.min(...items.map((i) => i.at))
  const head = `${items.length} message${items.length > 1 ? 's' : ''} en attente depuis ${waitingFor(oldest, now)}`
  if (!preview) return `${head} · ${[...new Set(items.map((i) => i.app))].join(', ')}`
  const groups = groupPending(items)
  const who = groups.slice(0, 3).map((g) => (g.sender ? `${g.sender} (${g.app})` : g.app))
  return `${head} · ${[...new Set(who)].join(', ')}${groups.length > 3 ? '…' : ''}`
}

// ─── Réglages de Windows ─────────────────────────────────────────────────────

/** Réglage d'une application dans Windows (registre) : 0 = coupé. */
export interface AppNotificationSetting {
  aumid: string
  enabled?: number | null
  /** « Afficher dans le centre de notifications ». */
  center?: number | null
}

export interface NotificationHealth {
  /** Interrupteur général « Notifications » de Windows : coupé, aucune application n'envoie rien. */
  toasts: boolean
  /** Messageries suivies que Windows empêche d'arriver dans le centre de notifications. */
  blocked: Array<{ key: string; app: string; reason: 'off' | 'center' }>
}

/**
 * Ce qui empêche les messages d'arriver dans le centre de notifications, donc
 * d'être vus par Compi. Les entrées d'installation (« …Setup ») sont ignorées.
 */
export function notificationHealth(toastEnabled: number | null | undefined, entries: AppNotificationSetting[], apps: string[]): NotificationHealth {
  const blocked = new Map<string, NotificationHealth['blocked'][number]>()
  for (const e of entries) {
    if (!e?.aumid || /setup/i.test(e.aumid)) continue
    const key = appKeyOf(e.aumid)
    if (!apps.includes(key) || blocked.has(key)) continue
    if (e.enabled === 0) blocked.set(key, { key, app: appLabelOf(key), reason: 'off' })
    else if (e.center === 0) blocked.set(key, { key, app: appLabelOf(key), reason: 'center' })
  }
  return { toasts: toastEnabled !== 0, blocked: [...blocked.values()] }
}

/** Garde les marques des messages encore en attente, et les reports pas encore échus. */
export function pruneMarks(marks: Record<string, ReminderMark>, pendingKeys: Set<string>): Record<string, ReminderMark> {
  return Object.fromEntries(Object.entries(marks).filter(([k]) => pendingKeys.has(k)))
}

// ─── Niveau 2 : lecture par Compi ────────────────────────────────────────────

export interface MessageItem {
  key: string
  at: number
  appKey: string
  app: string
  sender: string
  /** Texte, codes et secrets masqués. */
  text: string
}

export const RECENT_MAX = 200
export const RECENT_MS = 24 * 3600_000

const CODE_CONTEXT =
  /\b(code|codes|otp|2fa|mfa|v[ée]rification|verify|connexion|login|sign[- ]?in|authentification|authentication|s[ée]curit[ée]|security|mot de passe|password|pin|passcode|confirmation)\b/i

/**
 * Codes reçus par SMS (« 482913 est ton code de connexion », « G-123456 »…) :
 * dans un message qui parle de code, de connexion ou de vérification, tout
 * nombre de 4 à 8 chiffres est masqué. En plus du masquage général (cartes, IBAN…).
 */
export function maskCodes(text: string): string {
  if (!CODE_CONTEXT.test(text)) return text
  return text.replace(/\b(?:[A-Z]{1,3}-)?\d(?:[ -]?\d){3,7}\b/g, (m) => (m.replace(/\D/g, '').length >= 4 ? '[code masqué]' : m))
}

/** Ajoute des messages (sans doublon), garde les 24 dernières heures et 200 au plus. */
export function keepRecent(list: MessageItem[], added: MessageItem[], now: number): MessageItem[] {
  const seen = new Set(list.map((m) => m.key))
  const next = [...list, ...added.filter((m) => !seen.has(m.key))].filter((m) => m.at >= now - RECENT_MS)
  return next.sort((a, b) => a.at - b.at).slice(-RECENT_MAX)
}

export function findMessages(list: MessageItem[], q: { app?: string; sender?: string; sinceMin?: number; limit?: number }, now: number): MessageItem[] {
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const since = q.sinceMin ? now - q.sinceMin * 60_000 : 0
  return list
    .filter((m) => m.at >= since && (!q.app || fold(m.app).includes(fold(q.app))) && (!q.sender || fold(m.sender).includes(fold(q.sender))))
    .slice(-(q.limit ?? 30))
}

// ─── Réglages ────────────────────────────────────────────────────────────────

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/**
 * Réglages venus de l'interface, vérifiés. L'activation passe seulement par
 * « Activer » (accès de Windows vérifié) : ici, on peut désactiver, pas activer.
 */
export function cleanMessagesPatch(
  patch: Partial<import('./types').MessagesSettings>,
  current: import('./types').MessagesSettings
): import('./types').MessagesSettings {
  const next = { ...current }
  if (patch.enabled === false) next.enabled = false
  if (Array.isArray(patch.apps)) next.apps = [...new Set(patch.apps.filter((a) => typeof a === 'string' && a.length > 0 && a.length <= 200))].slice(0, 30)
  if (typeof patch.remindAfterMin === 'number' && Number.isFinite(patch.remindAfterMin))
    next.remindAfterMin = Math.min(240, Math.max(15, Math.round(patch.remindAfterMin)))
  if (typeof patch.quietStart === 'string' && HHMM.test(patch.quietStart)) next.quietStart = patch.quietStart
  if (typeof patch.quietEnd === 'string' && HHMM.test(patch.quietEnd)) next.quietEnd = patch.quietEnd
  if (typeof patch.preview === 'boolean') next.preview = patch.preview
  if (typeof patch.readByCompi === 'boolean') next.readByCompi = patch.readByCompi
  return next
}
