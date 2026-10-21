import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.' },
  powerMonitor: { on: vi.fn() },
  net: { fetch: vi.fn() },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: { defaultSession: {} },
  Notification: class {
    show(): void {}
  }
}))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/bus', () => ({ emit: vi.fn() }))

const { appLabel, formatClock, mediaChanged, mediaPosition, trackKey } = await import('../src/shared/media')
const { durationLabel, newPomodoro, newTimer, paused, pomodoroNext, progress, remainingMs, resumed, timerEndText, timerTitle } =
  await import('../src/shared/timer')
const { cleanSpeech, speakableEnd, speechChunks, speechText, SPEECH_MAX } = await import('../src/shared/speech')
const { toMediaInfo } = await import('../src/main/windows/media')
const { formatMedia } = await import('../src/main/agent/liveTools')
const { SAFE_COMPI_TOOLS, CONFIRM_EACH_TIME, HEADLESS_BLOCKED } = await import('../src/main/agent/tools')
const { privacyDecision, TOOL_CATEGORY } = await import('../src/shared/privacy')
const { encodeCommand, parseHostLine, PowerShellHost } = await import('../src/main/windows/host')
const { cleanTranscript, isVoiceModel, silenceStep, sizeLabel, VOICE_LIMITS, VOICE_MODELS } = await import('../src/shared/voice')
const { expectedHash, gitBlobHasher, hfBase, modelFileFor } = await import('../src/main/voice/model')
const { isOwnPage } = await import('../src/main/permissions')
const { createHash } = await import('node:crypto')
const { join, normalize } = await import('node:path')

const NOW = new Date(2026, 9, 13, 10, 0).getTime()

describe('musique en cours', () => {
  it('nomme l’application à partir de son identifiant Windows', () => {
    expect(appLabel('SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify')).toBe('Spotify')
    expect(appLabel('Chrome')).toBe('Chrome')
    expect(appLabel('MSEdge')).toBe('Edge')
    expect(appLabel('308046B0AF4A39CB')).toBe('Firefox')
    expect(appLabel('Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic')).toBe('Lecteur multimédia')
    expect(appLabel('C:\\Program Files\\VideoLAN\\VLC\\vlc.exe')).toBe('VLC')
    expect(appLabel('A1B2C3D4E5F6A7B8')).toBe('')
    expect(appLabel('MonLecteur')).toBe('MonLecteur')
    expect(appLabel('')).toBe('')
  })

  it('transforme la réponse de Windows (rien, arrêté, en lecture)', () => {
    expect(toMediaInfo({ status: 'none' }, NOW)).toBeNull()
    expect(toMediaInfo({ status: 'playing', title: '  ' }, NOW)).toBeNull()
    expect(toMediaInfo({ status: 'stopped', title: 'X' }, NOW)).toBeNull()
    const m = toMediaInfo(
      {
        status: 'playing',
        title: ' Naan Pizhai ',
        artist: 'Flute Siva',
        app: 'SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify',
        position: 197.8,
        duration: 242.4,
        updated: NOW - 1000,
        canNext: true,
        canPrevious: false
      },
      NOW
    )!
    expect(m).toMatchObject({
      status: 'playing',
      title: 'Naan Pizhai',
      artist: 'Flute Siva',
      app: 'Spotify',
      position: 197.8,
      duration: 242.4,
      at: NOW - 1000,
      canNext: true,
      canPrevious: false
    })
  })

  it('date le relevé lui-même quand l’application ne date pas la position', () => {
    expect(toMediaInfo({ status: 'paused', title: 'A', updated: 0 }, NOW)!.at).toBe(NOW)
    expect(toMediaInfo({ status: 'paused', title: 'A', updated: NOW + 60_000 }, NOW)!.at).toBe(NOW)
  })

  it('fait avancer la position seulement pendant la lecture', () => {
    const base = { position: 60, duration: 200, at: NOW }
    expect(mediaPosition({ ...base, status: 'playing' }, NOW + 5000)).toBe(65)
    expect(mediaPosition({ ...base, status: 'paused' }, NOW + 5000)).toBe(60)
    expect(mediaPosition({ ...base, status: 'playing' }, NOW + 999_000)).toBe(200)
    expect(mediaPosition({ ...base, duration: 0, status: 'playing' }, NOW + 5000)).toBe(0)
  })

  it('ne prévient l’îlot que pour un changement visible', () => {
    const a = toMediaInfo({ status: 'playing', title: 'A', artist: 'B', app: 'Spotify', position: 10, duration: 100, updated: NOW }, NOW)!
    // Le temps qui passe : pas de message.
    expect(mediaChanged(a, { ...a, position: 15, at: NOW + 5000 }, NOW + 5000)).toBe(false)
    // Avance rapide, pause, autre morceau, pochette arrivée : message.
    expect(mediaChanged(a, { ...a, position: 80, at: NOW + 5000 }, NOW + 5000)).toBe(true)
    expect(mediaChanged(a, { ...a, status: 'paused' }, NOW)).toBe(true)
    expect(mediaChanged(a, { ...a, title: 'C' }, NOW)).toBe(true)
    expect(mediaChanged(a, { ...a, art: 'data:image/png;base64,AA' }, NOW)).toBe(true)
    expect(mediaChanged(null, a, NOW)).toBe(true)
    expect(mediaChanged(a, null, NOW)).toBe(true)
    expect(mediaChanged(null, null, NOW)).toBe(false)
    expect(trackKey(a)).not.toBe(trackKey({ ...a, artist: 'Z' }))
  })

  it('formate les durées comme une horloge', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(5_400)).toBe('0:06')
    expect(formatClock(754_000)).toBe('12:34')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatClock(-50)).toBe('0:00')
  })

  it('décrit la musique pour le modèle', () => {
    expect(formatMedia(null, NOW)).toBe('Aucune musique ni vidéo en cours.')
    const m = toMediaInfo({ status: 'playing', title: 'A', artist: 'B', app: 'Spotify', position: 72, duration: 220, updated: NOW }, NOW)
    expect(formatMedia(m, NOW)).toBe('En lecture : A — B (Spotify), 1:12 / 3:40.')
    expect(formatMedia({ ...m!, status: 'paused', artist: '', app: '', duration: 0 }, NOW)).toBe('En pause : A.')
  })
})

describe('minuteur et pomodoro', () => {
  it('borne la durée et garde le libellé court', () => {
    expect(newTimer(1000, '', NOW).durationMs).toBe(5000)
    expect(newTimer(48 * 3600_000, '', NOW).durationMs).toBe(12 * 3600_000)
    const t = newTimer(10 * 60_000, '  Pâtes  ', NOW)
    expect(t).toMatchObject({ kind: 'timer', label: 'Pâtes', durationMs: 600_000, endsAt: NOW + 600_000 })
    expect(timerTitle(t)).toBe('Minuteur · Pâtes')
    expect(timerTitle({ ...t, label: '' })).toBe('Minuteur')
  })

  it('pause et reprise conservent le temps restant', () => {
    const t = newTimer(10 * 60_000, '', NOW)
    const p = paused(t, NOW + 4 * 60_000)
    expect(p.endsAt).toBeUndefined()
    expect(remainingMs(p, NOW + 99 * 60_000)).toBe(6 * 60_000)
    expect(paused(p, NOW + 5 * 60_000)).toBe(p)
    const r = resumed(p, NOW + 20 * 60_000)
    expect(r.endsAt).toBe(NOW + 26 * 60_000)
    expect(r.remainingMs).toBeUndefined()
    expect(resumed(r, NOW)).toBe(r)
    expect(progress(r, NOW + 23 * 60_000)).toBeCloseTo(0.7)
  })

  it('pomodoro : concentration, pause, …, sans pause après la dernière concentration', () => {
    let t = newPomodoro({ focusMin: 25, breakMin: 5, rounds: 2 }, NOW)
    expect(t.pomodoro).toMatchObject({ phase: 'focus', round: 1, rounds: 2 })
    expect(timerTitle(t)).toBe('Pomodoro 1/2 · concentration')

    let next = pomodoroNext(t, NOW + 25 * 60_000)!
    expect(next.pomodoro).toMatchObject({ phase: 'break', round: 1 })
    expect(next.durationMs).toBe(5 * 60_000)
    expect(timerEndText(t, next)).toBe('Pause de 5 min : lève-toi, bois un verre d’eau.')

    t = next
    next = pomodoroNext(t, NOW + 30 * 60_000)!
    expect(next.pomodoro).toMatchObject({ phase: 'focus', round: 2 })
    expect(timerEndText(t, next)).toBe('C’est reparti : concentration 2/2.')

    expect(pomodoroNext(next, NOW + 55 * 60_000)).toBeNull()
    expect(timerEndText(next, null)).toBe('Bravo, 2 pomodoros terminés !')
  })

  it('pomodoro : valeurs par défaut et bornes', () => {
    expect(newPomodoro({}, NOW).pomodoro).toMatchObject({ focusMin: 25, breakMin: 5, rounds: 4 })
    expect(newPomodoro({ focusMin: 500, breakMin: 0, rounds: 99 }, NOW).pomodoro).toMatchObject({ focusMin: 120, breakMin: 1, rounds: 12 })
    expect(pomodoroNext(newTimer(60_000, '', NOW), NOW)).toBeNull()
  })

  it('annonce les durées en français', () => {
    expect(durationLabel(45_000)).toBe('45 s')
    expect(durationLabel(90_000)).toBe('1 min 30 s')
    expect(durationLabel(10 * 60_000)).toBe('10 min')
    expect(durationLabel(90 * 60_000)).toBe('1 h 30')
    expect(durationLabel(2 * 3600_000)).toBe('2 h')
  })

  it('minuteur et musique : autorisés sans carte, la musique passe par le garde-fou', () => {
    for (const t of ['timer_start', 'pomodoro_start', 'timer_status', 'timer_stop', 'now_playing']) {
      expect(SAFE_COMPI_TOOLS).toContain(`mcp__compi__${t}`)
      expect(CONFIRM_EACH_TIME).not.toContain(`mcp__compi__${t}`)
    }
    expect(TOOL_CATEGORY.mcp__compi__now_playing).toBe('window')
    expect(privacyDecision('anthropic', 'mcp__compi__now_playing', { window: 'ask' })).toBe('ask')
    expect(privacyDecision('local', 'mcp__compi__now_playing', { window: 'never' })).toBeNull()
    expect(TOOL_CATEGORY.mcp__compi__timer_start).toBeUndefined()
  })

  it('rangement : les écritures demandent une carte à chaque fois et jamais en routine ; l’inventaire passe par le garde-fou « Fichiers »', () => {
    for (const t of ['create_folders', 'move_items', 'undo_moves']) {
      expect(CONFIRM_EACH_TIME).toContain(`mcp__compi__${t}`)
      expect(SAFE_COMPI_TOOLS).not.toContain(`mcp__compi__${t}`)
      expect(HEADLESS_BLOCKED).toContain(`mcp__compi__${t}`)
    }
    for (const t of ['folder_inventory', 'open_folder']) expect(SAFE_COMPI_TOOLS).toContain(`mcp__compi__${t}`)
    expect(HEADLESS_BLOCKED).toContain('mcp__compi__open_folder')
    expect(privacyDecision('anthropic', 'mcp__compi__folder_inventory', { files: 'ask' })).toBe('ask')
    expect(privacyDecision('local', 'mcp__compi__folder_inventory', { files: 'never' })).toBeNull()
  })
})

describe('lecture à voix haute', () => {
  it('retire le Markdown, le code, les liens et les émojis', () => {
    const md = [
      '## Résumé',
      '',
      'Voici **trois** points, voir [la doc](https://exemple.fr/doc) 🎉 :',
      '- Premier *point*',
      '1. Deuxième `point`',
      '',
      '```ts',
      'const x = 1',
      '```',
      'Source : https://exemple.fr/a?b=c'
    ].join('\n')
    const t = speechText(md)
    expect(t).toBe('Résumé.\nVoici trois points, voir la doc :\nPremier point\nDeuxième point\n(Le code est à l’écran.)\nSource : ce lien')
    expect(t).not.toMatch(/[*`#[\]]|https?:/)
  })

  it('lit les tableaux comme des listes', () => {
    expect(speechText('| Jour | Météo |\n|---|:---:|\n| Lundi | Soleil |')).toBe('Jour, Météo.\nLundi, Soleil.')
  })

  it('coupe un texte trop long', () => {
    const t = speechText('mot '.repeat(2000))
    expect(t.length).toBeLessThan(SPEECH_MAX + 40)
    expect(t.endsWith('La suite est à l’écran.')).toBe(true)
  })

  it('découpe entre les phrases, avec un premier morceau court', () => {
    const text = Array.from({ length: 12 }, (_, i) => `Phrase numéro ${i + 1} avec quelques mots.`).join(' ')
    const chunks = speechChunks(text, 120, 60)
    expect(chunks[0].length).toBeLessThanOrEqual(60)
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(120)
      expect(c).toMatch(/\.$/)
    }
    expect(chunks.join(' ')).toBe(text)
  })

  it('coupe une phrase sans ponctuation entre deux mots', () => {
    const text = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')
    const chunks = speechChunks(text, 100, 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
    expect(chunks.join(' ')).toBe(text)
    expect(speechChunks('')).toEqual([])
    expect(speechChunks('Court.')).toEqual(['Court.'])
  })
})

describe('lecture pendant que la réponse s’écrit', () => {
  it('lit les phrases terminées, pas celle qui s’écrit', () => {
    expect(speakableEnd('Bonjour. Je regar')).toBe('Bonjour.'.length)
    expect(speakableEnd('Bonjour. Je regar', 8)).toBe(8)
    expect(speakableEnd('Une ligne\nPuis')).toBe('Une ligne\n'.length)
    expect(speakableEnd('Sans fin de phrase')).toBe(0)
  })

  it('attend la fin d’un bloc de code, d’un tableau, d’un titre ou d’une liste', () => {
    const open = 'Voici :\n```ts\nconst x = 1. Encore\n'
    expect(speakableEnd(open)).toBe('Voici :\n'.length)
    expect(speakableEnd(`${open}\`\`\`\nFin`)).toBe(`${open}\`\`\`\n`.length)
    expect(speakableEnd('| Jour | Météo. Soleil |')).toBe(0)
    expect(speakableEnd('## Résumé. Suite')).toBe(0)
    expect(speakableEnd('- Premier point. Encore')).toBe(0)
  })

  it('ne coupe pas au milieu du gras ni d’un lien', () => {
    expect(speakableEnd('Voici **un point. important** et')).toBe(0)
    expect(speakableEnd('Voir [la doc. ici](https://exemple.fr) puis')).toBe(0)
    expect(speakableEnd('Voici **un point** important. Et')).toBe('Voici **un point** important.'.length)
  })

  it('lu morceau par morceau, le texte dit est le même que lu d’un coup', () => {
    const md = [
      '## Résumé',
      '',
      'Voici **trois** points, voir [la doc](https://exemple.fr/doc) 🎉. Puis la suite ! Et encore ?',
      '- Premier *point*',
      '1. Deuxième `point`',
      '',
      '| Jour | Météo |',
      '|---|:---:|',
      '| Lundi | Soleil |',
      '```ts',
      'const x = 1. Pas lu.',
      '```',
      'Dernière phrase sans point'
    ].join('\n')
    const said: string[] = []
    let consumed = 0
    for (let n = 1; n <= md.length; n += 7) {
      const end = speakableEnd(md.slice(0, n), consumed)
      if (end > consumed) said.push(cleanSpeech(md.slice(consumed, end)))
      consumed = Math.max(consumed, end)
    }
    said.push(cleanSpeech(md.slice(consumed)))
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim()
    expect(norm(said.filter(Boolean).join(' '))).toBe(norm(cleanSpeech(md)))
    expect(said.length).toBeGreaterThan(4)
  })
})

describe('hôtes PowerShell', () => {
  it('un hôte par usage, même protocole', () => {
    const h = new PowerShellHost<'ping'>('hôte test', '# vide')
    expect(typeof h.call).toBe('function')
    h.stop()
    expect(parseHostLine('{"ok":true,"result":{"pong":true},"id":1}')).toEqual({ id: 1, ok: true, result: { pong: true }, error: undefined })
    expect(Buffer.from(encodeCommand('é'), 'base64').toString('utf16le')).toBe('é')
  })
})

describe('dictée', () => {
  it('modèles : révision figée, fichiers et formats cohérents', () => {
    for (const [id, m] of Object.entries(VOICE_MODELS)) {
      expect(isVoiceModel(id)).toBe(true)
      expect(m.revision).toMatch(/^[0-9a-f]{40}$/)
      expect(m.repo).toMatch(/^onnx-community\/whisper-/)
      for (const v of Object.values(m.variants)) {
        expect(v.files).toContain('tokenizer.json')
        expect(v.files.filter((f) => f.startsWith('onnx/encoder_model'))).toHaveLength(1)
        expect(v.files.filter((f) => f.startsWith('onnx/decoder_model_merged'))).toHaveLength(1)
        // Le suffixe du fichier correspond au format demandé au moteur.
        const suffix: Record<string, string> = { fp32: '', fp16: '_fp16', q4: '_q4', q8: '_quantized' }
        expect(v.files).toContain(`onnx/encoder_model${suffix[v.dtype.encoder_model]}.onnx`)
        expect(v.files).toContain(`onnx/decoder_model_merged${suffix[v.dtype.decoder_model_merged]}.onnx`)
      }
    }
    expect(isVoiceModel('constructor')).toBe(false)
    expect(isVoiceModel('large')).toBe(false)
    expect(sizeLabel(413, true)).toBe('413 Mo')
    expect(sizeLabel(1_250_000_000)).toBe('1,3 Go')
  })

  it('s’arrête après un silence, abandonne si personne ne parle', () => {
    const t0 = 1_000_000
    let s = { heard: false, quietSince: null as number | null, startedAt: t0 }
    // Silence au début : on attend que l'utilisateur parle…
    expect(silenceStep(s, 0.01, t0 + 3000).stop).toBeNull()
    // … puis on abandonne.
    expect(silenceStep(s, 0.01, t0 + VOICE_LIMITS.noSpeechMs).stop).toBe('nothing')
    // Parole, puis silence : arrêt après le délai.
    s = silenceStep(s, 0.3, t0 + 500).state
    expect(s.heard).toBe(true)
    s = silenceStep(s, 0.01, t0 + 1000).state
    expect(silenceStep(s, 0.01, t0 + 1000 + VOICE_LIMITS.silenceMs - 100).stop).toBeNull()
    expect(silenceStep(s, 0.01, t0 + 1000 + VOICE_LIMITS.silenceMs).stop).toBe('silence')
    // Reprise de la parole : le silence repart de zéro.
    s = silenceStep(s, 0.2, t0 + 2000).state
    expect(s.quietSince).toBeNull()
    expect(silenceStep(s, 0.3, t0 + VOICE_LIMITS.maxMs).stop).toBe('max')
  })

  it('nettoie les transcriptions (bruits, phrases inventées sur un silence)', () => {
    expect(cleanTranscript('  Quel temps fait-il demain ?  ')).toBe('Quel temps fait-il demain ?')
    expect(cleanTranscript('[Musique] Bonjour (rires)')).toBe('Bonjour')
    expect(cleanTranscript("Sous-titrage ST' 501")).toBe('')
    expect(cleanTranscript('Merci d’avoir regardé')).toBe('')
    expect(cleanTranscript('...')).toBe('')
    expect(cleanTranscript('Merci beaucoup pour ton aide')).toBe('Merci beaucoup pour ton aide')
  })

  it('vérifie chaque fichier téléchargé avec l’empreinte publiée', () => {
    expect(expectedHash({ path: 'onnx/a.onnx', size: 3, oid: 'x', lfs: { oid: 'abc', size: 3 } })).toEqual({ algo: 'sha256', hex: 'abc' })
    expect(expectedHash({ path: 'config.json', size: 3, oid: 'def' })).toEqual({ algo: 'git-sha1', hex: 'def' })
    // Empreinte « blob » de Git d'un fichier contenant « hello » et un retour à la ligne (git hash-object).
    expect(gitBlobHasher(6).update('hello\n').digest('hex')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
    expect(createHash('sha256').update('').digest('hex')).toMatch(/^e3b0/)
  })

  it('le faux serveur de test n’est accepté que sur l’ordinateur lui-même', () => {
    expect(hfBase(undefined)).toBe('https://huggingface.co')
    expect(hfBase('http://127.0.0.1:47998/')).toBe('http://127.0.0.1:47998')
    expect(hfBase('https://evil.example')).toBe('https://huggingface.co')
    expect(hfBase('http://192.168.1.5:80')).toBe('https://huggingface.co')
    expect(hfBase('pas une adresse')).toBe('https://huggingface.co')
  })

  it('compi-model:// ne sert que les fichiers des modèles', () => {
    const base = normalize('C:/Users/x/AppData/Roaming/Compi/models')
    expect(modelFileFor('compi-model://models/whisper-small/onnx/encoder_model_fp16.onnx', base)).toBe(
      join(base, 'whisper-small', 'onnx', 'encoder_model_fp16.onnx')
    )
    expect(modelFileFor('compi-model://models/whisper-small/config.json', base)).toBe(join(base, 'whisper-small', 'config.json'))
    expect(modelFileFor('compi-model://models/../settings.json', base)).toBeNull()
    expect(modelFileFor('compi-model://models/whisper-small/%2e%2e/%2e%2e/secrets.json', base)).toBeNull()
    expect(modelFileFor('compi-model://models/whisper-small/compi.exe', base)).toBeNull()
    expect(modelFileFor('compi-model://autre/whisper-small/config.json', base)).toBeNull()
    expect(modelFileFor('https://models/whisper-small/config.json', base)).toBeNull()
  })

  it('micro : seulement pour l’interface de Compi', () => {
    expect(isOwnPage('http://localhost:5173/index.html', 'http://localhost:5173')).toBe(true)
    expect(isOwnPage('http://localhost:9999/', 'http://localhost:5173')).toBe(false)
    expect(isOwnPage('file:///C:/Program%20Files/Compi/resources/app.asar/out/renderer/index.html', undefined)).toBe(true)
    expect(isOwnPage('https://exemple.fr/', undefined)).toBe(false)
    expect(isOwnPage('', undefined)).toBe(false)
  })
})
