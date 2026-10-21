// Expressions de la mascotte Compi : des matrices de LED 5×5 par œil.
// `#` = LED allumée, `.` = éteinte. Une expression peut être animée
// (plusieurs images) : c'est le cas de « réfléchit ».

import type { Mood } from './types'

export const GRID = 5

export type EyeGrid = readonly string[]

export interface Expression {
  left: EyeGrid
  right: EyeGrid
}

const open: EyeGrid = ['.....', '.###.', '#####', '.###.', '.....']
const closed: EyeGrid = ['.....', '.....', '#####', '.....', '.....']
const happy: EyeGrid = ['.....', '..#..', '.#.#.', '#...#', '.....']
const surprised: EyeGrid = ['.###.', '#...#', '#...#', '#...#', '.###.']
const errorLeft: EyeGrid = ['#....', '.#...', '..#..', '.#...', '#....']
const errorRight: EyeGrid = ['....#', '...#.', '..#..', '...#.', '....#']
const waiting: EyeGrid = ['.....', '.....', '.###.', '.###.', '.....']

/** Positions du « point qui tourne » autour de l'œil (sens horaire). */
const RING: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [2, 0], [3, 0], [4, 1], [4, 2], [4, 3], [3, 4], [2, 4], [1, 4], [0, 3], [0, 2], [0, 1]
]

function ringFrame(step: number): EyeGrid {
  const rows = Array.from({ length: GRID }, () => Array.from({ length: GRID }, () => '.'))
  // Deux LED allumées : la tête et sa traîne.
  for (const offset of [0, 1]) {
    const [x, y] = RING[(step - offset + RING.length) % RING.length]
    rows[y][x] = '#'
  }
  rows[2][2] = '#'
  return rows.map((r) => r.join(''))
}

export const THINKING_FRAMES: Expression[] = RING.map((_, i) => ({
  left: ringFrame(i),
  right: ringFrame((i + RING.length / 2) % RING.length)
}))

export const EXPRESSIONS: Record<Exclude<Mood, 'thinking'>, Expression> = {
  idle: { left: open, right: open },
  listening: { left: open, right: open },
  waiting: { left: waiting, right: waiting },
  happy: { left: happy, right: happy },
  error: { left: errorLeft, right: errorRight },
  sleeping: { left: closed, right: closed },
  surprised: { left: surprised, right: surprised },
  wink: { left: happy, right: open }
}

export const BLINK: Expression = { left: closed, right: closed }

export function expressionFor(mood: Mood, frame = 0): Expression {
  if (mood === 'thinking') return THINKING_FRAMES[frame % THINKING_FRAMES.length]
  return EXPRESSIONS[mood]
}

/** Vérifie qu'une grille est bien une matrice 5×5 de `#`/`.`. */
export function isValidGrid(grid: EyeGrid): boolean {
  return grid.length === GRID && grid.every((row) => row.length === GRID && /^[#.]+$/.test(row))
}
