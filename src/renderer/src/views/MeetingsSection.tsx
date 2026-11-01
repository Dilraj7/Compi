// Réglages « Appels et réunions » : le pack des voix (téléchargé seulement sur
// un clic, taille affichée, supprimable), garder le son ou non, résumé à la fin.

import { Fragment, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Download, FolderOpen, Lock, RotateCcw, Trash2, X } from 'lucide-react'
import { brainLabel, defaultBrain } from '@shared/brains'
import { MEETING_LANGUAGES } from '@shared/meetingLanguage'
import { DEFAULT_NOTE_FILE, DEFAULT_NOTE_TEMPLATE, NOTE_VARIABLES } from '@shared/meetingNotes'
import { isOnline } from '@shared/privacy'
import { LEGACY_VOICES_PACK, VOICES_PACK } from '@shared/speechModels'
import { sizeLabel } from '@shared/voice'
import type { MeetingLanguage, MeetingNotesSettings, MeetingSettings, PublicSettings, Settings, SpeechModelStatus } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, Row, Section, Segmented, TextInput, Toggle } from '../components/ui'

type Props = { s: PublicSettings; update: (patch: Partial<Settings>) => void }

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function MeetingsSection({ s, update }: Props) {
  const m = s.meetings
  const set = (patch: Partial<MeetingSettings>): void => update({ meetings: { ...m, ...patch } })
  const [status, setStatus] = useState<SpeechModelStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.compi.speechModelStatus('voices').then(setStatus)
    return window.compi.onSpeechModelProgress((st) => st.model === 'voices' && setStatus(st))
  }, [])

  const dl = status?.downloading?.model === 'voices' ? status.downloading : undefined
  const brain = defaultBrain(s)
  const online = isOnline(brain.provider)

  const download = (): void => {
    setError('')
    window.compi.speechModelDownload('voices').then(setStatus, (e: Error) => {
      setError(cleanError(e))
      void window.compi.speechModelStatus('voices').then(setStatus)
    })
  }

  return (
    <>
      <Section
        title="Appels et réunions"
        hint="Historique › Réunions : enregistre un appel, transcrit sur ton PC, puis résumé. Rien ne commence sans ton clic."
      >
        <Row
          label={<span className="inline-flex items-center gap-2">Séparer les voix des autres {status?.installed && <Badge color="#4ADE80">prêt</Badge>}</span>}
          hint={
            status?.installed ? (
              <span className="inline-flex items-center gap-1">
                <Lock size={10} /> {status.sizeBytes ? sizeLabel(status.sizeBytes) : ''} sur ton PC ·{' '}
                {(status.outdated ? LEGACY_VOICES_PACK : VOICES_PACK).license}
              </span>
            ) : (
              `« Personne 1 », « Personne 2 »… au lieu de « Les autres ». Pack de deux petits modèles (${sizeLabel(VOICES_PACK.approxMb, true)}), depuis Hugging Face.`
            )
          }
        >
          {dl ? (
            <div className="flex w-44 items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <motion.div
                  className="h-full rounded-full bg-[var(--led)]"
                  animate={{ width: `${dl.total ? (dl.received / dl.total) * 100 : 2}%` }}
                  transition={{ ease: 'linear', duration: 0.2 }}
                />
              </div>
              <Button size="sm" variant="ghost" onClick={() => void window.compi.speechModelCancel()} title="Annuler">
                <X size={13} />
              </Button>
            </div>
          ) : status?.installed ? (
            <div className="flex items-center gap-1">
              <Toggle checked={m.voices} onChange={(voices) => set({ voices })} label="Séparer les voix" />
              <Button size="sm" variant="ghost" onClick={() => void window.compi.speechModelDelete('voices').then(setStatus)} title="Supprimer le pack du PC">
                <Trash2 size={13} />
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="subtle" onClick={download} disabled={Boolean(status?.downloading)}>
              <Download size={13} /> Télécharger ({sizeLabel(VOICES_PACK.approxMb, true)})
            </Button>
          )}
        </Row>
        {status?.outdated && !dl && (
          <div className="flex items-center justify-between gap-3 px-3.5 pb-2 text-[11.5px] text-white/55">
            <span>Un modèle des voix plus fiable existe : il distingue mieux deux personnes. L’ancien sert en attendant.</span>
            <Button size="sm" variant="subtle" onClick={download} disabled={Boolean(status.downloading)}>
              <Download size={13} /> Mettre à jour ({sizeLabel(VOICES_PACK.approxMb, true)})
            </Button>
          </div>
        )}
        {error && <div className="px-3.5 pb-2 text-[11.5px] text-led-amber">{error}</div>}
        <Row
          label="Résumer à la fin de l’appel"
          hint={
            online
              ? s.privacy.meetings === 'always'
                ? `Avec ${brainLabel(brain, s)} : tes réglages permettent d’envoyer les réunions.`
                : `Ton cerveau est en ligne (${brainLabel(brain, s)}) : le résumé attend ton clic sur « Résumer ».`
              : 'Fait sur ton PC par ton cerveau local.'
          }
        >
          <Toggle checked={m.autoSummary} onChange={(autoSummary) => set({ autoSummary })} label="Résumer à la fin" />
        </Row>
        <Row
          label="Langue des réunions"
          hint="La reconnaissance choisit la langue phrase par phrase et se trompe parfois (du français écrit en anglais). Compi reprend ces phrases ; en Auto, il suit la langue de la plupart des phrases."
        >
          <Segmented<MeetingLanguage>
            id="meeting-language"
            value={m.language}
            options={MEETING_LANGUAGES.map((l) => ({ value: l.id, label: l.label }))}
            onChange={(language) => set({ language })}
          />
        </Row>
        <Row label="Garder le son" hint="Par défaut, le son est effacé dès que la transcription est prête ; seul le texte reste sur ton PC.">
          <Toggle checked={m.keepAudio} onChange={(keepAudio) => set({ keepAudio })} label="Garder le son" />
        </Row>
        {!m.keepAudio && (
          <Row
            label="Corriger les voix pendant 24 h"
            hint="Le son de l’appel (pas ton micro) reste 24 h, pour refaire la séparation des voix si elle s’est trompée. Puis il est effacé tout seul."
          >
            <Toggle checked={m.redoAudio} onChange={(redoAudio) => set({ redoAudio })} label="Garder le son de l’appel 24 h" />
          </Row>
        )}
        <Row
          label="Transcription flottante"
          hint={`Dès le début de l’appel, une petite fenêtre reste devant ton appli de visio : pose-la où tu veux. Elle s’efface en plein écran.${s.hideFromCapture ? ' Invisible pour les autres quand tu partages ton écran.' : ''}`}
        >
          <Toggle checked={m.floating.auto} onChange={(auto) => set({ floating: { ...m.floating, auto } })} label="Transcription flottante automatique" />
        </Row>
        <Row label="Enregistrer un appel" hint="Prévenir les participants est obligatoire. Un point rouge reste visible pendant tout l’enregistrement.">
          <Button
            size="sm"
            variant="subtle"
            onClick={() => {
              useCompi.getState().setHistoryTab('meetings')
              useCompi.getState().openMeeting(null)
              useCompi.getState().setView('history')
            }}
          >
            Ouvrir Réunions
          </Button>
        </Row>
      </Section>
      <NotesSection notes={m.notes} set={(notes) => set({ notes })} />
    </>
  )
}

/** Notes de réunion : dossier (un coffre Obsidian…), nom des fichiers, modèle, ouverture. */
function NotesSection({ notes, set }: { notes: MeetingNotesSettings; set: (n: MeetingNotesSettings) => void }) {
  const [fileName, setFileName] = useState(notes.fileName)
  const [template, setTemplate] = useState(notes.template)
  const [showVars, setShowVars] = useState(false)
  useEffect(() => setFileName(notes.fileName), [notes.fileName])
  useEffect(() => setTemplate(notes.template), [notes.template])
  const save = (patch: Partial<MeetingNotesSettings>): void => set({ ...notes, ...patch })

  return (
    <Section
      title="Notes de réunion"
      hint="« Ajouter à mes notes » et « ajoute-la dans Obsidian » écrivent une note Markdown d’après ton modèle, toujours sous un nouveau nom. Annuler la retire."
    >
      <Row
        label="Dossier des notes"
        hint={
          notes.folder ? (
            <span className="inline-flex items-center gap-1 [overflow-wrap:anywhere]">
              <FolderOpen size={11} /> {notes.folder}
            </span>
          ) : (
            'Un coffre Obsidian, Logseq ou n’importe quel dossier. Il devient un dossier confié.'
          )
        }
      >
        <Button size="sm" variant="subtle" onClick={() => void window.compi.pickNotesFolder().then((p) => useCompi.getState().setSettings(p))}>
          <FolderOpen size={13} /> {notes.folder ? 'Changer' : 'Choisir'}
        </Button>
      </Row>
      {notes.folder && (
        <>
          <Row label="Ouvrir les notes avec" hint="Obsidian ouvre la note dans ton coffre ; sinon, l’appli par défaut des fichiers .md.">
            <Segmented
              id="notes-open"
              value={notes.openWith}
              onChange={(openWith) => save({ openWith })}
              options={[
                { value: 'obsidian', label: 'Obsidian' },
                { value: 'system', label: 'Appli par défaut' }
              ]}
            />
          </Row>
          <div className="space-y-1.5 border-t border-white/[0.05] px-3.5 py-3">
            <div className="text-[12.5px] text-fog-100">Nom du fichier</div>
            <TextInput
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              onBlur={() => fileName !== notes.fileName && save({ fileName })}
              placeholder={DEFAULT_NOTE_FILE}
              aria-label="Nom du fichier des notes"
            />
            <div className="text-[11.5px] text-fog-500">
              Un sous-dossier est possible : « Réunions/{'{{date}}'} {'{{titre}}'} ». « .md » est ajouté.
            </div>
          </div>
          <div className="space-y-1.5 border-t border-white/[0.05] px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[12.5px] text-fog-100">Modèle de la note</div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setShowVars((v) => !v)}>
                  {showVars ? 'Masquer les variables' : 'Variables'}
                </Button>
                {notes.template !== DEFAULT_NOTE_TEMPLATE && (
                  <Button size="sm" variant="ghost" onClick={() => save({ template: DEFAULT_NOTE_TEMPLATE })}>
                    <RotateCcw size={12} /> Par défaut
                  </Button>
                )}
              </div>
            </div>
            {showVars && (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px]">
                {NOTE_VARIABLES.map((v) => (
                  <Fragment key={v.name}>
                    <code className="font-mono text-[var(--led)]">{`{{${v.name}}}`}</code>
                    <span className="text-fog-500">{v.what}</span>
                  </Fragment>
                ))}
              </div>
            )}
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              onBlur={() => template !== notes.template && save({ template })}
              spellCheck={false}
              rows={10}
              aria-label="Modèle de la note"
              className="scroll-y w-full resize-y rounded-xl bg-white/[0.05] px-3 py-2 font-mono text-[11.5px] leading-relaxed text-fog-100 ring-1 ring-inset ring-white/[0.07] outline-none select-text focus:ring-[var(--led)]/50"
            />
          </div>
        </>
      )}
    </Section>
  )
}
