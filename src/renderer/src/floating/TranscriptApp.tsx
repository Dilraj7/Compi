// Transcription flottante d'un appel (fenêtre à part, toujours devant l'appli de visio) :
// qui parle et ce qui se dit, la durée, « Arrêter ». Compacte : les deux dernières phrases,
// comme des sous-titres. Elle n'enregistre rien elle-même : l'îlot reste maître de l'appel.

import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Square, SunDim, Users, X } from 'lucide-react'
import { clockAt, PEOPLE_CHOICES, speakerLabel } from '@shared/meetings'
import type { FloatingCommand, FloatingState } from '@shared/types'

const REC = '#F87171'
const OPACITIES = [1, 0.85, 0.7]
const nextPeople = (n?: number): number | undefined => PEOPLE_CHOICES[(n ? (PEOPLE_CHOICES as readonly number[]).indexOf(n) : -1) + 1]
const send = (cmd: FloatingCommand): void => void window.compi.floatingCommand(cmd)
// Pas de zone de glisser sur les boutons.
const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

function useClock(on: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [on])
  return now
}

export function TranscriptApp() {
  const [st, setSt] = useState<FloatingState | null>(null)
  const list = useRef<HTMLDivElement>(null)
  const call = st?.call ?? null
  const recording = call?.phase === 'recording'
  const now = useClock(recording)

  useEffect(() => {
    document.documentElement.style.background = '#0B0D12'
    document.body.style.background = '#0B0D12'
    void window.compi.floatingState().then(setSt)
    return window.compi.onFloatingState(setSt)
  }, [])

  // La dernière phrase reste en vue, sauf si on remonte pour relire.
  useEffect(() => {
    const el = list.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 90) el.scrollTop = el.scrollHeight
  }, [call?.lines.length, st?.compact])

  if (!st) return null
  const lines = call ? (st.compact ? call.lines.slice(-2) : call.lines) : []
  const opacityIndex = OPACITIES.findIndex((o) => Math.abs(o - st.opacity) < 0.05)

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#0B0D12] text-fog-100 select-none" data-floating>
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] pr-1 pl-3" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <span className="relative inline-grid size-2.5 place-items-center">
          {recording && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: REC }} />}
          <span className="relative size-2.5 rounded-full" style={{ background: call ? REC : '#6B7280' }} />
        </span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: call ? REC : undefined }}>
          {!call ? 'Aucun appel' : recording ? clockAt((now - call.startedAt) / 1000) : call.phase === 'starting' ? 'Préparation…' : 'Mise au propre'}
        </span>
        <span className="truncate text-[11px] text-fog-500">{call ? (call.others ? 'micro + son de l’appel' : 'micro seul') : ''}</span>
        <span className="flex-1" />
        {recording && call.choosePeople && (
          <button
            style={noDrag}
            onClick={() => send({ type: 'people', people: nextPeople(call.people) })}
            className="flex h-7 items-center gap-1 rounded-lg px-1.5 text-[11px] text-fog-300 hover:bg-white/[0.07]"
            title="Personnes en face (Auto ou 1)"
          >
            <Users size={12} /> {call.people ?? 'Auto'}
          </button>
        )}
        {st.compact && recording && (
          <button
            style={{ ...noDrag, background: REC }}
            onClick={() => send({ type: 'stop' })}
            aria-label="Arrêter l’enregistrement"
            title="Arrêter l’enregistrement"
            className="grid size-6 place-items-center rounded-md text-white"
          >
            <Square size={9} fill="currentColor" />
          </button>
        )}
        <HeadButton
          label={`Transparence (${Math.round(st.opacity * 100)} %)`}
          onClick={() => send({ type: 'opacity', opacity: OPACITIES[(opacityIndex + 1) % OPACITIES.length] })}
        >
          <SunDim size={13} />
        </HeadButton>
        <HeadButton label={st.compact ? 'Tout le fil' : 'Sous-titres seulement'} onClick={() => send({ type: 'compact', compact: !st.compact })}>
          {st.compact ? <Maximize2 size={12} /> : <Minimize2 size={12} />}
        </HeadButton>
        <HeadButton label="Fermer (l’enregistrement continue)" onClick={() => send({ type: 'close' })}>
          <X size={13} />
        </HeadButton>
      </header>

      <div
        ref={list}
        className={st.compact ? 'flex min-h-0 flex-1 flex-col justify-end gap-1 overflow-hidden px-3.5 py-2' : 'scroll-y min-h-0 flex-1 space-y-2 px-3.5 py-2.5'}
      >
        {lines.length ? (
          lines.map((l, i) => (
            <div key={`${l.start}-${i}`} className={st.compact ? 'line-clamp-2 text-[14.5px] leading-snug' : 'text-[13px] leading-snug'}>
              {!st.compact && <span className="mr-1.5 text-[10.5px] text-fog-700 tabular-nums">{clockAt(l.start)}</span>}
              <span className={l.who === 'me' ? 'text-led-cyan' : 'text-[#F9A8D4]'}>{speakerLabel(l.who)}</span>
              <span className="text-fog-500"> · </span>
              <span className={st.compact && i === lines.length - 1 ? 'text-white' : 'text-fog-100'}>{l.text}</span>
            </div>
          ))
        ) : (
          <div className="text-[12.5px] text-fog-500">
            {!call
              ? 'L’appel est terminé.'
              : call.phase === 'starting'
                ? 'J’ouvre le micro…'
                : 'La transcription s’affiche ici, sur ton PC. Cette fenêtre reste devant ton appel.'}
          </div>
        )}
      </div>

      {call && !st.compact && (recording || call.phase === 'processing') && (
        <footer className="flex h-10 shrink-0 items-center gap-2 border-t border-white/[0.06] px-3">
          <span className="truncate text-[11px] text-fog-700">{call.phase === 'processing' ? (call.step ?? 'Un instant…') : 'Invisible pour les autres quand tu partages ton écran'}</span>
          <span className="flex-1" />
          {recording && (
            <button
              onClick={() => send({ type: 'stop' })}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-white"
              style={{ background: REC }}
            >
              <Square size={9} fill="currentColor" /> Arrêter
            </button>
          )}
        </footer>
      )}
    </div>
  )
}

function HeadButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      style={noDrag}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-lg text-fog-500 hover:bg-white/[0.07] hover:text-fog-100"
    >
      {children}
    </button>
  )
}
