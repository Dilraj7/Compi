// Dictée partout : le texte est collé dans la fenêtre où l'utilisateur dictait,
// par le presse-papier, marqué « privé » (hors de l'historique Win+V et du
// presse-papier cloud). Le presse-papier d'avant est remis ensuite. Si la
// fenêtre a changé ou refuse le collage, le texte reste copié : Ctrl+V.

import { pauseClipboardWatch } from '../clipboard/history'
import { callHost } from '../windows/host'
import { restoreClipboard, snapshotClipboard } from '../windows/selection'
import type { WindowInfo } from '../windows/system'

export type Pasted = { ok: true } | { ok: false; reason: 'moved' | 'keys' | 'error'; message?: string }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Copie le texte sans le coller (marqué privé). */
export async function copyDictation(text: string): Promise<boolean> {
  pauseClipboardWatch(3000)
  try {
    return (await callHost<{ copied: boolean }>('clip_text', { text }, 4000)).copied
  } catch {
    return false
  }
}

export async function pasteDictation(window: WindowInfo | null, text: string): Promise<Pasted> {
  if (!window) return { ok: false, reason: 'moved' }
  pauseClipboardWatch(8000)
  const saved = await snapshotClipboard()
  let restore = true
  try {
    const c = await callHost<{ copied: boolean }>('clip_text', { text }, 4000)
    if (!c.copied) return { ok: false, reason: 'error', message: 'Presse-papier occupé par une autre application.' }
    const r = await callHost<{ pasted: boolean; reason?: string }>('paste', { handle: window.handle, onlyIfForeground: true }, 5000)
    if (!r.pasted) {
      // Le texte reste copié : l'utilisateur le colle où il veut.
      restore = false
      return { ok: false, reason: r.reason === 'keys' ? 'keys' : 'moved' }
    }
    // L'application lit le presse-papier juste après le Ctrl+V : on attend avant de le remettre.
    await sleep(600)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'error', message: (e as Error).message }
  } finally {
    if (restore) await restoreClipboard(saved)
  }
}
