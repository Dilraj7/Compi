// Encodeur du film promo (fenêtre cachée, Node activé) : reçoit les images BGRA de render.cjs,
// les encode en H.264 avec WebCodecs, crée la bande-son, encode l'AAC et écrit le MP4.

const { ipcRenderer } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { mux } = require(path.join(__dirname, 'mp4.cjs'))

let cfg = null
let enc = null
let avcC = null
let failure = null
const vSamples = []

const reply = (channel, id, payload = {}) => ipcRenderer.send(`${channel}:${id}`, payload)
const handle = (channel, fn) =>
  ipcRenderer.on(channel, async (_e, msg) => {
    try {
      if (failure) throw failure
      reply(channel, msg.id, (await fn(msg)) ?? {})
    } catch (err) {
      reply(channel, msg.id, { error: String(err?.stack ?? err) })
    }
  })

/** BGRA → I420, matrice BT.709 en plage limitée (déclarée telle quelle dans le MP4). */
function toI420(bgra, w, h, out) {
  const ySize = w * h
  const Y = out.subarray(0, ySize)
  const U = out.subarray(ySize, ySize + ySize / 4)
  const V = out.subarray(ySize + ySize / 4)
  for (let y = 0; y < h; y++) {
    let o = y * w * 4
    const row = y * w
    for (let x = 0; x < w; x++, o += 4) Y[row + x] = 16 + ((47 * bgra[o + 2] + 157 * bgra[o + 1] + 16 * bgra[o] + 128) >> 8)
  }
  const cw = w / 2
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const a = (y * w + x) * 4
      const b = a + w * 4
      const r = bgra[a + 2] + bgra[a + 6] + bgra[b + 2] + bgra[b + 6]
      const g = bgra[a + 1] + bgra[a + 5] + bgra[b + 1] + bgra[b + 5]
      const bl = bgra[a] + bgra[a + 4] + bgra[b] + bgra[b + 4]
      const c = (y / 2) * cw + x / 2
      U[c] = 128 + ((-26 * r - 86 * g + 112 * bl + 512) >> 10)
      V[c] = 128 + ((112 * r - 102 * g - 10 * bl + 512) >> 10)
    }
  }
}

handle('start', async ({ width, height, fps, bitrate }) => {
  cfg = { width, height, fps, bitrate, i420: new Uint8Array((width * height * 3) / 2) }
  const config = {
    codec: 'avc1.64002a',
    width,
    height,
    framerate: fps,
    bitrate,
    bitrateMode: 'variable',
    latencyMode: 'quality',
    hardwareAcceleration: 'prefer-software',
    avc: { format: 'avc' }
  }
  const support = await VideoEncoder.isConfigSupported(config)
  if (!support.supported) throw new Error('Encodeur H.264 indisponible')
  enc = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      vSamples.push({ data, key: chunk.type === 'key', ts: chunk.timestamp })
      if (!avcC && meta?.decoderConfig?.description) avcC = new Uint8Array(meta.decoderConfig.description)
    },
    error: (e) => (failure = e)
  })
  enc.configure(config)
})

handle('frame', async ({ i, bgra }) => {
  const { width: w, height: h, fps, i420 } = cfg
  toI420(bgra, w, h, i420)
  const frame = new VideoFrame(i420, {
    format: 'I420',
    codedWidth: w,
    codedHeight: h,
    timestamp: Math.round((i * 1e6) / fps),
    duration: Math.round(1e6 / fps),
    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false }
  })
  enc.encode(frame, { keyFrame: i % (fps * 2) === 0 })
  frame.close()
  while (enc.encodeQueueSize > 3) await new Promise((r) => setTimeout(r, 1))
})

async function encodeAudio(buffer) {
  const sampleRate = buffer.sampleRate
  const bitrate = 192000
  const samples = []
  let asc = null
  let aErr = null
  const aenc = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength)
      chunk.copyTo(data)
      samples.push({ data, ts: chunk.timestamp, dur: chunk.duration })
      if (!asc && meta?.decoderConfig?.description) asc = new Uint8Array(meta.decoderConfig.description)
    },
    error: (e) => (aErr = e)
  })
  aenc.configure({ codec: 'mp4a.40.2', sampleRate, numberOfChannels: 2, bitrate })
  const L = buffer.getChannelData(0)
  const R = buffer.getChannelData(1)
  const STEP = 4800
  for (let off = 0; off < L.length; off += STEP) {
    const n = Math.min(STEP, L.length - off)
    const data = new Float32Array(n * 2)
    data.set(L.subarray(off, off + n), 0)
    data.set(R.subarray(off, off + n), n)
    aenc.encode(
      new AudioData({ format: 'f32-planar', sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off * 1e6) / sampleRate), data })
    )
  }
  await aenc.flush()
  if (aErr) throw aErr
  // AAC-LC, 48 kHz, stéréo, si l'encodeur ne donne pas sa configuration.
  asc ??= new Uint8Array([0x11, 0x90])
  return { sampleRate, channels: 2, asc, bitrate, samples, first: samples[0] && { ts: samples[0].ts, dur: samples[0].dur } }
}

handle('finish', async ({ duration, out }) => {
  await enc.flush()
  if (!avcC) throw new Error('Configuration H.264 absente')
  for (let k = 1; k < vSamples.length; k++) if (vSamples[k].ts <= vSamples[k - 1].ts) throw new Error('Images B inattendues : ordre de décodage différent')

  const buffer = await window.renderSoundtrack(duration)
  const audio = await encodeAudio(buffer)
  const file = mux({ video: { width: cfg.width, height: cfg.height, fps: cfg.fps, avcC, samples: vSamples }, audio })
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, file)
  return {
    bytes: file.length,
    videoChunks: vSamples.length,
    audioChunks: audio.samples.length,
    audioFirst: audio.first,
    profile: Array.from(avcC.slice(0, 4)),
    peak: buffer.peak,
    levels: buffer.levels
  }
})
