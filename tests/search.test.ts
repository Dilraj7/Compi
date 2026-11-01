import { describe, expect, it } from 'vitest'
import { matchScore, rank, searchTerms, shortcutIndex, shortcutKey, snippet } from '../src/shared/search'

describe('recherche universelle', () => {
  it('mots sans accents ; une lettre seule ne compte que si elle est seule', () => {
    expect(searchTerms('Réunion  de Équipe')).toEqual(['reunion', 'de', 'equipe'])
    expect(searchTerms('a')).toEqual(['a'])
    expect(searchTerms('a devis')).toEqual(['devis'])
  })

  it('note : début du titre, début d’un mot, ailleurs, ou rien', () => {
    expect(matchScore('Excel', 'exc')).toBe(3)
    expect(matchScore('Microsoft Excel', 'exc')).toBe(2)
    expect(matchScore('Point équipe', 'equipe point')).toBe(2)
    expect(matchScore('Point', 'devis', 'Le devis Nexa est parti')).toBe(1)
    expect(matchScore('Point', 'devis zzz', 'Le devis')).toBe(0)
    expect(matchScore('Point', '   ')).toBe(0)
  })

  it('classe les meilleurs d’abord, garde l’ordre à égalité', () => {
    const r = rank(['Microsoft Excel', 'Excel', 'Paint', 'Excalidraw'], (x) => matchScore(x, 'exc'), 3)
    expect(r).toEqual(['Excel', 'Excalidraw', 'Microsoft Excel'])
  })

  it('extrait autour du mot trouvé, accents compris', () => {
    const text = `${'Bla '.repeat(60)}on a parlé du devis été pour Nexa ${'fin '.repeat(40)}`
    const s = snippet(text, 'ete', 60)
    expect(s.startsWith('…')).toBe(true)
    expect(s).toContain('devis été')
    expect(s.length).toBeLessThanOrEqual(62)
    expect(snippet('court', 'x')).toBe('court')
  })

  it('raccourcis du menu Démarrer : nom → chemin, le premier gagne', () => {
    expect(shortcutKey('C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Microsoft Excel.lnk')).toBe('microsoft excel')
    const m = shortcutIndex(['C:/u/Programs/Notepad++.lnk', 'C:/all/Programs/Notepad++.lnk', 'C:/all/readme.txt'])
    expect(m.get('notepad')).toBe('C:/u/Programs/Notepad++.lnk')
    expect(m.size).toBe(1)
  })
})
