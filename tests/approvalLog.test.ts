import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ApprovalLogEntry, ApprovalRequest } from '../src/shared/types'

const userData = mkdtempSync(join(tmpdir(), 'compi-approvals-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))
vi.mock('../src/main/bus', () => ({ emit: vi.fn() }))

const log = await import('../src/main/privacy/approvalLog')
const { auditTarget } = await import('../src/main/agent/labels')

const request = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'r1',
  source: 'compi',
  title: 'Compi veut lire « bail.pdf »',
  toolName: 'mcp__compi__read_document',
  detail: 'C:\\Users\\Moi\\Documents\\bail.pdf — contenu secret du bail',
  canAlwaysAllow: true,
  destination: 'Claude (Anthropic)',
  createdAt: Date.now(),
  ...over
})

describe('journal des autorisations', () => {
  afterAll(() => rmSync(userData, { recursive: true, force: true }))

  it('note chaque réponse, sans jamais garder le détail de la carte', () => {
    log.recordApproval(request(), 'allow')
    const [e] = log.listApprovalLog()
    expect(e).toMatchObject({ source: 'compi', title: 'Compi veut lire « bail.pdf »', outcome: 'allow', destination: 'Claude (Anthropic)' })
    expect(readFileSync(join(userData, 'approvals-log.json'), 'utf8')).not.toContain('contenu secret')
  })

  it('garde la règle seulement pour « Toujours »', () => {
    log.recordApproval(request({ alwaysRule: 'Ne plus demander pour cet outil' }), 'deny')
    expect(log.listApprovalLog()[0].rule).toBeUndefined()
    log.recordApproval(request({ alwaysRule: 'Ne plus demander pour cet outil' }), 'always')
    expect(log.listApprovalLog()[0]).toMatchObject({ outcome: 'always', rule: 'Ne plus demander pour cet outil' })
  })

  it('note les refus automatiques des routines', () => {
    log.recordRoutineDenial('Compi veut ouvrir un lien', 'mcp__compi__open_url', 'Mes e-mails du matin')
    expect(log.listApprovalLog()[0]).toMatchObject({ source: 'routine', outcome: 'auto-deny', session: 'Mes e-mails du matin' })
  })

  it('500 entrées et 90 jours au plus', () => {
    const now = Date.now()
    const entry = (i: number, daysAgo: number): ApprovalLogEntry => ({ id: String(i), at: now - daysAgo * 86_400_000, source: 'compi', title: 't', tool: 'x', outcome: 'allow' })
    const many = Array.from({ length: 600 }, (_, i) => entry(i, 1))
    expect(log.pruneApprovalLog(many, now)).toHaveLength(500)
    expect(log.pruneApprovalLog([entry(1, 10), entry(2, 91)], now).map((e) => e.id)).toEqual(['1'])
  })

  it('effacer vide le journal', () => {
    expect(log.clearApprovalLog()).toEqual([])
    expect(log.listApprovalLog()).toEqual([])
  })
})

describe('cible abrégée du journal', () => {
  it('nom du fichier, site ou début de commande, secrets masqués', () => {
    expect(auditTarget('Edit', { file_path: 'D:/Projets/app/src/main.ts' })).toBe('main.ts')
    expect(auditTarget('WebFetch', { url: 'https://www.example.com/page?token=abc' })).toBe('example.com')
    expect(auditTarget('Bash', { command: 'npm test\nrm -rf build' })).toBe('npm test')
    expect(auditTarget('Bash', { command: 'curl -H "x" --password=Sup3rS3cret!x https://api.example.com' })).not.toContain('Sup3rS3cret')
    expect(auditTarget('Bash', { command: 'x'.repeat(300) })?.length).toBeLessThanOrEqual(100)
    expect(auditTarget('mcp__compi__set_volume', { level: 30 })).toBeUndefined()
  })
})
