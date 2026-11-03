// Écriture des fichiers texte (.md, .txt) dans les dossiers confiés : chemin vérifié (liens
// compris), contenu prévu, aperçu des changements pour la carte, et copie de l'ancienne
// version pour annuler. Les accords (cartes) sont demandés avant, par canUseTool. Sans
// Electron : testé dans tests/textEdits.test.ts.

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { insideScope } from './folderOps'

/** Fichiers que Compi peut écrire : du texte, jamais un programme ni un script. */
export const TEXT_EXTENSIONS = ['.md', '.markdown', '.txt']
/** Taille maximale d'un fichier écrit (avant comme après). */
export const MAX_TEXT_BYTES = 1_000_000
/** Modifications gardées pour annuler (les plus anciennes sont oubliées). */
export const KEEP_EDITS = 30

export type WriteMode = 'replace' | 'append'

export interface TextEditPlan {
  /** Chemin réel du fichier (liens résolus). */
  path: string
  existed: boolean
  before: string
  after: string
  mode: WriteMode
  /** Le fichier commençait par une marque UTF-8 (BOM) : elle est gardée. */
  bom: boolean
}

export interface TextEdit {
  id: string
  path: string
  at: number
  existed: boolean
  /** Empreinte de ce que Compi a écrit : l'annulation n'écrase pas un fichier modifié depuis. */
  afterHash: string
  undone?: boolean
}

const BOM = Buffer.from([0xef, 0xbb, 0xbf])
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')
const encode = (text: string, bom: boolean): Buffer => (bom ? Buffer.concat([BOM, Buffer.from(text, 'utf8')]) : Buffer.from(text, 'utf8'))

/** Chemin réel d'un fichier texte qu'on peut écrire, ou la raison du refus (phrase pour le modèle). */
export async function writableTextPath(path: string, roots: string[]): Promise<{ path: string } | { error: string }> {
  const p = path.trim()
  if (!TEXT_EXTENSIONS.includes(extname(p).toLowerCase()))
    return { error: `Seuls les fichiers texte (${TEXT_EXTENSIONS.join(', ')}) peuvent être écrits : pas les documents Word, Excel, PDF, ni les programmes.` }
  if (!roots.length) return { error: "L'utilisateur ne t'a confié aucun dossier. Il peut en ajouter dans Extensions › Dossiers." }
  const real = await insideScope(p, { roots })
  if (!real) return { error: `${p} n'est pas dans un dossier que l'utilisateur t'a confié. Il peut ajouter ce dossier dans Extensions › Dossiers.` }
  if (
    resolve(real)
      .split(/[\\/]/)
      .some((s) => s.startsWith('.') && s.length > 1)
  )
    return { error: 'Les dossiers et fichiers cachés (nom commençant par un point) ne sont pas modifiables par Compi.' }
  if (!existsSync(dirname(real))) return { error: `Le dossier ${dirname(p)} n'existe pas.` }
  if (existsSync(real)) {
    const st = await lstat(real)
    if (st.isSymbolicLink() || !st.isFile()) return { error: `${p} n'est pas un fichier.` }
    if (st.size > MAX_TEXT_BYTES) return { error: `${basename(p)} est trop gros pour être modifié par Compi (1 Mo au plus).` }
  }
  return { path: real }
}

/**
 * Ce que le fichier contiendra après l'écriture : tout le texte donné (replace) ou ajouté à la
 * fin (append), avec les fins de ligne du fichier existant (Windows ou non) et sa marque UTF-8.
 */
export async function planTextEdit(path: string, content: string, mode: WriteMode, roots: string[]): Promise<TextEditPlan | { error: string }> {
  const target = await writableTextPath(path, roots)
  if ('error' in target) return target
  const existed = existsSync(target.path)
  let before = ''
  let bom = false
  if (existed) {
    const raw = await readFile(target.path)
    bom = raw.subarray(0, 3).equals(BOM)
    if (raw.includes(0)) return { error: `${basename(path)} n'est pas un fichier texte.` }
    before = raw.subarray(bom ? 3 : 0).toString('utf8')
  }
  const eol = before.includes('\r\n') ? '\r\n' : '\n'
  const text = content.replace(/\r\n/g, '\n').replace(/\n/g, eol)
  const after = mode === 'append' ? `${before}${before && !before.endsWith(eol) ? eol : ''}${text}` : text
  if (encode(after, bom).length > MAX_TEXT_BYTES) return { error: 'Le texte est trop long (1 Mo au plus).' }
  return { path: target.path, existed, before, after, mode, bom }
}

const cut = (line: string): string => (line.length > 120 ? `${line.slice(0, 119)}…` : line)

type DiffLine = { op: ' ' | '-' | '+'; text: string }

/** Au-delà (lignes avant × lignes après), on compare seulement entre le début et la fin communs. */
const DIFF_CELLS = 4_000_000

/** Lignes gardées, retirées et ajoutées (plus longue suite commune), dans l'ordre du fichier. */
export function lineDiff(a: string[], b: string[]): DiffLine[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const x = a.slice(start, a.length - end)
  const y = b.slice(start, b.length - end)
  const middle: DiffLine[] = []
  if (x.length * y.length > DIFF_CELLS) {
    middle.push(...x.map((text) => ({ op: '-' as const, text })), ...y.map((text) => ({ op: '+' as const, text })))
  } else {
    // lcs[i][j] : longueur de la plus longue suite commune de x[i..] et y[j..].
    const w = y.length + 1
    const lcs = new Uint32Array((x.length + 1) * w)
    for (let i = x.length - 1; i >= 0; i--)
      for (let j = y.length - 1; j >= 0; j--) lcs[i * w + j] = x[i] === y[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    let i = 0
    let j = 0
    while (i < x.length || j < y.length) {
      if (i < x.length && j < y.length && x[i] === y[j]) {
        middle.push({ op: ' ', text: x[i++] })
        j++
      } else if (i < x.length && (j === y.length || lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) middle.push({ op: '-', text: x[i++] })
      else middle.push({ op: '+', text: y[j++] })
    }
  }
  return [...a.slice(0, start).map((text) => ({ op: ' ' as const, text })), ...middle, ...b.slice(b.length - end).map((text) => ({ op: ' ' as const, text }))]
}

/**
 * Détail de la carte : le fichier, ce qui change (nouveau, remplacé, ajouté), puis seulement
 * les lignes retirées (-) et ajoutées (+), chacune avec la ligne qui la précède pour la situer.
 */
export function describeTextEdit(plan: TextEditPlan, maxLines = 16): string {
  const a = plan.before ? plan.before.split(/\r?\n/) : []
  const b = plan.after.split(/\r?\n/)
  const diff = lineDiff(a, b)
  const changed = diff.filter((d) => d.op !== ' ')
  const added = changed.filter((d) => d.op === '+').length
  const what = !plan.existed
    ? `Nouveau fichier · ${b.length} ligne(s)`
    : plan.mode === 'append'
      ? `Ajout à la fin · ${added} ligne(s)`
      : `Contenu remplacé · ${a.length} → ${b.length} ligne(s)`
  if (!changed.length) return `${plan.path}\n${what}\nAucun changement.`
  const lines: string[] = []
  let shown = 0
  let last = -1
  diff.forEach((d, k) => {
    if (d.op === ' ' || shown >= maxLines) return
    // La ligne inchangée juste avant situe le changement ; « … » quand des lignes sont sautées.
    const context = k - 1
    if (context > last && diff[context]?.op === ' ') {
      if (context > last + 1 && (lines.length || context > 0)) lines.push('  …')
      lines.push(`  ${cut(diff[context].text)}`)
    } else if (k > last + 1 && lines.length) lines.push('  …')
    lines.push(`${d.op} ${cut(d.text)}`)
    last = k
    shown++
  })
  if (changed.length > shown) lines.push(`  … ${changed.length - shown} autre(s) ligne(s) changée(s)`)
  return `${plan.path}\n${what}\n\n${lines.join('\n')}`
}

const journalFile = (dir: string): string => join(dir, 'journal.json')
const backupFile = (dir: string, id: string): string => join(dir, `${id}.bak`)

async function readJournal(dir: string): Promise<TextEdit[]> {
  try {
    const list = JSON.parse(await readFile(journalFile(dir), 'utf8')) as unknown
    return Array.isArray(list) ? (list as TextEdit[]).filter((e) => typeof e?.id === 'string' && typeof e.path === 'string') : []
  } catch {
    return []
  }
}

// Une écriture ou une annulation à la fois : le journal ne se mélange jamais.
let queue: Promise<unknown> = Promise.resolve()
const serial = <T>(job: () => Promise<T>): Promise<T> => {
  const run = queue.then(job, job)
  queue = run.catch(() => undefined)
  return run
}

/** Écrit le fichier prévu, après avoir gardé l'ancienne version dans `dir` (journal des modifications). */
export function applyTextEdit(plan: TextEditPlan, dir: string): Promise<TextEdit> {
  return serial(async () => {
    await mkdir(dir, { recursive: true })
    const journal = await readJournal(dir)
    const id = `e${journal.reduce((n, e) => Math.max(n, Number(e.id.slice(1)) || 0), 0) + 1}`
    if (plan.existed) await writeFile(backupFile(dir, id), encode(plan.before, plan.bom))
    const bytes = encode(plan.after, plan.bom)
    await writeFile(plan.path, bytes)
    const edit: TextEdit = { id, path: plan.path, at: Date.now(), existed: plan.existed, afterHash: sha(bytes) }
    const kept = [...journal, edit].slice(-KEEP_EDITS)
    for (const old of journal.filter((e) => !kept.includes(e))) await rm(backupFile(dir, old.id), { force: true })
    await writeFile(journalFile(dir), JSON.stringify(kept, null, 2))
    return edit
  })
}

/**
 * Annule une modification (la dernière par défaut, ou celle d'un numéro ou d'un fichier) :
 * l'ancienne version revient, ou le fichier créé part à la corbeille (`trash`). Refusé si le
 * fichier a changé depuis : on n'écrase jamais un changement fait ensuite.
 */
export function undoTextEdit(
  dir: string,
  which: { id?: string; path?: string },
  trash: (path: string) => Promise<void>
): Promise<{ path: string } | { error: string }> {
  return serial(async () => {
    const journal = await readJournal(dir)
    // Le journal garde le vrai chemin : « RUNNER~1 », une autre casse ou un lien mènent au même fichier.
    const wanted = which.path ? await realpath(which.path).catch(() => resolve(which.path!)) : ''
    const same = (p: string): boolean => resolve(p).toLowerCase() === resolve(wanted).toLowerCase()
    const edit = which.id ? journal.find((e) => e.id === which.id) : [...journal].reverse().find((e) => !e.undone && (which.path ? same(e.path) : true))
    if (!edit) return { error: 'Aucune modification de fichier à annuler.' }
    if (edit.undone) return { error: 'Cette modification a déjà été annulée.' }
    let current: Buffer
    try {
      current = await readFile(edit.path)
    } catch {
      return { error: `${basename(edit.path)} est introuvable : rien n'a été annulé.` }
    }
    if (sha(current) !== edit.afterHash)
      return { error: `${basename(edit.path)} a changé depuis la modification de Compi : rien n'a été annulé, pour ne pas perdre ces changements.` }
    if (edit.existed) await writeFile(edit.path, await readFile(backupFile(dir, edit.id)))
    else await trash(edit.path)
    edit.undone = true
    await writeFile(journalFile(dir), JSON.stringify(journal, null, 2))
    return { path: edit.path }
  })
}
