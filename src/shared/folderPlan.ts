// Ranger un dossier confié (le Bureau…) : nature de chaque élément, plan suggéré,
// noms libres, règles de sécurité. Le plan vient d'ici et non du modèle : un petit
// modèle local inventait des dossiers qui n'existaient pas. Fonctions pures,
// testées dans tests/folderPlan.test.ts.

export type ItemKind = 'folder' | 'file' | 'shortcut' | 'weblink'

/**
 * Remarques sur un élément : `system` (desktop.ini…, jamais déplacé), `vague`
 * (nom peu clair ou par défaut), `no-ext` (sans extension), `duplicate` (« (1) »,
 * « - Copie »), `app` (fichier d'application), `script`, `broken` (raccourci dont la
 * cible n'existe plus), `shared` (Bureau public : droits d'administrateur).
 */
export type ItemFlag = 'system' | 'vague' | 'no-ext' | 'duplicate' | 'app' | 'script' | 'broken' | 'shared'

export interface InventoryItem {
  name: string
  path: string
  kind: ItemKind
  /** Extension en minuscules (« .pdf »), vide pour un dossier ou un fichier sans extension. */
  ext: string
  size?: number
  modified?: number
  /** Cible d'un raccourci, adresse d'un lien web. */
  target?: string
  flags: ItemFlag[]
}

export interface PlannedMove {
  item: InventoryItem
  /** Nom du dossier de destination, dans le dossier rangé. */
  folder: string
}

export interface KeptItem {
  item: InventoryItem
  reason: string
}

export interface FolderPlan {
  moves: PlannedMove[]
  kept: KeptItem[]
}

const IMAGES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif', '.tif', '.tiff', '.svg']
const DOCUMENTS = ['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.md', '.xls', '.xlsx', '.xlsm', '.csv', '.ods', '.ppt', '.pptx', '.odp', '.epub']
const VIDEOS = ['.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv']
const AUDIO = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aac']
const ARCHIVES = ['.zip', '.rar', '.7z', '.tar', '.gz']
const INSTALLERS = ['.msi']
/** Fichiers d'une application ou d'un jeu : les déplacer peut casser le programme. */
const APP_FILES = ['.exe', '.dll', '.pak', '.bundle', '.unity3d', '.dat', '.bin', '.sys', '.cab', '.ini', '.cfg', '.asar']
const SCRIPTS = ['.ahk', '.ah2', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.py', '.sh', '.reg']
/** Ouvrir ces fichiers lance un programme : jamais sans une carte, et jamais « Toujours ». */
const LAUNCHERS = [
  '.exe',
  '.com',
  '.bat',
  '.cmd',
  '.ps1',
  '.psm1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.ahk',
  '.ah2',
  '.msi',
  '.msp',
  '.scr',
  '.pif',
  '.cpl',
  '.jar',
  '.py',
  '.pyw',
  '.reg',
  '.appref-ms',
  '.application'
]
const SYSTEM_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store'])
const DEFAULT_NAMES =
  /^(nouveau (dossier|document)|new (folder|text document)|sans titre|untitled|document ?\d*|image ?\d*|capture( d.?[ée]cran)?|screenshot)\b/i

const extOf = (name: string): string => {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i).toLowerCase() : ''
}

/** Ouvrir ce fichier lance un programme (exécutable, script, installateur…). */
export const isLauncher = (path: string): boolean =>
  LAUNCHERS.includes(
    extOf(
      path
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop() ?? ''
    )
  )

/** Fichier du système ou fichier temporaire d'Office : ni listé en détail, ni déplacé. */
export const isSystemName = (name: string): boolean => SYSTEM_NAMES.has(name.toLowerCase()) || name.startsWith('~$') || name.startsWith('.')

/** Nature et remarques d'un élément d'après son nom. */
export function classify(name: string, isDir: boolean): { kind: ItemKind; ext: string; flags: ItemFlag[] } {
  const flags: ItemFlag[] = []
  if (isSystemName(name)) flags.push('system')
  const ext = isDir ? '' : extOf(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  const kind: ItemKind = isDir ? 'folder' : ext === '.lnk' ? 'shortcut' : ext === '.url' ? 'weblink' : 'file'
  if (kind === 'file' && !ext) flags.push('no-ext')
  if (stem.replace(/[\s_\-.]/g, '').length <= 2 || /^[\d\s_\-.]+$/.test(stem) || DEFAULT_NAMES.test(stem)) flags.push('vague')
  if (/\s\(\d+\)$/.test(stem) || /\s-\s(copie|copy)(\s\(\d+\))?$/i.test(stem)) flags.push('duplicate')
  if (kind === 'file' && APP_FILES.includes(ext)) flags.push('app')
  if (kind === 'file' && SCRIPTS.includes(ext)) flags.push('script')
  return { kind, ext, flags }
}

function familyOf(item: InventoryItem): string | null {
  const e = item.ext
  if (IMAGES.includes(e)) return 'Images'
  if (DOCUMENTS.includes(e)) return 'Documents'
  if (VIDEOS.includes(e)) return 'Vidéos'
  if (AUDIO.includes(e)) return 'Musique'
  if (ARCHIVES.includes(e)) return 'Archives'
  if (INSTALLERS.includes(e)) return 'Installateurs'
  return null
}

/**
 * Plan proposé : les fichiers par famille (Documents, Images…), les noms peu clairs
 * et types inconnus dans « À trier ». Restent en place : dossiers (l'utilisateur
 * décide), raccourcis (son choix), fichiers d'application, scripts, Bureau public,
 * fichiers système.
 */
export function suggestPlan(items: InventoryItem[]): FolderPlan {
  const moves: PlannedMove[] = []
  const kept: KeptItem[] = []
  for (const item of items) {
    const f = item.flags
    if (f.includes('system')) continue
    if (f.includes('shared')) kept.push({ item, reason: 'raccourci partagé par Windows (droits d’administrateur)' })
    else if (item.kind === 'folder') kept.push({ item, reason: 'dossier : l’utilisateur décide où le ranger' })
    else if (item.kind !== 'file') kept.push({ item, reason: f.includes('broken') ? 'raccourci cassé : sa cible n’existe plus' : 'raccourci laissé en place' })
    else if (f.includes('app')) kept.push({ item, reason: 'fichier d’application : le déplacer peut casser le programme' })
    else if (f.includes('script')) kept.push({ item, reason: 'script : il peut servir au démarrage de Windows' })
    else {
      const family = familyOf(item)
      moves.push({ item, folder: family && !f.includes('vague') && !f.includes('no-ext') ? family : 'À trier' })
    }
  }
  return { moves, kept }
}

/** « rapport (2).pdf » si « rapport.pdf » est pris (jamais d'écrasement). */
export function freeName(name: string, taken: (candidate: string) => boolean, isDir = false): string {
  if (!taken(name)) return name
  const ext = isDir ? '' : extOf(name)
  const stem = ext ? name.slice(0, -ext.length) : name
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!taken(candidate)) return candidate
  }
  throw new Error(`Aucun nom libre pour ${name}`)
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/** Nom de dossier acceptable sous Windows, sinon la raison du refus. */
export function folderNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'nom vide'
  if (n.length > 120) return 'nom trop long (120 caractères au plus)'
  if (/[<>:"/\\|?*]/.test(n) || [...n].some((c) => c.charCodeAt(0) < 32)) return 'caractères interdits (< > : " / \\ | ? *)'
  if (/[. ]$/.test(name)) return 'un nom ne peut pas finir par un point ou une espace'
  if (RESERVED.test(n)) return 'nom réservé par Windows'
  if (n === '.' || n === '..') return 'nom invalide'
  return null
}

const FLAG_LABEL: Partial<Record<ItemFlag, string>> = {
  vague: 'nom peu clair',
  'no-ext': 'sans extension',
  duplicate: 'doublon probable',
  app: 'fichier d’application',
  script: 'script',
  broken: 'raccourci cassé'
}

export function sizeLabel(bytes: number): string {
  const f = (v: number): string => v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 })
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 ** 2) return `${f(bytes / 1024)} Ko`
  if (bytes < 1024 ** 3) return `${f(bytes / 1024 ** 2)} Mo`
  return `${f(bytes / 1024 ** 3)} Go`
}

const day = (ms?: number): string => (ms ? new Date(ms).toLocaleDateString('fr-FR') : '')

function line(item: InventoryItem): string {
  const parts = [
    item.kind === 'file' ? (item.ext ? item.ext.slice(1).toUpperCase() : 'fichier') : undefined,
    item.size !== undefined && item.kind === 'file' ? sizeLabel(item.size) : undefined,
    day(item.modified),
    item.target ? `→ ${item.target}` : undefined,
    ...item.flags.map((f) => FLAG_LABEL[f])
  ].filter(Boolean)
  return `- ${item.name}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
}

const LIMIT = 300

/**
 * Texte de l'inventaire pour le modèle : éléments par nature, plan suggéré, puis
 * la marche à suivre (montrer le plan avec ces noms exacts, demander l'accord,
 * appeler move_items). Au-delà de 300 éléments, un résumé par type.
 */
export function formatInventory(root: string, items: InventoryItem[]): string {
  const visible = items.filter((i) => !i.flags.includes('system'))
  const own = visible.filter((i) => !i.flags.includes('shared'))
  const shared = visible.filter((i) => i.flags.includes('shared'))
  const of = (k: ItemKind): InventoryItem[] => own.filter((i) => i.kind === k)
  const folders = of('folder')
  const files = of('file')
  const links = [...of('shortcut'), ...of('weblink')]
  const head = `Inventaire de ${root} : ${folders.length} dossier(s), ${files.length} fichier(s), ${links.length} raccourci(s)${shared.length ? `, plus ${shared.length} raccourci(s) partagé(s) par Windows (non déplaçables)` : ''}.`
  if (!visible.length) return `${head}\nLe dossier est vide.`

  const out = [head]
  let shown = 0
  const section = (title: string, list: InventoryItem[]): void => {
    if (!list.length) return
    out.push('', `${title} (${list.length}) :`)
    for (const i of list) {
      if (shown >= LIMIT) {
        out.push(`- … et ${list.length - list.indexOf(i)} autre(s)`)
        return
      }
      out.push(line(i))
      shown++
    }
  }
  section('Dossiers', folders)
  section('Fichiers', files)
  section('Raccourcis', links)
  if (shared.length) out.push('', `Raccourcis partagés (${shared.length}) : ${shared.map((i) => i.name.replace(/\.(lnk|url)$/i, '')).join(', ')}`)

  const plan = suggestPlan(visible)
  out.push('', 'Plan suggéré (rien n’est fait tant que l’utilisateur n’a pas dit oui) :')
  if (!plan.moves.length) out.push('- Aucun fichier à ranger.')
  const byFolder = new Map<string, string[]>()
  for (const m of plan.moves) byFolder.set(m.folder, [...(byFolder.get(m.folder) ?? []), m.item.name])
  for (const [folder, names] of byFolder) out.push(`- ${folder} ← ${names.join(', ')}`)
  const keptBy = new Map<string, string[]>()
  for (const k of plan.kept) keptBy.set(k.reason, [...(keptBy.get(k.reason) ?? []), k.item.name])
  if (keptBy.size) {
    out.push('Laissés en place :')
    for (const [reason, names] of keptBy)
      out.push(`- ${reason} : ${names.length > 12 ? `${names.slice(0, 12).join(', ')}… (${names.length})` : names.join(', ')}`)
  }
  out.push(
    '',
    `Prochaine étape : montre ce plan à l'utilisateur avec ces noms exacts (n'en invente aucun) et demande son accord. S'il dit oui, appelle move_items avec les déplacements acceptés (dossier de destination : ${root}\\<nom du dossier>). N'annonce rien comme fait avant le résultat de move_items.`
  )
  return out.join('\n')
}

/** Résumé d'un lot de déplacements pour la carte d'accord (« rapport.pdf → Documents »). */
export function movesSummary(moves: Array<{ from: string; to: string }>, max = 25): string {
  const name = (p: string): string =>
    p
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? p
  const lines = moves.slice(0, max).map((m) => `${name(m.from)} → ${name(m.to)}`)
  if (moves.length > max) lines.push(`… et ${moves.length - max} autre(s)`)
  return `${lines.join('\n')}\n\nRien n’est supprimé ni écrasé ; tu pourras annuler.`
}
