// Les yeux de Compi : deux matrices de LED 5×5. Chaque LED change d'état en
// douceur, ce qui fait « morpher » une expression vers la suivante.

import { useEffect, useId, useRef, useState } from 'react'
import { BLINK, expressionFor, GRID, type EyeGrid } from '@shared/expressions'
import type { Mood } from '@shared/types'

interface EyesProps {
  mood: Mood
  color: string
  /** Diamètre d'une LED, en px. */
  dot?: number
  /** Espace entre deux LED. */
  gap?: number
  /** Espace entre les deux yeux. */
  eyeGap?: number
  /** Décalage du regard, en px. */
  look?: { x: number; y: number }
}

const BLINKING_MOODS: Mood[] = ['idle', 'listening', 'waiting', 'surprised']

function useExpression(mood: Mood) {
  const [frame, setFrame] = useState(0)
  const [blink, setBlink] = useState(false)

  useEffect(() => {
    if (mood !== 'thinking') return
    const t = setInterval(() => setFrame((f) => f + 1), 85)
    return () => clearInterval(t)
  }, [mood])

  useEffect(() => {
    if (!BLINKING_MOODS.includes(mood)) return
    let timer: ReturnType<typeof setTimeout>
    const loop = (): void => {
      timer = setTimeout(
        () => {
          setBlink(true)
          timer = setTimeout(() => {
            setBlink(false)
            loop()
          }, 120)
        },
        2400 + Math.random() * 3800
      )
    }
    loop()
    return () => clearTimeout(timer)
  }, [mood])

  return blink && BLINKING_MOODS.includes(mood) ? BLINK : expressionFor(mood, frame)
}

export function EyeDots({ mood, color, dot = 3, gap = 1.5, eyeGap = 12, look = { x: 0, y: 0 }, x = 0, y = 0, filterId }: EyesProps & { x?: number; y?: number; filterId: string }) {
  const expr = useExpression(mood)
  const span = GRID * dot + (GRID - 1) * gap
  const r = dot / 2

  const eye = (grid: EyeGrid, ox: number) => {
    const base: React.ReactNode[] = []
    const lit: React.ReactNode[] = []
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        const cx = ox + col * (dot + gap) + r
        const cy = row * (dot + gap) + r
        const on = grid[row][col] === '#'
        base.push(<circle key={`b${row}${col}`} cx={cx} cy={cy} r={r * 0.82} fill="rgb(255 255 255 / 0.07)" />)
        lit.push(
          <circle
            key={`l${row}${col}`}
            cx={cx}
            cy={cy}
            r={r}
            fill={color}
            style={{ opacity: on ? 1 : 0, transition: 'opacity 110ms linear, fill 300ms ease' }}
          />
        )
      }
    }
    return { base, lit }
  }

  const left = eye(expr.left, 0)
  const right = eye(expr.right, span + eyeGap)

  return (
    <g transform={`translate(${x} ${y})`}>
      <g>
        {left.base}
        {right.base}
      </g>
      <g
        filter={`url(#${filterId})`}
        style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: 'transform 220ms cubic-bezier(.3,1.3,.5,1)' }}
      >
        {left.lit}
        {right.lit}
      </g>
    </g>
  )
}

export function GlowFilter({ id, strength = 2.2 }: { id: string; strength?: number }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation={strength} result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  )
}

/** Yeux seuls, dans leur propre SVG (pour la pastille). */
export function LedEyes(props: EyesProps) {
  const { dot = 3, gap = 1.5, eyeGap = 12 } = props
  const filterId = useId().replace(/:/g, '')
  const span = GRID * dot + (GRID - 1) * gap
  const pad = 6
  const w = span * 2 + eyeGap + pad * 2
  const h = span + pad * 2
  return (
    <svg width={w} height={h} viewBox={`${-pad} ${-pad} ${w} ${h}`} style={{ overflow: 'visible' }} aria-hidden>
      <defs>
        <GlowFilter id={filterId} strength={dot * 0.7} />
      </defs>
      <EyeDots {...props} filterId={filterId} />
    </svg>
  )
}

/** Suivi du regard : renvoie un décalage (px) vers la souris. */
export function useLook(max = 1.6) {
  const ref = useRef<HTMLDivElement>(null)
  const [look, setLook] = useState({ x: 0, y: 0 })
  useEffect(() => {
    let raf = 0
    const onMove = (e: MouseEvent): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const el = ref.current
        if (!el) return
        const b = el.getBoundingClientRect()
        const dx = e.clientX - (b.left + b.width / 2)
        const dy = e.clientY - (b.top + b.height / 2)
        const dist = Math.hypot(dx, dy) || 1
        const k = Math.min(1, dist / 220)
        setLook({ x: (dx / dist) * max * k, y: (dy / dist) * max * k })
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('mousemove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [max])
  return { ref, look }
}
