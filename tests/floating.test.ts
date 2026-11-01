import { describe, expect, it } from 'vitest'
import { cleanFloating, defaultFloatBounds, placeFloat } from '../src/shared/floating'

const main = { x: 0, y: 0, width: 1920, height: 1040 }
const right = { x: 1920, y: 0, width: 2560, height: 1400 }

describe('transcription flottante', () => {
  it('réglages vérifiés : opacité bornée, taille minimale, place absente si abîmée', () => {
    expect(cleanFloating({ auto: false, compact: true, opacity: 0.1, bounds: { x: 10, y: 20, width: 50, height: 4000 } })).toEqual({
      auto: false,
      compact: true,
      opacity: 0.5,
      bounds: { x: 10, y: 20, width: 280, height: 2000 }
    })
    expect(cleanFloating({ opacity: 'x', bounds: { x: 'a' } })).toEqual({ auto: true, compact: false, opacity: 0.94 })
    expect(cleanFloating(undefined).auto).toBe(true)
  })

  it('par défaut en bas à droite de l’écran principal', () => {
    expect(defaultFloatBounds(main)).toEqual({ x: 1516, y: 716, width: 380, height: 300 })
    expect(defaultFloatBounds(main, true).height).toBe(140)
  })

  it('garde sa place sur le second écran, et revient si cet écran est débranché', () => {
    const saved = { x: 2000, y: 100, width: 400, height: 300 }
    expect(placeFloat(saved, [main, right])).toEqual(saved)
    expect(placeFloat(saved, [main])).toEqual(defaultFloatBounds(main))
  })

  it('ramenée dans l’écran quand elle déborde', () => {
    expect(placeFloat({ x: 1800, y: -50, width: 400, height: 300 }, [main])).toEqual({ x: 1520, y: 0, width: 400, height: 300 })
  })
})
