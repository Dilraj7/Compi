import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const searchFiles = vi.fn()
vi.mock('../src/main/windows/search', () => ({ searchFiles: (...a: unknown[]) => searchFiles(...a) }))

const { byDate, filesIn, isIndexed, nameSearch, recentWalked } = await import('../src/main/search/folderFiles')

let root: string
const DAY = 86_400_000
const touch = (rel: string, ageDays: number): void => {
  const p = join(root, rel)
  writeFileSync(p, 'x')
  const t = new Date(Date.now() - ageDays * DAY)
  utimesSync(p, t, t)
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'compi-folder-'))
  mkdirSync(join(root, 'Factures'))
  mkdirSync(join(root, 'node_modules'))
  mkdirSync(join(root, '.cache'))
  touch('Factures/facture-octobre.pdf', 1)
  touch('Factures/facture-mars.pdf', 200)
  touch('notes réunion.txt', 0.1)
  touch('~$brouillon.docx', 0)
  touch('node_modules/paquet.js', 0)
  touch('.cache/cache.bin', 0)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('dossiers que Windows n’indexe pas', () => {
  it('parcourt les fichiers sans les dossiers techniques ni les brouillons Office', async () => {
    const names = (await filesIn(root)).map((f) => f.name).sort()
    expect(names).toEqual(['facture-mars.pdf', 'facture-octobre.pdf', 'notes réunion.txt'])
  })

  it('récents : les 7 derniers jours, le plus récent d’abord', async () => {
    const r = await recentWalked([root], 7, 6)
    expect(r.map((f) => f.name)).toEqual(['notes réunion.txt', 'facture-octobre.pdf'])
  })

  it('cherche par le nom, sans tenir compte des accents ni de l’extension', async () => {
    expect((await nameSearch([root], 'reunion', 8)).map((f) => f.name)).toEqual(['notes réunion.txt'])
    expect((await nameSearch([root], 'facture', 8)).length).toBe(2)
    expect(await nameSearch([root], 'pdf', 8)).toEqual([])
  })

  it('un dossier est indexé si l’index de Windows y trouve au moins un fichier', async () => {
    searchFiles.mockResolvedValueOnce([{ path: 'C:\\Users\\a\\x.txt', name: 'x.txt' }])
    expect(await isIndexed('C:\\Users\\a')).toBe(true)
    searchFiles.mockResolvedValueOnce([])
    expect(await isIndexed('D:\\Projets')).toBe(false)
    searchFiles.mockRejectedValueOnce(new Error('hôte absent'))
    expect(await isIndexed('E:\\Autre')).toBe(false)
    // Gardé en cache : pas de nouvelle requête.
    expect(await isIndexed('D:\\Projets')).toBe(false)
    expect(searchFiles).toHaveBeenCalledTimes(3)
  })

  it('fusionne par date sans doublon', () => {
    const a = [{ path: 'C:\\a.txt', name: 'a.txt', modified: '2026-10-30T10:00:00Z' }]
    const b = [
      { path: 'c:\\A.txt', name: 'a.txt', modified: '2026-10-30T10:00:00Z' },
      { path: 'D:\\b.txt', name: 'b.txt', modified: '2026-10-31T10:00:00Z' }
    ]
    expect(byDate([a, b], 5).map((f) => f.name)).toEqual(['b.txt', 'a.txt'])
  })
})
