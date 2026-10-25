// Index de la recherche par le sens, gardé sur le disque plutôt qu'en mémoire.
// - vectors.<gen>.bin : un vecteur par passage (float32), lu par tranches à chaque
//   recherche. Le cache de fichiers de Windows le garde chaud, et peut le rendre
//   quand la mémoire manque : Compi ne le garde pas pour lui.
// - texts.<gen>.bin : le texte des passages (UTF-8), lu seulement pour les résultats.
// - index.json : documents connus et, par passage, chemin, page et place du texte.
// Chaque enregistrement écrit une nouvelle génération de fichiers, puis index.json :
// une fermeture de Compi en pleine écriture laisse l'index précédent intact.
// Sans Electron (tests/semantic.test.ts).

import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

export interface FileMeta {
  mtime: number
  size: number
}

/** Un passage pas encore enregistré (document qui vient d'être lu). */
export interface FreshEntry {
  file: string
  page?: number
  text: string
  vec: Float32Array
}

export interface IndexMeta {
  model: string
  dims: number
  /** Génération des fichiers vectors.<gen>.bin et texts.<gen>.bin. */
  gen: number
  files: Record<string, FileMeta>
  paths: string[]
  /** Par passage, ROW entiers : indice du chemin, page (0 sinon), début et longueur du texte (octets). */
  rows: Int32Array
}

/** Ancien format : textes dans index.json, vecteurs dans vectors.bin, tout chargé en mémoire. */
interface StoredV1 {
  version: 1
  model: string
  dims: number
  files: Record<string, FileMeta>
  entries: Array<{ file: string; page?: number; text: string }>
}

interface StoredV2 {
  version: 2
  model: string
  dims: number
  gen: number
  files: Record<string, FileMeta>
  paths: string[]
  rows: number[]
}

export const ROW = 4
const CHUNK = 8 * 1024 * 1024

export const rowCount = (m: IndexMeta): number => m.rows.length / ROW
export const rowPath = (m: IndexMeta, row: number): string => m.paths[m.rows[row * ROW]]
export const rowPage = (m: IndexMeta, row: number): number | undefined => m.rows[row * ROW + 1] || undefined

const vectorsFile = (dir: string, gen: number): string => join(dir, `vectors.${gen}.bin`)
const textsFile = (dir: string, gen: number): string => join(dir, `texts.${gen}.bin`)
const sizeOf = (file: string): number => {
  try {
    return statSync(file).size
  } catch {
    return -1
  }
}

/** Écriture séquentielle en gros blocs. */
class Writer {
  pos = 0
  private readonly fd: number
  private parts: Buffer[] = []
  private pending = 0

  constructor(file: string) {
    this.fd = openSync(file, 'w')
  }

  write(b: Uint8Array): void {
    this.pos += b.length
    if (b.length >= 64 * 1024) {
      this.flush()
      writeSync(this.fd, b)
      return
    }
    this.parts.push(Buffer.from(b))
    this.pending += b.length
    if (this.pending >= 1024 * 1024) this.flush()
  }

  private flush(): void {
    if (!this.parts.length) return
    writeSync(this.fd, Buffer.concat(this.parts, this.pending))
    this.parts = []
    this.pending = 0
  }

  close(): void {
    try {
      this.flush()
    } finally {
      closeSync(this.fd)
    }
  }
}

/** Recopie `length` octets du fichier ouvert `fd`, à partir de `start`. */
function copyRange(fd: number, start: number, length: number, out: Writer, buf: Buffer): void {
  let done = 0
  while (done < length) {
    const n = readSync(fd, buf, 0, Math.min(buf.length, length - done), start + done)
    if (n <= 0) throw new Error('Index de recherche incomplet.')
    out.write(buf.subarray(0, n))
    done += n
  }
}

function writeMeta(dir: string, m: IndexMeta): void {
  const stored: StoredV2 = { version: 2, model: m.model, dims: m.dims, gen: m.gen, files: m.files, paths: m.paths, rows: Array.from(m.rows) }
  const tmp = join(dir, 'index.json.tmp')
  writeFileSync(tmp, JSON.stringify(stored))
  renameSync(tmp, join(dir, 'index.json'))
}

/** Fichiers de la génération annoncée complets et cohérents avec la table. */
function consistent(dir: string, m: IndexMeta): boolean {
  const n = rowCount(m)
  if (!Number.isInteger(n) || m.dims <= 0) return false
  if (sizeOf(vectorsFile(dir, m.gen)) !== n * m.dims * 4) return false
  const end = n ? m.rows[(n - 1) * ROW + 2] + m.rows[(n - 1) * ROW + 3] : 0
  if (sizeOf(textsFile(dir, m.gen)) !== end) return false
  for (let i = 0; i < n; i++) if (m.rows[i * ROW] < 0 || m.rows[i * ROW] >= m.paths.length) return false
  return true
}

/** Ancien format → nouveau, une fois : les vecteurs ne sont pas recalculés. */
function migrateV1(dir: string, v1: StoredV1): IndexMeta | null {
  if (!Array.isArray(v1.entries)) return null
  const legacy = join(dir, 'vectors.bin')
  const expected = v1.entries.length * v1.dims * 4
  // Compi fermé pendant une conversion : les vecteurs ont déjà changé de nom.
  const renamed = sizeOf(vectorsFile(dir, 1)) === expected
  if (!renamed && sizeOf(legacy) !== expected) return null
  const paths: string[] = []
  const at = new Map<string, number>()
  const rows = new Int32Array(v1.entries.length * ROW)
  const texts = new Writer(textsFile(dir, 1))
  try {
    v1.entries.forEach((e, i) => {
      let p = at.get(e.file)
      if (p === undefined) {
        p = paths.push(e.file) - 1
        at.set(e.file, p)
      }
      const bytes = Buffer.from(e.text, 'utf8')
      rows.set([p, e.page ?? 0, texts.pos, bytes.length], i * ROW)
      texts.write(bytes)
    })
  } finally {
    texts.close()
  }
  if (!renamed) renameSync(legacy, vectorsFile(dir, 1))
  const m: IndexMeta = { model: v1.model, dims: v1.dims, gen: 1, files: v1.files ?? {}, paths, rows }
  writeMeta(dir, m)
  return m
}

/** Index enregistré pour ce modèle, ou `null` (aucun, autre modèle, fichiers incomplets). */
export function readIndex(dir: string, model: string): IndexMeta | null {
  let raw: StoredV1 | StoredV2
  try {
    raw = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as StoredV1 | StoredV2
  } catch {
    return null
  }
  if (raw.model !== model) return null
  if (raw.version === 1) return migrateV1(dir, raw)
  if (raw.version !== 2) return null
  const m: IndexMeta = {
    model: raw.model,
    dims: raw.dims,
    gen: raw.gen,
    files: raw.files ?? {},
    paths: Array.isArray(raw.paths) ? raw.paths : [],
    rows: Int32Array.from(Array.isArray(raw.rows) ? raw.rows : [])
  }
  return consistent(dir, m) ? m : null
}

/**
 * Enregistre une nouvelle génération : les passages gardés de `prev` (documents ni
 * retirés ni relus), puis les passages frais. Recopie par blocs, sans tout charger.
 */
export function writeIndex(
  dir: string,
  prev: IndexMeta | null,
  next: { model: string; dims: number; files: Record<string, FileMeta>; removed: Set<string>; fresh: FreshEntry[] }
): IndexMeta {
  mkdirSync(dir, { recursive: true })
  const gen = (prev?.gen ?? 0) + 1
  const { dims } = next
  const rowBytes = dims * 4
  const paths: string[] = []
  const pathAt = new Map<string, number>()
  const pathIndex = (f: string): number => {
    let p = pathAt.get(f)
    if (p === undefined) {
      p = paths.push(f) - 1
      pathAt.set(f, p)
    }
    return p
  }
  const rows: number[] = []
  const vectors = new Writer(vectorsFile(dir, gen))
  const texts = new Writer(textsFile(dir, gen))
  try {
    const n = prev && prev.model === next.model && prev.dims === dims ? rowCount(prev) : 0
    if (prev && n) {
      const buf = Buffer.allocUnsafe(CHUNK)
      const vr = openSync(vectorsFile(dir, prev.gen), 'r')
      const tr = openSync(textsFile(dir, prev.gen), 'r')
      try {
        const kept = (row: number): boolean => !next.removed.has(rowPath(prev, row))
        let i = 0
        while (i < n) {
          if (!kept(i)) {
            i++
            continue
          }
          let j = i + 1
          while (j < n && kept(j)) j++
          // Passages i à j-1 gardés : vecteurs et textes contigus, recopiés d'un bloc.
          copyRange(vr, i * rowBytes, (j - i) * rowBytes, vectors, buf)
          const t0 = prev.rows[i * ROW + 2]
          const tEnd = prev.rows[(j - 1) * ROW + 2] + prev.rows[(j - 1) * ROW + 3]
          const base = texts.pos
          copyRange(tr, t0, tEnd - t0, texts, buf)
          for (let k = i; k < j; k++) rows.push(pathIndex(rowPath(prev, k)), prev.rows[k * ROW + 1], base + prev.rows[k * ROW + 2] - t0, prev.rows[k * ROW + 3])
          i = j
        }
      } finally {
        closeSync(vr)
        closeSync(tr)
      }
    }
    for (const e of next.fresh) {
      let v = e.vec
      if (v.length !== dims) {
        v = new Float32Array(dims)
        v.set(e.vec.subarray(0, dims))
      }
      vectors.write(new Uint8Array(v.buffer, v.byteOffset, rowBytes))
      const bytes = Buffer.from(e.text, 'utf8')
      rows.push(pathIndex(e.file), e.page ?? 0, texts.pos, bytes.length)
      texts.write(bytes)
    }
  } finally {
    vectors.close()
    texts.close()
  }
  const m: IndexMeta = { model: next.model, dims, gen, files: next.files, paths, rows: Int32Array.from(rows) }
  writeMeta(dir, m)
  return m
}

/** Efface les fichiers des autres générations (et ceux de l'ancien format). */
export function removeOtherGenerations(dir: string, gen: number): void {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return
  }
  for (const name of names) {
    const m = /^(?:vectors|texts)\.(\d+)\.bin$/.exec(name)
    if ((m && Number(m[1]) !== gen) || name === 'vectors.bin') {
      try {
        rmSync(join(dir, name), { force: true })
      } catch {
        // encore ouvert (antivirus…) : effacé à un prochain enregistrement
      }
    }
  }
}

export interface ScoredRow {
  row: number
  score: number
}

/**
 * Lit les vecteurs par tranches de 8 Mo et garde les passages dont la similarité
 * avec `q` atteint `min`. `skip(row)` écarte un passage (dossier non demandé…).
 */
export async function scanVectors(dir: string, m: IndexMeta, q: Float32Array, skip: (row: number) => boolean, min: number): Promise<ScoredRow[]> {
  const n = rowCount(m)
  const out: ScoredRow[] = []
  if (!n) return out
  const { dims } = m
  const rowBytes = dims * 4
  const per = Math.max(1, Math.floor(CHUNK / rowBytes))
  const ab = new ArrayBuffer(per * rowBytes)
  const bytes = new Uint8Array(ab)
  const f = new Float32Array(ab)
  const len = Math.min(q.length, dims)
  const fh = await open(vectorsFile(dir, m.gen), 'r')
  try {
    for (let start = 0; start < n; start += per) {
      const count = Math.min(per, n - start)
      const want = count * rowBytes
      let got = 0
      while (got < want) {
        const { bytesRead } = await fh.read(bytes, got, want - got, start * rowBytes + got)
        if (bytesRead <= 0) throw new Error('Index de recherche incomplet.')
        got += bytesRead
      }
      for (let r = 0; r < count; r++) {
        if (skip(start + r)) continue
        const base = r * dims
        let s = 0
        for (let d = 0; d < len; d++) s += q[d] * f[base + d]
        if (s >= min) out.push({ row: start + r, score: s })
      }
    }
  } finally {
    await fh.close()
  }
  return out
}

/** Texte de quelques passages, lu à sa place dans texts.<gen>.bin. */
export async function readTexts(dir: string, m: IndexMeta, rows: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  if (!rows.length) return out
  const fh = await open(textsFile(dir, m.gen), 'r')
  try {
    for (const row of rows) {
      const b = Buffer.alloc(m.rows[row * ROW + 3])
      await fh.read(b, 0, b.length, m.rows[row * ROW + 2])
      out.set(row, b.toString('utf8'))
    }
  } finally {
    await fh.close()
  }
  return out
}
