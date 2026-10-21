// Format des compétences (Skills) : un dossier par compétence, avec un fichier
// SKILL.md qui commence par un en-tête YAML (name, description).
// Aucune dépendance à Electron : testé dans tests/skills.test.ts.

export interface SkillDoc {
  name: string
  description: string
  body: string
}

/** Noms acceptés par Claude : minuscules, chiffres et tirets, 64 caractères au plus. */
export const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
}

function unquote(v: string): string {
  const t = v.trim()
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t) as string
    } catch {
      return t.slice(1, -1)
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'")
  return t
}

/** Lit un SKILL.md. Renvoie null si l'en-tête est absent ou incomplet. */
export function parseSkill(markdown: string): SkillDoc | null {
  const BOM = String.fromCharCode(0xfeff)
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown.startsWith(BOM) ? markdown.slice(1) : markdown)
  if (!m) return null
  const fields: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (kv) fields[kv[1].toLowerCase()] = unquote(kv[2])
  }
  if (!fields.name || !fields.description) return null
  return { name: fields.name, description: fields.description, body: m[2].trim() }
}

/**
 * Chemin relatif sûr d'une entrée d'archive sous `prefix`, ou null si elle est
 * hors du dossier de la compétence ou tente d'en sortir (« zip slip »).
 */
export function safeEntryPath(entryName: string, prefix: string): string | null {
  const name = entryName.replace(/\\/g, '/')
  if (!name.startsWith(prefix)) return null
  const rel = name.slice(prefix.length)
  if (!rel || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/')) return null
  const parts = rel.split('/').filter((p) => p && p !== '.')
  if (!parts.length || parts.includes('..')) return null
  return parts.join('/')
}

export function serializeSkill(doc: SkillDoc): string {
  // Description entre guillemets JSON : valide en YAML même avec « : » ou des guillemets.
  return `---\nname: ${doc.name}\ndescription: ${JSON.stringify(doc.description)}\n---\n\n${doc.body.trim()}\n`
}
