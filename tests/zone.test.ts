import { describe, expect, it } from 'vitest'
import { isZoneTooSmall, parseZoneTitle, rectBetween, visionSize, ZONE_MIN, zoneToImage } from '../src/shared/zone'

describe('zone tracée', () => {
  it('rectangle entre deux coins, dans les quatre sens', () => {
    const r = { x: 10, y: 20, width: 100, height: 50 }
    expect(rectBetween({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual(r)
    expect(rectBetween({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual(r)
    expect(rectBetween({ x: 110, y: 20 }, { x: 10, y: 70 })).toEqual(r)
  })

  it('un clic sans glisser n’est pas une zone', () => {
    expect(isZoneTooSmall({ x: 0, y: 0, width: 3, height: 200 })).toBe(true)
    expect(isZoneTooSmall({ x: 0, y: 0, width: ZONE_MIN, height: ZONE_MIN })).toBe(false)
  })
})

describe('zone → pixels de la capture', () => {
  it('écran à 100 % : mêmes coordonnées', () => {
    expect(zoneToImage({ x: 100, y: 50, width: 200, height: 80 }, { width: 3440, height: 1440 }, { width: 3440, height: 1440 })).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 80
    })
  })

  it('écran à 150 % : la zone suit la mise à l’échelle de Windows', () => {
    expect(zoneToImage({ x: 100, y: 50, width: 200, height: 80 }, { width: 1280, height: 720 }, { width: 1920, height: 1080 })).toEqual({
      x: 150,
      y: 75,
      width: 300,
      height: 120
    })
  })

  it('arrondis vers l’extérieur : aucun pixel du bord perdu', () => {
    expect(zoneToImage({ x: 10.4, y: 10.4, width: 20.2, height: 20.2 }, { width: 100, height: 100 }, { width: 125, height: 125 })).toEqual({
      x: 13,
      y: 13,
      width: 26,
      height: 26
    })
  })

  it('une zone qui déborde est ramenée dans l’image', () => {
    expect(zoneToImage({ x: 1200, y: 700, width: 200, height: 100 }, { width: 1280, height: 720 }, { width: 1280, height: 720 })).toEqual({
      x: 1200,
      y: 700,
      width: 80,
      height: 20
    })
  })

  it('trop petite, ou tailles absurdes : rien', () => {
    expect(zoneToImage({ x: 0, y: 0, width: 4, height: 4 }, { width: 100, height: 100 }, { width: 100, height: 100 })).toBeNull()
    expect(zoneToImage({ x: 0, y: 0, width: 50, height: 50 }, { width: 0, height: 100 }, { width: 100, height: 100 })).toBeNull()
    expect(zoneToImage({ x: 200, y: 0, width: 50, height: 50 }, { width: 100, height: 100 }, { width: 100, height: 100 })).toBeNull()
  })
})

describe('image pour un cerveau', () => {
  it('réduite si le côté le plus long dépasse la limite, proportions gardées', () => {
    expect(visionSize({ width: 3136, height: 1000 })).toEqual({ width: 1568, height: 500 })
    expect(visionSize({ width: 600, height: 2000 }, 1000)).toEqual({ width: 300, height: 1000 })
  })

  it('jamais agrandie', () => {
    expect(visionSize({ width: 400, height: 120 })).toEqual({ width: 400, height: 120 })
  })
})

describe('réponse de la fenêtre de sélection', () => {
  it('zone avec la taille de la vue', () => {
    expect(parseZoneTitle('zone:{"x":1,"y":2,"width":30,"height":40,"vw":1280,"vh":720}')).toEqual({
      rect: { x: 1, y: 2, width: 30, height: 40 },
      view: { width: 1280, height: 720 }
    })
  })

  it('annulation, titre de départ, ou réponse abîmée', () => {
    expect(parseZoneTitle('zone:cancel')).toBe('cancel')
    expect(parseZoneTitle('Zone d’écran')).toBeNull()
    expect(parseZoneTitle('zone:{"x":1}')).toBeNull()
    expect(parseZoneTitle('zone:{pas du json')).toBeNull()
    expect(parseZoneTitle('zone:{"x":"1","y":2,"width":3,"height":4,"vw":5,"vh":6}')).toBeNull()
  })
})
