import { describe, expect, it } from 'vitest'
import { BLINK, EXPRESSIONS, isValidGrid, THINKING_FRAMES } from '../src/shared/expressions'
import { countEdit } from '../src/main/bridge/sessions'

describe('expressions de la mascotte', () => {
  it('toutes les grilles LED sont des matrices 5×5 valides', () => {
    for (const [mood, e] of Object.entries(EXPRESSIONS)) {
      expect(isValidGrid(e.left), `${mood} gauche`).toBe(true)
      expect(isValidGrid(e.right), `${mood} droite`).toBe(true)
    }
    expect(isValidGrid(BLINK.left)).toBe(true)
  })

  it('l’animation « réfléchit » a des images valides et différentes', () => {
    expect(THINKING_FRAMES.length).toBeGreaterThan(4)
    for (const f of THINKING_FRAMES) expect(isValidGrid(f.left) && isValidGrid(f.right)).toBe(true)
    expect(THINKING_FRAMES[0].left).not.toEqual(THINKING_FRAMES[1].left)
  })
})

describe('countEdit', () => {
  it('utilise structuredPatch quand Claude Code le fournit', () => {
    const response = { structuredPatch: [{ lines: [' ctx', '-ancienne', '+nouvelle', '+ajout'] }] }
    expect(countEdit('Edit', {}, response)).toEqual({ added: 2, removed: 1 })
  })

  it('estime un Write de création', () => {
    expect(countEdit('Write', { content: 'a\nb\nc' })).toEqual({ added: 3, removed: 0 })
  })

  it('additionne les MultiEdit', () => {
    const input = { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'x\ny', new_string: 'x\ny\nz' }] }
    expect(countEdit('MultiEdit', input)).toEqual({ added: 2, removed: 1 })
  })

  it('ignore les outils qui ne modifient pas de fichier', () => {
    expect(countEdit('Bash', { command: 'ls' })).toBeNull()
  })
})
