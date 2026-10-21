import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'compi-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { DEFAULT_EMBED_MODEL, SETTINGS_VERSION, settings } = await import('../src/main/store/settings')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('réglages v11', () => {
  it('un profil v7 garde ses choix et reçoit les nouveautés désactivées', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 7, userName: 'Alex', folders: ['D:\\Docs'], privacy: { mail: 'always' } }))
    const s = settings.load()
    expect(SETTINGS_VERSION).toBe(11)
    expect(s.settingsVersion).toBe(11)
    expect(s.userName).toBe('Alex')
    expect(s.folders).toEqual(['D:\\Docs'])
    expect(s.privacy.mail).toBe('always')
    expect(s.privacy.memory).toBe('ask')
    // Presse-papier et recherche par le sens : rien sans l'accord de l'utilisateur.
    expect(s.clipboardHistory).toBe(false)
    expect(s.semantic).toEqual({ enabled: false, model: DEFAULT_EMBED_MODEL })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).settingsVersion).toBe(11)
  })

  it('modifier la recherche par le sens ne perd pas le modèle', () => {
    settings.update({ semantic: { enabled: true } as never })
    expect(settings.get().semantic).toEqual({ enabled: true, model: DEFAULT_EMBED_MODEL })
  })

  it('un profil v8 reçoit les messages désactivés, avec accord à chaque lecture', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 8, userName: 'Alex', clipboardHistory: true }))
    const s = settings.load()
    expect(s.settingsVersion).toBe(11)
    expect(s.clipboardHistory).toBe(true)
    expect(s.messages).toEqual({ enabled: false, apps: [], remindAfterMin: 60, quietStart: '22:00', quietEnd: '08:00', preview: false, readByCompi: false })
    expect(s.privacy.messages).toBe('ask')
  })

  it('modifier une partie des messages garde le reste', () => {
    settings.update({ messages: { apps: ['whatsapp'] } as never })
    expect(settings.get().messages.apps).toEqual(['whatsapp'])
    expect(settings.get().messages.remindAfterMin).toBe(60)
    expect(settings.get().messages.enabled).toBe(false)
  })

  it('un profil v9 reçoit les sons (bas), les raccourcis d’autorisation et le moniteur désactivé', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        settingsVersion: 9,
        userName: 'Alex',
        local: { engine: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'gemma4:12b', cloudHelp: true, effort: 'low' }
      })
    )
    const s = settings.load()
    expect(s.settingsVersion).toBe(11)
    expect(s.local.model).toBe('gemma4:12b')
    expect(s.local.keepAlive).toBe('30m')
    expect(s.sounds).toEqual({
      enabled: true,
      volume: 'low',
      approvals: true,
      reminders: true,
      messages: true,
      routines: false,
      quietStart: '22:00',
      quietEnd: '08:00'
    })
    expect(s.approvalKeys).toEqual({ enabled: true, allow: 'Alt+Shift+O', deny: 'Alt+Shift+N' })
    expect(s.monitor).toEqual({ island: false })
  })

  it('modifier une partie des sons garde le reste', () => {
    settings.update({ sounds: { volume: 'very-low' } as never })
    expect(settings.get().sounds.volume).toBe('very-low')
    expect(settings.get().sounds.enabled).toBe(true)
    expect(settings.get().sounds.quietStart).toBe('22:00')
  })

  it('un profil v10 reçoit les sources de l’agenda : Google comme avant, rien d’autre', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 10, userName: 'Alex', google: { calendar: true } }))
    const s = settings.load()
    expect(s.settingsVersion).toBe(11)
    expect(s.agenda).toEqual({ googleCalendars: null, sources: [] })
  })

  it('une liste de sources abîmée (fichier modifié à la main) ne bloque pas le démarrage', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 11, agenda: { googleCalendars: ['primary'], sources: 'oups' } }))
    const s = settings.load()
    expect(s.agenda).toEqual({ googleCalendars: ['primary'], sources: [] })
  })

  it('choisir des agendas Google garde les sources ajoutées', () => {
    settings.update({ agenda: { googleCalendars: null, sources: [{ id: 'x1', kind: 'ics', name: 'Club', enabled: true, host: 'exemple.fr' }] } })
    settings.update({ agenda: { googleCalendars: ['primary'] } as never })
    expect(settings.get().agenda.sources).toHaveLength(1)
    expect(settings.get().agenda.googleCalendars).toEqual(['primary'])
  })
})
