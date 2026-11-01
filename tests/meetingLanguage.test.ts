import { describe, expect, it } from 'vitest'
import { expectedLanguage, lineLanguage, sparseLines, wrongLanguageLines } from '../src/shared/meetingLanguage'
import type { MeetingLine } from '../src/shared/types'

const line = (text: string, start = 0): MeetingLine => ({ start, end: start + 5, who: 's1', text })

describe('langue des phrases', () => {
  it('reconnaît le français et l’anglais par leurs petits mots', () => {
    expect(lineLanguage('Aujourd’hui on va vous montrer comment les équipes utilisent leurs données.')).toBe('fr')
    expect(lineLanguage('So what we want to do is to show you how the team can use this.')).toBe('en')
    // Anglais phonétique écrit à la place d'une phrase française (cas réel du 01/11, reformulé).
    expect(lineLanguage('And the donation is in your pipeline, so you can see all of it.')).toBe('en')
  })

  it('les termes anglais d’une phrase française ne la font pas passer pour de l’anglais', () => {
    expect(lineLanguage('Le pipeline est dans Salesforce, avec les deals de la semaine.')).toBe('fr')
  })

  it('une phrase trop courte ou mêlée n’a pas de langue', () => {
    expect(lineLanguage('Merci.')).toBeNull()
    expect(lineLanguage('Okay.')).toBeNull()
    expect(lineLanguage('Les deals de the team and co')).toBeNull()
  })
})

describe('langue attendue', () => {
  const french = Array.from({ length: 7 }, (_, i) => line('Nous allons voir les chiffres de la semaine avec vous.', i * 5))
  const english = [line('And this is what we can do with it.', 50), line('So you have all the data at the same place.', 60)]

  it('automatique : la langue de la plupart des phrases', () => {
    expect(expectedLanguage([...french, ...english], 'auto')).toBe('fr')
    expect(wrongLanguageLines([...french, ...english], 'fr')).toEqual([7, 8])
  })

  it('automatique : une réunion vraiment bilingue, ou trop courte, n’est pas reprise', () => {
    const half = [...french.slice(0, 4), ...english, ...english]
    expect(expectedLanguage(half, 'auto')).toBeNull()
    expect(expectedLanguage(french.slice(0, 3), 'auto')).toBeNull()
    expect(wrongLanguageLines(half, null)).toEqual([])
  })

  it('langue choisie : imposée, même en minorité', () => {
    expect(expectedLanguage([...english, ...english, ...english, line('Bonjour à tous et merci.')], 'en')).toBe('en')
    expect(wrongLanguageLines([...english, line('Bonjour à tous, nous sommes là.')], 'en')).toEqual([2])
  })
})

describe('phrases presque vides', () => {
  it('12 s de parole rendues en deux mots sont à relire, pas une réponse courte', () => {
    const lines: MeetingLine[] = [
      { start: 100.8, end: 113.3, who: 's4', text: 'Bonne question.' },
      { start: 78.4, end: 79, who: 's5', text: 'Oui, exactement.' },
      { start: 0, end: 7, who: 's1', text: 'Bonjour à tous et bienvenue dans ce webinaire, nous allons commencer.' }
    ]
    expect(sparseLines(lines)).toEqual([0])
  })
})
