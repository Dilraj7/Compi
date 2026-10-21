import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createFolders, insideScope, inventory, moveItems, undoMoves, type FolderScope } from '../src/main/agent/folderOps'

// Chemin réel : les déplacements renvoient des chemins réels (sans noms courts 8.3).
const base = realpathSync.native(mkdtempSync(join(tmpdir(), 'compi-folders-')))
let desk = ''
let outside = ''
let pub = ''
let journal = ''
let scope: FolderScope

const touch = (path: string, text = 'x'): string => {
  writeFileSync(path, text)
  return path
}

beforeEach(() => {
  rmSync(base, { recursive: true, force: true })
  desk = join(base, 'Desktop')
  outside = join(base, 'Ailleurs')
  pub = join(base, 'Public', 'Desktop')
  journal = join(base, 'moves')
  for (const d of [desk, outside, pub]) mkdirSync(d, { recursive: true })
  scope = { roots: [desk], publicDesktop: pub, readShortcut: (p) => (p.endsWith('Cassé.lnk') ? join(base, 'disparu.exe') : join(outside, 'app.exe')) }
})

afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('dossiers confiés : périmètre', () => {
  it('accepte un chemin confié (même à créer), refuse relatif, réseau et hors périmètre', async () => {
    expect(await insideScope(join(desk, 'Documents', 'neuf'), scope)).toBeTruthy()
    expect(await insideScope('Desktop\\a.txt', scope)).toBeNull()
    expect(await insideScope('\\\\serveur\\partage\\a.txt', scope)).toBeNull()
    expect(await insideScope(outside, scope)).toBeNull()
    expect(await insideScope(join(desk, '..', 'Ailleurs'), scope)).toBeNull()
  })

  it('une jonction qui sort du dossier confié ne permet pas d’en sortir', async () => {
    symlinkSync(outside, join(desk, 'Raccourci vers ailleurs'), 'junction')
    touch(join(outside, 'secret.txt'))
    expect(await insideScope(join(desk, 'Raccourci vers ailleurs', 'secret.txt'), scope)).toBeNull()
    await expect(inventory(join(desk, 'Raccourci vers ailleurs'), scope)).rejects.toThrow(/confié/)
  })
})

describe('dossiers confiés : inventaire', () => {
  it('liste fichiers, dossiers, raccourcis (cible, cassé), liens web, et le Bureau public à part', async () => {
    mkdirSync(join(desk, 'Projets'))
    touch(join(desk, 'facture.pdf'), 'abc')
    touch(join(outside, 'app.exe'))
    touch(join(desk, 'Chrome.lnk'))
    touch(join(desk, 'Cassé.lnk'))
    touch(join(desk, 'Netflix.url'), '[InternetShortcut]\r\nURL=https://www.netflix.com/browse\r\n')
    touch(join(desk, 'desktop.ini'))
    touch(join(pub, 'Edge.lnk'))
    const items = await inventory(desk, scope, { withPublic: true })
    const byName = (n: string) => items.find((i) => i.name === n)!
    expect(byName('Projets').kind).toBe('folder')
    expect(byName('facture.pdf')).toMatchObject({ kind: 'file', ext: '.pdf', size: 3 })
    expect(byName('Chrome.lnk').target).toBe(join(outside, 'app.exe'))
    expect(byName('Chrome.lnk').flags).not.toContain('broken')
    expect(byName('Cassé.lnk').flags).toContain('broken')
    expect(byName('Netflix.url').target).toBe('www.netflix.com')
    expect(byName('desktop.ini').flags).toContain('system')
    expect(byName('Edge.lnk').flags).toContain('shared')
    expect((await inventory(desk, scope)).some((i) => i.name === 'Edge.lnk')).toBe(false)
  })

  it('refuse un dossier non confié', async () => {
    await expect(inventory(outside, scope)).rejects.toThrow(/confié/)
  })
})

describe('dossiers confiés : création', () => {
  it('crée, signale l’existant, refuse les noms interdits', async () => {
    mkdirSync(join(desk, 'Images'))
    const r = await createFolders(desk, ['Documents', 'Images', 'a/b', 'CON'], scope)
    expect(r.created).toEqual(['Documents'])
    expect(r.existing).toEqual(['Images'])
    expect(r.refused.map((x) => x.name)).toEqual(['a/b', 'CON'])
    expect(existsSync(join(desk, 'Documents'))).toBe(true)
    await expect(createFolders(outside, ['X'], scope)).rejects.toThrow()
  })
})

describe('dossiers confiés : déplacements et annulation', () => {
  it('déplace, crée la destination, renomme au lieu d’écraser, et garde un journal', async () => {
    touch(join(desk, 'facture.pdf'), 'nouvelle')
    mkdirSync(join(desk, 'Documents'))
    touch(join(desk, 'Documents', 'facture.pdf'), 'ancienne')
    touch(join(desk, 'photo.jpg'))
    mkdirSync(join(desk, 'Vieux projet'))
    const r = await moveItems(
      [
        { from: join(desk, 'facture.pdf'), to: 'Documents' },
        { from: join(desk, 'photo.jpg'), to: join(desk, 'Images') },
        { from: join(desk, 'Vieux projet'), to: join(desk, 'Archives') }
      ],
      scope,
      journal
    )
    expect(r.refused).toEqual([])
    expect(r.moved.map((m) => m.to)).toEqual([
      join(desk, 'Documents', 'facture (2).pdf'),
      join(desk, 'Images', 'photo.jpg'),
      join(desk, 'Archives', 'Vieux projet')
    ])
    expect(existsSync(join(desk, 'Documents', 'facture.pdf'))).toBe(true)
    expect(r.id).toBeTruthy()
    expect(readdirSync(journal)).toEqual([`${r.id}.json`])
  })

  it('refuse fichier système, Bureau public, hors périmètre, dossier confié, dossier dans lui-même, lien, destination fichier', async () => {
    touch(join(desk, 'desktop.ini'))
    touch(join(pub, 'Edge.lnk'))
    touch(join(outside, 'secret.txt'))
    mkdirSync(join(desk, 'Projets'))
    touch(join(desk, 'note.txt'))
    touch(join(desk, 'liste.txt'))
    symlinkSync(join(desk, 'Projets'), join(desk, 'Lien projets'), 'junction')
    const r = await moveItems(
      [
        { from: join(desk, 'desktop.ini'), to: 'Documents' },
        { from: join(pub, 'Edge.lnk'), to: join(desk, 'Raccourcis') },
        { from: join(outside, 'secret.txt'), to: join(desk, 'Documents') },
        { from: join(desk, 'note.txt'), to: outside },
        { from: desk, to: join(desk, 'Documents') },
        { from: join(desk, 'Projets'), to: join(desk, 'Projets', 'Sous') },
        { from: join(desk, 'Lien projets'), to: join(desk, 'Documents') },
        { from: join(desk, 'note.txt'), to: join(desk, 'liste.txt') },
        { from: join(desk, 'note.txt'), to: desk },
        { from: join(desk, 'fantome.txt'), to: 'Documents' },
        { from: 'note.txt', to: 'Documents' }
      ],
      scope,
      journal
    )
    expect(r.moved).toEqual([])
    expect(r.id).toBeUndefined()
    const why = r.refused.map((x) => x.why)
    expect(why[0]).toMatch(/système/)
    expect(why[1]).toMatch(/administrateur/)
    expect(why[2]).toMatch(/hors des dossiers confiés/)
    expect(why[3]).toMatch(/destination hors/)
    expect(why[4]).toMatch(/dossier confié lui-même/)
    expect(why[5]).toMatch(/lui-même/)
    expect(why[6]).toMatch(/lien/)
    expect(why[7]).toMatch(/est un fichier/)
    expect(why[8]).toMatch(/déjà dans ce dossier/)
    expect(why[9]).toMatch(/introuvable/)
    expect(why[10]).toMatch(/absolu/)
    expect(existsSync(join(desk, 'desktop.ini')) && existsSync(join(outside, 'secret.txt')) && existsSync(join(desk, 'Projets'))).toBe(true)
  })

  it('plus de 200 déplacements : le surplus est refusé', async () => {
    const moves = Array.from({ length: 202 }, (_, i) => ({ from: join(desk, `f${i}.txt`), to: 'Documents' }))
    const r = await moveItems(moves, scope, journal)
    expect(r.refused.filter((x) => /plus de 200/.test(x.why))).toHaveLength(2)
  })

  it('annule le dernier rangement sans rien écraser, une seule fois', async () => {
    touch(join(desk, 'a.pdf'))
    touch(join(desk, 'b.pdf'))
    const r = await moveItems(
      [
        { from: join(desk, 'a.pdf'), to: 'Documents' },
        { from: join(desk, 'b.pdf'), to: 'Documents' }
      ],
      scope,
      journal
    )
    // Un nouveau « b.pdf » est apparu entre-temps : il n'est pas écrasé.
    touch(join(desk, 'b.pdf'), 'nouveau')
    const u = await undoMoves(undefined, scope, journal)
    expect(u.id).toBe(r.id)
    expect(u.restored.map((m) => m.to)).toEqual([join(desk, 'a.pdf')])
    expect(u.skipped[0].why).toMatch(/porte déjà ce nom/)
    expect(existsSync(join(desk, 'Documents', 'b.pdf'))).toBe(true)
    expect(readdirSync(journal)).toEqual([`${r.id}.undone.json`])
    expect((await undoMoves(undefined, scope, journal)).skipped[0].why).toMatch(/aucun rangement/)
  })

  it('deux rangements dans la même milliseconde ont deux journaux', async () => {
    touch(join(desk, 'a.pdf'))
    touch(join(desk, 'b.pdf'))
    const [r1, r2] = await Promise.all([
      moveItems([{ from: join(desk, 'a.pdf'), to: 'Documents' }], scope, journal),
      moveItems([{ from: join(desk, 'b.pdf'), to: 'Images' }], scope, journal)
    ])
    expect(r1.id).not.toBe(r2.id)
  })
})
