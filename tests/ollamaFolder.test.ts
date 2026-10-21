import { describe, expect, it } from 'vitest'
import { lastServerModelsDir, needsRestart, parseRegValue, pickModelsDir, sameDir } from '../src/shared/ollamaFolder'

const config = (models: string): string =>
  `time=2026-10-14T22:35:04.120+02:00 level=INFO source=routes.go:1331 msg="server config" env="map[HTTPS_PROXY: OLLAMA_HOST:http://127.0.0.1:11434 OLLAMA_KEEP_ALIVE:5m0s OLLAMA_MODELS:${models} OLLAMA_NOHISTORY:false OLLAMA_ORIGINS:[] ROCR_VISIBLE_DEVICES:]"`

describe('lastServerModelsDir', () => {
  it('lit le dossier du journal et dédouble les barres', () => {
    expect(lastServerModelsDir(config('D:\\\\.ollama\\\\models'))).toBe('D:\\.ollama\\models')
  })

  it('garde les espaces du chemin', () => {
    expect(lastServerModelsDir(config('C:\\\\Users\\\\Jean Dupont\\\\Mes modèles'))).toBe('C:\\Users\\Jean Dupont\\Mes modèles')
  })

  it('prend le dernier démarrage du serveur', () => {
    const log = [
      config('C:\\\\Users\\\\vous\\\\.ollama\\\\models'),
      'time=… level=INFO msg="Listening on 127.0.0.1:11434"',
      config('D:\\\\.ollama\\\\models')
    ].join('\r\n')
    expect(lastServerModelsDir(log)).toBe('D:\\.ollama\\models')
  })

  it('s’arrête en fin de liste', () => {
    expect(lastServerModelsDir('msg="server config" env="map[OLLAMA_HOST:x OLLAMA_MODELS:E:\\\\ia]"')).toBe('E:\\ia')
  })

  it('rien si le journal ne contient pas de démarrage', () => {
    expect(lastServerModelsDir('')).toBeNull()
    expect(lastServerModelsDir('level=INFO msg="Listening on 127.0.0.1:11434"')).toBeNull()
    expect(lastServerModelsDir(config(''))).toBeNull()
  })
})

describe('sameDir', () => {
  it('ignore la casse, les séparateurs et la barre finale', () => {
    expect(sameDir('D:\\.ollama\\models', 'd:/.ollama/models/')).toBe(true)
    expect(sameDir(' D:\\.ollama\\models\\ ', 'D:\\.OLLAMA\\MODELS')).toBe(true)
  })

  it('distingue deux dossiers', () => {
    expect(sameDir('C:\\Users\\vous\\.ollama\\models', 'D:\\.ollama\\models')).toBe(false)
  })
})

describe('pickModelsDir', () => {
  const home = 'C:\\Users\\vous'

  it('le réglage de l’application Ollama passe en premier', () => {
    expect(pickModelsDir({ appSetting: 'D:\\.ollama\\models', envUser: 'E:\\ia', home })).toEqual({ dir: 'D:\\.ollama\\models', source: 'app' })
  })

  it('puis la variable de l’utilisateur, puis celle du système', () => {
    expect(pickModelsDir({ appSetting: ' ', envUser: 'E:\\ia', envMachine: 'F:\\ia', home })).toEqual({ dir: 'E:\\ia', source: 'env' })
    expect(pickModelsDir({ envMachine: 'F:\\ia', home })).toEqual({ dir: 'F:\\ia', source: 'env' })
  })

  it('sinon le dossier par défaut', () => {
    expect(pickModelsDir({ home: 'C:\\Users\\vous\\' })).toEqual({ dir: 'C:\\Users\\vous\\.ollama\\models', source: 'default' })
  })
})

describe('needsRestart', () => {
  const dir = 'D:\\.ollama\\models'

  it('serveur sur l’ancien dossier, aucun modèle visible : redémarrer', () => {
    expect(needsRestart({ running: true, apiModels: 0, folderSizeGb: 12.9, runningDir: 'C:\\Users\\vous\\.ollama\\models', dir })).toBe(true)
  })

  it('journal illisible mais dossier plein et aucun modèle : redémarrer', () => {
    expect(needsRestart({ running: true, apiModels: 0, folderSizeGb: 12.9, runningDir: null, dir })).toBe(true)
  })

  it('pas de redémarrage quand tout va bien', () => {
    expect(needsRestart({ running: true, apiModels: 3, folderSizeGb: 12.9, runningDir: 'C:\\old', dir })).toBe(false)
    expect(needsRestart({ running: false, apiModels: 0, folderSizeGb: 12.9, dir })).toBe(false)
    expect(needsRestart({ running: true, apiModels: 0, folderSizeGb: 0, dir })).toBe(false)
    expect(needsRestart({ running: true, apiModels: 0, folderSizeGb: 12.9, runningDir: 'd:/.ollama/models/', dir })).toBe(false)
  })
})

describe('parseRegValue', () => {
  it('lit REG_SZ et REG_EXPAND_SZ', () => {
    expect(parseRegValue('\r\nHKEY_CURRENT_USER\\Environment\r\n    OLLAMA_MODELS    REG_SZ    D:\\ia models\r\n\r\n', 'OLLAMA_MODELS')).toBe('D:\\ia models')
    expect(parseRegValue('    OLLAMA_MODELS    REG_EXPAND_SZ    %USERPROFILE%\\ia\r\n', 'OLLAMA_MODELS')).toBe('%USERPROFILE%\\ia')
  })

  it('rien si la variable n’existe pas', () => {
    expect(parseRegValue('', 'OLLAMA_MODELS')).toBeUndefined()
    expect(parseRegValue('    OLLAMA_HOST    REG_SZ    0.0.0.0\r\n', 'OLLAMA_MODELS')).toBeUndefined()
  })
})
