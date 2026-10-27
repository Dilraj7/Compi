// Réglages « Appels et réunions » : le pack des voix (téléchargé seulement sur
// un clic, taille affichée, supprimable), garder le son ou non, résumé à la fin.

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Download, Lock, Trash2, X } from 'lucide-react'
import { brainLabel, defaultBrain } from '@shared/brains'
import { isOnline } from '@shared/privacy'
import { LEGACY_VOICES_PACK, VOICES_PACK } from '@shared/speechModels'
import { sizeLabel } from '@shared/voice'
import type { MeetingSettings, PublicSettings, Settings, SpeechModelStatus } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, Row, Section, Toggle } from '../components/ui'

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
    <Section title="Appels et réunions" hint="Historique › Réunions : enregistre un appel, transcrit sur ton PC, puis résumé. Rien ne commence sans ton clic.">
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
      <Row label="Garder le son" hint="Par défaut, le son est effacé dès que la transcription est prête ; seul le texte reste sur ton PC.">
        <Toggle checked={m.keepAudio} onChange={(keepAudio) => set({ keepAudio })} label="Garder le son" />
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
  )
}
