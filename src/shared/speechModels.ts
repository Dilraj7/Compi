// Modèles de reconnaissance de la dictée partout (sherpa-onnx, sur le PC), à
// une révision figée de Hugging Face. Chacun n'est téléchargé qu'après un
// clic, avec sa taille affichée, et chaque fichier est vérifié.

import type { SpeechModelId } from './types'

export interface SpeechModelDef {
  label: string
  /** « FR · EN · 25 langues ». */
  langs: string
  hint: string
  /** Mention obligatoire de la licence du modèle. */
  license: string
  repo: string
  /** Révision figée : les fichiers et leurs empreintes ne changent jamais. */
  revision: string
  /** Dossier dans userData/models. */
  dir: string
  files: string[]
  approxMb: number
  kind: 'nemo-transducer' | 'omnilingual-ctc'
}

export const SPEECH_MODELS: Record<SpeechModelId, SpeechModelDef> = {
  parakeet: {
    label: 'Parakeet',
    langs: 'Français, anglais et 23 autres langues',
    hint: 'Reconnaît la langue tout seul, avec la ponctuation. Rapide, même sans carte graphique.',
    license: 'Parakeet TDT 0.6B v3 de NVIDIA, licence CC-BY-4.0',
    repo: 'csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    revision: '2bda32ec70b097a55adaa07d9a7173915b43cc78',
    dir: 'parakeet-tdt-0.6b-v3-int8',
    files: ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'],
    approxMb: 670,
    kind: 'nemo-transducer'
  },
  omnilingual: {
    label: 'Omnilingual',
    langs: 'Tamoul, hindi et 1 600 langues',
    hint: 'Pour le tamoul. Sans ponctuation ; qualité à vérifier sur ta voix.',
    license: 'Omnilingual ASR 300M de Meta, licence Apache-2.0',
    repo: 'csukuangfj/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12',
    revision: '6abf1ece20cd2308bdb7d13cd78ec1c44fa4c094',
    dir: 'omnilingual-asr-300m-ctc-int8',
    files: ['model.int8.onnx', 'tokens.txt'],
    approxMb: 366,
    kind: 'omnilingual-ctc'
  }
}

export const isSpeechModel = (id: unknown): id is SpeechModelId => typeof id === 'string' && Object.hasOwn(SPEECH_MODELS, id)
