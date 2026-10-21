// La fenêtre de l'îlot : transparente, sans bordure, toujours devant,
// collée en haut au centre de l'écran. Elle a une taille fixe (celle du
// panneau ouvert) : c'est l'interface qui anime la forme de l'îlot à
// l'intérieur. Hors de l'îlot, les clics traversent vers le bureau.

import { join } from 'node:path'
import { BrowserWindow, dialog, ipcMain, screen, shell, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron'
import { IPC } from '../shared/ipc'
import type { IslandCommand } from '../shared/types'

export const WIN_WIDTH = 760
export const WIN_HEIGHT = 540

let win: BrowserWindow | null = null
let interactive = false
/**
 * La fenêtre peut être activée par un clic. Une fenêtre non activable perd le
 * clic qui devrait l'activer (Chromium répond MA_NOACTIVATEANDEAT) : l'îlot et
 * les boutons du panneau ne répondraient pas. Elle l'est donc tant que le
 * panneau est ouvert, ou que la souris est sur l'îlot, sans pour autant prendre
 * le clavier tant qu'on n'y clique pas.
 */
let activatable = false
/** Le panneau demande à être activable (ouvert). */
let panelActivatable = false
/** La fenêtre a vraiment le focus (panneau ouvert pour discuter, ou clic dedans). */
let hadFocus = false

/** Tests de bout en bout : décale l'îlot pour ne pas recouvrir celui de Compi installé. */
const TEST_OFFSET_X = Number(process.env.COMPI_TEST_OFFSET_X) || 0

function targetBounds(): Electron.Rectangle {
  const display = screen.getPrimaryDisplay()
  const { x, y, width } = display.bounds
  return {
    x: Math.round(x + (width - WIN_WIDTH) / 2) + TEST_OFFSET_X,
    y,
    width: WIN_WIDTH,
    height: WIN_HEIGHT
  }
}

export function reposition(): void {
  if (win && !win.isDestroyed()) win.setBounds(targetBounds())
}

export function createNotchWindow(): BrowserWindow {
  win = new BrowserWindow({
    ...targetBounds(),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    alwaysOnTop: true,
    show: false,
    title: 'Compi',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })

  // Niveau le plus haut : au-dessus de la barre des tâches et des fenêtres « toujours devant ».
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setIgnoreMouseEvents(true, { forward: true })

  win.once('ready-to-show', () => win?.showInactive())

  // Clic ailleurs : on referme le panneau s'il avait pris le focus (sauf pendant un sélecteur de fichiers).
  win.on('focus', () => {
    hadFocus = true
  })
  win.on('blur', () => {
    const was = hadFocus
    hadFocus = false
    if (was && !dialogOpen) sendIslandCommand('collapse')
  })

  // Les liens s'ouvrent dans le navigateur par défaut, jamais dans l'îlot.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  screen.on('display-metrics-changed', reposition)
  screen.on('display-added', reposition)
  screen.on('display-removed', reposition)

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const panelOpenListeners = new Set<() => void>()

/** Appelé quand l'îlot s'ouvre pour discuter (il prend le focus). */
export function onPanelOpen(cb: () => void): void {
  panelOpenListeners.add(cb)
}

export function registerIslandIpc(): void {
  ipcMain.on(IPC.setInteractive, (_e, value: boolean) => {
    if (!win || value === interactive) return
    interactive = value
    win.setIgnoreMouseEvents(!value, { forward: true })
    // Souris sur l'îlot replié : activable, sinon Windows jette le clic qui doit l'ouvrir.
    refreshActivatable(win)
  })

  // Panneau ouvert sans prendre le clavier (validation, Activité…) : activable au clic.
  ipcMain.on(IPC.setActivatable, (_e, value: boolean) => {
    if (win) setPanelActivatable(win, value)
  })

  // `true` : le panneau prend le clavier (ouvert pour discuter) ; `false` : il le rend et redevient inerte.
  ipcMain.on(IPC.setFocusable, (_e, value: boolean) => {
    if (!win) return
    if (value) {
      setPanelActivatable(win, true)
      if (win.isFocused()) return
      win.focus()
      win.webContents.focus()
      for (const cb of panelOpenListeners) cb()
      win.setAlwaysOnTop(true, 'screen-saver')
    } else {
      setPanelActivatable(win, false)
    }
  })
}

function setPanelActivatable(w: BrowserWindow, value: boolean): void {
  panelActivatable = value
  if (!value) {
    // Pas de « collapse » en retour : c'est l'interface qui referme. Le clavier revient à
    // l'application d'avant, même si la souris est encore sur l'îlot.
    hadFocus = false
    if (w.isFocused()) w.blur()
  }
  refreshActivatable(w)
}

function refreshActivatable(w: BrowserWindow): void {
  const value = panelActivatable || interactive
  if (value === activatable) return
  activatable = value
  w.setFocusable(value)
  // Sous Windows, une fenêtre activable réapparaît dans la barre des tâches : pas l'îlot.
  w.setSkipTaskbar(true)
  // Repasser au-dessus après un changement (Windows peut réordonner).
  w.setAlwaysOnTop(true, 'screen-saver')
}

export function sendIslandCommand(cmd: IslandCommand): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.islandCommand, cmd)
}

export function getNotchWindow(): BrowserWindow | null {
  return win
}

let dialogOpen = false

/** Ouvre un sélecteur de fichiers rattaché à l'îlot, sans que la perte de focus referme le panneau. */
export async function showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
  dialogOpen = true
  const refocus = Boolean(win && !win.isDestroyed() && activatable)
  try {
    return win && !win.isDestroyed() ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  } finally {
    dialogOpen = false
    if (win && !win.isDestroyed() && refocus) {
      win.focus()
      win.setAlwaysOnTop(true, 'screen-saver')
    }
  }
}
