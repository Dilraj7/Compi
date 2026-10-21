import { describe, expect, it } from 'vitest'
import {
  acceptPolished,
  addDictation,
  applyDictionary,
  cleanNatural,
  compiRequest,
  DICTATION_MAX_MS,
  DOUBLE_TAP_MS,
  HOLD_MS,
  KEY_IDLE,
  keyStep,
  minutesSaved,
  styleFor,
  summarizeDictation,
  wordCount,
  type KeyAction,
  type KeyEvent,
  type KeyState
} from '../src/shared/dictation'
import { dayKey } from '../src/shared/usage'

/** Joue une suite d'événements datés ; les « tick » arrivent toutes les 50 ms entre deux événements. */
function play(events: Array<[number, KeyEvent]>, start: KeyState = KEY_IDLE): { state: KeyState; actions: KeyAction[] } {
  let state = start
  const actions: KeyAction[] = []
  let t = events[0]?.[0] ?? 0
  for (const [at, ev] of events) {
    for (; t + 50 <= at; t += 50) {
      const r = keyStep(state, { type: 'tick' }, t + 50)
      state = r.state
      if (r.action) actions.push(r.action)
    }
    t = at
    const r = keyStep(state, ev, at)
    state = r.state
    if (r.action) actions.push(r.action)
  }
  return { state, actions }
}

const down = (key: 'target' | 'esc' | 'other' = 'target'): KeyEvent => ({ type: 'down', key })
const up = (key: 'target' | 'esc' | 'other' = 'target'): KeyEvent => ({ type: 'up', key })

describe('touche de la dictée', () => {
  it('maintenir écoute, relâcher arrête', () => {
    const r = play([
      [0, down()],
      [1000, up()]
    ])
    expect(r.actions).toEqual(['start', 'stop'])
    expect(r.state).toEqual(KEY_IDLE)
  })

  it('la répétition de la touche enfoncée ne relance rien', () => {
    const r = play([
      [0, down()],
      [500, down()],
      [530, down()],
      [900, up()]
    ])
    expect(r.actions).toEqual(['start', 'stop'])
  })

  it('une tape isolée n’ouvre jamais le micro', () => {
    const r = play([
      [0, down()],
      [HOLD_MS - 80, up()],
      [2000, { type: 'tick' }]
    ])
    expect(r.actions).toEqual([])
    expect(r.state).toEqual(KEY_IDLE)
  })

  it('Ctrl droit + C reste un raccourci : rien ne démarre', () => {
    const r = play([
      [0, down()],
      [60, down('other')],
      [120, up('other')],
      [900, up()]
    ])
    expect(r.actions).toEqual([])
    expect(r.state).toEqual(KEY_IDLE)
  })

  it('une autre touche pendant le maintien annule la dictée', () => {
    const r = play([
      [0, down()],
      [600, down('other')],
      [700, up()]
    ])
    expect(r.actions).toEqual(['start', 'cancel'])
    expect(r.state).toEqual(KEY_IDLE)
  })

  it('Échap pendant le maintien annule', () => {
    const r = play([
      [0, down()],
      [600, down('esc')],
      [800, up()]
    ])
    expect(r.actions).toEqual(['start', 'cancel'])
  })

  it('double appui : mains libres, jusqu’à la tape suivante', () => {
    const r = play([
      [0, down()],
      [80, up()],
      [80 + DOUBLE_TAP_MS - 100, down()],
      [400, up()],
      [5000, down()],
      [5080, up()]
    ])
    expect(r.actions).toEqual(['handsfree', 'stop'])
    expect(r.state).toEqual(KEY_IDLE)
  })

  it('mains libres : Échap annule, les autres touches sont ignorées', () => {
    const r = play([
      [0, down()],
      [80, up()],
      [200, down()],
      [260, up()],
      [1000, down('other')],
      [1100, up('other')],
      [3000, down('esc')]
    ])
    expect(r.actions).toEqual(['handsfree', 'cancel'])
    expect(r.state).toEqual(KEY_IDLE)
  })

  it('deux tapes trop espacées : pas de mains libres', () => {
    const r = play([
      [0, down()],
      [80, up()],
      [80 + DOUBLE_TAP_MS + 200, down()],
      [80 + DOUBLE_TAP_MS + 260, up()]
    ])
    expect(r.actions).toEqual([])
  })

  it('durée maximale : la dictée s’arrête seule', () => {
    const r = play([
      [0, down()],
      [DICTATION_MAX_MS + 1000, { type: 'tick' }]
    ])
    expect(r.actions).toEqual(['start', 'stop'])
  })

  it('relâchement jamais reçu après un raccourci : on repart de zéro', () => {
    const r = play([
      [0, down()],
      [50, down('other')],
      [20_000, { type: 'tick' }]
    ])
    expect(r.state).toEqual(KEY_IDLE)
  })
})

describe('texte dicté', () => {
  it('Naturel retire les hésitations et corrige les espaces', () => {
    expect(cleanNatural('euh, alors, je pense qu’on devrait, euh, décaler le rendez-vous à 15h30.')).toBe(
      'Alors, je pense qu’on devrait, décaler le rendez-vous à 15h30.'
    )
    expect(cleanNatural('Hum  ok   ,  merci .')).toBe('Ok, merci.')
  })

  it('Naturel garde les vrais mots et l’heure', () => {
    expect(cleanNatural('Ben arrive à 9:30 demain')).toBe('Ben arrive à 9:30 demain')
    expect(cleanNatural('rendez-vous sur https://example.com demain')).toBe('Rendez-vous sur https://example.com demain')
  })

  it('espace avant ? ! : ; en français seulement', () => {
    expect(cleanNatural('Peux-tu venir avant midi?')).toBe('Peux-tu venir avant midi ?')
    expect(cleanNatural('C’est vrai?!')).toBe('C’est vrai ?!')
    expect(cleanNatural('Can you come before noon?')).toBe('Can you come before noon?')
  })

  it('dictionnaire : mot entier, sans les majuscules, sur plusieurs lignes', () => {
    const dict = [
      { from: 'ma signature', to: 'Alex Martin\nalex@example.com' },
      { from: 'compi', to: 'Compi' },
      { from: '', to: 'rien' }
    ]
    expect(applyDictionary('Merci, Ma  signature', dict)).toBe('Merci, Alex Martin\nalex@example.com')
    expect(applyDictionary('compilation de compi', dict)).toBe('compilation de Compi')
    expect(applyDictionary('prix : 5 $', [{ from: '$', to: 'dollars' }])).toBe('prix : 5 dollars')
  })

  it('style par application, sinon le style général', () => {
    const rules = [{ app: 'OUTLOOK.EXE', style: 'polished' as const }]
    expect(styleFor('outlook', rules, 'natural')).toBe('polished')
    expect(styleFor('Code', rules, 'natural')).toBe('natural')
    expect(styleFor(undefined, rules, 'raw')).toBe('raw')
  })

  it('« Compi, … » devient une demande à l’assistant', () => {
    expect(compiRequest('Compi, rappelle-moi d’appeler le dentiste demain à 9h.')).toBe('Rappelle-moi d’appeler le dentiste demain à 9h.')
    expect(compiRequest('Hé Compi mets un minuteur de 10 minutes')).toBe('Mets un minuteur de 10 minutes')
    expect(compiRequest('Compiègne est une jolie ville')).toBeNull()
    expect(compiRequest('La compilation a échoué')).toBeNull()
    expect(compiRequest('Compi.')).toBeNull()
  })

  it('garde-fou du style Soigné', () => {
    const raw = 'alors euh je voulais te dire que la réunion est décalée à jeudi'
    expect(acceptPolished(raw, 'Je voulais te dire que la réunion est décalée à jeudi.')).toBe('Je voulais te dire que la réunion est décalée à jeudi.')
    expect(acceptPolished(raw, '« Je voulais te dire que la réunion est décalée à jeudi. »')).toBe('Je voulais te dire que la réunion est décalée à jeudi.')
    // Une réponse au lieu d'une correction : trop longue ou trop courte.
    expect(
      acceptPolished(raw, `${raw} Bien sûr ! Voici quelques idées pour organiser la réunion de jeudi avec toute l’équipe et préparer l’ordre du jour.`)
    ).toBeNull()
    expect(acceptPolished(raw, 'OK.')).toBeNull()
    expect(acceptPolished(raw, '   ')).toBeNull()
  })

  it('compte les mots', () => {
    expect(wordCount('Bonjour, peux-tu venir ? 15h30 !')).toBe(4)
    expect(wordCount('  ')).toBe(0)
  })
})

describe('temps gagné', () => {
  it('mots ÷ vitesse de frappe − temps de parole, jamais négatif', () => {
    expect(minutesSaved(400, 120_000, 40)).toBe(8)
    expect(minutesSaved(10, 120_000, 40)).toBe(0)
    expect(minutesSaved(10, 0, 0)).toBe(0)
  })

  it('agrège par jour et par application, et résume 30 jours', () => {
    const now = new Date(2026, 9, 21, 15).getTime()
    const day = 86_400_000
    let rows = addDictation([], { at: now, app: 'outlook', words: 120, speakingMs: 60_000 })
    rows = addDictation(rows, { at: now, app: 'outlook', words: 80, speakingMs: 30_000 })
    rows = addDictation(rows, { at: now - day, app: 'code', words: 40, speakingMs: 20_000 })
    rows = addDictation(rows, { at: now - 2 * day, app: 'code', words: 40, speakingMs: 20_000 })
    rows = addDictation(rows, { at: now - 40 * day, app: 'code', words: 999, speakingMs: 1 })
    expect(rows.find((r) => r.day === dayKey(now) && r.app === 'outlook')).toMatchObject({ dictations: 2, words: 200, speakingMs: 90_000 })
    const s = summarizeDictation(rows, 40, now)
    expect(s.dictations).toBe(4)
    expect(s.words).toBe(280)
    expect(s.streak).toBe(3)
    expect(s.days).toHaveLength(30)
    expect(s.days[29]).toMatchObject({ day: dayKey(now), words: 200 })
    // 200/40 − 1,5 = 3,5 ; puis 2 × (40/40 − 1/3)
    expect(s.minutesSaved).toBeCloseTo(3.5 + 2 * (1 - 1 / 3), 5)
    expect(s.wpm).toBe(Math.round(280 / (130_000 / 60_000)))
    expect(s.apps.map((a) => a.app)).toEqual(['outlook', 'code'])
  })

  it('la série tient jusqu’à la fin de la journée', () => {
    const now = new Date(2026, 9, 21, 9).getTime()
    const rows = addDictation([], { at: now - 86_400_000, app: 'x', words: 5, speakingMs: 1000 })
    expect(summarizeDictation(rows, 40, now).streak).toBe(1)
    expect(summarizeDictation([], 40, now).streak).toBe(0)
  })
})
