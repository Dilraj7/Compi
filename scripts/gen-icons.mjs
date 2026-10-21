// Génère les icônes de Compi (visage de robot) en PNG, sans dépendance :
// rendu par fonctions de distance signée + suréchantillonnage, encodage PNG via zlib.
// Usage : node scripts/gen-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const CYAN = [56, 225, 255]

// ─── PNG ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ─── Formes (repère 256×256) ─────────────────────────────────────────────────
const sdRoundRect = (px, py, x0, y0, x1, y1, r) => {
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const hx = (x1 - x0) / 2 - r
  const hy = (y1 - y0) / 2 - r
  const qx = Math.abs(px - cx) - hx
  const qy = Math.abs(py - cy) - hy
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r
const sdSegment = (px, py, ax, ay, bx, by, r) => {
  const pax = px - ax
  const pay = py - ay
  const bax = bx - ax
  const bay = by - ay
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)))
  return Math.hypot(pax - bax * h, pay - bay * h) - r
}

const HAPPY = ['.....', '..#..', '.#.#.', '#...#', '.....']

function ledDots(detail) {
  if (!detail) {
    // Petite taille : yeux simplifiés en arcs « ^ » épais.
    return []
  }
  const dots = []
  const dot = 9
  const gap = 3.2
  const span = 5 * dot + 4 * gap
  for (const cx of [88, 168]) {
    const x0 = cx - span / 2
    const y0 = 138 - span / 2
    HAPPY.forEach((row, ry) =>
      [...row].forEach((c, rx) => {
        if (c === '#') dots.push([x0 + rx * (dot + gap) + dot / 2, y0 + ry * (dot + gap) + dot / 2, dot / 2])
      })
    )
  }
  return dots
}

function scene(detail) {
  const dots = ledDots(detail)
  // Couches peintes de bas en haut : [sdf, [r,g,b], alpha]
  const layers = [
    // oreilles
    { d: (x, y) => sdRoundRect(x, y, 8, 108, 34, 168, 13), c: [36, 36, 46] },
    { d: (x, y) => sdRoundRect(x, y, 222, 108, 248, 168, 13), c: [36, 36, 46] },
    // antenne
    { d: (x, y) => sdSegment(x, y, 128, 46, 128, 80, detail ? 4 : 7), c: [52, 52, 66] },
    // tête (capsule) + liseré
    { d: (x, y) => sdRoundRect(x, y, 24, 72, 232, 204, 66), c: [58, 58, 74] },
    { d: (x, y) => sdRoundRect(x, y, 30, 78, 226, 198, 60), c: [16, 16, 22] },
    // visière
    { d: (x, y) => sdRoundRect(x, y, 46, 96, 210, 180, 42), c: [0, 0, 0] },
    // pointe d'antenne
    { d: (x, y) => sdCircle(x, y, 128, 38, detail ? 13 : 20), c: CYAN }
  ]
  if (detail) {
    for (const [cx, cy, r] of dots) layers.push({ d: (x, y) => sdCircle(x, y, cx, cy, r), c: CYAN })
  } else {
    for (const cx of [88, 168]) {
      layers.push({ d: (x, y) => Math.min(sdSegment(x, y, cx - 19, 152, cx, 128, 9), sdSegment(x, y, cx, 128, cx + 19, 152, 9)), c: CYAN })
    }
  }
  const glows = detail
    ? [...dots.map(([cx, cy]) => [cx, cy, 9]), [128, 38, 22]]
    : [[90, 140, 24], [166, 140, 24], [128, 38, 30]]
  return { layers, glows }
}

function render(size, detail) {
  const { layers, glows } = scene(detail)
  const ss = size >= 128 ? 3 : 6
  const out = Buffer.alloc(size * size * 4)
  const k = 256 / size
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) * k
          const y = (py + (sy + 0.5) / ss) * k
          let cr = 0
          let cg = 0
          let cb = 0
          let ca = 0
          for (const L of layers) {
            if (L.d(x, y) <= 0) {
              ;[cr, cg, cb] = L.c
              ca = 1
            }
          }
          // halo lumineux des LED (additif, seulement sur la visière ou au-dessus)
          let glow = 0
          for (const [gx, gy, gr] of glows) {
            const d2 = ((x - gx) ** 2 + (y - gy) ** 2) / (gr * gr)
            glow += Math.exp(-d2) * 0.55
          }
          if (glow > 0.01) {
            const ga = Math.min(1, glow)
            cr = cr * (1 - ga) + CYAN[0] * ga
            cg = cg * (1 - ga) + CYAN[1] * ga
            cb = cb * (1 - ga) + CYAN[2] * ga
            ca = Math.max(ca, ga * 0.9)
          }
          r += cr * ca
          g += cg * ca
          b += cb * ca
          a += ca
        }
      }
      const n = ss * ss
      const i = (py * size + px) * 4
      out[i + 3] = Math.round((a / n) * 255)
      if (a > 0) {
        out[i] = Math.round(r / a)
        out[i + 1] = Math.round(g / a)
        out[i + 2] = Math.round(b / a)
      }
    }
  }
  return encodePng(size, out)
}

mkdirSync('resources', { recursive: true })
writeFileSync('resources/icon.png', render(256, true))
writeFileSync('resources/tray.png', render(32, false))
writeFileSync('resources/tray@2x.png', render(64, false))
console.log('Icônes générées dans resources/')
