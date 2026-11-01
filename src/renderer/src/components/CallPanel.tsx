// Appel en cours, en grand (plein écran) : la transcription qui défile, qui parle, la
// durée et « Arrêter ». À la fin : le résumé, les tâches et « Suite avec Compi », quand
// le résumé est prêt. Rien de plus n'est enregistré qu'avec le bandeau de l'encoche.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { AudioLines, ExternalLink, Sparkles, Square, Users, X } from 'lucide-react'
import { defaultBrain } from '@shared/brains'
import { clockAt, followUpPrompt, formatDuration, PEOPLE_CHOICES, speakerLabel } from '@shared/meetings'
import { isOnline } from '@shared/privacy'
import type { Meeting } from '@shared/types'
import { useCompi } from '../store'
import { REC } from './CallLive'
import { Block } from './Day'
import { openMeetingView } from './FullBlocks'
import { useNow } from './Live'
import { Button, IconButton, LedDots } from './ui'

const nextPeople = (n?: number): number | undefined => PEOPLE_CHOICES[(n ? (PEOPLE_CHOICES as readonly number[]).indexOf(n) : -1) + 1]

function Live() {
  const call = useCompi((s) => s.call)!
  const now = useNow(call.phase === 'recording')
  const list = useRef<HTMLDivElement>(null)
  // La dernière phrase reste en vue, sauf si on remonte pour relire.
  useEffect(() => {
    const el = list.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight
  }, [call.lines.length])
  const recording = call.phase === 'recording'
  return (
    <div className="space-y-2.5 px-3.5 py-3" data-call-panel>
      <div className="flex items-center gap-2 text-[12px]">
        <span className="relative inline-grid size-2.5 place-items-center">
          {recording && <span className="absolute inset-0 animate-ping rounded-full opacity-60" style={{ background: REC }} />}
          <span className="relative size-2.5 rounded-full" style={{ background: REC, boxShadow: `0 0 8px ${REC}` }} />
        </span>
        <span className="font-semibold tabular-nums" style={{ color: REC }}>
          {recording ? clockAt((now - call.startedAt) / 1000) : call.phase === 'starting' ? 'Préparation…' : 'Mise au propre'}
        </span>
        <span className="truncate text-fog-500">{call.others ? 'micro + son de l’appel' : 'micro seul'}</span>
        <span className="flex-1" />
        {recording && call.choosePeople && (
          <button
            onClick={() => useCompi.getState().setCallPeople(nextPeople(call.people))}
            className="flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[11.5px] text-fog-300 hover:bg-white/[0.06]"
            title="Personnes en face (Auto ou 1)"
          >
            <Users size={12} /> {call.people ?? 'Auto'}
          </button>
        )}
      </div>
      <div ref={list} className="scroll-y max-h-[320px] space-y-1.5 pr-1">
        {call.lines.length ? (
          call.lines.map((l, i) => (
            <motion.div key={`${l.start}-${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-[12.5px] leading-snug">
              <span className="mr-1.5 text-[10.5px] text-fog-700 tabular-nums">{clockAt(l.start)}</span>
              <span className={l.who === 'me' ? 'text-led-cyan' : 'text-[#F9A8D4]'}>{speakerLabel(l.who)}</span>
              <span className="text-fog-500"> · </span>
              <span className="text-fog-100">{l.text}</span>
            </motion.div>
          ))
        ) : (
          <div className="text-[12px] text-fog-500">{call.phase === 'starting' ? 'J’ouvre le micro…' : 'La transcription s’affiche ici, sur ton PC.'}</div>
        )}
      </div>
      {call.phase === 'processing' && (
        <div className="flex items-center gap-2 text-[12px] text-fog-300">
          <LedDots color={REC} /> {call.step ?? 'Un instant…'}
        </div>
      )}
      {recording && (
        <div className="flex justify-end">
          <Button size="sm" variant="primary" accent={REC} onClick={() => void useCompi.getState().stopCall()}>
            <Square size={10} fill="currentColor" /> Arrêter
          </Button>
        </div>
      )}
    </div>
  )
}

/** Après l'appel : le résumé quand il arrive, puis la suite. */
function Done({ id, onClose }: { id: string; onClose: () => void }) {
  const settings = useCompi((s) => s.settings)
  const [m, setM] = useState<Meeting | null>(null)
  useEffect(() => {
    // Appel annulé (rien gardé) ou effacé : le bloc disparaît.
    const load = (): void => void window.compi.meeting(id).then((x) => (x ? setM(x) : onClose()))
    load()
    return window.compi.onMeetings(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  if (!m) return null
  const online = settings ? isOnline(defaultBrain(settings).provider) : false
  const blocked = online && settings?.privacy.meetings === 'never'
  const followUp = (): void => {
    const s = useCompi.getState()
    s.newConversation()
    s.setView('chat')
    void s.send(followUpPrompt(m), { external: true })
    onClose()
  }
  return (
    <div className="space-y-2.5 px-3.5 py-3" data-call-done>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-fog-100">{m.title}</div>
          <div className="text-[11px] text-fog-500">Appel enregistré · {formatDuration(m.durationMs)}</div>
        </div>
        <IconButton label="Fermer" onClick={onClose} className="size-7">
          <X size={13} />
        </IconButton>
      </div>
      {m.summary ? (
        <>
          <p className="text-[12.5px] leading-snug text-fog-300">{m.summary.summary}</p>
          {m.summary.tasks.length > 0 && (
            <ul className="space-y-1">
              {m.summary.tasks.slice(0, 6).map((t, i) => (
                <li key={i} className="flex gap-2 text-[12px] text-fog-100">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-led-violet" />
                  <span>
                    {t.text}
                    {(t.owner || t.due) && <span className="text-fog-500"> · {[t.owner, t.due].filter(Boolean).join(', ')}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <div className="flex items-center gap-2 text-[12px] text-fog-500">
          {m.status === 'done' && settings?.meetings.autoSummary !== false && !online ? (
            <>
              <LedDots color="#A78BFA" /> Je prépare le résumé sur ton PC…
            </>
          ) : (
            'Le résumé se lance depuis la fiche de l’appel.'
          )}
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => openMeetingView(m.id)}>
          <ExternalLink size={12} /> Ouvrir
        </Button>
        {m.summary && !blocked && (
          <Button size="sm" variant="subtle" onClick={followUp} title="Rappels, e-mail de suivi, rendez-vous : chaque action te sera proposée avant d’être faite">
            <Sparkles size={13} /> Suite avec Compi
          </Button>
        )}
      </div>
    </div>
  )
}

/** Bloc « Appel en cours » : rien quand aucun appel n'est enregistré ni tout juste fini. */
export function CallPanel() {
  const call = useCompi((s) => s.call)
  const [doneId, setDoneId] = useState<string | null>(null)
  const last = useRef<string | null>(null)
  // L'appel vient de finir (le store ouvre sa fiche dans l'historique) : on garde son résumé ici.
  useEffect(() => {
    if (call?.id) last.current = call.id
    else if (last.current) {
      setDoneId(last.current)
      last.current = null
    }
  }, [call])
  if (!call && !doneId) return null
  return (
    <Block icon={<AudioLines size={12} style={{ color: REC }} />} title={call ? 'Appel en cours' : 'Appel terminé'}>
      {call ? <Live /> : doneId && <Done id={doneId} onClose={() => setDoneId(null)} />}
    </Block>
  )
}
