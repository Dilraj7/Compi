// Texte sélectionné dans une autre application : Compi le copie (un seul
// Ctrl+C, une fois les touches du raccourci relâchées) et peut remettre un
// texte à sa place (un seul Ctrl+V). Le presse-papier est toujours remis
// comme avant.

import { clipboard, ClipboardItem } from 'electron'
import { pauseClipboardWatch } from '../clipboard/history'
import { log } from '../log'
import { callHost } from './host'
import type { WindowInfo } from './system'

type Entry = { type: string; data: Blob | Electron.ClipboardBookmark }
type Snapshot = Entry[][]

/** Copie de tout le contenu du presse-papier (texte, mise en forme, image…). */
export async function snapshotClipboard(): Promise<Snapshot> {
  try {
    const out: Snapshot = []
    for (const item of await clipboard.read()) {
      const entries: Entry[] = []
      for (const type of item.types) {
        try {
          entries.push({ type, data: await item.getType(type) })
        } catch {
          // format illisible : ignoré
        }
      }
      out.push(entries)
    }
    return out
  } catch (e) {
    log('warn', 'presse-papier illisible', (e as Error).message)
    return []
  }
}

export async function restoreClipboard(s: Snapshot): Promise<void> {
  // La restauration n'est pas une nouvelle copie de l'utilisateur.
  pauseClipboardWatch(1500)
  try {
    const items = s.filter((entries) => entries.length).map((entries) => new ClipboardItem(Object.fromEntries(entries.map((e) => [e.type, e.data]))))
    if (items.length) await clipboard.write(items)
    else clipboard.clear()
  } catch (e) {
    log('warn', 'presse-papier non restauré', (e as Error).message)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export type Captured = { ok: true; text: string; window: WindowInfo | null } | { ok: false; reason: 'empty' | 'keys' | 'self' | 'error'; message?: string }

/** Copie la sélection de la fenêtre au premier plan. En cas d'échec, rien n'a changé. */
export async function captureSelection(): Promise<Captured> {
  // Le Ctrl+C envoyé par Compi n'entre pas dans l'historique du presse-papier.
  pauseClipboardWatch(6000)
  const saved = await snapshotClipboard()
  let r: { copied: boolean; reason?: string; window: WindowInfo | null }
  try {
    r = await callHost('copy', {}, 4000)
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message }
  }
  if (r.window?.pid === process.pid) {
    if (r.copied) await restoreClipboard(saved)
    return { ok: false, reason: 'self' }
  }
  if (!r.copied) return { ok: false, reason: r.reason === 'keys' ? 'keys' : 'empty' }
  try {
    const text = (await clipboard.readText()).replace(/\r\n/g, '\n')
    return text.trim() ? { ok: true, text, window: r.window } : { ok: false, reason: 'empty' }
  } finally {
    await restoreClipboard(saved)
  }
}

export type Replaced = { ok: true } | { ok: false; reason: 'focus' | 'keys' | 'error'; message?: string }

/** Remet `text` à la place de la sélection, dans sa fenêtre d'origine. */
export async function replaceSelection(window: WindowInfo, text: string): Promise<Replaced> {
  pauseClipboardWatch(8000)
  const saved = await snapshotClipboard()
  try {
    await clipboard.writeText(text)
    const r = await callHost<{ pasted: boolean; reason?: string }>('paste', { handle: window.handle }, 5000)
    if (!r.pasted) return { ok: false, reason: r.reason === 'keys' ? 'keys' : 'focus' }
    // L'application lit le presse-papier juste après le Ctrl+V : on attend avant de le remettre.
    await sleep(600)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message }
  } finally {
    await restoreClipboard(saved)
  }
}
