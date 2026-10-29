import { describe, expect, it } from 'vitest'
import { cleanZoom, nearestZoom, stepZoom, zoomFactor } from '../src/shared/zoom'

const NOTCH = { width: 760, height: 540 }

describe('taille de l’affichage', () => {
  it('valeurs du fichier : la taille proposée la plus proche, encoche bornée à 150 %', () => {
    expect(cleanZoom(undefined)).toEqual({ notch: 100, full: 100 })
    expect(cleanZoom({ notch: 123, full: 160 })).toEqual({ notch: 125, full: 150 })
    expect(cleanZoom({ notch: 200, full: 999 })).toEqual({ notch: 150, full: 200 })
    expect(cleanZoom({ notch: 10, full: Number.NaN })).toEqual({ notch: 80, full: 100 })
    expect(nearestZoom('125')).toBe(100)
  })

  it('pas à pas, sans dépasser les bornes', () => {
    expect(stepZoom(100, 1, 'full')).toBe(110)
    expect(stepZoom(110, 1, 'full')).toBe(125)
    expect(stepZoom(200, 1, 'full')).toBe(200)
    expect(stepZoom(80, -1, 'notch')).toBe(80)
    expect(stepZoom(150, 1, 'notch')).toBe(150)
    expect(stepZoom(175, 0, 'full')).toBe(100)
    // Valeur hors liste : on repart de la plus proche.
    expect(stepZoom(130, 1, 'full')).toBe(150)
  })

  it('l’écran borne l’agrandissement, jamais la réduction', () => {
    // Écran 34" en 3440 × 1440 : tout passe.
    expect(zoomFactor('full', 200, { width: 3440, height: 1440 }, NOTCH)).toBe(2)
    expect(zoomFactor('notch', 150, { width: 3440, height: 1440 }, NOTCH)).toBe(1.5)
    // Portable en 1366 × 768 : l'encoche s'arrête où sa fenêtre tient, le plein écran garde 960 × 640.
    expect(zoomFactor('notch', 150, { width: 1366, height: 768 }, NOTCH)).toBeCloseTo(768 / 540)
    expect(zoomFactor('full', 175, { width: 1366, height: 768 }, NOTCH)).toBeCloseTo(1.2)
    expect(zoomFactor('full', 80, { width: 1366, height: 768 }, NOTCH)).toBe(0.8)
    // Écran plus petit que la place minimale : 100 % reste possible.
    expect(zoomFactor('full', 110, { width: 900, height: 600 }, NOTCH)).toBe(1)
  })
})
