import { describe, expect, it, vi } from 'vitest'
import { classify, folderNameProblem, formatInventory, freeName, isLauncher, movesSummary, suggestPlan, type InventoryItem } from '../src/shared/folderPlan'

vi.mock('electron', () => ({ app: { getPath: () => '.' } }))

const { activityLabel, approvalTitle } = await import('../src/main/agent/labels')

const item = (name: string, isDir = false, extra: Partial<InventoryItem> = {}): InventoryItem => {
  const c = classify(name, isDir)
  return { name, path: `C:\\Users\\u\\Desktop\\${name}`, kind: c.kind, ext: c.ext, ...extra, flags: [...c.flags, ...(extra.flags ?? [])] }
}

describe('rangement : nature des éléments', () => {
  it('reconnaît dossiers, raccourcis, liens web et fichiers', () => {
    expect(classify('Projets', true).kind).toBe('folder')
    expect(classify('Chrome.lnk', false).kind).toBe('shortcut')
    expect(classify('Netflix.url', false).kind).toBe('weblink')
    expect(classify('facture.PDF', false)).toMatchObject({ kind: 'file', ext: '.pdf' })
  })

  it('signale fichiers système, noms flous, sans extension, doublons, applis et scripts', () => {
    expect(classify('desktop.ini', false).flags).toContain('system')
    expect(classify('~$rapport.docx', false).flags).toContain('system')
    expect(classify('README', false).flags).toContain('no-ext')
    expect(classify('a.txt', false).flags).toContain('vague')
    expect(classify('Nouveau dossier', true).flags).toContain('vague')
    expect(classify('Capture d’écran 2026-10-02.png', false).flags).toContain('vague')
    expect(classify('rapport (1).pdf', false).flags).toContain('duplicate')
    expect(classify('rapport - Copie.pdf', false).flags).toContain('duplicate')
    expect(classify('Game.pak', false).flags).toContain('app')
    expect(classify('raccourcis.ahk', false).flags).toContain('script')
    expect(classify('facture-edf.pdf', false).flags).toEqual([])
  })

  it('repère ce qui lance un programme', () => {
    for (const p of ['C:\\x\\setup.exe', 'C:\\x\\run.BAT', 'C:\\x\\a.ps1', 'C:\\x\\b.vbs', 'C:\\x\\c.js', 'C:\\x\\d.ahk', 'C:\\x\\e.msi', 'C:\\x\\f.scr'])
      expect(isLauncher(p)).toBe(true)
    for (const p of ['C:\\x\\facture.pdf', 'C:\\x\\Projets', 'C:\\x\\photo.png', 'C:\\x\\Chrome.lnk']) expect(isLauncher(p)).toBe(false)
  })
})

describe('rangement : plan suggéré', () => {
  const items = [
    item('Projets', true),
    item('facture-edf.pdf'),
    item('vacances.jpg'),
    item('a.png'),
    item('README'),
    item('Chrome.lnk', false, { target: 'C:\\Program Files\\Chrome\\chrome.exe' }),
    item('Vieux jeu.lnk', false, { flags: ['broken'] }),
    item('Game.pak'),
    item('raccourcis.ahk'),
    item('desktop.ini'),
    item('Edge.lnk', false, { flags: ['shared'] }),
    item('inconnu.xyz')
  ]
  const plan = suggestPlan(items)
  const dest = (name: string): string | undefined => plan.moves.find((m) => m.item.name === name)?.folder
  const keptWhy = (name: string): string | undefined => plan.kept.find((k) => k.item.name === name)?.reason

  it('range les fichiers par famille, les noms flous et inconnus dans « À trier »', () => {
    expect(dest('facture-edf.pdf')).toBe('Documents')
    expect(dest('vacances.jpg')).toBe('Images')
    expect(dest('a.png')).toBe('À trier')
    expect(dest('README')).toBe('À trier')
    expect(dest('inconnu.xyz')).toBe('À trier')
  })

  it('laisse en place dossiers, raccourcis, applis, scripts et Bureau public ; ignore les fichiers système', () => {
    expect(keptWhy('Projets')).toMatch(/dossier/)
    expect(keptWhy('Chrome.lnk')).toMatch(/raccourci/)
    expect(keptWhy('Vieux jeu.lnk')).toMatch(/cassé/)
    expect(keptWhy('Game.pak')).toMatch(/application/)
    expect(keptWhy('raccourcis.ahk')).toMatch(/script/)
    expect(keptWhy('Edge.lnk')).toMatch(/administrateur/)
    expect(dest('desktop.ini')).toBeUndefined()
    expect(keptWhy('desktop.ini')).toBeUndefined()
  })

  it('l’inventaire donne les noms exacts, le plan, et interdit d’annoncer avant move_items', () => {
    const text = formatInventory('C:\\Users\\u\\Desktop', items)
    expect(text).toMatch(/^Inventaire de C:\\Users\\u\\Desktop : 1 dossier\(s\), 7 fichier\(s\), 2 raccourci\(s\), plus 1 raccourci\(s\) partagé/)
    expect(text).toContain('- Documents ← facture-edf.pdf')
    expect(text).toContain('→ C:\\Program Files\\Chrome\\chrome.exe')
    expect(text).toContain('raccourci cassé')
    expect(text).not.toContain('desktop.ini')
    expect(text).toContain('appelle move_items')
    expect(text).toContain("N'annonce rien comme fait avant le résultat de move_items")
    expect(formatInventory('C:\\vide', [])).toContain('Le dossier est vide.')
  })

  it('au-delà de 300 éléments, l’inventaire résume', () => {
    const many = Array.from({ length: 320 }, (_, i) => item(`photo-${String(i).padStart(3, '0')}-plage.jpg`))
    const text = formatInventory('C:\\d', many)
    expect(text).toContain('… et 20 autre(s)')
  })
})

describe('rangement : noms', () => {
  it('trouve un nom libre sans jamais écraser', () => {
    const taken = new Set(['rapport.pdf', 'rapport (2).pdf'])
    expect(freeName('rapport.pdf', (n) => taken.has(n))).toBe('rapport (3).pdf')
    expect(freeName('neuf.pdf', (n) => taken.has(n))).toBe('neuf.pdf')
    expect(freeName('Projets.2026', (n) => n === 'Projets.2026', true)).toBe('Projets.2026 (2)')
  })

  it('refuse les noms de dossier interdits par Windows', () => {
    expect(folderNameProblem('Documents')).toBeNull()
    expect(folderNameProblem('À trier')).toBeNull()
    expect(folderNameProblem('')).toMatch(/vide/)
    expect(folderNameProblem('a/b')).toMatch(/interdits/)
    expect(folderNameProblem('CON')).toMatch(/réservé/)
    expect(folderNameProblem('fin.')).toMatch(/point/)
    expect(folderNameProblem('..')).toBeTruthy()
  })
})

describe('rangement : cartes et activité', () => {
  it('la carte de déplacement montre la liste et rassure', () => {
    const card = approvalTitle('mcp__compi__move_items', {
      moves: [
        { from: 'C:\\Users\\u\\Desktop\\facture.pdf', to: 'C:\\Users\\u\\Desktop\\Documents' },
        { from: 'C:\\Users\\u\\Desktop\\vacances.jpg', to: 'Images' }
      ]
    })
    expect(card.title).toBe('Compi veut déplacer 2 élément(s)')
    expect(card.detail).toContain('facture.pdf → Documents')
    expect(card.detail).toContain('vacances.jpg → Images')
    expect(card.detail).toContain('Rien n’est supprimé ni écrasé')
    expect(movesSummary(Array.from({ length: 30 }, (_, i) => ({ from: `C:\\d\\f${i}.txt`, to: 'C:\\d\\Documents' })))).toContain('… et 5 autre(s)')
  })

  it('open_path : un programme est « lancer », un dossier « ouvrir le dossier »', () => {
    expect(approvalTitle('mcp__compi__open_path', { path: 'C:\\Users\\u\\Desktop\\setup.exe' }).title).toBe('Compi veut lancer « setup.exe »')
    expect(approvalTitle('mcp__compi__open_path', { path: 'C:\\Users\\u\\Desktop\\setup.exe' }).detail).toContain('programme ou un script')
    expect(approvalTitle('mcp__compi__open_path', { path: 'C:\\Users\\u\\Desktop\\Projets' }).title).toBe('Compi veut ouvrir le dossier « Projets »')
    expect(approvalTitle('mcp__compi__open_path', { path: 'C:\\Users\\u\\Desktop\\facture.pdf' }).title).toBe('Compi veut ouvrir « facture.pdf »')
  })

  it('cartes de création et d’annulation, libellés d’activité', () => {
    expect(approvalTitle('mcp__compi__create_folders', { parent: 'C:\\d', names: ['Documents', 'Images'] }).title).toBe('Compi veut créer 2 dossier(s)')
    expect(approvalTitle('mcp__compi__undo_moves', {}).title).toBe('Compi veut annuler le dernier rangement')
    expect(activityLabel('mcp__compi__folder_inventory', {})).toBe('Inventaire de ton Bureau')
    expect(activityLabel('mcp__compi__move_items', { moves: [{ from: 'a', to: 'b' }] })).toBe('Rangement : 1 élément(s)')
    expect(activityLabel('mcp__compi__open_folder', { path: 'C:\\d\\Images' })).toBe('Ouverture du dossier Images')
  })
})
