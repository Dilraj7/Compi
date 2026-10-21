import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { parseSkill, safeEntryPath, serializeSkill, slugify } from '../src/main/skills/format'

const userData = mkdtempSync(join(tmpdir(), 'compi-skills-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

const store = await import('../src/main/skills/store')
const BUILTIN = await import('../src/main/skills/builtin')
const { BUILTIN_SKILLS } = BUILTIN

afterAll(() => rmSync(userData, { recursive: true, force: true }))

describe('format SKILL.md', () => {
  it('relit ce qu’il écrit, même avec des deux-points et des guillemets', () => {
    const doc = { name: 'devis', description: 'Prépare un devis : prix "TTC" et délais.', body: '# Devis\n\n1. Étape' }
    expect(parseSkill(serializeSkill(doc))).toEqual(doc)
  })

  it('accepte les en-têtes écrits à la main (BOM, guillemets simples, fins de ligne Windows)', () => {
    const md = String.fromCharCode(0xfeff) + "---\r\nname: notes\r\ndescription: 'L''essentiel'\r\n---\r\nCorps"
    expect(parseSkill(md)).toEqual({ name: 'notes', description: "L'essentiel", body: 'Corps' })
  })

  it('rejette un fichier sans name ou description', () => {
    expect(parseSkill('# Pas d’en-tête')).toBeNull()
    expect(parseSkill('---\nname: x\n---\ncorps')).toBeNull()
  })

  it('rejette les chemins d’archive qui sortent du dossier (zip slip)', () => {
    expect(safeEntryPath('skill/modeles/devis.md', 'skill/')).toBe('modeles/devis.md')
    expect(safeEntryPath('skill/../evil.txt', 'skill/')).toBeNull()
    expect(safeEntryPath('skill/a/../../evil.txt', 'skill/')).toBeNull()
    expect(safeEntryPath('C:/Windows/evil.dll', '')).toBeNull()
    expect(safeEntryPath('/etc/passwd', '')).toBeNull()
    expect(safeEntryPath('autre/fichier.md', 'skill/')).toBeNull()
  })

  it('transforme un nom libre en identifiant valide', () => {
    expect(slugify('  Résumé de Réunion !  ')).toBe('resume-de-reunion')
  })

  it('les compétences de départ ont des noms valides et une description qui dit quand les utiliser', () => {
    for (const s of BUILTIN_SKILLS) {
      expect(s.name).toMatch(/^[a-z0-9-]+$/)
      expect(s.description).toMatch(/À utiliser|utiliser/)
    }
  })
})

describe('magasin de compétences', () => {
  it('installe le plugin et les compétences de départ, une seule fois', () => {
    store.ensureSkillsPlugin()
    expect(existsSync(join(store.pluginDir(), '.claude-plugin', 'plugin.json'))).toBe(true)
    expect(store.listSkills().map((s) => s.name)).toEqual(BUILTIN_SKILLS.map((s) => s.name).sort())
    expect(store.listSkills().find((s) => s.name === 'compte-rendu-reunion')?.title).toBe('Compte-rendu de réunion')

    store.deleteSkill('redaction-email')
    store.ensureSkillsPlugin() // une compétence de départ supprimée n'est pas réinstallée
    expect(store.listSkills().some((s) => s.name === 'redaction-email')).toBe(false)
  })

  it('met à jour une compétence de départ restée telle quelle, jamais une compétence modifiée', () => {
    const { PREVIOUS_BODIES } = BUILTIN
    const skill = BUILTIN_SKILLS.find((s) => s.name === 'recherche-documents')!
    const file = join(store.pluginDir(), 'skills', skill.name, 'SKILL.md')
    const seed = join(store.pluginDir(), '.compi.json')
    const oldText = serializeSkill({ ...skill, body: PREVIOUS_BODIES[skill.name](skill.body) })
    expect(oldText).not.toBe(serializeSkill(skill))

    // Version 1 installée, jamais modifiée : elle passe à la nouvelle.
    writeFileSync(file, oldText)
    writeFileSync(seed, JSON.stringify({ version: 1, removed: ['redaction-email'] }))
    store.ensureSkillsPlugin()
    expect(readFileSync(file, 'utf8')).toBe(serializeSkill(skill))

    // Modifiée par l'utilisateur : on n'y touche pas.
    const mine = oldText.replace('N\'invente jamais', 'Ne devine jamais')
    writeFileSync(file, mine)
    writeFileSync(seed, JSON.stringify({ version: 1, removed: ['redaction-email'] }))
    store.ensureSkillsPlugin()
    expect(readFileSync(file, 'utf8')).toBe(mine)
  })

  it('crée, renomme et filtre les compétences actives', () => {
    const name = store.saveSkill({ name: 'Préparer un devis', description: 'Devis client.', body: 'Étapes…' })
    expect(name).toBe('preparer-un-devis')
    const renamed = store.saveSkill({ name: 'devis', description: 'Devis client.', body: 'Étapes…', previousName: name })
    expect(existsSync(join(store.pluginDir(), 'skills', 'preparer-un-devis'))).toBe(false)
    expect(store.getSkill(renamed)?.body).toBe('Étapes…')
    expect(store.enabledSkillIds(['devis'])).not.toContain('compi:devis')
    expect(store.enabledSkillIds([])).toContain('compi:devis')
  })

  it('refuse un doublon et une description vide', () => {
    expect(() => store.saveSkill({ name: 'devis', description: 'x', body: 'y' })).toThrow(/existe déjà/)
    expect(() => store.saveSkill({ name: 'autre', description: ' ', body: 'y' })).toThrow(/description/)
  })

  it('importe une archive sans laisser un fichier sortir du dossier (zip slip)', async () => {
    const zip = new JSZip()
    zip.file('ma-competence/SKILL.md', '---\nname: veille\ndescription: Veille concurrentielle.\n---\nCorps')
    zip.file('ma-competence/modele.md', 'Modèle')
    zip.file('ma-competence/../../evil.txt', 'piège')
    const archive = join(userData, 'veille.zip')
    writeFileSync(archive, await zip.generateAsync({ type: 'nodebuffer' }))

    const name = await store.importSkill(archive)
    expect(name).toBe('veille')
    expect(readFileSync(join(store.pluginDir(), 'skills', 'veille', 'modele.md'), 'utf8')).toBe('Modèle')
    expect(existsSync(join(store.pluginDir(), 'evil.txt'))).toBe(false)
    expect(existsSync(join(userData, 'evil.txt'))).toBe(false)
  })

  it('importe un dossier et renomme en cas de conflit', async () => {
    const src = join(userData, 'source-veille')
    mkdirSync(src)
    writeFileSync(join(src, 'SKILL.md'), '---\nname: veille\ndescription: Une autre veille.\n---\nCorps 2')
    const name = await store.importSkill(src)
    expect(name).toBe('veille-2')
    expect(store.getSkill('veille-2')?.name).toBe('veille-2')
  })
})
