import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { binScript, findCached, nodeOnPath, parseNpx } from '../src/main/connectors/npxDirect'

const cache = mkdtempSync(join(tmpdir(), 'compi-npx-'))
afterAll(() => rmSync(cache, { recursive: true, force: true }))

/** Un dossier de npx tel que npm le laisse après `npx -y <paquet>`. */
function install(hash: string, name: string, pkg: Record<string, unknown>, o: { range?: string; done?: boolean; files?: string[]; at?: number } = {}): void {
  const base = join(cache, '_npx', hash)
  const dir = join(base, 'node_modules', ...name.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(base, 'package.json'), JSON.stringify({ dependencies: { [name]: o.range ?? '^1.0.0' } }))
  if (o.done !== false) writeFileSync(join(base, 'node_modules', '.package-lock.json'), '{}')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, ...pkg }))
  for (const f of o.files ?? []) {
    mkdirSync(join(dir, f, '..'), { recursive: true })
    writeFileSync(join(dir, f), '#!/usr/bin/env node\n')
  }
  if (o.at) utimesSync(join(base, 'package.json'), o.at, o.at)
}

describe('connecteurs lancés sans npx', () => {
  it('lit la commande npx', () => {
    expect(parseNpx(['-y', '@modelcontextprotocol/server-filesystem', 'D:\\Docs'])).toEqual({
      name: '@modelcontextprotocol/server-filesystem',
      rest: ['D:\\Docs']
    })
    expect(parseNpx(['--yes', 'mcp-server-x@1.4.2', '--port', '3'])).toEqual({ name: 'mcp-server-x', version: '1.4.2', rest: ['--port', '3'] })
    expect(parseNpx(['-y', '@scope/pkg@latest'])).toEqual({ name: '@scope/pkg', version: undefined, rest: [] })
    // Formes que seul npx sait traiter : on le laisse faire.
    expect(parseNpx(['-y', '@scope/pkg@^1.2'])).toBeNull()
    expect(parseNpx(['-p', 'a', 'b'])).toBeNull()
    expect(parseNpx(['-y', 'github:user/repo'])).toBeNull()
    expect(parseNpx([])).toBeNull()
  })

  it('choisit le script comme npx', () => {
    expect(binScript({ bin: 'dist/index.js' }, 'x')).toBe('dist/index.js')
    expect(binScript({ bin: { 'mcp-server-memory': 'dist/index.js' } }, '@modelcontextprotocol/server-memory')).toBe('dist/index.js')
    expect(binScript({ bin: { a: 'a.js', 'server-x': 'x.js' } }, '@s/server-x')).toBe('x.js')
    expect(binScript({ bin: { a: 'a.js', b: 'b.js' } }, '@s/server-x')).toBeNull()
    expect(binScript({}, 'x')).toBeNull()
  })

  it('trouve le serveur installé, le plus récent, et respecte une version exacte', () => {
    install(
      'aaaa',
      '@modelcontextprotocol/server-memory',
      { version: '1.0.0', bin: { 'mcp-server-memory': 'dist/index.js' } },
      { files: ['dist/index.js'], at: 1_000 }
    )
    install(
      'bbbb',
      '@modelcontextprotocol/server-memory',
      { version: '1.2.0', bin: { 'mcp-server-memory': 'dist/index.js' } },
      { files: ['dist/index.js'], at: 2_000 }
    )
    expect(findCached(cache, '@modelcontextprotocol/server-memory')).toBe(
      join(cache, '_npx', 'bbbb', 'node_modules', '@modelcontextprotocol', 'server-memory', 'dist', 'index.js')
    )
    expect(findCached(cache, '@modelcontextprotocol/server-memory', '1.0.0')).toContain(join('_npx', 'aaaa'))
    expect(findCached(cache, '@modelcontextprotocol/server-memory', '9.9.9')).toBeNull()
  })

  it('ignore une installation inachevée, un script absent, ou qui sort du paquet', () => {
    install('cccc', 'half-done', { version: '1.0.0', bin: 'index.js' }, { files: ['index.js'], done: false })
    install('dddd', 'no-script', { version: '1.0.0', bin: 'index.js' })
    install('eeee', 'escape', { version: '1.0.0', bin: '../../../evil.js' })
    writeFileSync(join(cache, '_npx', 'evil.js'), '')
    expect(findCached(cache, 'half-done')).toBeNull()
    expect(findCached(cache, 'no-script')).toBeNull()
    expect(findCached(cache, 'escape')).toBeNull()
    expect(findCached(cache, 'absent')).toBeNull()
    expect(findCached(join(cache, 'nulle-part'), 'absent')).toBeNull()
  })

  it('trouve node dans le PATH', () => {
    const bin = join(cache, 'nodejs')
    mkdirSync(bin, { recursive: true })
    const exe = join(bin, process.platform === 'win32' ? 'node.exe' : 'node')
    writeFileSync(exe, '')
    const sep = process.platform === 'win32' ? ';' : ':'
    expect(nodeOnPath(`${join(cache, 'vide')}${sep}"${bin}"`)).toBe(exe)
    expect(nodeOnPath('')).toBeNull()
  })
})
