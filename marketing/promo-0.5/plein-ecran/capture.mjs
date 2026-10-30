// Captures du vrai plein écran (aperçu web, données fictives d'Alex) pour le film 0.5 :
// Edge sans fenêtre, 1920 × 1080 au double (3840 × 2160), horloge fixée au mardi 20 octobre 2026.
// Chaque étape de la démo « e-mails de Claire » donne une image JPEG, et layout.json garde
// la place des zones (colonnes, saisie, carte d'accord) pour animer le film.
// Avec l'aperçu web lancé (port 5199) : node marketing/promo-0.5/plein-ecran/capture.mjs marketing/promo-0.5/plein-ecran
import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2]
mkdirSync(out, { recursive: true })
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const profile = join(tmpdir(), 'compi-promo-0.5-edge')
rmSync(profile, { recursive: true, force: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(
  EDGE,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1920,1080',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-color-profile=srgb',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

let list = []
for (let i = 0; i < 80 && !list.some((t) => t.type === 'page'); i++) {
  try {
    list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
  } catch {
    // Edge démarre
  }
  if (!list.some((t) => t.type === 'page')) await sleep(250)
}
const target = list.find((t) => t.type === 'page')
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let seq = 0
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq
    const on = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      ws.removeEventListener('message', on)
      if (m.error) reject(new Error(`${method} : ${m.error.message}`))
      else resolve(m.result)
    }
    ws.addEventListener('message', on)
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
const until = async (expression, what, ms = 15000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await evaluate(expression)) return
    await sleep(100)
  }
  throw new Error(`Jamais vu : ${what}`)
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 2, mobile: false })
// Horloge : mardi 20 octobre 2026, 10:42 (le temps continue de passer).
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
    const R = Date
    const off = new R(2026, 9, 20, 10, 42, 0).getTime() - R.now()
    class D extends R {
      constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a) }
      static now() { return R.now() + off }
    }
    D.UTC = R.UTC
    D.parse = R.parse
    globalThis.Date = D
  })()`
})
await send('Page.navigate', { url: 'http://localhost:5199/?missed=on&tasks=on&messages=on&local=running&cc=idle' })
await until('Boolean(window.__compiDemo && window.compi && document.querySelector("[data-island]"))', 'l’aperçu')
await sleep(800)

// Réglages de la démo : ville pour la météo, dossier confié du fichier écrit, pas de musique.
await evaluate(`(async () => {
  const s = await window.compi.getSettings()
  await window.compi.updateSettings({ day: { ...s.day, city: 'Lyon' }, folders: ['D:\\\\Documents\\\\Travail', 'D:\\\\Documents\\\\Factures'], showMusic: false, provider: 'local', local: { ...s.local, model: 'gemma4:12b' } })
  return true
})()`)
await sleep(300)
await evaluate(`(window.__compiDemo.command('full'), true)`)
await sleep(2200)

const rect = (sel) =>
  `(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })()`
const layout = {}
const shot = async (name, settle = 700) => {
  await sleep(settle)
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, captureBeyondViewport: false })
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, 'base64'))
  console.log(name)
}
const text = () => evaluate('document.body.innerText')

layout.header = await evaluate(rect('document.querySelector("header")'))
layout.left = await evaluate(rect('document.querySelectorAll("aside")[0]'))
layout.main = await evaluate(rect('document.querySelector("main")'))
layout.right = await evaluate(rect('document.querySelectorAll("aside")[1]'))
layout.dock = await evaluate(rect('document.querySelector("footer")'))
layout.composer = await evaluate(rect('document.querySelector("main textarea")'))
await until('/en veille/i.test(document.querySelector("header").innerText)', 'l’état « en veille »', 20000)
await shot('f0-vide', 1500)

// La demande, tapée dans la saisie du centre.
const ask = 'Résume les e-mails de Claire et note ses demandes dans un fichier'
await evaluate('(document.querySelector("main textarea").focus(), true)')
await send('Input.insertText', { text: ask })
await shot('f1-tape', 400)
layout.typed = await evaluate(`(() => {
  const t = document.querySelector('main textarea')
  const r = t.getBoundingClientRect()
  const c = document.createElement('canvas').getContext('2d')
  const cs = getComputedStyle(t)
  c.font = cs.font
  return { x: r.x + parseFloat(cs.paddingLeft), y: r.y, w: c.measureText(t.value).width, h: r.height }
})()`)

await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
await until(`/from:claire/.test(document.body.innerText)`, 'la recherche dans les e-mails')
await shot('f2-recherche', 300)
await until(`/Lecture d.un e-mail/.test(document.body.innerText)`, 'la lecture')
await shot('f3-lecture', 300)
await until(`/créer « demandes-claire\\.md »/.test(document.body.innerText)`, 'la carte d’accord')
await shot('f4-carte', 900)
layout.card = await evaluate(
  rect(
    '[...document.querySelectorAll("aside")[1].querySelectorAll("div")].find((d) => /Compi veut créer/.test(d.innerText) && d.getBoundingClientRect().height > 80 && d.getBoundingClientRect().height < 420)'
  )
)
layout.allow = await evaluate(rect('[...document.querySelectorAll("aside")[1].querySelectorAll("button")].find((b) => /^Autoriser/.test(b.innerText.trim()))'))
layout.steps = await evaluate(
  rect(
    '[...document.querySelectorAll("main *")].find((d) => /Recherche dans tes e-mails/.test(d.innerText) && /Lecture/.test(d.innerText) && d.getBoundingClientRect().height < 400)'
  )
)
console.log(JSON.stringify(layout))

// Autoriser : la carte part, l'étape se termine avec ses lignes, la réponse s'écrit.
await evaluate(`([...document.querySelectorAll("aside")[1].querySelectorAll("button")].find((b) => /^Autoriser/.test(b.innerText.trim())).click(), true)`)
await until(`/Nouveau fichier/.test(document.querySelector('main').innerText)`, 'la carte du fichier écrit')
await shot('f5-ecrit', 250)
await until(`/salle pour 14/.test(document.body.innerText) && !/En cours/i.test(document.querySelector('header').innerText)`, 'la réponse complète')
await shot('f6-fini', 900)
layout.file = await evaluate(
  rect(
    '[...document.querySelectorAll("main *")].find((d) => /Nouveau fichier/.test(d.innerText) && /Demandes de Claire/.test(d.innerText) && d.getBoundingClientRect().height < 320)'
  )
)
layout.answer = await evaluate(rect('[...document.querySelectorAll("main p")].find((p) => /demandes-claire/.test(p.innerText))'))

writeFileSync(join(out, 'layout.json'), JSON.stringify(layout, null, 2))
console.log(JSON.stringify(layout))
console.log((await text()).slice(0, 3000))
ws.close()
edge.kill()
process.exit(0)
