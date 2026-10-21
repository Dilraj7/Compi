import { describe, expect, it, vi } from 'vitest'
import { toRegistryEntry } from '../src/main/connectors/mcpRegistry'

// Raccourci : on simule Windows qui refuse les combinaisons déjà prises par une autre app.
const taken = new Set(['Control+Shift+Space', 'Alt+Shift+Space'])
const registered = new Set<string>()
vi.mock('electron', () => ({
  globalShortcut: {
    register: (acc: string) => {
      if (taken.has(acc) || registered.has(acc)) return false
      registered.add(acc)
      return true
    },
    unregister: (acc: string) => registered.delete(acc)
  },
  app: { getPath: () => '' }
}))
vi.mock('../src/main/notchWindow', () => ({ sendIslandCommand: vi.fn() }))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))

const shortcut = await import('../src/main/shortcut')

describe('raccourci global', () => {
  it('bascule sur une alternative libre quand le raccourci est pris (1Password)', () => {
    expect(shortcut.initShortcut('Control+Shift+Space')).toEqual({ accelerator: 'Control+Alt+K', replaced: true })
    expect(shortcut.shortcutActive()).toBe(true)
  })

  it('refuse une combinaison prise et garde l’ancienne', () => {
    expect(shortcut.setShortcut('Alt+Shift+Space')).toBe(false)
    expect(registered.has('Control+Alt+K')).toBe(true)
    expect(shortcut.setShortcut('Alt+Shift+K')).toBe(true)
    expect(registered.has('Control+Alt+K')).toBe(false)
  })

  it('actions rapides : leur propre raccourci, jamais celui qui ouvre Compi', () => {
    const onQuick = vi.fn()
    expect(shortcut.initQuickShortcut('Alt+Shift+C', onQuick)).toEqual({ accelerator: 'Alt+Shift+C', replaced: false })
    expect(shortcut.quickShortcutActive()).toBe(true)
    // L'un ne peut pas prendre la combinaison de l'autre.
    expect(shortcut.setShortcut('Alt+Shift+C')).toBe(false)
    expect(shortcut.setQuickShortcut('Alt+Shift+K')).toBe(false)
    expect(shortcut.setQuickShortcut('')).toBe(true)
    expect(shortcut.quickShortcutActive()).toBe(false)
    expect(registered.has('Alt+Shift+C')).toBe(false)
  })

  it('affiche les raccourcis en français', () => {
    expect(shortcut.prettyShortcut('Control+Shift+Space')).toBe('Ctrl + Maj + Espace')
  })
})

describe('registre MCP', () => {
  it('préfère le serveur distant et liste ses en-têtes secrets', () => {
    const e = toRegistryEntry({
      name: 'io.example/notion',
      description: 'Notion',
      remotes: [
        { type: 'sse', url: 'https://x/sse' },
        { type: 'streamable-http', url: 'https://x/mcp', headers: [{ name: 'Authorization', value: 'Bearer {token}', isSecret: true }] }
      ],
      packages: [{ registryType: 'npm', identifier: 'notion-mcp', transport: { type: 'stdio' } }]
    })
    expect(e).toMatchObject({ kind: 'remote', secrets: ['Authorization'], config: { transport: 'http', url: 'https://x/mcp' } })
    expect(e?.hints.Authorization).toContain('Bearer {token}')
  })

  it('convertit un paquet npm en commande npx, avec ses arguments et variables', () => {
    const e = toRegistryEntry({
      name: 'io.github.org/brave',
      title: 'Brave Search',
      packages: [
        {
          registryType: 'npm',
          identifier: '@brave/brave-search-mcp-server',
          version: '2.1.4',
          transport: { type: 'stdio' },
          packageArguments: [{ type: 'named', name: '--transport', value: 'stdio' }, { type: 'positional', valueHint: 'dossier' }],
          environmentVariables: [{ name: 'BRAVE_API_KEY', description: 'Clé API', isSecret: true }]
        }
      ]
    })
    expect(e?.kind).toBe('npm')
    expect(e?.config.command).toBe('npx')
    expect(e?.config.args).toEqual(['-y', '@brave/brave-search-mcp-server@2.1.4', '--transport', 'stdio', '<dossier>'])
    expect(e?.secrets).toEqual(['BRAVE_API_KEY'])
  })

  it('accepte les paquets Python (uvx) et ignore les images Docker seules', () => {
    expect(toRegistryEntry({ name: 'py', packages: [{ registryType: 'pypi', identifier: 'mcp-server-time', transport: { type: 'stdio' } }] })?.config.command).toBe('uvx')
    expect(toRegistryEntry({ name: 'oci', packages: [{ registryType: 'oci', identifier: 'docker.io/x/y' }] })).toBeNull()
  })
})
