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
  export const version: string
}
