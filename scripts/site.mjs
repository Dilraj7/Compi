// Site de Compi (GitHub Pages) : assemble site/ avec l'icône de l'app, vérifie que chaque
// lien local et chaque ancre existent, puis (option) le sert en local.
// Les captures du site (site/images, au double pour les écrans nets) sont tirées du film :
// npx electron marketing/promo/render.cjs stills --hd <instants>, puis recadrées.
// Usage : node scripts/site.mjs            → out/site (utilisé par .github/workflows/pages.yml)
//         node scripts/site.mjs --serve 4173 → aperçu sur http://127.0.0.1:4173

import { copyFileSync, cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, relative, resolve, sep } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = join(ROOT, 'out', 'site')

function assemble() {
  rmSync(OUT, { recursive: true, force: true })
  cpSync(join(ROOT, 'site'), OUT, { recursive: true })
  copyFileSync(join(ROOT, 'resources', 'icon.png'), join(OUT, 'icon.png'))
}

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]))

/** Liens locaux cassés (fichiers absents, ancres inconnues) dans les pages et les feuilles de style. */
function brokenLinks() {
  const broken = []
  for (const file of walk(OUT).filter((f) => /\.(html|css)$/.test(f))) {
    const text = readFileSync(file, 'utf8')
    const ids = new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))
    const refs = [
      ...[...text.matchAll(/(?:href|src|poster)="([^"]+)"/g), ...text.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1]),
      // srcset="a.jpg 980w, a@2x.jpg 1960w" : chaque fichier compte.
      ...[...text.matchAll(/srcset="([^"]+)"/g)].flatMap((m) => m[1].split(',').map((part) => part.trim().split(/\s+/)[0]))
    ]
    for (const ref of refs) {
      if (/^(https?:|mailto:|data:|javascript:)/.test(ref) || !/[./#]/.test(ref) || /\s/.test(ref)) continue
      if (ref.startsWith('#')) {
        if (ref.length > 1 && !ids.has(ref.slice(1))) broken.push(`${relative(OUT, file)} : ancre ${ref}`)
        continue
      }
      const path = ref.split(/[?#]/)[0]
      if (!/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/')) continue
      if (!existsSync(join(file, '..', path))) broken.push(`${relative(OUT, file)} : ${ref}`)
    }
  }
  return broken
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml'
}

function serve(port) {
  createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = normalize(join(OUT, url))
    if (!file.startsWith(OUT + sep) && file !== OUT) return res.writeHead(403).end()
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html')
    if (!existsSync(file)) return res.writeHead(404).end('Introuvable')
    const size = statSync(file).size
    const type = TYPES[extname(file)] ?? 'application/octet-stream'
    // Lecture vidéo : le navigateur demande des morceaux (Range).
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '')
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Number(range[2]) : size - 1
      res.writeHead(206, {
        'content-type': type,
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
        'content-length': end - start + 1
      })
      return res.end(readFileSync(file).subarray(start, end + 1))
    }
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' }).end(readFileSync(file))
  }).listen(port, '127.0.0.1', () => console.log(`site : http://127.0.0.1:${port}`))
}

assemble()
const broken = brokenLinks()
if (broken.length) {
  console.error(`Liens cassés :\n${broken.map((b) => `- ${b}`).join('\n')}`)
  process.exit(1)
}
console.log(`site assemblé dans ${relative(ROOT, OUT)}, aucun lien local cassé`)
const at = process.argv.indexOf('--serve')
if (at >= 0) serve(Number(process.argv[at + 1]) || 4173)
