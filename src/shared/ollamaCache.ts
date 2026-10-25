// Cache des conversations d'Ollama : son serveur (llama-server) garde en mémoire du PC les
// dernières discussions pour répondre plus vite à la suivante, jusqu'à 8 Go par défaut, sans
// que `/api/ps` le montre. Taille lue dans son journal, limite réglée par la variable
// LLAMA_ARG_CACHE_RAM. Fonctions pures, testées dans tests/ollamaCache.test.ts.

export const CACHE_ENV = 'LLAMA_ARG_CACHE_RAM'
/** Limite d'Ollama quand rien n'est réglé (llama-server --cache-ram). */
export const DEFAULT_CACHE_MB = 8192
/** Limite proposée par Compi : garde une ou deux discussions récentes, rend le reste. */
export const SUGGESTED_CACHE_MB = 2048

export interface OllamaCacheLog {
  /** Discussions gardées par le serveur en marche. */
  prompts: number
  /** Leur taille (Mo). */
  usedMb: number
  /** Limite du serveur en marche (Mo), si le journal la donne. */
  limitMb?: number
}

export interface OllamaCache extends OllamaCacheLog {
  /** Limite réglée pour les prochains démarrages d'Ollama (Mo) ; absente : défaut d'Ollama. */
  configuredMb?: number
  /** Compi peut régler la limite : Ollama installé sur ce PC, sous Windows. */
  canSet: boolean
}

const RUNNER = /llama-server(?:\.exe)?\S*\s+--model\b/
const SIZE_LIMIT = /prompt cache is enabled, size limit: (\d+) MiB/
const STATE = /cache state: (\d+) prompts, ([\d.]+) MiB \(limits: ([\d.]+) MiB/

/**
 * État du cache d'après la fin du journal d'Ollama (`server.log`). Le journal mêle le serveur
 * de discussion et celui des vecteurs (`--embedding`) : un nouveau serveur de discussion remet
 * le compte à zéro ; les états à 0 discussion sont ignorés, car un cache ne se vide qu'au
 * redémarrage de son serveur. Null si le journal n'en dit rien (moteur sans ce cache).
 */
export function parseCacheLog(text: string): OllamaCacheLog | null {
  let state: OllamaCacheLog | null = null
  for (const line of text.split(/\r?\n/)) {
    if (RUNNER.test(line) && !line.includes('--embedding')) {
      state = { prompts: 0, usedMb: 0 }
      continue
    }
    const limit = SIZE_LIMIT.exec(line)
    if (limit) {
      if (!state) state = { prompts: 0, usedMb: 0 }
      state.limitMb ??= Number(limit[1])
      continue
    }
    const m = STATE.exec(line)
    if (!m) continue
    const prompts = Number(m[1])
    if (prompts > 0) state = { prompts, usedMb: Number(m[2]), limitMb: Math.round(Number(m[3])) }
    else if (!state) state = { prompts: 0, usedMb: 0, limitMb: Math.round(Number(m[3])) }
  }
  return state
}

/** Valeur de LLAMA_ARG_CACHE_RAM en Mo (-1 : sans limite, 0 : cache coupé) ; absente ou illisible : undefined. */
export function parseCacheEnv(v: string | undefined | null): number | undefined {
  const t = v?.trim()
  if (!t || !/^-?\d+$/.test(t)) return undefined
  const n = Number(t)
  return n >= -1 ? n : undefined
}

/**
 * Ce que Compi propose : limiter (rien de réglé, ou plus que la limite proposée), rétablir le
 * défaut (la limite proposée est réglée), et s'il faut redémarrer Ollama pour l'appliquer.
 * Une valeur choisie par l'utilisateur hors de ces cas (1 Go, cache coupé…) est respectée.
 */
export function cacheChoice(c: Pick<OllamaCache, 'configuredMb' | 'limitMb' | 'canSet'>): { suggest: 'limit' | 'restore' | null; restartPending: boolean } {
  if (!c.canSet) return { suggest: null, restartPending: false }
  const conf = c.configuredMb
  const suggest = conf === undefined || conf === -1 || conf > SUGGESTED_CACHE_MB ? 'limit' : conf === SUGGESTED_CACHE_MB ? 'restore' : null
  const wanted = conf === undefined ? DEFAULT_CACHE_MB : conf
  const restartPending = c.limitMb !== undefined && wanted > 0 && c.limitMb !== wanted
  return { suggest, restartPending }
}
