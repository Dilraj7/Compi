import { describe, expect, it } from 'vitest'
import { heroSuggestions } from '../src/shared/hero'

// Samedi 31 octobre 2026, vendredi 30, lundi 2 novembre (heure locale).
const at = (d: number, h: number, m = 0): Date => new Date(2026, 9, d, h, m)

describe('accueil qui propose', () => {
  it('rien de spécial : aucune proposition (les suggestions habituelles restent)', () => {
    expect(heroSuggestions({ now: at(31, 15), missed: 0, unread: 0 })).toEqual([])
  })

  it('réunion dans moins de 30 min : la préparer d’abord', () => {
    const now = at(31, 15)
    const s = heroSuggestions({ now, missed: 2, unread: 3, nextMeeting: { title: 'Point équipe avec toute la direction commerciale', start: now.getTime() + 20 * 60_000, prepKey: 'e2|x' } })
    expect(s.map((x) => x.id)).toEqual(['prep', 'missed', 'mail'])
    expect(s[0]).toMatchObject({ action: 'prep', prepKey: 'e2|x' })
    expect(s[0].label.length).toBeLessThan(45)
  })

  it('réunion trop loin ou déjà commencée : pas de préparation', () => {
    const now = at(31, 15)
    expect(heroSuggestions({ now, missed: 0, unread: 0, nextMeeting: { title: 'A', start: now.getTime() + 45 * 60_000, prepKey: 'a' } })).toEqual([])
    expect(heroSuggestions({ now, missed: 0, unread: 0, nextMeeting: { title: 'A', start: now.getTime() - 60_000, prepKey: 'a' } })).toEqual([])
  })

  it('matin, vendredi après-midi, lundi matin', () => {
    expect(heroSuggestions({ now: at(31, 8), missed: 0, unread: 0 }).map((x) => x.id)).toEqual(['morning'])
    expect(heroSuggestions({ now: at(30, 16), missed: 0, unread: 0 })[0]).toMatchObject({ id: 'week', label: 'Ma semaine prochaine', action: 'week' })
    expect(heroSuggestions({ now: at(33, 9), missed: 0, unread: 1 }).map((x) => x.id)).toEqual(['week', 'morning', 'mail'])
  })
})
