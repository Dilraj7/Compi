// Transcription de la voix avec Whisper, dans un fil séparé pour ne jamais
// figer l'îlot. Le modèle vient du PC (compi-model://, servi par Compi) et le
// moteur ONNX est fourni avec l'application : aucun accès à Internet ici.

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'
import ortMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'
import ortWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'

export type WorkerRequest =
  | { type: 'load'; id: number; model: string; device: 'webgpu' | 'wasm'; dtype: Record<string, string> }
  | { type: 'transcribe'; id: number; audio: Float32Array; language: string }

export type WorkerResponse =
  | { type: 'progress'; id: number; ratio: number }
  | { type: 'done'; id: number; text?: string }
  | { type: 'error'; id: number; message: string }

env.allowRemoteModels = false
env.allowLocalModels = true
env.localModelPath = 'compi-model://models/'
env.useBrowserCache = false
env.useWasmCache = false
const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } }
if (onnx.wasm) {
  onnx.wasm.wasmPaths = { mjs: new URL(ortMjs, self.location.href).href, wasm: new URL(ortWasm, self.location.href).href }
}

let asr: AutomaticSpeechRecognitionPipeline | null = null
let loaded = ''

const post = (msg: WorkerResponse): void => self.postMessage(msg)

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data
  try {
    if (req.type === 'load') {
      const key = `${req.model}|${req.device}`
      if (asr && loaded === key) return post({ type: 'done', id: req.id })
      await asr?.dispose()
      asr = null
      const files = new Map<string, { loaded: number; total: number }>()
      asr = (await pipeline('automatic-speech-recognition', req.model, {
        device: req.device,
        dtype: req.dtype as never,
        progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
          if (p.status !== 'progress' || !p.file || !p.total) return
          files.set(p.file, { loaded: p.loaded ?? 0, total: p.total })
          let a = 0
          let b = 0
          for (const f of files.values()) {
            a += f.loaded
            b += f.total
          }
          post({ type: 'progress', id: req.id, ratio: b ? a / b : 0 })
        }
      })) as AutomaticSpeechRecognitionPipeline
      loaded = key
      return post({ type: 'done', id: req.id })
    }
    if (req.type === 'transcribe') {
      if (!asr) throw new Error('Le modèle de dictée n’est pas chargé.')
      const out = await asr(req.audio, { language: req.language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
      const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out.text
      return post({ type: 'done', id: req.id, text })
    }
  } catch (err) {
    post({ type: 'error', id: req.id, message: (err as Error).message || String(err) })
  }
}
