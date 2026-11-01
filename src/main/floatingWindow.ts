// Transcription flottante : une petite fenêtre toujours devant, au-dessus de l'appli de visio,
// que l'on pose où l'on veut. L'îlot reste maître de l'appel (micro, arrêt) : il envoie ici
// son état à chaque changement, et les boutons de la fenêtre lui renvoient leurs ordres.
// Masquée du plein écran (qui montre déjà l'appel) et, si le réglage le dit, des partages d'écran.

import { join } from 'node:path'
import { BrowserWindow, screen, shell } from 'electron'
import { cleanBounds, FLOAT_COMPACT_HEIGHT, FLOAT_MIN, FLOAT_SIZE, placeFloat } from '../shared/floating'
import { IPC } from '../shared/ipc'
import type { FloatingCommand, FloatingState, LiveCall } from '../shared/types'
import { log } from './log'
import { settings } from './store/settings'

let win: BrowserWindow | null = null
let call: LiveCall | null = null
/** Appel dont l'utilisateur a fermé la fenêtre : elle ne se rouvre pas toute seule. */
let dismissedFor: string | null = null
let fullMode = false
let saveTimer: ReturnType<typeof setTimeout> | null = null

const floating = (): ReturnType<typeof settings.get>['meetings']['floating'] => settings.get().meetings.floating

function state(): FloatingState {
  const f = floating()
  return { call, compact: f.compact, opacity: f.opacity }
}

function saveFloating(patch: Partial<ReturnType<typeof floating>>): void {
  const m = settings.get().meetings
  settings.update({ meetings: { ...m, floating: { ...m.floating, ...patch } } })
}

function push(): void {
  if (win && !win.isDestroyed()) win.webContents.send(IPC.floatingState, state())
}

/** Commandes de l'îlot (« Arrêter », personnes en face) : relayées par index.ts. */
let toIsland: (cmd: FloatingCommand) => void = () => undefined
export function onFloatingCommand(cb: (cmd: FloatingCommand) => void): void {
  toIsland = cb
}

function create(): BrowserWindow {
  const f = floating()
  const works = [screen.getPrimaryDisplay(), ...screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id)].map((d) => d.workArea)
  const saved = f.bounds ? { ...f.bounds, ...(f.compact ? { height: Math.min(f.bounds.height, FLOAT_COMPACT_HEIGHT) } : {}) } : undefined
  const b = placeFloat(saved, works, f.compact)
  const w = new BrowserWindow({
    ...b,
    minWidth: FLOAT_MIN.width,
    minHeight: FLOAT_MIN.height,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0B0D12',
    title: 'Compi · transcription',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  // Au-dessus de l'appli de visio, même quand elle a le focus.
  w.setAlwaysOnTop(true, 'screen-saver')
  w.setContentProtection(settings.get().hideFromCapture)
  w.setOpacity(f.opacity)
  w.once('ready-to-show', () => {
    if (!fullMode) w.showInactive()
  })
  const remember = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (!w.isDestroyed()) saveFloating({ bounds: cleanBounds(w.getBounds()) })
    }, 500)
  }
  w.on('moved', remember)
  w.on('resized', remember)
  w.on('closed', () => {
    if (win === w) win = null
  })
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  w.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(`${process.env.ELECTRON_RENDERER_URL}#transcript`)
  else void w.loadFile(join(__dirname, '../renderer/index.html'), { hash: 'transcript' })
  return w
}

/** Ouvre la fenêtre (bouton « Fenêtre flottante », ou automatiquement au début de l'appel). */
export function openFloating(): void {
  dismissedFor = null
  if (win && !win.isDestroyed()) {
    if (!fullMode) win.showInactive()
    return
  }
  win = create()
  log('info', 'transcription flottante ouverte')
}

export function closeFloating(byUser = false): void {
  if (byUser && call) dismissedFor = call.id
  if (win && !win.isDestroyed()) win.close()
  win = null
}

/** État de l'appel envoyé par l'îlot. */
export function setFloatingCall(next: LiveCall | null): void {
  const started = next && next.phase === 'recording' && call?.id !== next.id
  call = next
  if (!next) {
    // Appel fini (dans l'historique) : la fenêtre n'a plus rien à montrer.
    closeFloating()
    dismissedFor = null
    return
  }
  if (started && floating().auto && dismissedFor !== next.id) openFloating()
  push()
}

export const floatingState = (): FloatingState => state()

export function floatingCommand(cmd: FloatingCommand): void {
  switch (cmd.type) {
    case 'close':
      closeFloating(true)
      return
    case 'compact': {
      saveFloating({ compact: cmd.compact })
      if (win && !win.isDestroyed()) {
        const b = win.getBounds()
        const height = cmd.compact ? FLOAT_COMPACT_HEIGHT : Math.max(floating().bounds?.height ?? FLOAT_SIZE.height, FLOAT_SIZE.height)
        win.setBounds({ ...b, y: b.y + b.height - height, height })
      }
      push()
      return
    }
    case 'opacity': {
      const opacity = Math.min(1, Math.max(0.5, cmd.opacity))
      saveFloating({ opacity })
      win?.setOpacity(opacity)
      push()
      return
    }
    default:
      toIsland(cmd)
  }
}

/** Plein écran : il montre déjà l'appel en grand, la fenêtre s'efface puis revient. */
export function setFloatingFullMode(on: boolean): void {
  fullMode = on
  if (!win || win.isDestroyed()) return
  if (on) win.hide()
  else win.showInactive()
}

/** Réglage « Masquer Compi des partages d'écran » changé. */
export function applyFloatingCapture(hide: boolean): void {
  if (win && !win.isDestroyed()) win.setContentProtection(hide)
}
