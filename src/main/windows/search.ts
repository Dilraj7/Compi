// Recherche de fichiers sur tout le PC, par l'index de Windows Search (le même
// que la recherche du menu Démarrer). La requête SQL est construite ici, avec
// tout le texte de l'utilisateur échappé ; l'hôte n'exécute que des SELECT.

import { callHost } from './host'

export const FILE_KINDS = ['document', 'picture', 'music', 'video', 'folder', 'program'] as const
export type FileKind = (typeof FILE_KINDS)[number]

export interface FileSearch {
  query: string
  kind?: FileKind
  /** Modifiés il y a moins de N jours. */
  modifiedWithinDays?: number
  limit?: number
}

export interface FileHit {
  path: string
  name: string
  /** Date ISO (UTC). */
  modified?: string | null
  size?: number | null
  kind?: string
}

/** Mots de la recherche : sans caractères de contrôle, guillemets ni points-virgules, 6 au plus. */
export function searchWords(query: string): string[] {
  return query
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle
    .replace(/[\u0000-\u001f";]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.slice(0, 40))
}

/** Littéral SQL : l'apostrophe est doublée. */
const sqlString = (s: string): string => s.replace(/'/g, "''")
/** Jokers de LIKE pris au pied de la lettre. */
const likeLiteral = (s: string): string => s.replace(/[[%_]/g, (c) => `[${c}]`)

/**
 * Requête Windows Search. `content: false` ne cherche que dans les noms de
 * fichiers (repli si la recherche dans le contenu est refusée).
 */
export function buildSearchSql(o: FileSearch, { content = true, now = new Date() }: { content?: boolean; now?: Date } = {}): string | null {
  const words = searchWords(o.query)
  if (!words.length && !o.kind && !o.modifiedWithinDays) return null
  const limit = Math.min(Math.max(Math.round(o.limit ?? 15), 1), 50)
  const where = ["SCOPE='file:'", "System.ItemUrl NOT LIKE '%/AppData/%'"]
  if (words.length) {
    const byName = words.map((w) => `System.FileName LIKE '%${sqlString(likeLiteral(w))}%'`).join(' AND ')
    const byContent = `CONTAINS(*, '${words.map((w) => `"${sqlString(w)}*"`).join(' AND ')}')`
    where.push(content ? `((${byName}) OR ${byContent})` : `(${byName})`)
  }
  if (o.kind && FILE_KINDS.includes(o.kind)) where.push(`System.Kind = '${o.kind}'`)
  if (o.modifiedWithinDays && o.modifiedWithinDays > 0) {
    const since = new Date(now.getTime() - Math.min(o.modifiedWithinDays, 3650) * 86_400_000)
    where.push(`System.DateModified >= '${since.toISOString().slice(0, 19).replace('T', ' ')}'`)
  }
  return (
    // System.ItemUrl donne le vrai chemin (System.ItemPathDisplay est traduit : « Utilisateurs », « Téléchargements »).
    `SELECT TOP ${limit} System.ItemUrl, System.ItemNameDisplay, System.DateModified, System.Size, System.Kind ` +
    `FROM SYSTEMINDEX WHERE ${where.join(' AND ')} ORDER BY System.DateModified DESC`
  )
}

/** Cherche des fichiers dans l'index de Windows. */
export async function searchFiles(o: FileSearch): Promise<FileHit[]> {
  const sql = buildSearchSql(o)
  if (!sql) return []
  try {
    return (await callHost<{ rows: FileHit[] }>('search', { sql }, 8000)).rows
  } catch (e) {
    // Certains mots font échouer la recherche dans le contenu : on se rabat sur les noms.
    const byName = buildSearchSql(o, { content: false })
    if (!byName || byName === sql || /répondu à temps|interrompu/.test((e as Error).message)) throw e
    return (await callHost<{ rows: FileHit[] }>('search', { sql: byName }, 8000)).rows
  }
}

const sizeLabel = (n: number): string =>
  n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} Go` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`

/** Liste lisible pour le modèle. */
export function formatHits(hits: FileHit[]): string {
  return hits
    .map((h) => {
      const bits = [h.modified ? `modifié le ${new Date(h.modified).toLocaleDateString('fr-FR')}` : '', h.size ? sizeLabel(h.size) : ''].filter(Boolean)
      return `- ${h.path}${bits.length ? ` (${bits.join(', ')})` : ''}`
    })
    .join('\n')
}
