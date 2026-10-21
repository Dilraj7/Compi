import type { BrowserWindow } from 'electron'

// Petit relais pour pousser des événements vers l'interface depuis
// n'importe quel module du processus principal.

let target: BrowserWindow | null = null

export function setBusTarget(win: BrowserWindow | null): void {
  target = win
}

export function emit(channel: string, payload?: unknown): void {
  if (target && !target.isDestroyed()) target.webContents.send(channel, payload)
}
