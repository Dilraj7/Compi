// Enregistrement d'un appel dans l'îlot : un point rouge et la durée dans la
// pastille, la dernière phrase en aperçu, un bandeau rouge dans le panneau.
// Visible pendant tout l'enregistrement : personne n'est enregistré en secret.

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { PictureInPicture2, Square, Users, X } from 'lucide-react'
import { clockAt, PEOPLE_CHOICES, speakerLabel } from '@shared/meetings'
import { useCompi, type CallState } from '../store'
import { useNow } from './Live'

export const REC = '#F87171'

/** Bouton qui ouvre la transcription flottante (devant l'appli de visio). */
export const FLOAT_LABEL = 'Transcription dans une fenêtre flottante, devant ton appel'

function Dot({ pulse }: { pulse: boolean }) {
  return (
    <span className="relative inline-grid size-2 place-items-center">
      {pulse && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: REC }} />}
      <span className="relative size-2 rounded-full" style={{ background: REC, boxShadow: `0 0 8px ${REC}` }} />
    </span>
  )
}

const elapsed = (c: CallState, now: number): string => clockAt((now - c.startedAt) / 1000)

/** Personnes en face, au clic : Auto → 1 → Auto. */
const nextPeople = (n?: number): number | undefined => PEOPLE_CHOICES[(n ? (PEOPLE_CHOICES as readonly number[]).indexOf(n) : -1) + 1]

/** Pastille : point rouge et durée (à gauche des yeux). */
export function CompactCall({ call }: { call: CallState }) {
  const now = useNow(call.phase === 'recording')
  return (
    <span className="flex items-center gap-1.5 pl-0.5" title="Enregistrement en cours">
      <Dot pulse={call.phase === 'recording'} />
      <span className="text-[10.5px] font-semibold tabular-nums" style={{ color: REC }}>
        {call.phase === 'recording' ? elapsed(call, now) : '…'}
      </span>
    </span>
  )
}

function lastLineText(call: CallState): string {
  const l = call.lines.at(-1)
  if (l) return `${speakerLabel(l.who)} : ${l.text}`
  if (call.phase === 'starting') return 'J’ouvre le micro…'
  return call.others ? 'Ton micro et le son de l’appel, transcrits sur ton PC' : 'Ton micro seul, transcrit sur ton PC'
}

/** Aperçu : la dernière phrase entendue et le bouton Arrêter. */
export function CallPeek({ eyes }: { eyes: ReactNode }) {
  const call = useCompi((s) => s.call)
  const now = useNow(call?.phase === 'recording')
  if (!call) return null
  const recording = call.phase === 'recording'
  return (
    <div className="flex h-full items-center gap-3.5 pr-3.5 pl-5">
      {eyes}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Dot pulse={recording} />
          <span className="led-text text-[12px] leading-tight" style={{ color: REC, textShadow: `0 0 10px ${REC}88` }}>
            {recording ? `Enregistrement · ${elapsed(call, now)}` : call.phase === 'starting' ? 'Préparation' : 'Je mets l’appel au propre'}
          </span>
        </div>
        <div className="mt-0.5 truncate text-[12px] text-fog-300">{call.phase === 'processing' ? (call.step ?? 'Un instant…') : lastLineText(call)}</div>
      </div>
      {call.phase !== 'processing' && (
        <motion.button
          whileTap={{ scale: 0.92 }}
          aria-label={FLOAT_LABEL}
          title={FLOAT_LABEL}
          onClick={(e) => {
            e.stopPropagation()
            void window.compi.openFloating()
          }}
          className="grid size-8 shrink-0 place-items-center rounded-full text-fog-300 hover:bg-white/[0.08] hover:text-fog-100"
        >
          <PictureInPicture2 size={14} />
        </motion.button>
      )}
      {recording && (
        <motion.button
          whileTap={{ scale: 0.92 }}
          aria-label="Arrêter l’enregistrement"
          title="Arrêter l’enregistrement"
          onClick={(e) => {
            e.stopPropagation()
            void useCompi.getState().stopCall()
          }}
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{ background: REC, color: '#0b0b0f', boxShadow: `0 0 16px ${REC}66` }}
        >
          <Square size={12} fill="currentColor" />
        </motion.button>
      )}
    </div>
  )
}

/** Panneau ouvert : bandeau rouge sous l'en-tête, tant que l'appel est enregistré. */
export function CallBanner() {
  const call = useCompi((s) => s.call)
  const now = useNow(call?.phase === 'recording')
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3500)
    return () => clearTimeout(t)
  }, [confirm])
  if (!call) return null
  const recording = call.phase === 'recording'
  return (
    <div
      className="relative mx-4 mb-2 flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-3 text-[12px]"
      style={{ background: `${REC}14`, boxShadow: `inset 0 0 0 1px ${REC}40` }}
      role="status"
    >
      <Dot pulse={recording} />
      <span className="font-semibold tabular-nums" style={{ color: REC }}>
        {recording ? `Enregistrement · ${elapsed(call, now)}` : call.phase === 'starting' ? 'Préparation…' : 'Mise au propre'}
      </span>
      <span className="min-w-0 flex-1 truncate text-fog-300">{call.phase === 'processing' ? (call.step ?? '') : lastLineText(call)}</span>
      {recording && (
        <>
          {call.choosePeople && (
            <button
              onClick={() => useCompi.getState().setCallPeople(nextPeople(call.people))}
              className="flex h-6.5 shrink-0 items-center gap-1 rounded-lg px-1.5 text-[11.5px] text-fog-300 tabular-nums transition-colors hover:bg-white/[0.06] hover:text-fog-100"
              title={`Personnes en face : ${call.people ?? 'automatique'}. Clique pour changer (Auto ou 1).`}
              aria-label={`Personnes en face : ${call.people ?? 'automatique'}`}
            >
              <Users size={12} /> {call.people ?? 'Auto'}
            </button>
          )}
          <button
            onClick={() => void window.compi.openFloating()}
            className="grid size-6.5 shrink-0 place-items-center rounded-lg text-fog-300 transition-colors hover:bg-white/[0.06] hover:text-fog-100"
            title={FLOAT_LABEL}
            aria-label={FLOAT_LABEL}
          >
            <PictureInPicture2 size={13} />
          </button>
          <button
            onClick={() => (confirm ? void useCompi.getState().discardCall() : setConfirm(true))}
            className="flex h-6.5 items-center gap-1 rounded-lg px-2 text-[11.5px] text-fog-300 transition-colors hover:bg-white/[0.06] hover:text-fog-100"
            title="Arrêter sans rien garder"
          >
            <X size={12} /> {confirm ? 'Tout effacer ?' : 'Annuler'}
          </button>
          <button
            onClick={() => void useCompi.getState().stopCall()}
            className="flex h-6.5 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px] font-semibold"
            style={{ background: REC, color: '#0b0b0f' }}
          >
            <Square size={10} fill="currentColor" /> Arrêter
          </button>
        </>
      )}
    </div>
  )
}
