// Processus annexe de la dictée partout (utilityProcess d'Electron) : sherpa-onnx
// y charge le modèle et transcrit. Isolé de Compi : un plantage du moteur ne
// ferme pas l'application, et sa mémoire est rendue quand il s'arrête. Le son
// arrive par message (ou, pour séparer les voix d'un appel, depuis le fichier
// de l'enregistrement) ; rien n'est écrit ni envoyé ailleurs.

import { readFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { OfflineRecognizer, OfflineSpeakerDiarization } from 'sherpa-onnx-node'
import type { SpeechRequest, SpeechResponse } from './protocol'

let recognizer: OfflineRecognizer | null = null
let loadedKey = ''

const reply = (r: SpeechResponse): void => process.parentPort.postMessage(r)

/** La moitié des cœurs, de 1 à 4 : rapide sans accaparer le PC. */
const threads = (): number => Math.max(1, Math.min(4, Math.floor(cpus().length / 2)))

function configFor(req: Extract<SpeechRequest, { type: 'load' }>): unknown {
  const f = req.files
  const modelConfig =
    req.kind === 'nemo-transducer'
      ? { transducer: { encoder: f['encoder.int8.onnx'], decoder: f['decoder.int8.onnx'], joiner: f['joiner.int8.onnx'] }, modelType: 'nemo_transducer' }
      : { omnilingual: { model: f['model.int8.onnx'] } }
  return {
    featConfig: { sampleRate: 16_000, featureDim: 80 },
    modelConfig: { ...modelConfig, tokens: f['tokens.txt'], numThreads: threads(), provider: 'cpu', debug: 0 }
  }
}

/** Piste d'appel (16 bits, 16 kHz) → son de -1 à 1. */
function readTrack(path: string): Float32Array {
  const b = readFileSync(path)
  const pcm = new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2))
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

/** Qui parle quand, chez les autres participants. Le moteur est libéré juste après. */
function diarize(req: Extract<SpeechRequest, { type: 'diarize' }>): Extract<SpeechResponse, { type: 'voices' }> {
  const t = Date.now()
  const sd = new OfflineSpeakerDiarization({
    segmentation: { pyannote: { model: req.segmentation }, numThreads: threads(), debug: 0 },
    embedding: { model: req.embedding, numThreads: threads(), debug: 0 },
    // Seuil bas : plutôt une voix de trop (deux voix se réunissent en leur donnant le même nom)
    // que deux personnes mélangées, impossibles à démêler une fois le son effacé.
    clustering: req.speakers ? { numClusters: req.speakers } : { numClusters: -1, threshold: 0.5 },
    minDurationOn: 0.2,
    minDurationOff: 0.5
  })
  const segments = sd.process(readTrack(req.path)).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker }))
  return { type: 'voices', id: req.id, segments, ms: Date.now() - t }
}

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as SpeechRequest
  void (async () => {
    try {
      if (req.type === 'diarize') return reply(diarize(req))
      if (req.type === 'load') {
        const key = `${req.model}|${Object.values(req.files).join('|')}`
        if (recognizer && loadedKey === key) return reply({ type: 'ok', id: req.id, ms: 0 })
        const t = Date.now()
        recognizer = null
        recognizer = await OfflineRecognizer.createAsync(configFor(req))
        loadedKey = key
        return reply({ type: 'ok', id: req.id, ms: Date.now() - t })
      }
      if (!recognizer) return reply({ type: 'error', id: req.id, message: 'Modèle de dictée non chargé.' })
      const t = Date.now()
      const stream = recognizer.createStream()
      stream.acceptWaveform({ samples: req.samples, sampleRate: 16_000 })
      const r = await recognizer.decodeAsync(stream)
      reply({ type: 'text', id: req.id, text: (r.text ?? '').trim(), ms: Date.now() - t })
    } catch (err) {
      reply({ type: 'error', id: req.id, message: (err as Error).message || String(err) })
    }
  })()
})
