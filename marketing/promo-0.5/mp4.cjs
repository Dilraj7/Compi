// Assembleur MP4 minimal : une piste vidéo H.264 (format « avc ») et une piste audio AAC,
// « moov » en tête (lecture immédiate sur le web), données entrelacées par demi-seconde.

const u8 = (n) => Buffer.from([n & 255])
const u16 = (n) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n & 0xffff)
  return b
}
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}
const zeros = (n) => Buffer.alloc(n)

function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))))
  return Buffer.concat([u32(8 + body.length), Buffer.from(type, 'latin1'), body])
}
const full = (type, version, flags, ...parts) => box(type, u32((version << 24) | flags), ...parts)

const MATRIX = Buffer.concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32))
const LANG_UND = 0x55c4

const mvhd = (timescale, duration, nextTrack) =>
  full('mvhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(nextTrack))
const tkhd = (id, duration, w, h, audio) =>
  full(
    'tkhd',
    0,
    3,
    u32(0),
    u32(0),
    u32(id),
    u32(0),
    u32(duration),
    zeros(8),
    u16(0),
    u16(audio ? 1 : 0),
    u16(audio ? 0x0100 : 0),
    u16(0),
    MATRIX,
    u32(w * 65536),
    u32(h * 65536)
  )
const mdhd = (timescale, duration) => full('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(LANG_UND), u16(0))
const hdlr = (type, name) => full('hdlr', 0, 0, u32(0), Buffer.from(type, 'latin1'), zeros(12), Buffer.from(name + '\0', 'utf8'))
const dinf = () => box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1)))

/** Suite de durées → entrées « stts » (durées égales regroupées). */
function stts(durations) {
  const runs = []
  for (const d of durations) {
    const last = runs[runs.length - 1]
    if (last && last[1] === d) last[0]++
    else runs.push([1, d])
  }
  return full('stts', 0, 0, u32(runs.length), ...runs.flatMap(([n, d]) => [u32(n), u32(d)]))
}
function stsc(chunkSizes) {
  const runs = []
  chunkSizes.forEach((n, i) => {
    const last = runs[runs.length - 1]
    if (!last || last[1] !== n) runs.push([i + 1, n])
  })
  return full('stsc', 0, 0, u32(runs.length), ...runs.flatMap(([first, n]) => [u32(first), u32(n), u32(1)]))
}
const stsz = (sizes) => full('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map(u32))
const stco = (offsets) => full('stco', 0, 0, u32(offsets.length), ...offsets.map(u32))
const stss = (keys) => full('stss', 0, 0, u32(keys.length), ...keys.map(u32))

function avc1(width, height, avcC) {
  const name = Buffer.alloc(32)
  name.write('\x0bCompi promo', 0, 'latin1')
  // Couleurs BT.709, plage limitée : celles de la conversion faite par encoder.js.
  const colr = box('colr', Buffer.from('nclx', 'latin1'), u16(1), u16(1), u16(1), u8(0))
  return box(
    'avc1',
    zeros(6),
    u16(1),
    u16(0),
    u16(0),
    zeros(12),
    u16(width),
    u16(height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    name,
    u16(0x0018),
    u16(0xffff),
    box('avcC', Buffer.from(avcC)),
    colr,
    box('pasp', u32(1), u32(1))
  )
}

function mp4a(sampleRate, channels, asc, bitrate) {
  const descr = (tag, body) => Buffer.concat([u8(tag), u8(body.length), body])
  const dsi = descr(0x05, Buffer.from(asc))
  const dcd = descr(0x04, Buffer.concat([u8(0x40), u8(0x15), zeros(3), u32(bitrate), u32(bitrate), dsi]))
  const es = descr(0x03, Buffer.concat([u16(0), u8(0), dcd, descr(0x06, u8(0x02))]))
  return box('mp4a', zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate * 65536), full('esds', 0, 0, es))
}

/**
 * video : { width, height, fps, avcC, samples: [{ data, key }] } (ordre de décodage, sans images B)
 * audio : { sampleRate, channels, asc, bitrate, samples: [{ data }] } (blocs AAC de 1024 échantillons)
 */
function mux({ video, audio }) {
  const VT = video.fps * 1000
  const vDur = 1000
  const aFrame = 1024
  const MOVIE_TS = 1000
  const vSeconds = video.samples.length / video.fps
  const aSeconds = audio ? (audio.samples.length * aFrame) / audio.sampleRate : 0

  // Entrelacement : un bloc vidéo puis un bloc audio par demi-seconde.
  const chunks = []
  const step = 0.5
  let vi = 0
  let ai = 0
  for (let tEnd = step; vi < video.samples.length || (audio && ai < audio.samples.length); tEnd += step) {
    const v = []
    while (vi < video.samples.length && vi / video.fps < tEnd) v.push(vi++)
    if (v.length) chunks.push({ track: 'v', idx: v })
    if (audio) {
      const a = []
      while (ai < audio.samples.length && (ai * aFrame) / audio.sampleRate < tEnd) a.push(ai++)
      if (a.length) chunks.push({ track: 'a', idx: a })
    }
  }

  const build = (offsets) => {
    const vChunks = chunks.filter((c) => c.track === 'v')
    const aChunks = chunks.filter((c) => c.track === 'a')
    const vStbl = box(
      'stbl',
      full('stsd', 0, 0, u32(1), avc1(video.width, video.height, video.avcC)),
      stts(video.samples.map(() => vDur)),
      stss(video.samples.flatMap((s, i) => (s.key ? [i + 1] : []))),
      stsc(vChunks.map((c) => c.idx.length)),
      stsz(video.samples.map((s) => s.data.length)),
      stco(vChunks.map((c) => offsets.get(c) ?? 0))
    )
    const vTrak = box(
      'trak',
      tkhd(1, Math.round(vSeconds * MOVIE_TS), video.width, video.height, false),
      box('mdia', mdhd(VT, video.samples.length * vDur), hdlr('vide', 'Compi video'), box('minf', full('vmhd', 0, 1, zeros(8)), dinf(), vStbl))
    )
    const traks = [vTrak]
    if (audio) {
      const aStbl = box(
        'stbl',
        full('stsd', 0, 0, u32(1), mp4a(audio.sampleRate, audio.channels, audio.asc, audio.bitrate)),
        stts(audio.samples.map(() => aFrame)),
        stsc(aChunks.map((c) => c.idx.length)),
        stsz(audio.samples.map((s) => s.data.length)),
        stco(aChunks.map((c) => offsets.get(c) ?? 0))
      )
      traks.push(
        box(
          'trak',
          tkhd(2, Math.round(aSeconds * MOVIE_TS), 0, 0, true),
          box(
            'mdia',
            mdhd(audio.sampleRate, audio.samples.length * aFrame),
            hdlr('soun', 'Compi audio'),
            box('minf', full('smhd', 0, 0, zeros(4)), dinf(), aStbl)
          )
        )
      )
    }
    return box('moov', mvhd(MOVIE_TS, Math.round(Math.max(vSeconds, aSeconds) * MOVIE_TS), audio ? 3 : 2), ...traks)
  }

  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomiso2avc1mp41', 'latin1'))
  const moovSize = build(new Map()).length
  const offsets = new Map()
  let pos = ftyp.length + moovSize + 8
  const parts = []
  for (const c of chunks) {
    offsets.set(c, pos)
    for (const i of c.idx) {
      const d = (c.track === 'v' ? video : audio).samples[i].data
      parts.push(Buffer.from(d.buffer, d.byteOffset, d.length))
      pos += d.length
    }
  }
  const moov = build(offsets)
  if (moov.length !== moovSize) throw new Error('Taille de moov instable')
  const mdatSize = pos - (ftyp.length + moovSize)
  return Buffer.concat([ftyp, moov, u32(mdatSize), Buffer.from('mdat', 'latin1'), ...parts])
}

module.exports = { mux }
