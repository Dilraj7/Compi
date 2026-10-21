// Messages entre Compi et le processus annexe de la dictée (speech/worker.ts).

import type { SpeechModelId } from '../../shared/types'

export type SpeechRequest =
  | { type: 'load'; id: number; model: SpeechModelId; kind: 'nemo-transducer' | 'omnilingual-ctc'; files: Record<string, string> }
  /** Son en 16 kHz mono, de -1 à 1. */
  | { type: 'transcribe'; id: number; samples: Float32Array }

export type SpeechResponse =
  { type: 'ok'; id: number; ms: number } | { type: 'text'; id: number; text: string; ms: number } | { type: 'error'; id: number; message: string }
