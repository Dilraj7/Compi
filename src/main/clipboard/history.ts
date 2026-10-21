// Historique du presse-papier, seulement si l'utilisateur l'active. Il reste sur
// le PC, chiffré par Windows (DPAPI). Jamais gardé :
// - ce qu'une application marque comme à ne pas garder (gestionnaires de mots de
//   passe : formats « ExcludeClipboardContentFromMonitorProcessing » et
//   « CanIncludeInClipboardHistory » = 0, comme pour l'historique de Windows) ;
// - ce qui est copié depuis une application de mots de passe ;
// - ce qui ressemble à un secret (IBAN, carte, mot de passe, clé) ;
// - les copies que Compi fait lui-même (actions rapides).
// Texte seulement, 200 éléments et 30 jours au plus (les épinglés restent).

import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, clipboard, safeStorage } from 'electron'
import { addClip, CLIP_TEXT_MAX, isPasswordLike, PASSWORD_APPS, pruneClips, searchClips } from '../../shared/clipboard'
import { IPC } from '../../shared/ipc'
import type { ClipItem } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { redact } from '../privacy/redact'
import { listWindows } from '../windows/system'

const POLL_MS = 1000
const file = (): string => join(app.getPath('userData'), 'clipboard-history.bin')

let items: ClipItem[] = []
let timer: NodeJS.Timeout | null = null
let lastHash = ''
let pausedUntil = 0
let saveTimer: NodeJS.Timeout | null = null

const hashOf = (t: string): string => createHash('sha256').update(t).digest('base64')

function load(): ClipItem[] {
  try {
    const raw = safeStorage.decryptString(readFileSync(file()))
    const parsed = JSON.parse(raw) as ClipItem[]
    return Array.isArray(parsed) ? pruneClips(parsed.filter((i) => typeof i?.text === 'string' && typeof i.id === 'string')) : []
  } catch {
    return []
  }
}

function persistSoon(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushClipboardHistory, 1500)
}

export function flushClipboardHistory(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  if (!timer && !items.length) return
  try {
    if (!safeStorage.isEncryptionAvailable()) return // jamais en clair sur le disque
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), safeStorage.encryptString(JSON.stringify(items)))
  } catch (e) {
    log('warn', 'historique du presse-papier non enregistré', (e as Error).message)
  }
}

const changed = (): void => {
  emit(IPC.clipChanged, items)
  persistSoon()
}

/** Format Windows « brut » (nom de format enregistré), vu par l'API presse-papier d'Electron. */
const osFormat = (name: string): string => `electron application/osclipboard;format="${name}"`

/**
 * Le contenu actuel a été marqué « à ne pas garder » par l'application qui l'a copié.
 * « CanIncludeInClipboardHistory » vaut 0 chez les gestionnaires de mots de passe :
 * sa simple présence suffit pour ne rien garder (prudence).
 */
async function excludedByOwner(): Promise<boolean> {
  for (const name of ['ExcludeClipboardContentFromMonitorProcessing', 'Clipboard Viewer Ignore', 'CanIncludeInClipboardHistory']) {
    try {
      if (await clipboard.has(osFormat(name))) return true
    } catch {
      // format inconnu : on continue
    }
  }
  return false
}

let polling = false

async function poll(): Promise<void> {
  if (polling) return
  polling = true
  try {
    let text: string
    try {
      text = await clipboard.readText()
    } catch {
      return
    }
    const h = hashOf(text)
    if (h === lastHash) return
    lastHash = h
    if (Date.now() < pausedUntil || !text.trim() || text.length > CLIP_TEXT_MAX) return
    if ((await excludedByOwner()) || isPasswordLike(text) || redact(text).count > 0) return
    await record(text)
  } finally {
    polling = false
  }
}

async function record(text: string): Promise<void> {
  // L'application au premier plan est celle d'où vient la copie.
  const win = await listWindows()
    .then((w) => w[0])
    .catch(() => undefined)
  if (win && (PASSWORD_APPS.test(win.process) || PASSWORD_APPS.test(win.title))) return
  if (!timer) return // désactivé entre-temps
  items = addClip(items, { id: randomUUID(), text, at: Date.now(), ...(win?.process ? { source: win.process } : {}) })
  changed()
}

/** Change à chaque arrêt : un démarrage encore en cours est alors abandonné. */
let generation = 0

export async function startClipboardHistory(): Promise<void> {
  if (timer) return
  const gen = ++generation
  items = load()
  // Ce qui est déjà copié au démarrage ne compte pas : seulement les nouvelles copies.
  lastHash = await clipboard
    .readText()
    .then(hashOf)
    .catch(() => '')
  if (timer || gen !== generation) return
  timer = setInterval(() => void poll(), POLL_MS)
  emit(IPC.clipChanged, items)
}

/** Désactiver, c'est aussi tout effacer. */
export function stopClipboardHistory(): void {
  generation++
  if (timer) clearInterval(timer)
  timer = null
  items = []
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = null
  rmSync(file(), { force: true })
  emit(IPC.clipChanged, items)
}

/** Compi copie lui-même (actions rapides, restauration) : ces copies ne sont pas gardées. */
export function pauseClipboardWatch(ms: number): void {
  pausedUntil = Math.max(pausedUntil, Date.now() + ms)
}

export const listClips = (): ClipItem[] => items
export const findClips = (query?: string, limit?: number): ClipItem[] => searchClips(items, query, limit)

/** Recopie une entrée : elle remonte en tête. */
export async function copyClip(id: string): Promise<boolean> {
  const item = items.find((i) => i.id === id)
  if (!item) return false
  await clipboard.writeText(item.text)
  lastHash = hashOf(item.text)
  items = addClip(items, { ...item, at: Date.now() })
  changed()
  return true
}

export function pinClip(id: string, pinned: boolean): ClipItem[] {
  items = items.map((i) => (i.id === id ? { ...i, pinned: pinned || undefined } : i))
  changed()
  return items
}

export function deleteClip(id: string): ClipItem[] {
  items = items.filter((i) => i.id !== id)
  changed()
  return items
}

export function clearClips(): ClipItem[] {
  items = []
  changed()
  return items
}

export const clipboardHistoryActive = (): boolean => timer !== null
