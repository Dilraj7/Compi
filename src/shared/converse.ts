// Conversation vocale : après une question posée à la voix, le micro se rouvre
// à la fin de la lecture de la réponse, et la phrase entendue part comme
// nouvelle question. Ici la logique pure (phases, découpage de la parole),
// sans navigateur ni Electron, pour être testée.

import { SAMPLE_RATE, SEGMENT, type SegmentOptions } from './meetings'

/**
 * off : pas de conversation ; answering : Compi répond (et lit) ;
 * listening : micro ouvert, en attente d'une phrase ; hearing : quelqu'un parle ;
 * transcribing : la phrase se transcrit ; queued : phrase prête, envoyée dès la fin
 * de la réponse en cours (parole entendue pendant que la réponse s'écrivait encore).
 */
export type ConversePhase = 'off' | 'answering' | 'listening' | 'hearing' | 'transcribing' | 'queued'

export const CONVERSE = {
  /** Fenêtre d'écoute après la lecture. */
  listenMs: 6000,
  /** Voix entendue pendant au moins ce temps : c'est une phrase (et elle coupe la lecture). */
  onsetMs: 200,
  /** Pendant la lecture, plus long : une toux ou l'écho de la voix de Compi ne coupent pas. */
  readingOnsetMs: 350,
  /** Phrases vides d'affilée avant d'arrêter (bruit, mot isolé). */
  maxMisses: 2
} as const

/** Découpage pour une phrase dite à Compi : 0,3 s gardées avant, fin après 1,2 s de silence, 30 s au plus. */
export const CONVERSE_SEGMENT: SegmentOptions = {
  ...SEGMENT,
  preRoll: 0.3 * SAMPLE_RATE,
  endSilence: 1.2 * SAMPLE_RATE,
  minSpeech: 0.15 * SAMPLE_RATE,
  max: 30 * SAMPLE_RATE
}

/** Pendant la lecture : seuil relevé, le micro entend aussi la voix de Compi (moins avec un casque). */
export const READING_SEGMENT: SegmentOptions = { ...CONVERSE_SEGMENT, factor: 5, floor: 0.03 }

export type MicMode = 'reading' | 'listening'

/** Assez de voix pour une phrase ? (tranches de 30 ms entendues depuis son début) */
export const isOnset = (voicedFrames: number, mode: MicMode): boolean =>
  voicedFrames * SEGMENT.frame >= ((mode === 'reading' ? CONVERSE.readingOnsetMs : CONVERSE.onsetMs) / 1000) * SAMPLE_RATE

export interface ConverseState {
  phase: ConversePhase
  /** Fin de la fenêtre d'écoute (ms), en phase listening. */
  until: number
  /** Phrases vides d'affilée. */
  misses: number
}

export const CONVERSE_OFF: ConverseState = { phase: 'off', until: 0, misses: 0 }

export type ConverseEvent =
  /** Question posée à la voix, conversation activée. */
  | { type: 'ask' }
  /** Fin d'une lecture commencée : allée au bout, ou coupée. */
  | { type: 'speech-end'; reason: 'end' | 'stopped'; now: number }
  /** Réponse finie sans rien à lire (vide, erreur). */
  | { type: 'answer-silent' }
  /** Assez de voix pour une phrase ; `reading` : la voix de Compi lit encore. */
  | { type: 'onset'; reading: boolean }
  /** Phrase terminée (silence) : on transcrit. */
  | { type: 'phrase' }
  /** Transcription ; `busy` : une réponse s'écrit encore. */
  | { type: 'heard'; text: string; busy: boolean; now: number }
  /** La réponse qui s'écrivait est finie. */
  | { type: 'answer-end' }
  | { type: 'tick'; now: number }
  | { type: 'stop' }

/** Ce que l'îlot doit faire après un pas : couper la lecture, transcrire, envoyer la phrase. */
export type ConverseEffect = 'cut-reading' | 'transcribe' | 'send'

const listen = (s: ConverseState, now: number, misses = s.misses): ConverseState => ({ phase: 'listening', until: now + CONVERSE.listenMs, misses })

export function converseStep(s: ConverseState, e: ConverseEvent): { state: ConverseState; effects: ConverseEffect[] } {
  const keep = { state: s, effects: [] as ConverseEffect[] }
  if (e.type === 'stop') return { state: CONVERSE_OFF, effects: [] }
  if (e.type === 'ask') return { state: { phase: 'answering', until: 0, misses: 0 }, effects: [] }
  switch (s.phase) {
    case 'answering':
      if (e.type === 'speech-end') return { state: e.reason === 'end' ? listen(s, e.now) : CONVERSE_OFF, effects: [] }
      if (e.type === 'answer-silent') return { state: CONVERSE_OFF, effects: [] }
      // Parler pendant la lecture la coupe ; avant qu'elle commence, la voix est ignorée.
      if (e.type === 'onset' && e.reading) return { state: { ...s, phase: 'hearing' }, effects: ['cut-reading'] }
      return keep
    case 'listening':
      if (e.type === 'onset') return { state: { ...s, phase: 'hearing' }, effects: [] }
      if (e.type === 'phrase') return { state: { ...s, phase: 'transcribing' }, effects: ['transcribe'] }
      if (e.type === 'tick' && e.now >= s.until) return { state: CONVERSE_OFF, effects: [] }
      return keep
    case 'hearing':
      if (e.type === 'phrase') return { state: { ...s, phase: 'transcribing' }, effects: ['transcribe'] }
      return keep
    case 'transcribing':
      if (e.type !== 'heard') return keep
      if (!e.text.trim()) {
        const misses = s.misses + 1
        return { state: misses >= CONVERSE.maxMisses ? CONVERSE_OFF : listen(s, e.now, misses), effects: [] }
      }
      return e.busy ? { state: { ...s, phase: 'queued' }, effects: [] } : { state: { phase: 'answering', until: 0, misses: 0 }, effects: ['send'] }
    case 'queued':
      if (e.type === 'answer-end') return { state: { phase: 'answering', until: 0, misses: 0 }, effects: ['send'] }
      return keep
    default:
      return keep
  }
}

/** Micro voulu : pendant l'écoute, et pendant la lecture si on peut la couper en parlant. */
export function micWanted(s: ConverseState, reading: boolean, bargeIn: boolean): MicMode | null {
  if (s.phase === 'listening' || s.phase === 'hearing') return 'listening'
  if (s.phase === 'answering' && reading && bargeIn) return 'reading'
  return null
}
