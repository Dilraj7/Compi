import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NOTE_FILE,
  DEFAULT_NOTE_TEMPLATE,
  findMeeting,
  meetingContext,
  meetingForBrain,
  noteRelativePath,
  noteVariables,
  numberedPath,
  obsidianUri,
  renderNote,
  renderTemplate
} from '../src/shared/meetingNotes'
import type { Meeting, MeetingMeta } from '../src/shared/types'

const at = (d: number, h = 10): number => new Date(2026, 9, d, h, 5).getTime()

const meta = (id: string, title: string, startedAt: number, extra: Partial<MeetingMeta> = {}): MeetingMeta => ({
  id,
  title,
  startedAt,
  durationMs: 42 * 60_000,
  status: 'done',
  engine: 'parakeet',
  others: true,
  hasSummary: true,
  audio: false,
  ...extra
})

const meeting: Meeting = {
  ...meta('m1', 'Point Nexa', at(27)),
  names: { s1: 'Paul' },
  lines: [
    { start: 0, end: 3, who: 'me', text: 'Bonjour à tous.' },
    { start: 4, end: 9, who: 's1', text: 'Le budget passe à 12 000 €.' },
    { start: 10, end: 12, who: 's2', text: 'D’accord.' }
  ],
  summary: {
    title: 'Point Nexa',
    summary: 'Budget validé.',
    points: ['Budget à 12 000 €'],
    tasks: [{ text: 'Envoyer le devis', owner: 'Paul', due: 'jeudi' }, { text: 'Relancer Marie' }],
    brain: 'gemma4',
    at: at(27, 11)
  }
}

describe('note de réunion', () => {
  it('remplit le modèle par défaut : en-tête YAML, tâches en cases à cocher', () => {
    const note = renderNote(meeting, DEFAULT_NOTE_TEMPLATE)
    expect(note.startsWith('---\ntype: réunion\ndate: 2026-10-27\nheure: 10:05\ndurée: 42 min\nparticipants: Moi, Paul, Personne 2\n')).toBe(true)
    expect(note).toContain('# Point Nexa')
    expect(note).toContain('- [ ] Envoyer le devis — Paul (échéance : jeudi)\n- [ ] Relancer Marie')
    expect(note).not.toContain('{{')
    expect(note).not.toMatch(/\n{3,}/)
    expect(note.endsWith('Relancer Marie\n')).toBe(true)
  })

  it('ajoute les notes de Compi et les liens des personnes nommées', () => {
    const note = renderNote(meeting, '{{participants_liens}}\n\n{{notes}}', '## Ce qu’on retient\n\nTout va bien.')
    expect(note).toBe('[[Paul]]\n\n## Ce qu’on retient\n\nTout va bien.\n')
  })

  it('une variable inconnue reste visible', () => {
    expect(renderTemplate('{{ titre }} {{inconnue}}', noteVariables(meeting))).toBe('Point Nexa {{inconnue}}')
  })

  it('sans résumé, la note le dit au lieu de rester vide', () => {
    const v = noteVariables({ ...meeting, summary: undefined })
    expect(v.resume).toBe('_Pas encore de résumé._')
    expect(v.taches).toBe('_Aucune tâche._')
  })
})

describe('nom du fichier', () => {
  const vars = noteVariables({ ...meeting, title: 'Point : Nexa / budget?' })

  it('par défaut : date et titre, sans caractère interdit, en .md', () => {
    expect(noteRelativePath(DEFAULT_NOTE_FILE, vars)).toBe('2026-10-27 Point Nexa - budget.md')
  })

  it('sous-dossier permis, remontée refusée, extension gardée', () => {
    expect(noteRelativePath('Réunions/{{date}}.markdown', vars)).toBe('Réunions\\2026-10-27.markdown')
    expect(noteRelativePath('../{{date}}', vars)).toBeNull()
    expect(noteRelativePath('  ', vars)).toBeNull()
  })

  it('numérote quand la note existe déjà', () => {
    expect(numberedPath('D:\\Coffre\\2026-10-27 Point.md', 2)).toBe('D:\\Coffre\\2026-10-27 Point (2).md')
  })

  it('lien Obsidian encodé', () => {
    expect(obsidianUri('D:\\Coffre\\Point Nexa.md')).toBe('obsidian://open?path=D%3A%5CCoffre%5CPoint%20Nexa.md')
  })
})

describe('quelle réunion ?', () => {
  const list = [
    meta('a', 'Point équipe', at(30)),
    meta('b', 'Point Nexa', at(27)),
    meta('c', 'Appel banque', at(31), { status: 'recording' }),
    meta('d', 'Revue produit', at(24))
  ]

  it('la dernière terminée, quand rien n’est précisé ou « la dernière »', () => {
    expect(findMeeting(list, '')?.id).toBe('a')
    expect(findMeeting(list, 'la dernière réunion')?.id).toBe('a')
  })

  it('par l’identifiant, le titre ou le jour', () => {
    expect(findMeeting(list, 'd')?.id).toBe('d')
    expect(findMeeting(list, 'celle avec Nexa')?.id).toBe('b')
    expect(findMeeting(list, 'mardi')?.id).toBe('b')
  })

  it('jamais celle en cours, et rien de deviné si aucun mot ne correspond', () => {
    expect(findMeeting(list, 'banque')).toBeNull()
    expect(findMeeting(list, 'comptable')).toBeNull()
    expect(findMeeting([], '')).toBeNull()
  })
})

describe('pour le cerveau', () => {
  it('résumé et tâches, puis la transcription seulement si demandée, par parties', () => {
    const short = meetingForBrain(meeting)
    expect(short).toContain('Résumé : Budget validé.')
    expect(short).toContain('transcript: true')
    expect(short).not.toContain('12 000 €.')
    const p1 = meetingForBrain(meeting, { transcript: true, partChars: 40 })
    expect(p1).toContain('partie 1 sur')
    expect(p1).toContain('Suite : partie 2.')
    const all = meetingForBrain(meeting, { transcript: true })
    expect(all).toContain('[00:04] Paul : Le budget passe à 12 000 €.')
  })

  it('le contexte joint donne l’identifiant à relire', () => {
    expect(meetingContext(meeting)).toContain('meeting: « m1 »')
  })
})
