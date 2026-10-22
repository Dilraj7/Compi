// Messages entre Compi et le processus annexe de la dictée (speech/worker.ts).

import type { SpeechModelId } from '../../shared/types'

export type SpeechRequest =
  | { type: 'load'; id: number; model: SpeechModelId; kind: 'nemo-transducer' | 'omnilingual-ctc'; files: Record<string, string> }
  /** Son en 16 kHz mono, de -1 à 1. */
  | { type: 'transcribe'; id: number; samples: Float32Array }
  /** Séparer les voix d'une piste d'appel (fichier 16 kHz, 16 bits) ; `speakers` si l'utilisateur le connaît. */
  | { type: 'diarize'; id: number; segmentation: string; embedding: string; path: string; speakers?: number }
  /** Dire un texte avec la voix naturelle (chargée au premier morceau). `speed` : 1 = normale. */
  | { type: 'speak'; id: number; files: Record<string, string>; text: string; sid: number; lang: string; speed: number }

export type SpeechResponse =
  | { type: 'ok'; id: number; ms: number }
  | { type: 'text'; id: number; text: string; ms: number }
  | { type: 'voices'; id: number; segments: { start: number; end: number; speaker: number }[]; ms: number }
  /** Son de -1 à 1 ; `loadMs` si le moteur vient d'être chargé. */
  | { type: 'audio'; id: number; samples: Float32Array; sampleRate: number; ms: number; loadMs?: number }
  | { type: 'error'; id: number; message: string }
