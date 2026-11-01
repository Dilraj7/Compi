import { describe, expect, it } from 'vitest'
import { cleanFull, columnBlocks, DEFAULT_FULL_BLOCKS, moveBlock, normalizeBlocks, shiftBlock, toggleBlock } from '../src/shared/fullBlocks'

const ids = (col: 'left' | 'right', blocks = DEFAULT_FULL_BLOCKS): string[] => columnBlocks(blocks, col).map((b) => b.id)

describe('blocs du plein écran', () => {
  it('une liste vide ou abîmée redonne la disposition par défaut', () => {
    expect(normalizeBlocks(undefined)).toEqual(DEFAULT_FULL_BLOCKS)
    expect(normalizeBlocks('oups')).toEqual(DEFAULT_FULL_BLOCKS)
  })

  it('les doublons et identifiants inconnus sont ignorés, les manquants reviennent dans leur colonne', () => {
    const out = normalizeBlocks([{ id: 'tasks', col: 'left' }, { id: 'tasks', col: 'right' }, { id: 'meteo', col: 'left' }, { id: 'agenda', col: 'x' }])
    expect(out.slice(0, 2)).toEqual([
      { id: 'tasks', col: 'left' },
      { id: 'agenda', col: 'left' }
    ])
    expect(out).toHaveLength(DEFAULT_FULL_BLOCKS.length)
    expect(ids('right', out)).toEqual(['call', 'recents', 'messages', 'routines'])
    expect(ids('left', out)).toEqual(['tasks', 'agenda', 'missed', 'reminders', 'timer', 'mail'])
  })

  it('déplace un bloc vers une autre colonne, à la place voulue', () => {
    const out = moveBlock(DEFAULT_FULL_BLOCKS, 'mail', 'right', 1)
    expect(ids('right', out)).toEqual(['call', 'mail', 'tasks', 'recents', 'messages', 'routines'])
    expect(ids('left', out)).toEqual(['missed', 'agenda', 'reminders', 'timer'])
    expect(moveBlock(DEFAULT_FULL_BLOCKS, 'missed', 'left', 99).at(-1)).toBeDefined()
    expect(ids('left', moveBlock(DEFAULT_FULL_BLOCKS, 'missed', 'left', 99))).toEqual(['agenda', 'reminders', 'timer', 'mail', 'missed'])
  })

  it('vers une colonne vide', () => {
    let out = DEFAULT_FULL_BLOCKS
    for (const id of ids('right')) out = moveBlock(out, id as never, 'left', 0)
    expect(ids('right', out)).toEqual([])
    expect(ids('right', moveBlock(out, 'agenda', 'right', 0))).toEqual(['agenda'])
  })

  it('au clavier : haut, bas, gauche, droite', () => {
    expect(ids('left', shiftBlock(DEFAULT_FULL_BLOCKS, 'agenda', 'up'))).toEqual(['agenda', 'missed', 'reminders', 'timer', 'mail'])
    expect(shiftBlock(DEFAULT_FULL_BLOCKS, 'missed', 'up')).toBe(DEFAULT_FULL_BLOCKS)
    expect(ids('left', shiftBlock(DEFAULT_FULL_BLOCKS, 'missed', 'down'))).toEqual(['agenda', 'missed', 'reminders', 'timer', 'mail'])
    expect(ids('right', shiftBlock(DEFAULT_FULL_BLOCKS, 'agenda', 'right'))).toEqual(['call', 'agenda', 'tasks', 'recents', 'messages', 'routines'])
    expect(shiftBlock(DEFAULT_FULL_BLOCKS, 'agenda', 'left')).toBe(DEFAULT_FULL_BLOCKS)
  })

  it('masquer puis afficher', () => {
    const hidden = toggleBlock(DEFAULT_FULL_BLOCKS, 'mail')
    expect(hidden.find((b) => b.id === 'mail')?.hidden).toBe(true)
    expect(toggleBlock(hidden, 'mail')).toEqual(DEFAULT_FULL_BLOCKS)
  })

  it('réglages abîmés : vue du jour', () => {
    expect(cleanFull({ agenda: 'mois' as never, blocks: [] }).agenda).toBe('day')
    expect(cleanFull({ agenda: 'week', blocks: [] }).agenda).toBe('week')
  })
})
