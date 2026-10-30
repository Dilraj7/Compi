// Fenêtre de sélection de la zone d'écran : l'écran figé (capture déjà prise), assombri,
// et un rectangle tracé à la souris. Page locale sans accès à Node ni à l'API de Compi ;
// elle rend son choix par son titre (« zone:{…} » ou « zone:cancel »).

import { app, BrowserWindow, type Display, type NativeImage } from 'electron'
import { parseZoneTitle, ZONE_MIN, type ZonePick } from '../../shared/zone'

const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Zone d'écran</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; cursor: crosshair; user-select: none; background: #000; }
  #shot { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
  #dim { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); }
  #sel { position: fixed; display: none; outline: 1.5px solid #38e1ff; box-shadow: 0 0 0 100vmax rgba(0, 0, 0, 0.35); }
  #hint { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); padding: 7px 14px; border-radius: 999px;
    background: rgba(10, 10, 14, 0.85); color: #e8e8ee; font: 13px 'Segoe UI', system-ui, sans-serif; pointer-events: none; }
</style>
</head>
<body>
<img id="shot" alt="">
<div id="dim"></div>
<div id="sel"></div>
<div id="hint">Encadre une zone · Échap pour annuler</div>
<script>
  const sel = document.getElementById('sel')
  const dim = document.getElementById('dim')
  let start = null
  const done = (v) => { document.title = 'zone:' + v }
  const rect = (e) => ({
    x: Math.min(start.x, e.clientX),
    y: Math.min(start.y, e.clientY),
    width: Math.abs(e.clientX - start.x),
    height: Math.abs(e.clientY - start.y)
  })
  const show = (r) => {
    dim.style.display = r ? 'none' : 'block'
    sel.style.display = r ? 'block' : 'none'
    if (r) Object.assign(sel.style, { left: r.x + 'px', top: r.y + 'px', width: r.width + 'px', height: r.height + 'px' })
  }
  addEventListener('mousedown', (e) => {
    if (e.button !== 0) return done('cancel')
    start = { x: e.clientX, y: e.clientY }
  })
  addEventListener('mousemove', (e) => { if (start) show(rect(e)) })
  addEventListener('mouseup', (e) => {
    if (!start || e.button !== 0) return
    const r = rect(e)
    start = null
    if (r.width < ${ZONE_MIN} || r.height < ${ZONE_MIN}) return show(null)
    done(JSON.stringify(Object.assign(r, { vw: innerWidth, vh: innerHeight })))
  })
  addEventListener('keydown', (e) => { if (e.key === 'Escape') done('cancel') })
  addEventListener('contextmenu', (e) => { e.preventDefault(); done('cancel') })
  window.setShot = (src) => new Promise((resolve) => {
    const img = document.getElementById('shot')
    img.onload = resolve
    img.onerror = resolve
    img.src = src
  })
</script>
</body>
</html>`

/** Sans choix au bout de ce temps, la sélection est abandonnée. */
const PICK_TIMEOUT_MS = 120_000

/**
 * Montre l'écran figé `shot` par-dessus `display` et attend la zone tracée.
 * `null` : annulé (Échap, clic droit, autre application, délai dépassé).
 */
export function pickZone(display: Display, shot: NativeImage): Promise<ZonePick | null> {
  return new Promise((resolve) => {
    const b = display.bounds
    const win = new BrowserWindow({
      ...b,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      backgroundColor: '#000000',
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, devTools: !app.isPackaged }
    })
    // Au-dessus de tout, îlot compris.
    win.setAlwaysOnTop(true, 'screen-saver', 2)
    let settled = false
    const finish = (v: ZonePick | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
      resolve(v)
    }
    const timer = setTimeout(() => finish(null), PICK_TIMEOUT_MS)
    win.on('page-title-updated', (e, title) => {
      e.preventDefault()
      const r = parseZoneTitle(title)
      if (r) finish(r === 'cancel' ? null : r)
    })
    // Passer à une autre application annule.
    win.on('blur', () => finish(null))
    win.on('closed', () => finish(null))
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
      .then(async () => {
        await win.webContents.executeJavaScript(`setShot(${JSON.stringify(`data:image/jpeg;base64,${shot.toJPEG(92).toString('base64')}`)})`)
        if (settled) return
        win.setBounds(b)
        win.show()
        win.focus()
      })
      .catch(() => finish(null))
  })
}
