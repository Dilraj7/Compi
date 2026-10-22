import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'compi-settings-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { DEFAULT_EMBED_MODEL, SETTINGS_VERSION, settings } = await import('../src/main/store/settings')
const { DEFAULT_DICTATION } = await import('../src/shared/dictation')
const { DEFAULT_MEETINGS } = await import('../src/shared/meetings')

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('réglages v15', () => {
  it('un profil v7 garde ses choix et reçoit les nouveautés désactivées', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 7, userName: 'Alex', folders: ['D:\\Docs'], privacy: { mail: 'always' } }))
    const s = settings.load()
    expect(SETTINGS_VERSION).toBe(15)
    expect(s.settingsVersion).toBe(15)
    expect(s.userName).toBe('Alex')
    expect(s.folders).toEqual(['D:\\Docs'])
    expect(s.privacy.mail).toBe('always')
    expect(s.privacy.memory).toBe('ask')
    // Presse-papier et recherche par le sens : rien sans l'accord de l'utilisateur.
    expect(s.clipboardHistory).toBe(false)
    expect(s.semantic).toEqual({ enabled: false, model: DEFAULT_EMBED_MODEL })
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')).settingsVersion).toBe(15)
  })

  it('modifier la recherche par le sens ne perd pas le modèle', () => {
    settings.update({ semantic: { enabled: true } as never })
    expect(settings.get().semantic).toEqual({ enabled: true, model: DEFAULT_EMBED_MODEL })
  })

  it('un profil v8 reçoit les messages désactivés, avec accord à chaque lecture', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 8, userName: 'Alex', clipboardHistory: true }))
    const s = settings.load()
    expect(s.settingsVersion).toBe(15)
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
    expect(s.settingsVersion).toBe(15)
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
    expect(s.settingsVersion).toBe(15)
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

  it('un profil v11 reçoit la dictée partout désactivée, avec une copie de l’ancien fichier', () => {
    rmSync(join(dir, 'settings.v11.bak.json'), { force: true })
    const v11 = JSON.stringify({ settingsVersion: 11, userName: 'Alex', voice: { shortcut: 'Alt+Shift+D', model: 'base' }, folders: ['D:\\Docs'] })
    writeFileSync(join(dir, 'settings.json'), v11)
    const s = settings.load()
    expect(s.settingsVersion).toBe(15)
    expect(s.userName).toBe('Alex')
    expect(s.folders).toEqual(['D:\\Docs'])
    expect(s.voice.shortcut).toBe('Alt+Shift+D')
    expect(s.voice.model).toBe('base')
    expect(s.dictation).toEqual(DEFAULT_DICTATION)
    expect(s.dictation.enabled).toBe(false)
    expect(readFileSync(join(dir, 'settings.v11.bak.json'), 'utf8')).toBe(v11)
    // Une seconde migration n'écrase pas la copie.
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 11, userName: 'Autre' }))
    settings.load()
    expect(readFileSync(join(dir, 'settings.v11.bak.json'), 'utf8')).toBe(v11)
  })

  it('un profil à jour n’écrit pas de copie', () => {
    rmSync(join(dir, 'settings.v15.bak.json'), { force: true })
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 15, userName: 'Alex' }))
    settings.load()
    expect(existsSync(join(dir, 'settings.v15.bak.json'))).toBe(false)
  })

  it('un profil v14 garde sa confidentialité et reçoit la recherche web désactivée, avec une carte par défaut', () => {
    rmSync(join(dir, 'settings.v14.bak.json'), { force: true })
    const v14 = JSON.stringify({
      settingsVersion: 14,
      userName: 'Alex',
      privacy: { files: 'always', memory: 'never' },
      voice: { engine: 'natural', naturalVoice: 'F1' }
    })
    writeFileSync(join(dir, 'settings.json'), v14)
    const s = settings.load()
    expect(s.settingsVersion).toBe(15)
    expect(s.webSearch).toEqual({ provider: 'off', searxngUrl: '' })
    expect(s.privacy).toMatchObject({ files: 'always', memory: 'never', web: 'ask' })
    expect(s.voice.engine).toBe('natural')
    expect(readFileSync(join(dir, 'settings.v14.bak.json'), 'utf8')).toBe(v14)
  })

  it('une recherche web abîmée (fichier modifié à la main) revient à « désactivée »', () => {
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ settingsVersion: 15, webSearch: { provider: 'google', searxngUrl: 42 } }))
    expect(settings.load().webSearch).toEqual({ provider: 'off', searxngUrl: '' })
    settings.update({ webSearch: { provider: 'searxng', searxngUrl: ' http://localhost:8080 ' } })
    settings.update({ webSearch: { provider: 'ollama' } as never })
    expect(settings.get().webSearch).toEqual({ provider: 'ollama', searxngUrl: 'http://localhost:8080' })
  })

  it('un profil v13 garde sa voix de Windows et reçoit la voix naturelle non choisie', () => {
    rmSync(join(dir, 'settings.v13.bak.json'), { force: true })
    const v13 = JSON.stringify({ settingsVersion: 13, userName: 'Alex', voice: { speak: 'always', voice: 'MSTTS_V110_frFR_JulieM', rate: 1.2 } })
    writeFileSync(join(dir, 'settings.json'), v13)
    const s = settings.load()
    expect(s.settingsVersion).toBe(15)
    expect(s.voice).toMatchObject({ speak: 'always', voice: 'MSTTS_V110_frFR_JulieM', rate: 1.2, shortcut: 'Alt+Shift+V', model: 'small' })
    expect(s.voice.engine).toBe('windows')
    expect(s.voice.naturalVoice).toBe('F1')
    expect(readFileSync(join(dir, 'settings.v13.bak.json'), 'utf8')).toBe(v13)
    settings.update({ voice: { ...s.voice, engine: 'natural' } })
    expect(settings.get().voice.voice).toBe('MSTTS_V110_frFR_JulieM')
  })

  it('un profil v12 reçoit les réunions (rien ne s’enregistre sans clic) et garde sa dictée', () => {
    rmSync(join(dir, 'settings.v12.bak.json'), { force: true })
    const v12 = JSON.stringify({
      settingsVersion: 12,
      userName: 'Alex',
      dictation: { ...DEFAULT_DICTATION, enabled: true, engine: 'omnilingual' },
      privacy: { mail: 'always' }
    })
    writeFileSync(join(dir, 'settings.json'), v12)
    const s = settings.load()
    expect(s.settingsVersion).toBe(15)
    expect(s.dictation.enabled).toBe(true)
    expect(s.dictation.engine).toBe('omnilingual')
    expect(s.meetings).toEqual(DEFAULT_MEETINGS)
    expect(s.meetings.keepAudio).toBe(false)
    expect(s.privacy.mail).toBe('always')
    expect(s.privacy.meetings).toBe('ask')
    expect(readFileSync(join(dir, 'settings.v12.bak.json'), 'utf8')).toBe(v12)
  })

  it('des réglages de réunions abîmés reviennent aux valeurs sûres', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({ settingsVersion: 13, meetings: { engine: 'whisper', voices: 'non', keepAudio: 'oui', autoSummary: 0 } })
    )
    const m = settings.load().meetings
    expect(m.engine).toBe('parakeet')
    expect(m.voices).toBe(true)
    expect(m.keepAudio).toBe(false)
    expect(m.autoSummary).toBe(true)
    settings.update({ meetings: { keepAudio: true } as never })
    expect(settings.get().meetings).toEqual({ ...DEFAULT_MEETINGS, keepAudio: true })
  })

  it('une dictée abîmée (fichier modifié à la main) revient aux valeurs sûres', () => {
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        settingsVersion: 12,
        dictation: {
          enabled: 'oui',
          key: 'F13',
          engine: 'x',
          style: 'joli',
          appStyles: 'oups',
          dictionary: [{ from: 'a' }, { from: 'b', to: 'B' }],
          typingWpm: 9000
        }
      })
    )
    const d = settings.load().dictation
    expect(d.enabled).toBe(false)
    expect(d.key).toBe('ControlRight')
    expect(d.engine).toBe('parakeet')
    expect(d.style).toBe('natural')
    expect(d.appStyles).toEqual([])
    expect(d.dictionary).toEqual([{ from: 'b', to: 'B' }])
    expect(d.typingWpm).toBe(40)
  })

  it('modifier une partie de la dictée garde le reste', () => {
    settings.update({ dictation: { enabled: true } as never })
    settings.update({ dictation: { style: 'raw' } as never })
    expect(settings.get().dictation.enabled).toBe(true)
    expect(settings.get().dictation.style).toBe('raw')
    expect(settings.get().dictation.key).toBe('ControlRight')
  })
})
