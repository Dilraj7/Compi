// Processus annexe de la dictée partout (utilityProcess d'Electron) : sherpa-onnx
// y charge le modèle et transcrit. Isolé de Compi : un plantage du moteur ne
// ferme pas l'application, et sa mémoire est rendue quand il s'arrête. Le son
// arrive par message, n'est jamais écrit sur le disque ni envoyé ailleurs.

import { cpus } from 'node:os'
import { OfflineRecognizer } from 'sherpa-onnx-node'
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

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as SpeechRequest
  void (async () => {
    try {
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
