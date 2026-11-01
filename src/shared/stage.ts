// La scène du plein écran : un détail court de chaque étape, tiré de ce que l'outil a
// renvoyé (et, pour un fichier, de la carte d'accord). Jamais plus que ce que la carte
// ou le résultat montrent déjà ; borné pour rester court dans l'historique.

export type StageDetail =
  /** Fichier texte écrit : chemin, résumé et lignes changées (« + », « - », contexte). */
  | { kind: 'file'; path: string; summary: string; diff: string[] }
  /** Rangement : éléments déplacés (les premiers), nombre total et refusés. */
  | { kind: 'moves'; moves: Array<{ from: string; to: string }>; total: number; refused: number }
  | { kind: 'event'; action: 'created' | 'updated' | 'deleted'; text: string }
  | { kind: 'reminder'; text: string; when: string }
  | { kind: 'task'; action: 'created' | 'done' | 'updated'; text: string }
  | { kind: 'timer'; text: string }
  | { kind: 'opened'; what: 'app' | 'page' | 'file' | 'folder' | 'settings'; target: string }
  | { kind: 'sources'; sources: Array<{ title: string; url: string }> }

export const STAGE_MAX_MOVES = 8
export const STAGE_MAX_SOURCES = 5
const MAX_DIFF = 18
const MAX_TEXT = 200

type Input = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const cut = (s: string, n = MAX_TEXT): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** « Rappel programmé : lundi 26 octobre à 18:30. » → « lundi 26 octobre à 18:30 ». */
const afterColon = (s: string): string =>
  cut(
    s
      .slice(s.indexOf(' : ') + 3)
      .trim()
      .replace(/\.$/, '')
  )
const firstLine = (s: string): string => s.split(/\r?\n/)[0].trim()

/** Le nom de l'outil sans le préfixe du serveur de Compi. */
const baseName = (name: string): string => name.replace(/^mcp__compi__/, '')

const httpUrl = (u: unknown): string | null => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null)

/** Sources d'une recherche web : sortie structurée de Claude Code, liste « Links: [...] », ou liste numérotée de Compi. */
export function sourcesFrom(result: string, structured?: unknown): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = []
  const add = (title: unknown, url: unknown): void => {
    const u = httpUrl(url)
    if (u && !out.some((x) => x.url === u)) out.push({ title: cut(str(title).trim() || u, 140), url: u })
  }
  const results = (structured as { results?: unknown } | undefined)?.results
  if (Array.isArray(results)) {
    for (const r of results)
      if (r && typeof r === 'object' && Array.isArray((r as { content?: unknown }).content))
        for (const c of (r as { content: Array<{ title?: unknown; url?: unknown }> }).content) add(c?.title, c?.url)
  }
  if (!out.length) {
    const links = /Links:\s*(\[[\s\S]*?\])(?:\s*\n|$)/.exec(result)?.[1]
    if (links) {
      try {
        const list = JSON.parse(links) as Array<{ title?: unknown; url?: unknown }>
        if (Array.isArray(list)) for (const l of list) add(l?.title, l?.url)
      } catch {
        // liste illisible : on essaie le format suivant
      }
    }
  }
  if (!out.length) {
    // « 1. Titre\n   https://… » (recherche web de Compi pour les cerveaux locaux).
    for (const m of result.matchAll(/^\s*\d+\.\s+(.+)\n\s+(https?:\/\/\S+)/gm)) add(m[1], m[2])
  }
  return out.slice(0, STAGE_MAX_SOURCES)
}

/** Carte d'accord d'une écriture (describeTextEdit) : chemin, résumé, puis les lignes changées. */
function fileFrom(input: Input, result: string, card?: string): StageDetail | undefined {
  if (card) {
    const [path, summary, ...rest] = card.split(/\r?\n/)
    // « + ajouté », « - retiré », « ··contexte » et « ··… » ; « Aucun changement. » n'en a pas.
    const diff = rest.filter((l) => /^[+\- ] /.test(l))
    return { kind: 'file', path: path ?? str(input.path), summary: summary ?? '', diff: diff.slice(0, MAX_DIFF) }
  }
  // Sans carte (rien à montrer) : le résultat suffit.
  const lines = /\((\d+) ligne\(s\)/.exec(result)?.[1]
  const how = /^Fichier créé/.test(result) ? 'Nouveau fichier' : /^Texte ajouté/.test(result) ? 'Ajout à la fin' : 'Contenu remplacé'
  return { kind: 'file', path: str(input.path), summary: lines ? `${how} · ${lines} ligne(s)` : how, diff: [] }
}

/** Résultat de move_items : « Déplacés (n) : - de → vers », puis « Non déplacés (k) ». */
function movesFrom(result: string): StageDetail | undefined {
  const total = Number(/Déplacés \((\d+)\)/.exec(result)?.[1] ?? 0)
  const refused = Number(/Non déplacés \((\d+)\)/.exec(result)?.[1] ?? 0)
  if (!total && !refused) return undefined
  const block = result.split(/\n\s*\n/).find((b) => b.startsWith('Déplacés')) ?? ''
  const moves = block
    .split(/\r?\n/)
    .filter((l) => l.startsWith('- ') && l.includes(' → '))
    .slice(0, STAGE_MAX_MOVES)
    .map((l) => {
      const [from, to] = l.slice(2).split(' → ')
      return { from: from.trim(), to: (to ?? '').trim() }
    })
  return { kind: 'moves', moves, total, refused }
}

/**
 * Détail d'une étape terminée sans erreur, ou `undefined` quand l'outil n'a pas de carte
 * riche (il garde sa ligne). `card` : détail de la carte d'accord (fichier texte).
 */
export function stageDetail(name: string, input: Input, result: string, opts: { card?: string; structured?: unknown } = {}): StageDetail | undefined {
  const tool = baseName(name)
  const line = firstLine(result)
  switch (tool) {
    case 'write_text_file':
      return /contient déjà exactement/.test(result) ? undefined : fileFrom(input, result, opts.card)
    case 'meeting_save_note':
      return fileFrom({ path: /^Note créée : (.+?) \(«/.exec(line)?.[1] ?? '' }, 'Fichier créé', opts.card)
    case 'move_items':
      return movesFrom(result)
    case 'calendar_create_event':
      return line.startsWith('Ajouté') ? { kind: 'event', action: 'created', text: afterColon(line) } : undefined
    case 'calendar_update_event':
      return line.startsWith('Modifié') ? { kind: 'event', action: 'updated', text: afterColon(line) } : undefined
    case 'calendar_delete_event':
      return line.startsWith('Supprimé') ? { kind: 'event', action: 'deleted', text: afterColon(line) } : undefined
    case 'tasks_create':
      return line.startsWith('Tâche ajoutée') ? { kind: 'task', action: 'created', text: afterColon(line) } : undefined
    case 'tasks_complete':
      return line.startsWith('Tâche terminée') ? { kind: 'task', action: 'done', text: afterColon(line) } : undefined
    case 'tasks_update':
      return line.startsWith('Tâche modifiée') ? { kind: 'task', action: 'updated', text: afterColon(line) } : undefined
    case 'reminder_create':
      return line.startsWith('Rappel programmé') ? { kind: 'reminder', text: cut(str(input.message)), when: afterColon(line) } : undefined
    case 'timer_start':
    case 'pomodoro_start':
      return line ? { kind: 'timer', text: cut(line.replace(/\.$/, '')) } : undefined
    case 'open_url': {
      const url = httpUrl(input.url)
      return url ? { kind: 'opened', what: 'page', target: cut(url) } : undefined
    }
    case 'open_app':
      return line.startsWith('Ouverte') ? { kind: 'opened', what: 'app', target: afterColon(line) } : undefined
    case 'open_path':
      return str(input.path) ? { kind: 'opened', what: 'file', target: cut(str(input.path)) } : undefined
    case 'open_folder':
      return str(input.path) ? { kind: 'opened', what: 'folder', target: cut(str(input.path)) } : undefined
    case 'open_settings':
      return line.startsWith('Paramètres') ? { kind: 'opened', what: 'settings', target: afterColon(line) } : undefined
    case 'WebSearch':
    case 'web_search': {
      const sources = sourcesFrom(result, opts.structured)
      return sources.length ? { kind: 'sources', sources } : undefined
    }
    default:
      return undefined
  }
}
