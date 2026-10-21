import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasCompiHooks, HOOK_EVENTS, installHooks, mergeCompiHooks, removeCompiHooks, uninstallHooks } from '../src/main/bridge/installHooks'

const cfg = { port: 47474, token: 'jeton-test', permissionTimeoutSec: 90 }

// Réglages réalistes : clés existantes + un hook déjà configuré par l'utilisateur.
const existing = {
  extraKnownMarketplaces: { 'claude-plugins-official': { source: { source: 'github', repo: 'anthropics/claude-plugins-official' } } },
  autoCompactWindow: 500000,
  autoUpdatesChannel: 'latest',
  agentPushNotifEnabled: true,
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo user-hook' }] }]
  }
}

describe('mergeCompiHooks', () => {
  it('ajoute un hook HTTP pour chaque événement sans toucher au reste', () => {
    const out = mergeCompiHooks(existing, cfg)
    expect(out.autoCompactWindow).toBe(500000)
    expect(out.extraKnownMarketplaces).toEqual(existing.extraKnownMarketplaces)
    for (const event of HOOK_EVENTS) {
      const urls = out.hooks[event].flatMap((g: { hooks: { url?: string }[] }) => g.hooks.map((h) => h.url))
      expect(urls).toContain(`http://127.0.0.1:47474/compi/jeton-test/${event}`)
    }
    // Le hook de l'utilisateur est conservé, en premier.
    expect(out.hooks.PreToolUse[0]).toEqual(existing.hooks.PreToolUse[0])
  })

  it('donne un délai long aux événements bloquants et un matcher aux événements d’outil', () => {
    const out = mergeCompiHooks({}, cfg)
    expect(out.hooks.PermissionRequest[0].hooks[0].timeout).toBe(105)
    expect(out.hooks.Stop[0].hooks[0].timeout).toBe(10)
    expect(out.hooks.PostToolUse[0].matcher).toBe('*')
    expect(out.hooks.Stop[0].matcher).toBeUndefined()
  })

  it('est idempotent', () => {
    const once = mergeCompiHooks(existing, cfg)
    expect(mergeCompiHooks(once, cfg)).toEqual(once)
  })

  it('ne modifie pas l’objet d’origine', () => {
    const copy = structuredClone(existing)
    mergeCompiHooks(existing, cfg)
    expect(existing).toEqual(copy)
  })
})

describe('removeCompiHooks', () => {
  it('restaure exactement les réglages d’origine', () => {
    expect(removeCompiHooks(mergeCompiHooks(existing, cfg))).toEqual(existing)
  })

  it('supprime la clé hooks si elle ne contenait que Compi', () => {
    const { hooks: _h, ...rest } = existing
    expect(removeCompiHooks(mergeCompiHooks(rest, cfg))).toEqual(rest)
  })

  it('détecte la présence des hooks Compi', () => {
    expect(hasCompiHooks(existing)).toBe(false)
    expect(hasCompiHooks(mergeCompiHooks(existing, cfg))).toBe(true)
  })
})

describe('installHooks / uninstallHooks (fichier temporaire)', () => {
  it('sauvegarde, écrit, puis retire proprement', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compi-hooks-'))
    const path = join(dir, 'settings.json')
    writeFileSync(path, JSON.stringify(existing, null, 2))

    installHooks(cfg, path)
    const installed = JSON.parse(readFileSync(path, 'utf8'))
    expect(hasCompiHooks(installed)).toBe(true)
    expect(readdirSync(dir).some((f) => f.startsWith('settings.json.compi-backup-'))).toBe(true)

    uninstallHooks(path)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(existing)
  })

  it('crée le fichier s’il n’existe pas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compi-hooks-'))
    const path = join(dir, 'sub', 'settings.json')
    installHooks(cfg, path)
    expect(existsSync(path)).toBe(true)
  })

  it('refuse de toucher un fichier JSON invalide', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compi-hooks-'))
    const path = join(dir, 'settings.json')
    writeFileSync(path, '{ invalide')
    expect(() => installHooks(cfg, path)).toThrow()
    expect(readFileSync(path, 'utf8')).toBe('{ invalide')
  })
})
