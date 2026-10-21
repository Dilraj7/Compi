// Dictée : modèles Whisper proposés, à une révision figée de Hugging Face.
// Deux variantes : carte graphique (WebGPU) ou processeur, selon le PC.

import type { VoiceModelId, VoiceVariant } from './types'

const COMMON = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json']

export interface VoiceModelDef {
  label: string
  hint: string
  repo: string
  /** Révision figée : les fichiers et leurs empreintes ne changent jamais. */
  revision: string
  /** Dossier dans userData/models. */
  dir: string
  variants: Record<VoiceVariant, { files: string[]; dtype: Record<string, string>; device: 'webgpu' | 'wasm'; approxMb: number }>
}

export const VOICE_MODELS: Record<VoiceModelId, VoiceModelDef> = {
  small: {
    label: 'Précise',
    hint: 'Comprend bien le français, même vite ou avec du bruit.',
    repo: 'onnx-community/whisper-small',
    revision: '36050c46d777d46dc4b5f43f6d90574fc38f8732',
    dir: 'whisper-small',
    variants: {
      gpu: { files: [...COMMON, 'onnx/encoder_model_fp16.onnx', 'onnx/decoder_model_merged_q4.onnx'], dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' }, device: 'webgpu', approxMb: 413 },
      cpu: { files: [...COMMON, 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'], dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'wasm', approxMb: 252 }
    }
  },
  base: {
    label: 'Légère',
    hint: 'Plus petite et plus rapide, un peu moins précise.',
    repo: 'onnx-community/whisper-base',
    revision: '1846881b6b3a3024392c1eea3ad983695bc23925',
    dir: 'whisper-base',
    variants: {
      gpu: { files: [...COMMON, 'onnx/encoder_model.onnx', 'onnx/decoder_model_merged_q4.onnx'], dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, device: 'webgpu', approxMb: 209 },
      cpu: { files: [...COMMON, 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'], dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' }, device: 'wasm', approxMb: 80 }
    }
  }
}

export const isVoiceModel = (id: unknown): id is VoiceModelId => typeof id === 'string' && Object.hasOwn(VOICE_MODELS, id)

/** « 413 Mo », « 1,2 Go ». */
export function sizeLabel(bytesOrMb: number, inMb = false): string {
  const mb = inMb ? bytesOrMb : bytesOrMb / 1e6
  return mb >= 1000 ? `${(mb / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go` : `${Math.round(mb)} Mo`
}

/**
 * Détection de la parole dans le niveau sonore (0 à 1, mesuré ~20 fois par
 * seconde) : arrêt après un silence, abandon si personne ne parle (testé).
 */
export interface SilenceState {
  heard: boolean
  /** Début du silence en cours (ms), ou `null`. */
  quietSince: number | null
  startedAt: number
}

export const VOICE_LIMITS = { threshold: 0.045, silenceMs: 1600, noSpeechMs: 7000, maxMs: 60_000 } as const

export function silenceStep(s: SilenceState, level: number, now: number): { state: SilenceState; stop: 'silence' | 'nothing' | 'max' | null } {
  if (now - s.startedAt >= VOICE_LIMITS.maxMs) return { state: s, stop: 'max' }
  if (level >= VOICE_LIMITS.threshold) return { state: { ...s, heard: true, quietSince: null }, stop: null }
  if (!s.heard) return { state: s, stop: now - s.startedAt >= VOICE_LIMITS.noSpeechMs ? 'nothing' : null }
  const quietSince = s.quietSince ?? now
  return { state: { ...s, quietSince }, stop: now - quietSince >= VOICE_LIMITS.silenceMs ? 'silence' : null }
}

/** Nettoie une transcription de Whisper (bruits, hallucinations courantes sur le silence). */
export function cleanTranscript(text: string): string {
  const t = text
    .replace(/\[[^\]]*\]|\([^)]*(musique|music|rires|applaudissements|silence|inaudible)[^)]*\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Phrases que Whisper invente sur un silence ou un bruit.
  if (/^(sous-titr(es|age)|merci d'avoir regardé|abonnez-vous|thank you\.?|merci\.?|\.+|…)$/i.test(t.replace(/[’]/g, "'"))) return ''
  if (/^(sous-titrage|sous-titres) (st'|réalisés|par)/i.test(t)) return ''
  return t
}
