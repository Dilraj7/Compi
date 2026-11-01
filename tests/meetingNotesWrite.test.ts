import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_MEETING_NOTES } from '../src/shared/meetings'
import type { Meeting, MeetingNotesSettings } from '../src/shared/types'

const root = mkdtempSync(join(tmpdir(), 'compi-notes-'))
const vault = join(root, 'Coffre')
const userData = join(root, 'userData')
mkdirSync(vault)
mkdirSync(userData)

let notes: MeetingNotesSettings = { ...DEFAULT_MEETING_NOTES }
let folders = [vault]

vi.mock('electron', () => ({ app: { getPath: () => userData }, shell: { openPath: vi.fn(async () => ''), openExternal: vi.fn(), trashItem: vi.fn() } }))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))
vi.mock('../src/main/store/settings', () => ({ settings: { get: () => ({ meetings: { notes } }) } }))
vi.mock('../src/main/agent/folders', async () => {
  const { isInside } = await import('../src/main/agent/docSearch')
  return { allowedFolders: () => folders, insideAny: (p: string, roots: string[]) => Boolean(p) && roots.some((r) => isInside(p, r)) }
})

const meeting: Meeting = {
  id: 'm1',
  title: 'Point Nexa',
  startedAt: new Date(2026, 9, 27, 10, 5).getTime(),
  durationMs: 42 * 60_000,
  status: 'done',
  engine: 'parakeet',
  others: true,
  hasSummary: true,
  audio: false,
  names: {},
  lines: [{ start: 0, end: 2, who: 'me', text: 'Bonjour.' }],
  summary: { title: 'Point Nexa', summary: 'Budget validé.', points: [], tasks: [{ text: 'Envoyer le devis' }], brain: 'gemma4', at: 0 }
}
vi.mock('../src/main/meetings/store', () => ({
  getMeeting: (id: string) => (id === 'm1' ? meeting : id === 'rec' ? { ...meeting, id: 'rec', status: 'recording' } : null)
}))

const { isObsidianVault, saveMeetingNote } = await import('../src/main/meetings/notes')

afterAll(() => rmSync(root, { recursive: true, force: true }))
beforeEach(() => {
  notes = { ...DEFAULT_MEETING_NOTES, folder: vault }
  folders = [vault]
})

describe('écrire une note de réunion', () => {
  it('crée la note d’après le modèle, puis « (2) » sans écraser la première', async () => {
    const a = await saveMeetingNote('m1')
    expect(a).toMatchObject({ ok: true, path: join(vault, '2026-10-27 Point Nexa.md') })
    expect(readFileSync(join(vault, '2026-10-27 Point Nexa.md'), 'utf8')).toContain('- [ ] Envoyer le devis')
    const b = await saveMeetingNote('m1')
    expect(b).toMatchObject({ ok: true, path: join(vault, '2026-10-27 Point Nexa (2).md') })
  })

  it('crée le sous-dossier du nom de fichier', async () => {
    notes = { ...notes, fileName: 'Réunions/{{titre}}', template: '# {{titre}}' }
    const r = await saveMeetingNote('m1')
    expect(r.ok).toBe(true)
    expect(readFileSync(join(vault, 'Réunions', 'Point Nexa.md'), 'utf8')).toBe('# Point Nexa\n')
  })

  it('refuse sans dossier, hors des dossiers confiés, et pendant l’enregistrement', async () => {
    notes = { ...notes, folder: '' }
    expect(await saveMeetingNote('m1')).toMatchObject({ ok: false, needsSetup: true })
    notes = { ...notes, folder: vault }
    folders = []
    expect(await saveMeetingNote('m1')).toMatchObject({ ok: false, needsSetup: true })
    folders = [vault]
    expect(await saveMeetingNote('rec')).toMatchObject({ ok: false })
    expect(await saveMeetingNote('inconnue')).toMatchObject({ ok: false })
  })

  it('reconnaît un coffre Obsidian', () => {
    expect(isObsidianVault(vault)).toBe(false)
    mkdirSync(join(vault, '.obsidian'))
    mkdirSync(join(vault, 'Réunions', 'Équipe'), { recursive: true })
    expect(isObsidianVault(join(vault, 'Réunions', 'Équipe'))).toBe(true)
    expect(existsSync(join(vault, '.obsidian'))).toBe(true)
  })
})
