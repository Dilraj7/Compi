import { describe, expect, it } from 'vitest'
import { shouldPlay, soundFor, type SoundContext } from '../src/shared/sounds'
import type { SoundSettings } from '../src/shared/types'

const settings: SoundSettings = {
  enabled: true,
  volume: 'low',
  approvals: true,
  reminders: true,
  messages: true,
  routines: false,
  quietStart: '22:00',
  quietEnd: '08:00'
}
const at = (h: number, m = 0): number => new Date(2026, 9, 14, h, m).getTime()
const ctx = (patch: Partial<SoundContext> = {}): SoundContext => ({ settings, now: at(15), focus: false, meeting: false, fullscreen: false, ...patch })

describe('quel son', () => {
  it('par notification de l’îlot', () => {
    expect(soundFor('reminder')).toBe('reminder')
    expect(soundFor('timer')).toBe('reminder')
    expect(soundFor('meeting')).toBe('reminder')
    expect(soundFor('today')).toBe('reminder')
    expect(soundFor('message')).toBe('message')
    expect(soundFor('routine')).toBe('done')
    expect(soundFor('claude-done')).toBe('done')
    expect(soundFor('approval')).toBe('attention')
    expect(soundFor('memory')).toBeNull()
    expect(soundFor('chat')).toBeNull()
  })
})

describe('quand se taire', () => {
  it('suit l’interrupteur général et celui de chaque son', () => {
    expect(shouldPlay('reminder', ctx())).toBe(true)
    expect(shouldPlay('done', ctx())).toBe(false)
    expect(shouldPlay('reminder', ctx({ settings: { ...settings, enabled: false } }))).toBe(false)
    expect(shouldPlay('message', ctx({ settings: { ...settings, messages: false } }))).toBe(false)
  })

  it('heures calmes, même en passant minuit', () => {
    expect(shouldPlay('attention', ctx({ now: at(23, 30) }))).toBe(false)
    expect(shouldPlay('attention', ctx({ now: at(7, 59) }))).toBe(false)
    expect(shouldPlay('attention', ctx({ now: at(8) }))).toBe(true)
    expect(shouldPlay('attention', ctx({ now: at(23), settings: { ...settings, quietStart: '08:00', quietEnd: '08:00' } }))).toBe(true)
  })

  it('pomodoro, réunion (sauf son alerte), plein écran', () => {
    expect(shouldPlay('message', ctx({ focus: true }))).toBe(false)
    // La fin du pomodoro sonne quand même.
    expect(shouldPlay('reminder', ctx({ focus: true, pill: 'timer' }))).toBe(true)
    expect(shouldPlay('reminder', ctx({ meeting: true, pill: 'reminder' }))).toBe(false)
    expect(shouldPlay('reminder', ctx({ meeting: true, pill: 'meeting' }))).toBe(true)
    expect(shouldPlay('attention', ctx({ fullscreen: true }))).toBe(false)
  })

  it('« ok » répond à une touche : il ne suit que les interrupteurs', () => {
    expect(shouldPlay('ok', ctx({ now: at(23), fullscreen: true, meeting: true, focus: true }))).toBe(true)
    expect(shouldPlay('ok', ctx({ settings: { ...settings, approvals: false } }))).toBe(false)
  })
})
