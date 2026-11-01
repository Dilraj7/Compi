import { describe, expect, it } from 'vitest'
import { fullLayout } from '../src/shared/fullLayout'

describe('disposition du plein écran', () => {
  it('écran large (à partir de 2400 px) : colonnes plus larges', () => {
    expect(fullLayout(3440)).toEqual({ left: 420, right: 460, center: 980 })
    expect(fullLayout(2399).left).toBe(340)
  })

  it('trois colonnes à partir de 1600 px', () => {
    expect(fullLayout(1920)).toEqual({ left: 340, right: 400, center: 860 })
    expect(fullLayout(1600).left).toBe(340)
  })

  it('colonnes plus étroites de 1280 à 1600 px', () => {
    expect(fullLayout(1599)).toEqual({ left: 300, right: 340, center: 760 })
    expect(fullLayout(1280).left).toBe(300)
  })

  it('sous 1280 px, la journée reste dans l’onglet Aujourd’hui', () => {
    expect(fullLayout(1279).left).toBeNull()
    expect(fullLayout(1024).right).toBe(307)
    // Jamais une colonne « À toi » trop étroite pour une carte, ni trop large.
    expect(fullLayout(800).right).toBe(300)
    expect(fullLayout(1270).right).toBe(360)
  })

  it('le centre garde toujours de la place pour la discussion', () => {
    for (const w of [1024, 1280, 1366, 1440, 1600, 1920, 2400, 2560, 3440]) {
      const l = fullLayout(w)
      expect(w - (l.left ?? 0) - l.right).toBeGreaterThanOrEqual(600)
    }
  })
})
