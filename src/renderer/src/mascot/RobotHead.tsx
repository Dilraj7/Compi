// La tête complète de Compi : capsule-visière, oreilles, antenne lumineuse
// et yeux LED. Utilisée en grand (accueil) et en petit (avatar).

import { useId } from 'react'
import { motion } from 'motion/react'
import type { Mood } from '@shared/types'
import { EyeDots, GlowFilter, useLook } from './LedEyes'

interface Props {
  mood: Mood
  color: string
  /** Largeur en px (la hauteur suit). */
  width?: number
  onPoke?: () => void
}

export function RobotHead({ mood, color, width = 132, onPoke }: Props) {
  const id = useId().replace(/:/g, '')
  const { ref, look } = useLook(3)
  // Repère interne 256 × 210, comme l'icône de l'app.
  const dot = 10
  const gap = 3.6
  const span = 5 * dot + 4 * gap
  const eyeGap = 26
  const eyesW = span * 2 + eyeGap
  const height = (width * 210) / 256

  return (
    <motion.div
      ref={ref}
      style={{ width, height, cursor: onPoke ? 'pointer' : 'default' }}
      whileTap={onPoke ? { scale: 0.92, rotate: -3 } : undefined}
      onClick={onPoke}
    >
      <svg viewBox="0 0 256 210" width={width} height={height} aria-label="Compi" style={{ overflow: 'visible' }}>
        <defs>
          <GlowFilter id={`${id}g`} strength={5} />
          <linearGradient id={`${id}shell`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a3a4c" />
            <stop offset="1" stopColor="#1c1c26" />
          </linearGradient>
          <radialGradient id={`${id}visor`} cx="0.5" cy="0.25" r="0.9">
            <stop offset="0" stopColor="#14141c" />
            <stop offset="1" stopColor="#000" />
          </radialGradient>
        </defs>

        {/* oreilles */}
        <rect x="6" y="88" width="26" height="62" rx="13" fill="#23232e" />
        <rect x="224" y="88" width="26" height="62" rx="13" fill="#23232e" />
        <rect x="14" y="104" width="10" height="30" rx="5" fill={color} opacity="0.55" filter={`url(#${id}g)`} />
        <rect x="232" y="104" width="10" height="30" rx="5" fill={color} opacity="0.55" filter={`url(#${id}g)`} />

        {/* antenne */}
        <rect x="124" y="20" width="8" height="38" rx="4" fill="#2e2e3c" />
        <motion.circle
          cx="128"
          cy="18"
          r="12"
          fill={color}
          filter={`url(#${id}g)`}
          animate={{ opacity: mood === 'sleeping' ? 0.35 : [1, 0.55, 1] }}
          transition={{ duration: mood === 'thinking' ? 0.9 : 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />

        {/* tête */}
        <rect x="22" y="52" width="212" height="140" rx="70" fill={`url(#${id}shell)`} />
        <rect x="28" y="58" width="200" height="128" rx="64" fill="#101017" />
        <rect x="44" y="76" width="168" height="92" rx="46" fill={`url(#${id}visor)`} />
        {/* reflet de la visière */}
        <path d="M70 84 Q128 70 186 84" stroke="rgb(255 255 255 / 0.07)" strokeWidth="4" fill="none" strokeLinecap="round" />

        <EyeDots
          mood={mood}
          color={color}
          dot={dot}
          gap={gap}
          eyeGap={eyeGap}
          look={look}
          x={128 - eyesW / 2}
          y={122 - span / 2}
          filterId={`${id}g`}
        />
      </svg>
    </motion.div>
  )
}
