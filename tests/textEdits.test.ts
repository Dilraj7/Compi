import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyTextEdit,
  describeTextEdit,
  KEEP_EDITS,
  lineDiff,
  planTextEdit,
  undoTextEdit,
  writableTextPath,
  type TextEditPlan
} from '../src/main/agent/textEdits'

let dir: string
let notes: string
let journal: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'compi-text-'))
  notes = join(dir, 'Notes')
  journal = join(dir, 'edits')
  mkdirSync(notes)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const plan = async (path: string, content: string, mode: 'replace' | 'append' = 'replace'): Promise<TextEditPlan> => {
  const p = await planTextEdit(path, content, mode, [notes])
  if ('error' in p) throw new Error(p.error)
  return p
}

describe('fichiers que Compi peut écrire', () => {
  it('du texte (.md, .txt) dans un dossier confié, rien d’autre', async () => {
    expect(await writableTextPath(join(notes, 'Essai.md'), [notes])).toHaveProperty('path')
    expect(await writableTextPath(join(notes, 'a.TXT'), [notes])).toHaveProperty('path')
    expect(await writableTextPath(join(notes, 'script.ps1'), [notes])).toEqual({ error: expect.stringMatching(/Seuls les fichiers texte/) })
    expect(await writableTextPath(join(notes, 'rapport.docx'), [notes])).toEqual({ error: expect.stringMatching(/Word/) })
    expect(await writableTextPath(join(dir, 'hors.md'), [notes])).toEqual({ error: expect.stringMatching(/pas dans un dossier que l'utilisateur t'a confié/) })
    expect(await writableTextPath(join(notes, '..', 'Notes2', 'x.md'), [notes])).toHaveProperty('error')
    expect(await writableTextPath(join(notes, 'a.md'), [])).toEqual({ error: expect.stringMatching(/aucun dossier/) })
  })

  it('ni dossier caché, ni dossier absent, ni dossier à la place du fichier', async () => {
    mkdirSync(join(notes, '.obsidian'))
    expect(await writableTextPath(join(notes, '.obsidian', 'app.md'), [notes])).toEqual({ error: expect.stringMatching(/cachés/) })
    expect(await writableTextPath(join(notes, 'Absent', 'a.md'), [notes])).toEqual({ error: expect.stringMatching(/n'existe pas/) })
    mkdirSync(join(notes, 'dossier.md'))
    expect(await writableTextPath(join(notes, 'dossier.md'), [notes])).toEqual({ error: expect.stringMatching(/n'est pas un fichier/) })
  })
})

describe('contenu prévu', () => {
  it('remplace tout, en gardant les fins de ligne Windows et la marque UTF-8 du fichier', async () => {
    const f = join(notes, 'Essai.md')
    writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('---\r\ntype: idee\r\n---\r\n# Essai\r\n\r\n## L’idée\r\n- \r\n')]))
    const p = await plan(f, '---\ntype: idee\n---\n# Essai\n\n## L’idée\n- Un assistant\n')
    expect(p.existed).toBe(true)
    expect(p.bom).toBe(true)
    expect(p.after).toBe('---\r\ntype: idee\r\n---\r\n# Essai\r\n\r\n## L’idée\r\n- Un assistant\r\n')
  })

  it('ajoute à la fin, sur une nouvelle ligne', async () => {
    const f = join(notes, 'journal.txt')
    writeFileSync(f, 'lundi')
    expect((await plan(f, 'mardi', 'append')).after).toBe('lundi\nmardi')
    expect((await plan(join(notes, 'neuf.md'), 'bonjour', 'append')).after).toBe('bonjour')
  })

  it('refuse un fichier binaire ou trop long', async () => {
    const f = join(notes, 'bin.txt')
    writeFileSync(f, Buffer.from([0x61, 0x00, 0x62]))
    expect(await planTextEdit(f, 'x', 'replace', [notes])).toEqual({ error: expect.stringMatching(/pas un fichier texte/) })
    expect(await planTextEdit(join(notes, 'long.md'), 'x'.repeat(1_000_001), 'replace', [notes])).toEqual({ error: expect.stringMatching(/trop long/) })
  })
})

describe('carte : ce qui change', () => {
  it('lignes retirées et ajoutées entre le début et la fin communs', async () => {
    const f = join(notes, 'Essai.md')
    writeFileSync(f, '# Essai\n\n## Idée\n- \n\n## Pourquoi\n- \n')
    const text = describeTextEdit(await plan(f, '# Essai\n\n## Idée\n- Un assistant Windows\n\n## Pourquoi\n- Il agit vraiment\n'))
    // La carte montre le vrai chemin (le dossier temporaire peut être écrit en nom court 8.3).
    expect(text).toContain(realpathSync.native(f))
    expect(text).toMatch(/Contenu remplacé · 8 → 8 ligne\(s\)/)
    expect(text).toMatch(/^- - $/m)
    expect(text).toMatch(/^\+ - Un assistant Windows$/m)
    expect(text).toMatch(/^\+ - Il agit vraiment$/m)
    expect(text).not.toMatch(/^[-+] # Essai$/m)
  })

  it('nouveau fichier, et longue liste coupée', async () => {
    const text = describeTextEdit(await plan(join(notes, 'neuf.md'), Array.from({ length: 40 }, (_, i) => `ligne ${i}`).join('\n')))
    expect(text).toMatch(/Nouveau fichier · 40 ligne\(s\)/)
    expect(text).toMatch(/\+ ligne 0/)
    expect(text).toMatch(/… 24 autre\(s\) ligne\(s\) changée\(s\)/)
  })

  it('modèle de note rempli (cas réel) : seules les lignes vides remplies changent, les titres situent', async () => {
    const f = join(notes, 'Essai.md')
    writeFileSync(f, '# Essai\n\n## L’idée en une phrase\n- \n\n## Pourquoi c’est intéressant\n- \n')
    const text = describeTextEdit(await plan(f, '# Essai\n\n## L’idée en une phrase\n- Un assistant\n\n## Pourquoi c’est intéressant\n- Il agit\n'))
    expect(text.split('\n\n')[1]).toBe(
      ['  …', '  ## L’idée en une phrase', '- - ', '+ - Un assistant', '  …', '  ## Pourquoi c’est intéressant', '- - ', '+ - Il agit'].join('\n')
    )
  })
})

describe('comparaison ligne à ligne', () => {
  it('garde ce qui ne change pas, même entre deux changements', () => {
    expect(lineDiff(['a', 'b', 'c', 'd'], ['a', 'B', 'c', 'd', 'e']).map((d) => `${d.op}${d.text}`)).toEqual([' a', '-b', '+B', ' c', ' d', '+e'])
    expect(lineDiff([], ['x']).map((d) => d.op)).toEqual(['+'])
    expect(lineDiff(['x'], ['x']).map((d) => d.op)).toEqual([' '])
  })
})

describe('écrire et annuler', () => {
  it('garde l’ancienne version et la remet, marque UTF-8 comprise', async () => {
    const f = join(notes, 'Essai.md')
    const original = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('# Essai\r\n- \r\n')])
    writeFileSync(f, original)
    const edit = await applyTextEdit(await plan(f, '# Essai\n- Rempli\n'), journal)
    expect(edit.id).toBe('e1')
    expect(readFileSync(f, 'utf8')).toBe(`${String.fromCharCode(0xfeff)}# Essai\r\n- Rempli\r\n`)
    expect(await undoTextEdit(journal, { id: 'e1' }, async () => undefined)).toEqual({ path: expect.stringMatching(/Essai\.md$/) })
    expect(readFileSync(f).equals(original)).toBe(true)
    expect(await undoTextEdit(journal, { id: 'e1' }, async () => undefined)).toEqual({ error: expect.stringMatching(/déjà été annulée/) })
  })

  it('n’écrase jamais un changement fait ensuite', async () => {
    const f = join(notes, 'a.md')
    writeFileSync(f, 'avant')
    await applyTextEdit(await plan(f, 'Compi'), journal)
    writeFileSync(f, 'Compi, puis l’utilisateur')
    expect(await undoTextEdit(journal, { path: f }, async () => undefined)).toEqual({ error: expect.stringMatching(/a changé depuis/) })
    expect(readFileSync(f, 'utf8')).toBe('Compi, puis l’utilisateur')
  })

  it('un fichier créé part à la corbeille, et seulement lui', async () => {
    const f = join(notes, 'neuf.md')
    await applyTextEdit(await plan(f, 'bonjour'), journal)
    const trashed: string[] = []
    expect(await undoTextEdit(journal, {}, async (p) => void trashed.push(p))).toEqual({ path: expect.stringMatching(/neuf\.md$/) })
    expect(trashed).toHaveLength(1)
    expect(trashed[0]).toMatch(/neuf\.md$/)
  })

  it(`garde les ${KEEP_EDITS} dernières modifications`, async () => {
    const f = join(notes, 'a.md')
    writeFileSync(f, 'v0')
    for (let i = 1; i <= KEEP_EDITS + 2; i++) await applyTextEdit(await plan(f, `v${i}`), journal)
    const list = JSON.parse(readFileSync(join(journal, 'journal.json'), 'utf8')) as Array<{ id: string }>
    expect(list).toHaveLength(KEEP_EDITS)
    expect(list[0].id).toBe('e3')
    expect(existsSync(join(journal, 'e1.bak'))).toBe(false)
    expect(existsSync(join(journal, 'e3.bak'))).toBe(true)
    expect(await undoTextEdit(journal, { id: 'e1' }, async () => undefined)).toEqual({ error: expect.stringMatching(/Aucune modification/) })
  })
})
