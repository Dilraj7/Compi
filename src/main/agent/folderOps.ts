// Opérations de rangement dans les dossiers confiés : inventaire, création de
// dossiers, déplacements et annulation. Jamais de suppression ni d'écrasement,
// jamais hors des dossiers confiés (chemins réels, liens compris), jamais vers un
// autre disque. Les accords (cartes) sont demandés avant, par canUseTool.

import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path'
import { classify, folderNameProblem, freeName, isSystemName, type InventoryItem } from '../../shared/folderPlan'
import { isInside } from './docSearch'

export interface FolderScope {
  /** Dossiers confiés. */
  roots: string[]
  /** Bureau public de Windows (raccourcis partagés, non déplaçables). */
  publicDesktop?: string
  /** Cible d'un raccourci .lnk (shell.readShortcutLink sous Windows). */
  readShortcut?: (path: string) => string | undefined
}

/** Chemin réel (liens résolus), même s'il n'existe pas encore : on résout le parent le plus proche qui existe. */
async function realOrPlanned(path: string): Promise<string> {
  const abs = resolve(path)
  let base = abs
  const rest: string[] = []
  while (!existsSync(base)) {
    const up = dirname(base)
    if (up === base) return abs
    rest.unshift(basename(base))
    base = up
  }
  return join(await realpath(base), ...rest)
}

async function realRoots(roots: string[]): Promise<string[]> {
  return Promise.all(roots.map((r) => realOrPlanned(r).catch(() => resolve(r))))
}

/** Le chemin (réel) est dans un dossier confié ; renvoie ce chemin réel, sinon null. */
export async function insideScope(path: string, scope: FolderScope): Promise<string | null> {
  if (!path || !isAbsolute(path) || /^\\\\|^\/\//.test(path)) return null
  const real = await realOrPlanned(path)
  const roots = await realRoots(scope.roots)
  return roots.some((r) => isInside(real, r)) ? real : null
}

const sameVolume = (a: string, b: string): boolean => parse(a).root.toLowerCase() === parse(b).root.toLowerCase()

async function listDir(dir: string, scope: FolderScope, shared = false): Promise<InventoryItem[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const items: InventoryItem[] = []
  for (const e of entries) {
    const path = join(dir, e.name)
    const { kind, ext, flags } = classify(e.name, e.isDirectory())
    let size: number | undefined
    let modified: number | undefined
    try {
      const st = await lstat(path)
      size = st.isFile() ? st.size : undefined
      modified = st.mtimeMs
    } catch {
      // élément illisible (droits) : on le liste quand même
    }
    let target: string | undefined
    if (kind === 'shortcut') {
      target = scope.readShortcut?.(path)
      if (target && !existsSync(target)) flags.push('broken')
    } else if (kind === 'weblink') {
      const url = /^URL=(.+)$/im.exec(await readFile(path, 'utf8').catch(() => ''))?.[1]?.trim()
      try {
        target = url ? new URL(url).hostname || url : undefined
      } catch {
        target = url
      }
    }
    if (shared) flags.push('shared')
    items.push({ name: e.name, path, kind, ext, size, modified, target, flags })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, 'fr'))
}

/** Éléments d'un dossier confié ; pour le Bureau, aussi les raccourcis du Bureau public. */
export async function inventory(dir: string, scope: FolderScope, opts: { withPublic?: boolean } = {}): Promise<InventoryItem[]> {
  const real = await insideScope(dir, scope)
  if (!real) throw new Error(`${dir} n'est pas dans un dossier que l'utilisateur t'a confié.`)
  const items = await listDir(real, scope)
  if (opts.withPublic && scope.publicDesktop && existsSync(scope.publicDesktop)) {
    items.push(...(await listDir(scope.publicDesktop, scope, true).catch(() => [])))
  }
  return items
}

export interface CreateReport {
  created: string[]
  existing: string[]
  refused: Array<{ name: string; why: string }>
}

/** Crée des dossiers dans un dossier confié (un nom déjà pris est signalé, rien n'est remplacé). */
export async function createFolders(parent: string, names: string[], scope: FolderScope): Promise<CreateReport> {
  const real = await insideScope(parent, scope)
  if (!real || !existsSync(real)) throw new Error(`${parent} n'est pas un dossier confié existant.`)
  const report: CreateReport = { created: [], existing: [], refused: [] }
  for (const raw of names) {
    const name = raw.trim()
    const problem = folderNameProblem(raw)
    if (problem) {
      report.refused.push({ name: raw, why: problem })
      continue
    }
    const path = join(real, name)
    if (existsSync(path)) report.existing.push(name)
    else {
      await mkdir(path)
      report.created.push(name)
    }
  }
  return report
}

export interface MoveRequest {
  from: string
  /** Dossier de destination (absolu, ou relatif au dossier de l'élément). */
  to: string
}

export interface MoveReport {
  /** Identifiant du journal d'annulation (absent si rien n'a bougé). */
  id?: string
  moved: Array<{ from: string; to: string }>
  refused: Array<{ from: string; why: string }>
}

interface Journal {
  id: string
  at: number
  moves: Array<{ from: string; to: string }>
}

const MAX_MOVES = 200
const KEEP_JOURNALS = 20

function lockedReason(e: unknown): string {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return 'fichier ouvert ou protégé : ferme-le puis réessaie'
  if (code === 'EXDEV') return 'autre disque : déplacement refusé (il faudrait copier puis supprimer)'
  return (e as Error).message
}

/** Vérifie un déplacement sans rien toucher : la raison du refus, ou les chemins réels à utiliser. */
async function moveProblem(m: MoveRequest, scope: FolderScope): Promise<{ why: string } | { src: string; dest: string; isDir: boolean }> {
  if (!m.from || !isAbsolute(m.from)) return { why: 'chemin d’origine absolu attendu' }
  if (!existsSync(m.from)) return { why: 'introuvable (déjà déplacé ?)' }
  if (isSystemName(basename(m.from))) return { why: 'fichier système : laissé en place' }
  if (scope.publicDesktop && isInside(m.from, scope.publicDesktop)) return { why: 'raccourci partagé par Windows : il faut des droits d’administrateur' }
  // Lien symbolique ou jonction : on déplacerait sa cible, pas le lien.
  if ((await lstat(m.from)).isSymbolicLink()) return { why: 'lien vers un autre dossier : laissé en place' }
  const src = await insideScope(m.from, scope)
  if (!src) return { why: 'hors des dossiers confiés' }
  const roots = await realRoots(scope.roots)
  if (roots.some((r) => resolve(r).toLowerCase() === src.toLowerCase())) return { why: 'c’est un dossier confié lui-même' }
  const destDir = await insideScope(isAbsolute(m.to) ? m.to : join(dirname(m.from), m.to), scope)
  if (!destDir) return { why: 'destination hors des dossiers confiés' }
  if (existsSync(destDir) && !(await lstat(destDir)).isDirectory()) return { why: 'la destination est un fichier, pas un dossier' }
  const isDir = (await lstat(src)).isDirectory()
  if (isDir && isInside(destDir, src)) return { why: 'un dossier ne peut pas aller dans lui-même' }
  if (resolve(dirname(src)).toLowerCase() === resolve(destDir).toLowerCase()) return { why: 'déjà dans ce dossier' }
  if (!sameVolume(src, destDir)) return { why: 'autre disque : déplacement refusé (il faudrait copier puis supprimer)' }
  return { src, dest: destDir, isDir }
}

/**
 * Déplace les éléments (200 au plus), crée les dossiers de destination manquants,
 * renomme en « (2) » au lieu d'écraser, et garde un journal pour annuler.
 */
export async function moveItems(moves: MoveRequest[], scope: FolderScope, journalDir: string): Promise<MoveReport> {
  const report: MoveReport = { moved: [], refused: [] }
  for (const m of moves.slice(MAX_MOVES)) report.refused.push({ from: m.from, why: `plus de ${MAX_MOVES} déplacements d’un coup : refais une demande` })
  for (const m of moves.slice(0, MAX_MOVES)) {
    const check = await moveProblem(m, scope).catch((e: Error) => ({ why: e.message }))
    if ('why' in check) {
      report.refused.push({ from: m.from, why: check.why })
      continue
    }
    try {
      await mkdir(check.dest, { recursive: true })
      const name = freeName(basename(check.src), (n) => existsSync(join(check.dest, n)), check.isDir)
      const to = join(check.dest, name)
      await rename(check.src, to)
      report.moved.push({ from: check.src, to })
    } catch (e) {
      report.refused.push({ from: m.from, why: lockedReason(e) })
    }
  }
  if (report.moved.length) {
    await mkdir(journalDir, { recursive: true })
    // Création exclusive : deux rangements dans la même milliseconde n'écrivent pas le même journal.
    for (let n = Date.now(); !report.id; n++) {
      if (existsSync(join(journalDir, `${n}.undone.json`))) continue
      const journal: Journal = { id: String(n), at: Date.now(), moves: report.moved }
      try {
        await writeFile(join(journalDir, `${n}.json`), JSON.stringify(journal, null, 1), { flag: 'wx' })
        report.id = journal.id
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
    await pruneJournals(journalDir)
  }
  return report
}

async function pruneJournals(journalDir: string): Promise<void> {
  const files = (await readdir(journalDir)).filter((f) => /^\d+(\.undone)?\.json$/.test(f)).sort()
  for (const f of files.slice(0, Math.max(0, files.length - KEEP_JOURNALS))) await rm(join(journalDir, f), { force: true })
}

export interface UndoReport {
  id?: string
  restored: Array<{ from: string; to: string }>
  skipped: Array<{ path: string; why: string }>
}

/** Remet en place le dernier rangement (ou celui indiqué), sans jamais écraser. */
export async function undoMoves(id: string | undefined, scope: FolderScope, journalDir: string): Promise<UndoReport> {
  const files = existsSync(journalDir) ? (await readdir(journalDir)).filter((f) => /^\d+\.json$/.test(f)).sort() : []
  const file = id ? files.find((f) => f === `${id}.json`) : files.at(-1)
  if (!file) return { restored: [], skipped: [{ path: '', why: id ? `rangement ${id} introuvable ou déjà annulé` : 'aucun rangement à annuler' }] }
  const journal = JSON.parse(await readFile(join(journalDir, file), 'utf8')) as Journal
  const report: UndoReport = { id: journal.id, restored: [], skipped: [] }
  for (const m of [...journal.moves].reverse()) {
    if (!existsSync(m.to)) {
      report.skipped.push({ path: m.to, why: 'n’est plus là' })
      continue
    }
    if (existsSync(m.from)) {
      report.skipped.push({ path: m.from, why: 'un autre élément porte déjà ce nom' })
      continue
    }
    if (!(await insideScope(m.from, scope)) || !(await insideScope(m.to, scope))) {
      report.skipped.push({ path: m.to, why: 'hors des dossiers confiés' })
      continue
    }
    try {
      await mkdir(dirname(m.from), { recursive: true })
      await rename(m.to, m.from)
      report.restored.push({ from: m.to, to: m.from })
    } catch (e) {
      report.skipped.push({ path: m.to, why: lockedReason(e) })
    }
  }
  await rename(join(journalDir, file), join(journalDir, `${journal.id}.undone.json`))
  return report
}
