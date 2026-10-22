// Modèles de reconnaissance de la dictée partout (sherpa-onnx, sur le PC), à
// une révision figée de Hugging Face. Chacun n'est téléchargé qu'après un
// clic, avec sa taille affichée, et chaque fichier est vérifié.

import type { SpeechModelId, SpeechPackId } from './types'

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

/** Une partie d'un téléchargement : des fichiers d'un dépôt, à une révision figée. */
export interface ModelSource {
  repo: string
  revision: string
  files: string[]
}

/** Ce qui se télécharge et se supprime d'un bloc (un modèle, ou le pack des voix). */
export interface SpeechPackDef {
  label: string
  license: string
  dir: string
  approxMb: number
  sources: ModelSource[]
}

/** Fichiers du pack des voix, par rôle. */
export const VOICES_FILES = { segmentation: 'model.int8.onnx', embedding: '3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx' } as const

/**
 * Pack des voix : repère qui parle chez les autres participants d'un appel
 * (« Personne 1 », « Personne 2 »…). Deux petits modèles, sur le PC.
 */
export const VOICES_PACK: SpeechPackDef = {
  label: 'Pack des voix',
  license: 'pyannote segmentation 3.0 (licence MIT) et CAM++ de 3D-Speaker (licence Apache-2.0)',
  dir: 'voices-pyannote-campplus',
  approxMb: 31,
  sources: [
    { repo: 'csukuangfj/sherpa-onnx-pyannote-segmentation-3-0', revision: '9403a6902bb58e3d5ae8c7e77c3422de279db2e0', files: [VOICES_FILES.segmentation] },
    { repo: 'csukuangfj/speaker-embedding-models', revision: '0743f301363dec56491a490f6d6cbc9d67f9a3bf', files: [VOICES_FILES.embedding] }
  ]
}

export const SPEECH_PACKS: Record<SpeechPackId, SpeechPackDef> = {
  parakeet: {
    ...SPEECH_MODELS.parakeet,
    sources: [{ repo: SPEECH_MODELS.parakeet.repo, revision: SPEECH_MODELS.parakeet.revision, files: SPEECH_MODELS.parakeet.files }]
  },
  omnilingual: {
    ...SPEECH_MODELS.omnilingual,
    sources: [{ repo: SPEECH_MODELS.omnilingual.repo, revision: SPEECH_MODELS.omnilingual.revision, files: SPEECH_MODELS.omnilingual.files }]
  },
  voices: VOICES_PACK
}

export const isSpeechPack = (id: unknown): id is SpeechPackId => typeof id === 'string' && Object.hasOwn(SPEECH_PACKS, id)

/** Révision enregistrée à l'installation (une seule partie : celle du dépôt, comme avant les packs). */
export const packRevision = (def: SpeechPackDef): string => def.sources.map((s) => s.revision).join('+')
