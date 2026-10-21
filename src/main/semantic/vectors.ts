// Recherche par le sens : découpage des documents en passages et calcul de
// proximité entre vecteurs. Fonctions pures, sans Electron (tests/semantic.test.ts).

/** Un passage d'un document, avec sa page pour un PDF. */
export interface Passage {
  page?: number
  text: string
}

/** Taille visée d'un passage, et recouvrement entre deux morceaux d'un long paragraphe. */
export const PASSAGE_SIZE = 900
const OVERLAP = 150
/** Un très long document : au-delà, la fin n'est pas indexée. */
export const MAX_PASSAGES_PER_FILE = 400

/** Coupe un texte trop long en morceaux qui se recouvrent, de préférence entre deux phrases. */
function splitLong(text: string, size: number): string[] {
  const out: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(text.length, start + size)
    if (end < text.length) {
      const cut = text.lastIndexOf('. ', end)
      if (cut > start + size * 0.5) end = cut + 1
    }
    out.push(text.slice(start, end).trim())
    if (end >= text.length) break
    start = Math.max(end - OVERLAP, start + 1)
  }
  return out.filter(Boolean)
}

/**
 * Découpe un document en passages d'environ 900 caractères, sans couper un
 * paragraphe quand c'est possible. Les repères « --- Page N --- » des PDF
 * donnent la page de chaque passage.
 */
export function chunkText(text: string, size = PASSAGE_SIZE): Passage[] {
  const out: Passage[] = []
  const pages = text.split(/^--- Page (\d+) ---$/m)
  // split avec un groupe : [avant, n1, page1, n2, page2…]
  const parts: Array<{ page?: number; body: string }> = [{ body: pages[0] }]
  for (let i = 1; i < pages.length; i += 2) parts.push({ page: Number(pages[i]), body: pages[i + 1] ?? '' })
  for (const { page, body } of parts) {
    let current = ''
    const flush = (): void => {
      const t = current.replace(/[ \t]+/g, ' ').trim()
      if (t.length >= 20) out.push({ ...(page ? { page } : {}), text: t })
      current = ''
    }
    for (const para of body.split(/\n\s*\n/)) {
      const p = para.trim()
      if (!p) continue
      if (p.length > size) {
        flush()
        for (const piece of splitLong(p, size)) out.push({ ...(page ? { page } : {}), text: piece.replace(/[ \t]+/g, ' ') })
        continue
      }
      if (current && current.length + p.length + 2 > size) flush()
      current = current ? `${current}\n\n${p}` : p
    }
    flush()
    if (out.length >= MAX_PASSAGES_PER_FILE) return out.slice(0, MAX_PASSAGES_PER_FILE)
  }
  return out
}

/** Vecteur raccourci à `dims` composantes puis normalisé (modèles « Matryoshka »). */
export function toUnit(v: number[], dims: number): Float32Array {
  const n = Math.min(dims, v.length)
  const out = new Float32Array(n)
  let norm = 0
  for (let i = 0; i < n; i++) norm += v[i] * v[i]
  const k = norm > 0 ? 1 / Math.sqrt(norm) : 0
  for (let i = 0; i < n; i++) out[i] = v[i] * k
  return out
}

/** Produit scalaire : la similarité cosinus de deux vecteurs normalisés. */
export function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let s = 0
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

export interface Scored<T> {
  item: T
  score: number
}

/** Les `k` meilleurs, au plus `perGroup` par groupe (par fichier), au-dessus de `min`. */
export function topK<T>(items: T[], score: (t: T) => number, k: number, group: (t: T) => string, perGroup = 2, min = 0.3): Scored<T>[] {
  const scored = items.map((item) => ({ item, score: score(item) })).filter((s) => s.score >= min)
  scored.sort((a, b) => b.score - a.score)
  const counts = new Map<string, number>()
  const out: Scored<T>[] = []
  for (const s of scored) {
    const g = group(s.item)
    const c = counts.get(g) ?? 0
    if (c >= perGroup) continue
    counts.set(g, c + 1)
    out.push(s)
    if (out.length >= k) break
  }
  return out
}

/** Sans clavier ni souris depuis ce temps, le PC est « au repos ». */
export const IDLE_SEC = 120
/** Pendant que l'utilisateur travaille : une pause entre deux lots (≈ 20 % de la carte graphique au plus). */
export const GENTLE_PAUSE_MS = 4000

export type IndexPace = 'full' | 'gentle' | 'wait'

/**
 * Rythme de l'indexation de fond : à fond quand le PC est au repos, doucement pendant
 * qu'on travaille, en pause sur batterie. Le 21/10, une première indexation (3 000
 * documents) a occupé Ollama 73 min d'affilée dès l'ouverture de session.
 */
export function indexPace(o: { idleSec: number; onBattery: boolean }): IndexPace {
  if (o.onBattery) return 'wait'
  return o.idleSec >= IDLE_SEC ? 'full' : 'gentle'
}

/** Consignes attendues par chaque famille de modèles pour une question ou un passage. */
export function embedPrefix(model: string, kind: 'query' | 'passage'): string {
  const m = model.toLowerCase()
  if (m.startsWith('qwen3-embedding')) return kind === 'query' ? 'Instruct: Given a search query, retrieve relevant passages from personal documents that answer the query\nQuery:' : ''
  if (m.startsWith('embeddinggemma')) return kind === 'query' ? 'task: search result | query: ' : 'title: none | text: '
  if (m.startsWith('nomic-embed')) return kind === 'query' ? 'search_query: ' : 'search_document: '
  if (m.includes('e5')) return kind === 'query' ? 'query: ' : 'passage: '
  return ''
}
