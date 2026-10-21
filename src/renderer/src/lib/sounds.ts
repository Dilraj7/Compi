// Sons discrets de Compi, créés à la volée (Web Audio) : quelques notes
// douces, sans fichier. Le processus principal dit d'abord s'ils peuvent jouer
// (heures calmes, réunion, pomodoro, plein écran).

import { SOUND_GAIN, SOUND_SETTING, type SoundKind } from '@shared/sounds'
import type { PillId } from '@shared/pills'
import type { PublicSettings, SoundVolume } from '@shared/types'

interface Note {
  /** Fréquence (Hz). */
  f: number
  /** Départ et durée (s). */
  at: number
  dur: number
  type?: OscillatorType
  gain?: number
}

// Créations originales : intervalles simples, attaques douces, fins longues.
const PATTERNS: Record<SoundKind, Note[]> = {
  // Deux notes qui montent : « j'ai besoin de toi ».
  attention: [
    { f: 587.33, at: 0, dur: 0.22 },
    { f: 880, at: 0.12, dur: 0.34 }
  ],
  // Petit carillon de trois notes.
  reminder: [
    { f: 783.99, at: 0, dur: 0.55 },
    { f: 987.77, at: 0.15, dur: 0.55 },
    { f: 1174.66, at: 0.3, dur: 0.85 },
    { f: 2349.32, at: 0.3, dur: 0.4, gain: 0.12 }
  ],
  // Double bip doux.
  message: [
    { f: 1046.5, at: 0, dur: 0.1, type: 'triangle' },
    { f: 1318.51, at: 0.14, dur: 0.16, type: 'triangle' }
  ],
  // Clic bref : réponse à une touche.
  ok: [{ f: 1567.98, at: 0, dur: 0.06, type: 'triangle', gain: 0.5 }],
  // Deux notes qui descendent : c'est fini.
  done: [
    { f: 880, at: 0, dur: 0.2 },
    { f: 659.25, at: 0.13, dur: 0.4 }
  ]
}

let ctx: AudioContext | null = null

export function playSound(kind: SoundKind, volume: SoundVolume): void {
  try {
    ctx ??= new AudioContext()
    const ac = ctx
    if (ac.state === 'suspended') void ac.resume()
    const t0 = ac.currentTime + 0.02
    const master = ac.createGain()
    master.gain.value = SOUND_GAIN[volume]
    const soft = ac.createBiquadFilter()
    soft.type = 'lowpass'
    soft.frequency.value = 3600
    master.connect(soft).connect(ac.destination)
    for (const n of PATTERNS[kind]) {
      const o = ac.createOscillator()
      o.type = n.type ?? 'sine'
      o.frequency.value = n.f
      const g = ac.createGain()
      const start = t0 + n.at
      g.gain.setValueAtTime(0.0001, start)
      g.gain.exponentialRampToValueAtTime(n.gain ?? 1, start + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, start + n.dur)
      o.connect(g).connect(master)
      o.start(start)
      o.stop(start + n.dur + 0.05)
    }
  } catch {
    // Pas de sortie audio : tant pis, Compi reste silencieux.
  }
}

let lastAt = 0

/** Joue le son si les réglages et le moment le permettent. */
export async function maybePlay(kind: SoundKind, settings: PublicSettings | null, pill?: PillId): Promise<void> {
  const s = settings?.sounds
  if (!s?.enabled || !s[SOUND_SETTING[kind]]) return
  // Pas de rafale : deux évènements rapprochés ne sonnent qu'une fois.
  if (Date.now() - lastAt < 500) return
  lastAt = Date.now()
  try {
    if (await window.compi.soundAllowed(kind, pill)) playSound(kind, s.volume)
  } catch {
    // Réponse impossible : silence.
  }
}
