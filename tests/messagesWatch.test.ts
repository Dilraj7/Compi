import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Relevé des notifications avec une source simulée (COMPI_NOTIF_TEST_FILE) :
// aucun accès aux vraies notifications de Windows.
const dir = mkdtempSync(join(tmpdir(), 'compi-messages-'))
const notifFile = join(dir, 'notifications.json')
process.env.COMPI_NOTIF_TEST_FILE = notifFile

vi.mock('electron', () => ({
  app: { getPath: () => dir, getVersion: () => '0.0.0-test' },
  powerMonitor: { on: vi.fn() },
  shell: { openExternal: vi.fn(async () => undefined), openPath: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: { defaultSession: {} },
  Notification: class {
    show(): void {}
  }
}))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/bus', () => ({ emit: vi.fn() }))
vi.mock('../src/main/day/meetings', () => ({ inMeeting: () => false }))
vi.mock('../src/main/windows/system', async (importOriginal) => ({ ...(await importOriginal<object>()), launchApp: vi.fn() }))

const { emit } = await import('../src/main/bus')
const { IPC } = await import('../src/shared/ipc')
const { settings } = await import('../src/main/store/settings')
const watch = await import('../src/main/messages/watch')
const { HEADLESS_BLOCKED, createCompiServer } = await import('../src/main/agent/tools')

const WA = '5319275A.WhatsAppDesktop_cv1g1gvanyjgm!App'
const NOW = new Date(2026, 9, 14, 15, 0).getTime()
const marksFile = join(dir, 'messages-reminders.json')
const base = { enabled: true, apps: ['whatsapp'], remindAfterMin: 60, quietStart: '22:00', quietEnd: '08:00', preview: false, readByCompi: true }

const notifications = (list: object[]): void => writeFileSync(notifFile, JSON.stringify(list))
const islandCalls = (): unknown[] =>
  vi
    .mocked(emit)
    .mock.calls.filter(([channel]) => channel === IPC.islandNotify)
    .map(([, payload]) => payload)
const toolNames = (): string[] => {
  const sdk = { tool: (name: string) => ({ name }), createSdkMcpServer: (o: { tools: Array<{ name: string }> }) => o }
  const server = createCompiServer(sdk as never, { provider: 'anthropic', vision: false, cloudHelp: false }) as unknown as { tools: Array<{ name: string }> }
  return server.tools.map((t) => t.name)
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(NOW)
  settings.load()
})

afterAll(() => {
  watch.stopMessages(true)
  vi.useRealTimers()
  rmSync(dir, { recursive: true, force: true })
  delete process.env.COMPI_NOTIF_TEST_FILE
})

describe('messages en attente : relevé simulé', () => {
  it('sans « Compi peut lire mes messages », pas d’outil de lecture', () => {
    expect(HEADLESS_BLOCKED).toContain('mcp__compi__messages_recent')
    expect(toolNames()).not.toContain('messages_recent')
    settings.update({ messages: { ...base, readByCompi: false } })
    expect(toolNames()).not.toContain('messages_recent')
  })

  it('rappelle une fois un message resté sans réponse, sans écrire ni nom ni texte sur le disque', async () => {
    notifications([
      { id: 1, aumid: WA, app: 'WhatsApp', at: NOW - 2 * 3600_000, title: 'Marie', body: 'Ton code de vérification est 482913' },
      { id: 7, aumid: 'Contoso.Mail_x!App', app: 'Contoso Mail', at: NOW, title: 'Facture', body: 'Montant 120 €' }
    ])
    settings.update({ messages: base })
    watch.syncMessages()

    // Premier relevé : l'application est repérée ; son texte n'est lu qu'au suivant.
    await vi.advanceTimersByTimeAsync(600)
    expect(watch.messagesStatus().pending).toEqual([])
    await vi.advanceTimersByTimeAsync(3000)

    const status = watch.messagesStatus()
    expect(status.access).toBe('allowed')
    expect(status.windows).toEqual({ toasts: true, blocked: [] })
    expect(status.pending).toHaveLength(1)
    expect(status.pending[0]).toMatchObject({ sender: 'Marie', app: 'WhatsApp', appKey: 'whatsapp' })
    expect(status.seenApps.map((a) => a.app)).toEqual(['Contoso Mail', 'WhatsApp'])

    expect(islandCalls()).toEqual([{ pill: 'message', text: '1 message en attente depuis 2 h · WhatsApp', view: 'today', duration: 9000 }])
    const disk = readFileSync(marksFile, 'utf8')
    expect(disk).not.toMatch(/Marie|482913|Facture|vérification/)

    // Lecture par Compi : en mémoire, code masqué, autres applications jamais lues.
    const recent = watch.recentMessages({})
    expect(recent).toHaveLength(1)
    expect(recent[0].text).not.toContain('482913')
    expect(toolNames()).toContain('messages_recent')

    // Pas de second rappel pour le même message.
    await vi.advanceTimersByTimeAsync(3000)
    expect(islandCalls()).toHaveLength(1)
  })

  it('« Plus tard » rappelle une heure après, « Ignorer » retire le message', async () => {
    const key = watch.messagesStatus().pending[0].key
    const before = islandCalls().length
    watch.snoozeMessage(key, 60)
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(islandCalls()).toHaveLength(before)
    await vi.advanceTimersByTimeAsync(31 * 60_000)
    expect(islandCalls()).toHaveLength(before + 1)

    watch.ignoreMessage(key)
    expect(watch.messagesStatus().pending).toEqual([])
  })

  it('un message ouvert ou fermé (sorti des notifications) n’est plus en attente', async () => {
    notifications([])
    await vi.advanceTimersByTimeAsync(3000)
    expect(watch.messagesStatus().pending).toEqual([])
    expect(JSON.parse(readFileSync(marksFile, 'utf8'))).toEqual({})
  })

  it('Mobile connecté : une notification à une seule ligne est en attente sans expéditeur, et cette ligne n’est lue qu’avec la lecture activée', async () => {
    const PHONE = 'Microsoft.YourPhone_8wekyb3d8bbwe!App'
    // Forme réelle : la ligne utile entourée de lignes de retours à la ligne et de tabulations.
    notifications([{ id: 3, aumid: PHONE, app: 'Mobile connecté', at: NOW - 3600_000, lines: ['\n\t\t\t', 'Ligne utile', '\n\t\t'] }])
    settings.update({ messages: { ...base, apps: ['whatsapp', 'phone'], readByCompi: false } })
    watch.syncMessages()
    await vi.advanceTimersByTimeAsync(3600)
    await vi.advanceTimersByTimeAsync(3600)
    const pending = watch.messagesStatus().pending
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ sender: '', app: 'Mobile connecté', appKey: 'phone' })
    expect(watch.recentMessages({})).toEqual([])

    settings.update({ messages: { ...base, apps: ['whatsapp', 'phone'], readByCompi: true } })
    watch.syncMessages()
    await vi.advanceTimersByTimeAsync(3600)
    expect(watch.recentMessages({}).map((m) => [m.sender, m.text])).toEqual([['', 'Ligne utile']])
    notifications([])
    await vi.advanceTimersByTimeAsync(3600)
  })

  it('désactiver la lecture oublie le texte ; désactiver tout efface les marques', () => {
    settings.update({ messages: { ...base, readByCompi: false } })
    watch.syncMessages()
    expect(watch.recentMessages({})).toEqual([])

    settings.update({ messages: { ...base, enabled: false } })
    watch.syncMessages()
    expect(existsSync(marksFile)).toBe(false)
    expect(watch.messagesStatus().seenApps).toEqual([])
  })

  it('notifications de Windows coupées : le statut le dit', async () => {
    process.env.COMPI_NOTIF_TEST_TOASTS = '0'
    try {
      const status = await watch.refreshAccess()
      expect(status.windows?.toasts).toBe(false)
    } finally {
      delete process.env.COMPI_NOTIF_TEST_TOASTS
    }
  })
})
