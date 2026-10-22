// Ce que Compi utilise de sherpa-onnx-node (le paquet n'a pas de types TypeScript).
declare module 'sherpa-onnx-node' {
  export interface OfflineStream {
    acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void
  }
  export class OfflineRecognizer {
    static createAsync(config: unknown): Promise<OfflineRecognizer>
    createStream(): OfflineStream
    decodeAsync(stream: OfflineStream): Promise<{ text: string; lang?: string }>
  }
  export class OfflineSpeakerDiarization {
    constructor(config: unknown)
    readonly sampleRate: number
    process(samples: Float32Array): { start: number; end: number; speaker: number }[]
  }
  export class GenerationConfig {
    constructor(opts: { sid: number; speed: number; numSteps?: number; extra?: Record<string, string | number> })
  }
  export class OfflineTts {
    static createAsync(config: unknown): Promise<OfflineTts>
    readonly sampleRate: number
    readonly numSpeakers: number
    generateAsync(req: {
      text: string
      enableExternalBuffer?: boolean
      generationConfig: GenerationConfig
    }): Promise<{ samples: Float32Array; sampleRate: number }>
  }
  export const version: string
}
