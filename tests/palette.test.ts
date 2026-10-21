import { describe, expect, it } from 'vitest'
import { searchPalette, type PaletteEntry } from '../src/shared/palette'

const items: PaletteEntry[] = [
  { id: 'new', label: 'Nouvelle discussion', group: 'Actions' },
  { id: 'sounds', label: 'Couper les sons', group: 'Actions', keywords: 'muet silence' },
  { id: 'today', label: 'Aujourd’hui', group: 'Vues', keywords: 'agenda' },
  { id: 'activity', label: 'Activité', group: 'Vues' },
  { id: 'brain', label: 'Cerveau', group: 'Réglages', keywords: 'modele local ollama' },
  { id: 'privacy', label: 'Confidentialité', group: 'Réglages' },
  ...Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Discussion ${i}`, group: 'Discussions' as const })),
  { id: 'trip', label: 'Préparer le séjour à Annecy', group: 'Discussions' }
]

const ids = (q: string): string[] => searchPalette(items, q).map((i) => i.id)

describe('recherche de la palette', () => {
  it('sans accents ni majuscules', () => {
    expect(ids('activite')).toEqual(['activity'])
    expect(ids('SEJOUR')).toEqual(['trip'])
    expect(ids('confidentialite')).toEqual(['privacy'])
  })

  it('par mots-clés', () => {
    expect(ids('muet')).toEqual(['sounds'])
    expect(ids('ollama')).toEqual(['brain'])
  })

  it('tous les mots doivent être présents', () => {
    expect(ids('sejour annecy')).toEqual(['trip'])
    expect(ids('sejour paris')).toEqual([])
  })

  it('début du titre, puis début d’un mot, puis le reste', () => {
    // « Discussion 0… » commence par « disc » ; « Nouvelle discussion » a un mot qui commence par « disc ».
    const out = ids('disc')
    expect(out.indexOf('c0')).toBeLessThan(out.indexOf('new'))
    expect(ids('discussion').slice(0, 1)).toEqual(['c0'])
  })

  it('sans recherche : tout sauf les vieilles discussions', () => {
    const out = searchPalette(items, '', 50)
    expect(out.filter((i) => i.group === 'Discussions')).toHaveLength(5)
    expect(out[0].id).toBe('new')
  })
})
