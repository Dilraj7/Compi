// Compétences de Compi, rangées dans un plugin local que l'Agent SDK charge :
//   %APPDATA%\Compi\skills\.claude-plugin\plugin.json
//   %APPDATA%\Compi\skills\skills\<nom>\SKILL.md
// Elles restent séparées de celles de Claude Code (~/.claude/skills).

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { app } from 'electron'
import type { SkillInfo } from '../../shared/types'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'
import { BUILTIN_SKILLS, BUILTIN_VERSION, PREVIOUS_BODIES } from './builtin'
import { parseSkill, safeEntryPath, serializeSkill, SKILL_NAME, slugify, type SkillDoc } from './format'

export const PLUGIN_NAME = 'compi'
const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const MAX_IMPORT_FILES = 500

interface SeedState {
  version: number
  /** Compétences de départ supprimées par l'utilisateur : on ne les réinstalle pas. */
  removed: string[]
}

export const pluginDir = (): string => join(app.getPath('userData'), 'skills')
const skillsDir = (): string => join(pluginDir(), 'skills')
const seedPath = (): string => join(pluginDir(), '.compi.json')
const builtinNames = new Set(BUILTIN_SKILLS.map((s) => s.name))

/** Crée le plugin et installe les compétences de départ manquantes. */
export function ensureSkillsPlugin(): void {
  mkdirSync(join(pluginDir(), '.claude-plugin'), { recursive: true })
  mkdirSync(skillsDir(), { recursive: true })
  const manifest = join(pluginDir(), '.claude-plugin', 'plugin.json')
  if (!existsSync(manifest)) {
    writeJson(manifest, { name: PLUGIN_NAME, description: 'Compétences de Compi', version: '1.0.0' })
  }
  const seed = readJson<SeedState>(seedPath(), { version: 0, removed: [] })
  if (seed.version >= BUILTIN_VERSION) return
  for (const skill of BUILTIN_SKILLS) {
    const dir = join(skillsDir(), skill.name)
    if (!existsSync(dir)) {
      if (!seed.removed.includes(skill.name)) writeSkillFile(skill)
      continue
    }
    // Compétence améliorée : remplacée seulement si l'utilisateur ne l'a pas modifiée.
    const previous = PREVIOUS_BODIES[skill.name]
    const file = join(dir, 'SKILL.md')
    if (previous && existsSync(file) && readFileSync(file, 'utf8') === serializeSkill({ ...skill, body: previous(skill.body) })) writeSkillFile(skill)
  }
  writeJson(seedPath(), { ...seed, version: BUILTIN_VERSION })
}

function writeSkillFile(doc: SkillDoc): void {
  const dir = join(skillsDir(), doc.name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), serializeSkill(doc), 'utf8')
}

export function listSkills(): SkillInfo[] {
  if (!existsSync(skillsDir())) return []
  const out: SkillInfo[] = []
  for (const entry of readdirSync(skillsDir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(skillsDir(), entry.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const doc = parseSkill(readFileSync(file, 'utf8'))
    out.push({
      name: entry.name,
      title: doc ? /^#\s+(.+)$/m.exec(doc.body)?.[1]?.trim() : undefined,
      description: doc?.description ?? 'SKILL.md invalide : en-tête name/description manquant.',
      builtin: builtinNames.has(entry.name),
      valid: Boolean(doc),
      hasFiles: readdirSync(join(skillsDir(), entry.name)).length > 1
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function getSkill(name: string): SkillDoc | null {
  if (!SKILL_NAME.test(name)) return null
  const file = join(skillsDir(), name, 'SKILL.md')
  return existsSync(file) ? parseSkill(readFileSync(file, 'utf8')) : null
}

/** Crée ou met à jour une compétence. Renvoie son nom définitif. */
export function saveSkill(input: SkillDoc & { previousName?: string }): string {
  const name = slugify(input.name)
  if (!SKILL_NAME.test(name)) throw new Error('Nom invalide : utilise des lettres, des chiffres et des tirets.')
  if (!input.description.trim()) throw new Error('Ajoute une description : c’est elle qui dit à Compi quand utiliser la compétence.')
  if (!input.body.trim()) throw new Error('Les instructions sont vides.')
  const previous = input.previousName && SKILL_NAME.test(input.previousName) ? input.previousName : undefined
  if (name !== previous && existsSync(join(skillsDir(), name))) throw new Error(`Une compétence « ${name} » existe déjà.`)
  if (previous && previous !== name && existsSync(join(skillsDir(), previous))) {
    // Renommage : on déplace le dossier pour garder les fichiers joints.
    cpSync(join(skillsDir(), previous), join(skillsDir(), name), { recursive: true })
    rmSync(join(skillsDir(), previous), { recursive: true, force: true })
  }
  writeSkillFile({ name, description: input.description.trim(), body: input.body })
  return name
}

export function deleteSkill(name: string): void {
  if (!SKILL_NAME.test(name)) return
  rmSync(join(skillsDir(), name), { recursive: true, force: true })
  if (builtinNames.has(name)) {
    const seed = readJson<SeedState>(seedPath(), { version: BUILTIN_VERSION, removed: [] })
    writeJson(seedPath(), { ...seed, removed: [...new Set([...seed.removed, name])] })
  }
}

/** Nom de destination libre (« nom », « nom-2 »…). */
function freeName(base: string): string {
  let name = slugify(base) || 'competence'
  for (let i = 2; existsSync(join(skillsDir(), name)); i++) name = `${slugify(base).slice(0, 60)}-${i}`
  return name
}

/** Importe une compétence depuis un dossier contenant SKILL.md, ou une archive .zip / .skill. */
export async function importSkill(source: string): Promise<string> {
  if (statSync(source).isDirectory()) {
    const file = join(source, 'SKILL.md')
    if (!existsSync(file)) throw new Error('Ce dossier ne contient pas de fichier SKILL.md.')
    const doc = parseSkill(readFileSync(file, 'utf8'))
    if (!doc) throw new Error('SKILL.md invalide : l’en-tête doit contenir name et description.')
    const name = freeName(doc.name || basename(source))
    cpSync(source, join(skillsDir(), name), { recursive: true })
    rewriteName(name)
    return name
  }

  const { default: JSZip } = await import('jszip')
  if (statSync(source).size > MAX_IMPORT_BYTES) throw new Error('Archive trop volumineuse (20 Mo maximum).')
  const zip = await JSZip.loadAsync(readFileSync(source))
  const entries = Object.values(zip.files).filter((f) => !f.dir)
  if (entries.length > MAX_IMPORT_FILES) throw new Error('Archive trop grande (500 fichiers maximum).')
  const skillEntry = entries
    .filter((f) => /(^|\/)SKILL\.md$/.test(f.name))
    .sort((a, b) => a.name.split('/').length - b.name.split('/').length)[0]
  if (!skillEntry) throw new Error('Aucun fichier SKILL.md dans cette archive.')
  const doc = parseSkill(await skillEntry.async('string'))
  if (!doc) throw new Error('SKILL.md invalide : l’en-tête doit contenir name et description.')

  const prefix = skillEntry.name.slice(0, -'SKILL.md'.length)
  const name = freeName(doc.name)
  const target = join(skillsDir(), name)
  let total = 0
  for (const entry of entries) {
    // Protection « zip slip » : aucun chemin ne doit sortir du dossier de la compétence.
    const rel = safeEntryPath(entry.name, prefix)
    if (!rel) continue
    const data = await entry.async('nodebuffer')
    total += data.length
    if (total > MAX_IMPORT_BYTES) throw new Error('Archive trop volumineuse une fois décompressée.')
    mkdirSync(dirname(join(target, rel)), { recursive: true })
    writeFileSync(join(target, rel), data)
  }
  rewriteName(name)
  log('info', `compétence importée : ${name}`)
  return name
}

/** Aligne le champ name du SKILL.md sur le nom du dossier (nécessaire après un renommage à l'import). */
function rewriteName(name: string): void {
  const file = join(skillsDir(), name, 'SKILL.md')
  const doc = parseSkill(readFileSync(file, 'utf8'))
  if (doc && doc.name !== name) writeFileSync(file, serializeSkill({ ...doc, name }), 'utf8')
}

/** Noms qualifiés (« compi:resume-document ») des compétences actives, pour l'option `skills` du SDK. */
export function enabledSkillIds(disabled: string[]): string[] {
  return listSkills()
    .filter((s) => s.valid && !disabled.includes(s.name))
    .map((s) => `${PLUGIN_NAME}:${s.name}`)
}
