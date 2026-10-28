// Processeur audio de l'enregistreur d'appels : rassemble le son (déjà en
// 16 kHz, celui du contexte) par morceaux de 0,25 s, en mono, et les envoie à
// l'îlot. Un silence est envoyé tel quel : les deux pistes restent alignées.
// La conversation vocale demande des morceaux plus courts (processorOptions.chunk).

/* global AudioWorkletProcessor, registerProcessor */

const CHUNK = 4000

class PcmTap extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const chunk = options && options.processorOptions && options.processorOptions.chunk
    this.size = Number.isInteger(chunk) && chunk >= 160 && chunk <= 16000 ? chunk : CHUNK
    this.buf = new Float32Array(this.size)
    this.n = 0
  }

  process(inputs) {
    const input = inputs[0]
    const a = input && input[0]
    const b = input && input[1]
    const frames = a ? a.length : 128
    for (let i = 0; i < frames; i++) {
      this.buf[this.n++] = a ? (b ? (a[i] + b[i]) / 2 : a[i]) : 0
      if (this.n === this.size) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(this.size)
        this.n = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-tap', PcmTap)
