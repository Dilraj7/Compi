import { describe, expect, it } from 'vitest'
import {
  appKeyOf,
  appLabelOf,
  cleanMessagesPatch,
  dueReminders,
  findMessages,
  groupLabel,
  groupPending,
  inQuietHours,
  linesToNotification,
  keepRecent,
  maskCodes,
  notificationHealth,
  pruneMarks,
  RECENT_MAX,
  reminderText,
  waitingFor,
  type MessageItem,
  type PendingMessage
} from '../src/shared/messages'
import { DEFAULT_PRIVACY, filterAutoAllowed, PRIVACY_CATEGORIES, privacyDecision } from '../src/shared/privacy'
import type { MessagesSettings } from '../src/shared/types'

const at = (h: number, m = 0): number => new Date(2026, 9, 14, h, m).getTime()
const msg = (key: string, sender: string, app: string, time: number): PendingMessage => ({ key, appKey: app.toLowerCase(), app, sender, at: time })
const opts = { remindAfterMin: 60, quietStart: '22:00', quietEnd: '08:00', busy: false }
const TOOL = 'mcp__compi__messages_recent'

describe('messages en attente : rappels', () => {
  it('reconnaît les messageries par leur identifiant Windows', () => {
    expect(appKeyOf('Microsoft.YourPhone_8wekyb3d8bbwe!App')).toBe('phone')
    expect(appKeyOf('5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App')).toBe('whatsapp')
    expect(appKeyOf('TelegramMessengerLLP.TelegramDesktop_t4vj0pshhgkwm!Telegram.TelegramDesktop.Store')).toBe('telegram')
    expect(appKeyOf('Contoso.Chat_abc!App')).toBe('Contoso.Chat_abc!App')
    expect(appLabelOf('phone')).toBe('Mobile connecté')
    expect(appLabelOf('Contoso.Chat_abc!App', 'Contoso Chat')).toBe('Contoso Chat')
    expect(appLabelOf('Contoso.Chat_abc!App')).toBe('Contoso.Chat')
  })

  it('heures calmes, y compris quand la plage passe minuit', () => {
    expect(inQuietHours(at(23), '22:00', '08:00')).toBe(true)
    expect(inQuietHours(at(7, 59), '22:00', '08:00')).toBe(true)
    expect(inQuietHours(at(8), '22:00', '08:00')).toBe(false)
    expect(inQuietHours(at(13), '12:00', '14:00')).toBe(true)
    expect(inQuietHours(at(15), '12:00', '14:00')).toBe(false)
    // Plage vide ou invalide : jamais calme.
    expect(inQuietHours(at(3), '00:00', '00:00')).toBe(false)
    expect(inQuietHours(at(3), 'minuit', '08:00')).toBe(false)
  })

  it('rappelle une seule fois après le délai, sauf report échu ; jamais un message ignoré', () => {
    const now = at(15)
    const pending = [msg('a', 'Marie', 'WhatsApp', at(13, 30)), msg('b', 'Paul', 'Mobile connecté', at(14, 30)), msg('c', 'Léa', 'WhatsApp', at(12))]
    expect(dueReminders(pending, {}, opts, now).map((p) => p.key)).toEqual(['a', 'c'])
    expect(dueReminders(pending, { a: { remindedAt: at(14, 40) }, c: { ignored: true } }, opts, now)).toEqual([])
    // Reporté d'une heure : rappelé de nouveau à l'échéance seulement.
    const snoozed = { a: { remindedAt: at(14), snoozeUntil: at(15, 30) } }
    expect(dueReminders(pending, snoozed, opts, now).map((p) => p.key)).toEqual(['c'])
    expect(dueReminders(pending, snoozed, opts, at(15, 30)).map((p) => p.key)).toContain('a')
  })

  it('rien pendant les heures calmes, une réunion ou un pomodoro', () => {
    const pending = [msg('a', 'Marie', 'WhatsApp', at(20))]
    expect(dueReminders(pending, {}, opts, at(23))).toEqual([])
    expect(dueReminders(pending, {}, { ...opts, busy: true }, at(21, 30))).toEqual([])
    expect(dueReminders(pending, {}, opts, at(21, 30))).toHaveLength(1)
  })

  it('la pastille ne montre que les applications, sauf si l’aperçu est choisi', () => {
    const items = [msg('a', 'Marie', 'WhatsApp', at(13, 40)), msg('b', 'Paul', 'Mobile connecté', at(14)), msg('c', 'Léa', 'WhatsApp', at(14, 10))]
    const plain = reminderText(items, false, at(15))
    expect(plain).toBe('3 messages en attente depuis 1 h 20 · WhatsApp, Mobile connecté')
    expect(plain).not.toMatch(/Marie|Paul|Léa/)
    expect(reminderText(items, true, at(15))).toContain('Marie (WhatsApp), Paul (Mobile connecté), Léa (WhatsApp)')
    expect(reminderText(items.slice(0, 1), false, at(14))).toBe('1 message en attente depuis 20 min · WhatsApp')
    expect(reminderText([], false, at(15))).toBe('')
    expect(waitingFor(at(13), at(15))).toBe('2 h')
  })

  it('Mobile connecté : lignes vides ignorées, une ligne seule n’est pas un expéditeur', () => {
    // Forme réelle (relevée sans le texte) : « \n\t\t\t », la ligne utile, « \n\t\t ».
    expect(linesToNotification(['\n\t\t\t', 'Ligne utile', '\n\t\t'], false)).toEqual({ title: '' })
    expect(linesToNotification(['\n\t\t\t', 'Ligne utile', '\n\t\t'], true)).toEqual({ title: '', body: 'Ligne utile' })
    expect(linesToNotification(['  Marie ', 'Tu viens ?', 'À ce soir'], false)).toEqual({ title: 'Marie' })
    expect(linesToNotification(['Marie', 'Tu viens ?', 'À ce soir'], true)).toEqual({ title: 'Marie', body: 'Tu viens ?\nÀ ce soir' })
    expect(linesToNotification(['\n\t', ' '], true)).toEqual({})
  })

  it('regroupe par application et expéditeur ; sans nom, un libellé clair', () => {
    const items = [
      msg('a', '', 'Mobile connecté', at(13)),
      msg('b', '', 'Mobile connecté', at(13, 5)),
      msg('c', 'Marie', 'WhatsApp', at(13, 10)),
      msg('d', 'marie', 'WhatsApp', at(13, 20)),
      msg('e', 'Paul', 'WhatsApp', at(13, 30)),
      msg('f', '', 'WhatsApp', at(13, 40))
    ]
    const groups = groupPending(items)
    expect(groups.map((g) => [groupLabel(g), g.app, g.keys])).toEqual([
      ['2 messages', 'Mobile connecté', ['a', 'b']],
      ['Marie · 2 messages', 'WhatsApp', ['c', 'd']],
      ['Paul', 'WhatsApp', ['e']],
      ['Nouveau message', 'WhatsApp', ['f']]
    ])
    expect(groups[0].at).toBe(at(13))
    expect(reminderText(items, true, at(15))).toContain('Mobile connecté, Marie (WhatsApp), Paul (WhatsApp)…')
    expect(reminderText(items, true, at(15))).not.toContain('Inconnu')
  })

  it('oublie les marques des messages qui ne sont plus en attente (lus ou fermés)', () => {
    expect(pruneMarks({ a: { remindedAt: 1 }, b: { ignored: true } }, new Set(['b']))).toEqual({ b: { ignored: true } })
  })
})

describe('messages : lecture par Compi', () => {
  const item = (key: string, sender: string, app: string, time: number, text = 'Salut'): MessageItem => ({
    key,
    at: time,
    appKey: app.toLowerCase(),
    app,
    sender,
    text
  })

  it('garde 24 h et 200 messages au plus, sans doublon', () => {
    const now = at(15)
    const old = item('old', 'Marie', 'WhatsApp', now - 25 * 3600_000)
    const kept = keepRecent(
      [old, item('a', 'Marie', 'WhatsApp', at(14))],
      [item('a', 'Marie', 'WhatsApp', at(14)), item('b', 'Paul', 'Telegram', at(14, 30))],
      now
    )
    expect(kept.map((m) => m.key)).toEqual(['a', 'b'])
    const many = Array.from({ length: 250 }, (_, i) => item(`m${i}`, 'X', 'WhatsApp', now - (250 - i) * 1000))
    const capped = keepRecent([], many, now)
    expect(capped).toHaveLength(RECENT_MAX)
    expect(capped.at(-1)?.key).toBe('m249')
  })

  it('filtre par application, expéditeur (sans accents) et durée', () => {
    const list = [item('a', 'Hélène', 'WhatsApp', at(9)), item('b', 'Paul', 'Mobile connecté', at(14)), item('c', 'Helene', 'Telegram', at(14, 50))]
    expect(findMessages(list, { sender: 'helene' }, at(15)).map((m) => m.key)).toEqual(['a', 'c'])
    expect(findMessages(list, { app: 'mobile' }, at(15)).map((m) => m.key)).toEqual(['b'])
    expect(findMessages(list, { sinceMin: 30 }, at(15)).map((m) => m.key)).toEqual(['c'])
    expect(findMessages(list, { limit: 1 }, at(15)).map((m) => m.key)).toEqual(['c'])
  })

  it('masque les codes reçus par SMS, pas les nombres ordinaires', () => {
    expect(maskCodes('482913 est ton code de connexion')).toBe('[code masqué] est ton code de connexion')
    expect(maskCodes('G-123456 is your Google verification code')).toBe('[code masqué] is your Google verification code')
    expect(maskCodes('Votre code : 12 34 56')).toBe('Votre code : [code masqué]')
    expect(maskCodes('On se voit à 18h, table pour 4, budget 1200 €')).toBe('On se voit à 18h, table pour 4, budget 1200 €')
  })
})

describe('messages : confidentialité', () => {
  it('avec un cerveau en ligne, une carte à chaque fois, même si le réglage dit « toujours »', () => {
    expect(privacyDecision('anthropic', TOOL, DEFAULT_PRIVACY)).toBe('ask')
    expect(privacyDecision('custom', TOOL, { ...DEFAULT_PRIVACY, messages: 'always' })).toBe('ask')
    expect(privacyDecision('anthropic', TOOL, { ...DEFAULT_PRIVACY, messages: 'never' })).toBe('deny')
    expect(privacyDecision('local', TOOL, DEFAULT_PRIVACY)).toBeNull()
    expect(filterAutoAllowed([TOOL], 'anthropic', { ...DEFAULT_PRIVACY, messages: 'always' }, [])).toEqual([])
    expect(PRIVACY_CATEGORIES.find((c) => c.id === 'messages')?.noAlways).toBe(true)
  })

  it('les réglages venus de l’interface ne peuvent pas activer la lecture des notifications', () => {
    const current: MessagesSettings = {
      enabled: false,
      apps: [],
      remindAfterMin: 60,
      quietStart: '22:00',
      quietEnd: '08:00',
      preview: false,
      readByCompi: false
    }
    const next = cleanMessagesPatch({ enabled: true, apps: ['whatsapp', 'whatsapp', ''], remindAfterMin: 1, quietStart: '25:00', quietEnd: '07:30' }, current)
    expect(next.enabled).toBe(false)
    expect(next.apps).toEqual(['whatsapp'])
    expect(next.remindAfterMin).toBe(15)
    expect(next.quietStart).toBe('22:00')
    expect(next.quietEnd).toBe('07:30')
    expect(cleanMessagesPatch({ enabled: false }, { ...current, enabled: true }).enabled).toBe(false)
  })
})

describe('messages : réglages de notification de Windows', () => {
  const WA = '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'
  const PHONE = 'Microsoft.YourPhone_8wekyb3d8bbwe!App'

  it('interrupteur général coupé : aucune messagerie ne peut arriver jusqu’à Compi', () => {
    expect(notificationHealth(0, [], ['whatsapp']).toasts).toBe(false)
    expect(notificationHealth(1, [], ['whatsapp'])).toEqual({ toasts: true, blocked: [] })
    // Valeur absente du registre : activé par défaut.
    expect(notificationHealth(undefined, [], ['whatsapp']).toasts).toBe(true)
  })

  it('signale seulement les messageries suivies coupées ou hors du centre de notifications', () => {
    const entries = [
      { aumid: WA, enabled: 0 },
      { aumid: PHONE, enabled: null, center: 0 },
      { aumid: 'Microsoft.YourPhone_8wekyb3d8bbwe!YourPhoneSetup', enabled: 0 },
      { aumid: 'Contoso.Chat_x!App', enabled: 0 }
    ]
    expect(notificationHealth(1, entries, ['whatsapp', 'phone']).blocked).toEqual([
      { key: 'whatsapp', app: 'WhatsApp', reason: 'off' },
      { key: 'phone', app: 'Mobile connecté', reason: 'center' }
    ])
    expect(notificationHealth(1, entries, ['telegram']).blocked).toEqual([])
  })
})
