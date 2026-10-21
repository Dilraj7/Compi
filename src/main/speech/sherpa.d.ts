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
  export const version: string
}
