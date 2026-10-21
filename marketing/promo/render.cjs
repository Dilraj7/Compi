// Rend le film promo de Compi en MP4 (H.264 + AAC), sans outil externe :
// Electron capture chaque image de film.html, WebCodecs l'encode, mp4.cjs l'assemble.
//
//   npx electron marketing/promo/render.cjs                 → marketing/compi-promo.mp4
//   npx electron marketing/promo/render.cjs stills 1 4.5 …  → images PNG (dossier temporaire)

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const W = 1920
const H = 1080
const FPS = 60
const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'marketing', 'compi-promo.mp4')

app.setPath('userData', path.join(os.tmpdir(), 'compi-promo-render'))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

function filmWindow() {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false }
  })
  win.webContents.setFrameRate(60)
  return win
}

async function loadFilm(win) {
  await win.loadFile(path.join(__dirname, 'film.html'), { query: { t: '0' } })
  await win.webContents.executeJavaScript('window.__ready.then(() => true)')
}

let mark = 0

/**
 * Image de l'instant t, en BGRA. La capture hors écran peut rendre une image en retard :
 * on recommence jusqu'à lire le bon marqueur au pixel (0, 0), puis on le recouvre
 * avec la couleur de son voisin.
 */
async function capture(win, t) {
  mark = (mark + 1) % 65536
  await win.webContents.executeJavaScript(`window.__seek(${t}, ${mark})`)
  for (let tries = 0; tries < 200; tries++) {
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })
    const size = img.getSize()
    if (size.width !== W || size.height !== H) throw new Error(`Image de ${size.width}×${size.height} au lieu de ${W}×${H}`)
    const px = img.toBitmap()
    // BGRA : octets 0 = bleu, 1 = vert, 2 = rouge.
    if (px[0] === 77 && px[2] === (mark & 255) && px[1] === ((mark >> 8) & 255)) {
      px.copyWithin(0, 4 * W, 4 * W + 4)
      return px
    }
    await new Promise((r) => setTimeout(r, 8))
  }
  throw new Error(`Image de l'instant ${t} jamais reçue`)
}

/** BGRA → PNG, pour les images fixes. */
function toPNG(bgra) {
  const { nativeImage } = require('electron')
  return nativeImage.createFromBitmap(bgra, { width: W, height: H }).toPNG()
}

async function stills(times) {
  const win = filmWindow()
  await loadFilm(win)
  const dir = path.join(os.tmpdir(), 'compi-promo-stills')
  fs.mkdirSync(dir, { recursive: true })
  for (const t of times) {
    const px = await capture(win, t)
    const file = path.join(dir, `t${t.toFixed(2)}.png`)
    fs.writeFileSync(file, toPNG(px))
    console.log(file)
  }
}

async function video() {
  const film = filmWindow()
  await loadFilm(film)
  const enc = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
  })
  await enc.loadFile(path.join(__dirname, 'encoder.html'))
  const duration = await film.webContents.executeJavaScript('window.__duration')
  const frames = Math.round(duration * FPS)

  const ask = (channel, payload) =>
    new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2)
      ipcMain.once(`${channel}:${id}`, (_e, res) => (res && res.error ? reject(new Error(res.error)) : resolve(res)))
      enc.webContents.send(channel, { id, ...payload })
    })

  await ask('start', { width: W, height: H, fps: FPS, bitrate: 16_000_000 })
  const t0 = Date.now()
  for (let i = 0; i < frames; i++) {
    const bgra = await capture(film, i / FPS)
    await ask('frame', { i, bgra })
    if (i % 60 === 0) console.log(`image ${i}/${frames} · ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
  const res = await ask('finish', { duration, out: OUT })
  console.log('audio', JSON.stringify({ first: res.audioFirst, peak: res.peak, levels: res.levels, profile: res.profile }))
  console.log(
    `MP4 écrit : ${OUT} (${(res.bytes / 1e6).toFixed(1)} Mo, ${res.videoChunks} images, ${res.audioChunks} blocs audio) en ${((Date.now() - t0) / 1000).toFixed(0)} s`
  )
}

app.whenReady().then(async () => {
  try {
    const [mode, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.cjs'))
    if (mode === 'stills') await stills(rest.map(Number))
    else await video()
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  }
  app.quit()
})
