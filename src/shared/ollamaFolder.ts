// Dossier des modèles d'Ollama : celui qui est réglé, celui que le serveur en
// marche utilise, et quand il faut redémarrer Ollama. Fonctions pures, testées
// dans tests/ollamaFolder.test.ts.

export interface OllamaFolder {
  /** Dossier réglé (là où les modèles se téléchargent). */
  dir: string
  /** D'où vient le réglage : application Ollama (Settings › Model location), variable OLLAMA_MODELS, ou dossier par défaut. */
  source: 'app' | 'env' | 'default'
  exists: boolean
  /** Taille des modèles du dossier (Go). */
  sizeGb: number
  /** Place libre sur ce disque (Go). */
  freeGb?: number
  /** Modèles que voit Ollama (sans les variantes « -compi » créées par Compi). */
  models: number
  /** Dossier du serveur en marche, quand il diffère du dossier réglé. */
  runningDir?: string
  /** Le serveur en marche ne voit pas les modèles du dossier réglé : il faut redémarrer Ollama. */
  restartNeeded: boolean
}

/**
 * Dossier utilisé par le dernier serveur démarré, lu dans le journal d'Ollama
 * (`server config env="map[… OLLAMA_MODELS:C:\\Users\\…\\models …]"`).
 * Le chemin peut contenir des espaces : il s'arrête à la variable suivante.
 */
export function lastServerModelsDir(log: string): string | null {
  const lines = log.split(/\r?\n/).filter((l) => l.includes('server config'))
  const last = lines.at(-1)
  if (!last) return null
  const m = /OLLAMA_MODELS:(.*?)(?= [A-Z][A-Z0-9_]*:|\]")/.exec(last)
  const dir = m?.[1].trim().replace(/\\\\/g, '\\')
  return dir || null
}

/** Même dossier, à la casse, aux séparateurs et à la barre finale près. */
export function sameDir(a: string, b: string): boolean {
  const norm = (p: string): string => p.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/** Ordre suivi par Ollama : réglage de l'application, puis variable de l'utilisateur, puis du système, puis le dossier par défaut. */
export function pickModelsDir(o: { appSetting?: string; envUser?: string; envMachine?: string; home: string }): {
  dir: string
  source: OllamaFolder['source']
} {
  if (o.appSetting?.trim()) return { dir: o.appSetting.trim(), source: 'app' }
  const env = o.envUser?.trim() || o.envMachine?.trim()
  if (env) return { dir: env, source: 'env' }
  return { dir: `${o.home.replace(/[\\/]+$/, '')}\\.ollama\\models`, source: 'default' }
}

/**
 * Ollama tourne mais ne voit aucun modèle alors que le dossier réglé en contient :
 * le serveur a été lancé avant un changement de dossier (ou d'ailleurs).
 */
export function needsRestart(o: { running: boolean; apiModels: number; folderSizeGb: number; runningDir?: string | null; dir: string }): boolean {
  if (!o.running || o.apiModels > 0 || o.folderSizeGb < 0.1) return false
  return o.runningDir ? !sameDir(o.runningDir, o.dir) : true
}

/** Valeur d'une variable lue avec `reg query` (REG_SZ ou REG_EXPAND_SZ). */
export function parseRegValue(out: string, name: string): string | undefined {
  const m = new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'mi').exec(out)
  return m?.[1].trim() || undefined
}
