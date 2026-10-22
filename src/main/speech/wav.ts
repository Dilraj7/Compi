// Son de la voix naturelle (de -1 à 1) → fichier WAV 16 bits mono, en mémoire,
// comme celui de la voix de Windows : l'interface le lit de la même façon.

/** Crête visée : la voix naturelle sort plus bas que celle de Windows. */
const TARGET_PEAK = 0.89
/** Gain maximal : un morceau presque muet n'est pas poussé jusqu'au souffle. */
const MAX_GAIN = 4

export function wavFromSamples(samples: Float32Array, sampleRate: number): Buffer {
  let peak = 0
  for (const x of samples) peak = Math.max(peak, Math.abs(x))
  const gain = peak > 0 ? Math.min(MAX_GAIN, TARGET_PEAK / peak) : 1
  const out = Buffer.alloc(44 + samples.length * 2)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + samples.length * 2, 4)
  out.write('WAVEfmt ', 8, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i] * gain))
    out.writeInt16LE(Math.round(x * 32767), 44 + i * 2)
  }
  return out
}
