// Processeur audio de l'enregistreur d'appels : rassemble le son (déjà en
// 16 kHz, celui du contexte) par morceaux de 0,25 s, en mono, et les envoie à
// l'îlot. Un silence est envoyé tel quel : les deux pistes restent alignées.

/* global AudioWorkletProcessor, registerProcessor */

const CHUNK = 4000

class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buf = new Float32Array(CHUNK)
    this.n = 0
  }

  process(inputs) {
    const input = inputs[0]
    const a = input && input[0]
    const b = input && input[1]
    const frames = a ? a.length : 128
    for (let i = 0; i < frames; i++) {
      this.buf[this.n++] = a ? (b ? (a[i] + b[i]) / 2 : a[i]) : 0
      if (this.n === CHUNK) {
        this.port.postMessage(this.buf, [this.buf.buffer])
        this.buf = new Float32Array(CHUNK)
        this.n = 0
      }
    }
    return true
  }
}

registerProcessor('pcm-tap', PcmTap)
