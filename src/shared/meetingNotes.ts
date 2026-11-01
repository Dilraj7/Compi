// Notes de réunion : la note Markdown écrite dans le dossier choisi par l'utilisateur
// (un coffre Obsidian, Logseq ou n'importe quel dossier), d'après son modèle, et la
// réunion dont parle une demande (« la dernière », « celle avec Nexa »). Fonctions
// pures, testées dans tests/meetingNotes.test.ts.

import { formatDuration, speakerLabel, transcriptText } from './meetings'
import { foldText } from './memory'
import { localDay } from './tasks'
import type { Meeting, MeetingMeta } from './types'

export { cleanNotes, DEFAULT_MEETING_NOTES, DEFAULT_NOTE_FILE, DEFAULT_NOTE_TEMPLATE } from './meetings'

/** Variables du modèle, avec ce qu'elles donnent (pour l'aide des réglages). */
export const NOTE_VARIABLES: Array<{ name: string; what: string }> = [
  { name: 'titre', what: 'titre de la réunion' },
  { name: 'date', what: 'AAAA-MM-JJ' },
  { name: 'heure', what: 'HH:MM du début' },
  { name: 'jour', what: '« vendredi 31 octobre 2026 »' },
  { name: 'duree', what: '« 42 min »' },
  { name: 'participants', what: 'Moi, Paul, Personne 2' },
  { name: 'participants_liens', what: '[[Paul]], [[Marie]] (les voix nommées)' },
  { name: 'resume', what: 'le résumé' },
  { name: 'points', what: 'liste des points clés' },
  { name: 'taches', what: 'cases à cocher - [ ] avec qui et quand' },
  { name: 'transcription', what: 'toute la transcription' },
  { name: 'notes', what: 'ce que Compi ajoute à ta demande (vide sinon)' }
]

const DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const two = (n: number): string => String(n).padStart(2, '0')

/** Participants dans l'ordre où ils parlent la première fois. */
export function participants(m: Pick<Meeting, 'lines' | 'names'>): string[] {
  const seen: string[] = []
  for (const l of m.lines) if (!seen.includes(l.who)) seen.push(l.who)
  return seen.map((w) => speakerLabel(w, m.names))
}

export function noteVariables(m: Meeting, notes = ''): Record<string, string> {
  const d = new Date(m.startedAt)
  const s = m.summary
  const named = [
    ...new Set(
      Object.values(m.names)
        .map((n) => n.trim())
        .filter(Boolean)
    )
  ]
  return {
    titre: m.title,
    date: localDay(d),
    heure: `${two(d.getHours())}:${two(d.getMinutes())}`,
    jour: DAY.format(d),
    duree: formatDuration(m.durationMs),
    participants: participants(m).join(', '),
    participants_liens: named.map((n) => `[[${n}]]`).join(', '),
    resume: s?.summary || '_Pas encore de résumé._',
    points: s?.points.length ? s.points.map((p) => `- ${p}`).join('\n') : '_Aucun._',
    taches: s?.tasks.length
      ? s.tasks.map((t) => `- [ ] ${t.text}${t.owner ? ` — ${t.owner}` : ''}${t.due ? ` (échéance : ${t.due})` : ''}`).join('\n')
      : '_Aucune tâche._',
    transcription: transcriptText(m),
    notes: notes.trim()
  }
}

/** Remplace `{{ nom }}` ; une variable inconnue reste telle quelle (l'erreur se voit). */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (all, name: string) => vars[name.toLowerCase()] ?? all)
}

/** La note complète : modèle rempli, sans grands vides, finie par un saut de ligne. */
export function renderNote(m: Meeting, template: string, notes = ''): string {
  return `${renderTemplate(template, noteVariables(m, notes))
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()}\n`
}

/**
 * Chemin relatif de la note (dans le dossier des notes) d'après le modèle de nom :
 * sous-dossiers permis, caractères interdits par Windows retirés, `.md` ajouté.
 * `null` si le nom ne donne rien d'utilisable.
 */
export function noteRelativePath(pattern: string, vars: Record<string, string>): string | null {
  // Un « / » dans le titre ne crée pas de sous-dossier : seuls ceux du modèle comptent.
  const flat = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, v.replace(/[\\/]/g, '-').replace(/\n.*/s, '')]))
  const raw = renderTemplate(pattern, flat).split(/[\\/]+/)
  if (raw.some((p) => /^\s*\.+\s*$/.test(p))) return null
  const parts = raw
    .map((p) =>
      p
        .replace(/[<>:"|?*]/g, ' ')
        // eslint-disable-next-line no-control-regex -- on retire justement les caractères de contrôle
        .replace(/[\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/, '')
        .slice(0, 120)
    )
    .filter(Boolean)
  if (!parts.length) return null
  const last = parts.length - 1
  if (!/\.(md|markdown|txt)$/i.test(parts[last])) parts[last] = `${parts[last]}.md`
  return parts.join('\\')
}

/** Un autre nom quand la note existe déjà : « … (2).md », « … (3).md »… */
export function numberedPath(path: string, n: number): string {
  return path.replace(/(\.[^.\\/]+)?$/, (ext) => ` (${n})${ext}`)
}

/** Lien qui ouvre la note dans Obsidian (si le dossier est un de ses coffres). */
export const obsidianUri = (path: string): string => `obsidian://open?path=${encodeURIComponent(path)}`

// ─── Quelle réunion ? ────────────────────────────────────────────────────────

const STOP = new Set([
  'la',
  'le',
  'les',
  'de',
  'des',
  'du',
  'avec',
  'celle',
  'celui',
  'reunion',
  'appel',
  'call',
  'mon',
  'ma',
  'mes',
  'notre',
  'sur',
  'pour',
  'et'
])
const LAST = /\b(derniere|dernier|recente|recent|precedente|precedent|last)\b/

const dateWords = (at: number): string => foldText(DAY.format(new Date(at)))

/**
 * La réunion dont parle `query` : un identifiant, « la dernière », ou des mots du titre
 * ou de la date (« nexa », « mardi »). Les réunions en cours d'enregistrement ne comptent
 * pas. La plus récente si rien n'est dit.
 */
export function findMeeting(list: MeetingMeta[], query: string | undefined): MeetingMeta | null {
  const done = list.filter((m) => m.status !== 'recording').sort((a, b) => b.startedAt - a.startedAt)
  if (!done.length) return null
  const q = String(query ?? '').trim()
  const byId = done.find((m) => m.id === q)
  if (byId) return byId
  const terms = foldText(q)
    .split(' ')
    .filter((t) => t.length > 2 && !STOP.has(t) && !LAST.test(t))
  if (terms.length) {
    let best: MeetingMeta | null = null
    let bestScore = 0
    for (const m of done) {
      const title = foldText(m.title)
      const hay = `${title} ${dateWords(m.startedAt)}`
      const score = terms.filter((t) => hay.includes(t)).length * 2 + terms.filter((t) => title.includes(t)).length
      if (score > bestScore) [best, bestScore] = [m, score]
    }
    if (best) return best
    // Des mots, mais aucun ne correspond : pas de réunion devinée, sauf « la dernière ».
    if (!LAST.test(foldText(q))) return null
  }
  return done[0]
}

/** Une ligne par réunion, pour le cerveau. */
export function meetingLine(m: MeetingMeta): string {
  const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(
    new Date(m.startedAt)
  )
  const state = m.status === 'processing' ? ' · mise au propre en cours' : m.status === 'interrupted' ? ' · interrompue' : m.hasSummary ? '' : ' · sans résumé'
  return `- ${m.title} (id ${m.id}) · ${when} · ${formatDuration(m.durationMs)}${state}`
}

/** Ce que le cerveau reçoit d'une réunion : résumé, points, tâches, et la transcription si demandée (par parties). */
export function meetingForBrain(m: Meeting, o: { transcript?: boolean; part?: number; partChars?: number } = {}): string {
  const s = m.summary
  const out = [
    `Réunion « ${m.title} » (id ${m.id}), ${DAY.format(new Date(m.startedAt))}, ${formatDuration(m.durationMs)}.`,
    `Participants : ${participants(m).join(', ') || 'inconnus'}.`
  ]
  if (s) {
    out.push('', `Résumé : ${s.summary}`)
    if (s.points.length) out.push('', 'Points clés :', ...s.points.map((p) => `- ${p}`))
    if (s.tasks.length) out.push('', 'Tâches :', ...s.tasks.map((t) => `- ${t.text}${t.owner ? ` (${t.owner})` : ''}${t.due ? `, échéance : ${t.due}` : ''}`))
  } else out.push('', 'Pas encore de résumé.')
  if (!o.transcript) {
    out.push('', `Transcription : ${m.lines.length} phrase(s). Pour une question de détail (qui a dit quoi), relis-la avec transcript: true.`)
    return out.join('\n')
  }
  const text = transcriptText(m)
  const size = o.partChars ?? 24_000
  const parts = Math.max(1, Math.ceil(text.length / size))
  const part = Math.min(Math.max(1, o.part ?? 1), parts)
  out.push('', `Transcription${parts > 1 ? ` (partie ${part} sur ${parts})` : ''} :`, text.slice((part - 1) * size, part * size) || '(vide)')
  if (part < parts) out.push('', `Suite : partie ${part + 1}.`)
  return out.join('\n')
}

/** Message caché qui joint une réunion à une nouvelle discussion (« Discuter de cette réunion »). */
export function meetingContext(m: Meeting): string {
  return `<reunion-jointe>\nL'utilisateur a joint cette réunion à la discussion : ses questions en parlent.\n${meetingForBrain(m)}\nPour les détails (qui a dit quoi, chiffres, citations), lis la transcription avec mcp__compi__meeting_read (meeting: « ${m.id} », transcript: true). Pour l'ajouter à ses notes, mcp__compi__meeting_save_note.\n</reunion-jointe>`
}
