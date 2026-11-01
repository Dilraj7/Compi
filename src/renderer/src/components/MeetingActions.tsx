// Boutons d'une réunion terminée, dans sa fiche et dans le bloc « Appel terminé » :
// « Discuter » (nouvelle discussion, la réunion jointe) et « Ajouter à mes notes » (note
// Markdown d'après le modèle choisi, dans le dossier de notes ; le clic vaut accord).

import { useState } from 'react'
import { ExternalLink, MessagesSquare, NotebookPen, RotateCcw } from 'lucide-react'
import type { Meeting } from '@shared/types'
import { useCompi } from '../store'
import { Button } from './ui'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

export function DiscussButton({ m, onOpen }: { m: Meeting; onOpen: () => void }) {
  return (
    <Button
      size="sm"
      variant="subtle"
      onClick={() => {
        useCompi.getState().discussMeeting({ id: m.id, title: m.title })
        onOpen()
      }}
      title="Une nouvelle discussion où la réunion est jointe : pose tes questions (qui a dit quoi, chiffres, suite à donner)"
      data-discuss-meeting
    >
      <MessagesSquare size={13} /> Discuter
    </Button>
  )
}

type NoteState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'saved'; path: string; editId: string } | { kind: 'undone' } | { kind: 'error'; text: string }

/** « Ajouter à mes notes », puis « Ouvrir · Annuler » une fois la note écrite. */
export function NoteButton({ m }: { m: Meeting }) {
  const folder = useCompi((s) => s.settings?.meetings.notes.folder ?? '')
  const [state, setState] = useState<NoteState>({ kind: 'idle' })

  const setup = (): void => {
    const s = useCompi.getState()
    s.setView('settings')
    s.focusSettings('meetings')
  }

  const save = async (): Promise<void> => {
    if (!folder) return setup()
    setState({ kind: 'busy' })
    const r = await window.compi.saveMeetingNote(m.id)
    if (r.ok) setState({ kind: 'saved', path: r.path, editId: r.editId })
    else if (r.needsSetup) setup()
    else setState({ kind: 'error', text: r.error })
  }

  if (state.kind === 'saved')
    return (
      <span className="inline-flex items-center gap-1 text-[11.5px] text-fog-300" data-note-saved>
        <NotebookPen size={12} className="text-led-violet" />
        <span className="max-w-[180px] truncate" title={state.path}>
          {baseName(state.path)}
        </span>
        <Button size="sm" variant="ghost" onClick={() => void window.compi.openMeetingNote(state.path)}>
          <ExternalLink size={12} /> Ouvrir
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.compi.undoTextEdit(state.editId).then((u) => setState(u.ok ? { kind: 'undone' } : { kind: 'error', text: u.message }))}
        >
          <RotateCcw size={12} /> Annuler
        </Button>
      </span>
    )

  return (
    <>
      <Button
        size="sm"
        variant="subtle"
        disabled={state.kind === 'busy'}
        onClick={() => void save()}
        title={folder ? `Une note Markdown dans ${folder}, d’après ton modèle` : 'Choisis d’abord le dossier de tes notes (un coffre Obsidian, par exemple)'}
        data-save-note
      >
        <NotebookPen size={13} /> {state.kind === 'undone' ? 'Note retirée · Refaire' : 'Ajouter à mes notes'}
      </Button>
      {state.kind === 'error' && <span className="text-[11px] text-led-red">{state.text}</span>}
    </>
  )
}
