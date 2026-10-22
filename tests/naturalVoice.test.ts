import { describe, expect, it } from 'vitest'
import { NATURAL_VOICES, naturalLang, naturalVoiceSid } from '../src/shared/naturalVoice'
import { SPEECH_PACKS, SUPERTONIC_FILES, SUPERTONIC_PACK } from '../src/shared/speechModels'
import { wavFromSamples } from '../src/main/speech/wav'

describe('voix naturelle', () => {
  it('lit le français et l’anglais, et laisse le tamoul à la voix de Windows', () => {
    expect(naturalLang('Ton rendez-vous avec Camille est à 14 h 30, demain.')).toBe('fr')
    expect(naturalLang('Il fait beau : sortons.')).toBe('fr')
    expect(naturalLang('Tu as une réunion.')).toBe('fr')
    expect(naturalLang('Your meeting with Camille is tomorrow at 2:30 pm.')).toBe('en')
    expect(naturalLang('I don’t think it’s ready yet, but we can try.')).toBe('en')
    expect(naturalLang("L'heure du rendez-vous n'a pas changé.")).toBe('fr')
    expect(naturalLang('உங்கள் கூட்டம் நாளை உள்ளது.')).toBeNull()
    expect(naturalLang('Réunion : உங்கள் கூட்டம் நாளை உள்ளது.')).toBeNull()
  })

  it('choisit le français en cas de doute', () => {
    expect(naturalLang('14 h 30')).toBe('fr')
    expect(naturalLang('OK')).toBe('fr')
    expect(naturalLang('Compi')).toBe('fr')
  })

  it('donne à chaque voix son numéro, et la première à une voix inconnue', () => {
    expect(NATURAL_VOICES).toHaveLength(10)
    expect(naturalVoiceSid('F1')).toBe(0)
    expect(naturalVoiceSid('M1')).toBe(5)
    expect(naturalVoiceSid('M5')).toBe(9)
    expect(naturalVoiceSid('Z9')).toBe(0)
    expect(new Set(NATURAL_VOICES.map((v) => v.label)).size).toBe(10)
  })

  it('télécharge tous les fichiers du moteur, à une révision figée', () => {
    expect(SPEECH_PACKS.supertonic).toBe(SUPERTONIC_PACK)
    expect(SUPERTONIC_PACK.sources).toHaveLength(1)
    expect(SUPERTONIC_PACK.sources[0].revision).toMatch(/^[0-9a-f]{40}$/)
    expect(SUPERTONIC_PACK.sources[0].files.sort()).toEqual(Object.values(SUPERTONIC_FILES).sort())
  })
})

describe('son de la voix naturelle', () => {
  it('écrit un WAV 16 bits mono à la bonne fréquence, monté à un volume normal', () => {
    const samples = new Float32Array([0, 0.25, -0.25, 0.1])
    const wav = wavFromSamples(samples, 44_100)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(44_100)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.readUInt32LE(40)).toBe(8)
    expect(wav.length).toBe(44 + 8)
    // Crête 0,25 → montée vers 0,89 (gain plafonné à 4 : 0,25 × 3,56).
    expect(wav.readInt16LE(46) / 32767).toBeCloseTo(0.89, 2)
    expect(wav.readInt16LE(48) / 32767).toBeCloseTo(-0.89, 2)
  })

  it('ne pousse pas un morceau presque muet, et ne sature jamais', () => {
    const quiet = wavFromSamples(new Float32Array([0.01, -0.01]), 16_000)
    expect(quiet.readInt16LE(44) / 32767).toBeCloseTo(0.04, 2)
    const loud = wavFromSamples(new Float32Array([1.5, -2]), 16_000)
    expect(loud.readInt16LE(44)).toBeLessThanOrEqual(32767)
    expect(loud.readInt16LE(46)).toBeGreaterThanOrEqual(-32767)
    expect(wavFromSamples(new Float32Array([0, 0]), 16_000).readInt16LE(44)).toBe(0)
  })
})
