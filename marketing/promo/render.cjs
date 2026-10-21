// Rend le film promo de Compi en MP4 (H.264 + AAC), sans outil externe :
// Electron capture chaque image de film.html, WebCodecs l'encode, mp4.cjs l'assemble.
//
//   npx electron marketing/promo/render.cjs                 → marketing/compi-promo.mp4
//   npx electron marketing/promo/render.cjs web             → site/media/compi.mp4 (720p, ~7 Mo, pour le site)
//   npx electron marketing/promo/render.cjs stills 1 4.5 …  → images PNG (dossier temporaire)
//   npx electron marketing/promo/render.cjs stills --hd 12.7 → images au double (3840 × 2160), nettes pour le site

const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const W = 1920
const H = 1080
const FPS = 60
const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(ROOT, 'marketing', 'compi-promo.mp4')

/** Film complet (1080p60) ou version légère du site : images réduites avant l'encodage. */
const FORMATS = {
  full: { width: W, height: H, fps: FPS, bitrate: 16_000_000, out: OUT },
  web: { width: 1280, height: 720, fps: 30, bitrate: 1_000_000, out: path.join(ROOT, 'site', 'media', 'compi.mp4') }
}

/** BGRA 1920×1080 → BGRA à la taille voulue. */
function shrink(bgra, width, height) {
  if (width === W && height === H) return bgra
  const { nativeImage } = require('electron')
  return nativeImage.createFromBitmap(bgra, { width: W, height: H }).resize({ width, height, quality: 'best' }).toBitmap()
}

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
 * avec la couleur de son voisin. `dots` : côté du marqueur en pixels (2 avec le zoom ×2).
 */
async function capture(win, t, dots = 1) {
  mark = (mark + 1) % 65536
  await win.webContents.executeJavaScript(`window.__seek(${t}, ${mark})`)
  for (let tries = 0; tries < 200; tries++) {
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H })
    const size = img.getSize()
    if (size.width !== W || size.height !== H) throw new Error(`Image de ${size.width}×${size.height} au lieu de ${W}×${H}`)
    const px = img.toBitmap()
    // BGRA : octets 0 = bleu, 1 = vert, 2 = rouge.
    if (px[0] === 77 && px[2] === (mark & 255) && px[1] === ((mark >> 8) & 255)) {
      for (let y = 0; y < dots; y++) for (let x = 0; x < dots; x++) px.copyWithin(4 * (y * W + x), 4 * (dots * W + x), 4 * (dots * W + x) + 4)
      return px
    }
    await new Promise((r) => setTimeout(r, 8))
  }
  throw new Error(`Image de l'instant ${t} jamais reçue`)
}

/**
 * Image de l'instant t au double (3840 × 2160), pour des captures nettes sur le site.
 * Une fenêtre plus grande que l'écran est refusée : zoom CSS ×2, puis quatre morceaux
 * de 1920 × 1080 assemblés.
 */
async function captureHd(win, t) {
  const big = Buffer.alloc(4 * 2 * W * 2 * H)
  // Zoom sur <body> seulement : <html> (qui coupe à sa taille) passe à 3840 × 2160, et la scène
  // (calée sur la fenêtre par inset: 0) reçoit sa taille en dur pour ne plus couper à 1920 × 1080.
  await win.webContents.executeJavaScript(
    `Object.assign(document.documentElement.style, { width: '${2 * W}px', height: '${2 * H}px' });
     Object.assign(document.getElementById('stage').style, { right: 'auto', bottom: 'auto', width: '${W}px', height: '${H}px' });
     document.body.style.zoom = '2'; 1`
  )
  for (const [tx, ty] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1]
  ]) {
    await win.webContents.executeJavaScript(`window.scrollTo(${tx * W}, ${ty * H}); 1`)
    const tile = await capture(win, t, 2)
    for (let y = 0; y < H; y++) tile.copy(big, 4 * ((ty * H + y) * 2 * W + tx * W), 4 * y * W, 4 * (y + 1) * W)
  }
  return big
}

/** BGRA → PNG, pour les images fixes. */
function toPNG(bgra, scale = 1) {
  const { nativeImage } = require('electron')
  return nativeImage.createFromBitmap(bgra, { width: W * scale, height: H * scale }).toPNG()
}

async function stills(times, hd) {
  const win = filmWindow()
  await loadFilm(win)
  const dir = path.join(os.tmpdir(), hd ? 'compi-promo-stills-hd' : 'compi-promo-stills')
  fs.mkdirSync(dir, { recursive: true })
  for (const t of times) {
    const png = hd ? toPNG(await captureHd(win, t), 2) : toPNG(await capture(win, t))
    const file = path.join(dir, `t${t.toFixed(2)}.png`)
    fs.writeFileSync(file, png)
    console.log(file)
  }
}

async function video(format) {
  const { width, height, fps, bitrate, out } = format
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const film = filmWindow()
  await loadFilm(film)
  const enc = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
  })
  await enc.loadFile(path.join(__dirname, 'encoder.html'))
  const duration = await film.webContents.executeJavaScript('window.__duration')
  const frames = Math.round(duration * fps)

  const ask = (channel, payload) =>
    new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2)
      ipcMain.once(`${channel}:${id}`, (_e, res) => (res && res.error ? reject(new Error(res.error)) : resolve(res)))
      enc.webContents.send(channel, { id, ...payload })
    })

  await ask('start', { width, height, fps, bitrate })
  const t0 = Date.now()
  for (let i = 0; i < frames; i++) {
    const bgra = shrink(await capture(film, i / fps), width, height)
    await ask('frame', { i, bgra })
    if (i % 60 === 0) console.log(`image ${i}/${frames} · ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  }
  const res = await ask('finish', { duration, out })
  console.log('audio', JSON.stringify({ first: res.audioFirst, peak: res.peak, levels: res.levels, profile: res.profile }))
  console.log(
    `MP4 écrit : ${out} (${(res.bytes / 1e6).toFixed(1)} Mo, ${res.videoChunks} images, ${res.audioChunks} blocs audio) en ${((Date.now() - t0) / 1000).toFixed(0)} s`
  )
}

app.whenReady().then(async () => {
  try {
    const [mode, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--') && !a.endsWith('.cjs'))
    if (mode === 'stills') await stills(rest.map(Number), process.argv.includes('--hd'))
    else await video(mode === 'web' ? FORMATS.web : FORMATS.full)
  } catch (err) {
    console.error(err)
    process.exitCode = 1
  }
  app.quit()
})
