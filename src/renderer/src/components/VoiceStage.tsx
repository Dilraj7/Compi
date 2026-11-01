// Scène vocale du plein écran : quand tu parles à Compi (« Me parler » ou conversation
// vocale), le centre montre ce qu'il entend et ce qu'il répond, en grand. La discussion
// reste écrite derrière ; rien ne change dans la façon dont la voix fonctionne.

import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Mic, Send, Square, X } from 'lucide-react'
import { PILLS } from '@shared/pills'
import { useCompi } from '../store'
import { useNow } from './Live'
import { Button } from './ui'

/** La scène est affichée : dictée du chat en cours, ou conversation vocale. */
export const useVoiceStage = (): boolean =>
  useCompi((s) => (s.dictation.phase !== 'idle' && !s.dictation.everywhere) || s.converse.phase !== 'off')

/** Ce que dit l'état, en une phrase. */
function useStatus(): { title: string; hint: string; level: number; listening: boolean } {
  const dictation = useCompi((s) => (s.dictation.everywhere ? 'idle' : s.dictation.phase))
  const dLevel = useCompi((s) => s.dictation.level)
  const phase = useCompi((s) => s.converse.phase)
  const cLevel = useCompi((s) => s.converse.level)
  const until = useCompi((s) => s.converse.until)
  const streaming = useCompi((s) => s.streamingId !== null)
  const speaking = useCompi((s) => s.speaking)
  const now = useNow(phase === 'listening', 500)
  if (dictation === 'starting') return { title: 'J’ouvre le micro', hint: 'Un instant…', level: 0, listening: false }
  if (dictation === 'recording') return { title: 'Je t’écoute', hint: 'Parle, puis « Envoyer » ou une pause', level: dLevel, listening: true }
  if (dictation === 'transcribing' || phase === 'transcribing') return { title: 'Je transcris', hint: 'Sur ton PC, rien n’est envoyé', level: 0, listening: false }
  if (phase === 'hearing') return { title: 'Je t’écoute', hint: 'Fais une pause pour envoyer', level: cLevel, listening: true }
  if (phase === 'listening') {
    const left = Math.max(0, Math.ceil((until - now) / 1000))
    return { title: 'À toi', hint: `Je t’écoute encore ${left} s, sinon je m’arrête`, level: cLevel, listening: true }
  }
  if (phase === 'queued') return { title: 'Je t’ai entendu', hint: 'Ta question part à la fin de ma réponse', level: 0, listening: false }
  if (speaking) return { title: 'Je te réponds', hint: 'Parle pour me couper', level: cLevel, listening: false }
  if (streaming) return { title: 'Je réfléchis', hint: 'Ma réponse arrive', level: 0, listening: false }
  return { title: 'Conversation', hint: 'Parle quand tu veux', level: cLevel, listening: false }
}

const clipEnd = (s: string, max: number): string => (s.length > max ? `…${s.slice(-max).replace(/^\S*\s/, '')}` : s)

/** Onde : barres qui suivent le niveau du micro. */
function Wave({ level, color, on }: { level: number; color: string; on: boolean }) {
  const bars = [0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35]
  return (
    <div className="flex h-16 items-center gap-1.5" aria-hidden>
      {bars.map((k, i) => (
        <motion.span
          key={i}
          className="w-2 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px ${color}88` }}
          animate={{ height: on ? 10 + Math.min(1, level * 2.2) * 54 * k : 8, opacity: on ? 1 : 0.4 }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        />
      ))}
    </div>
  )
}

export function VoiceStage({ eyes }: { eyes?: ReactNode }) {
  const { title, hint, level, listening } = useStatus()
  const color = PILLS.chat.color
  const dictating = useCompi((s) => s.dictation.phase === 'recording' && !s.dictation.everywhere)
  // Dernière question (dite) et réponse en cours : les sous-titres.
  const asked = useCompi((s) => {
    for (let i = s.messages.length - 1; i >= 0; i--) if (s.messages[i].role === 'user') return s.messages[i].text
    return ''
  })
  const answer = useCompi((s) => {
    const last = s.messages.at(-1)
    return last && last.role === 'assistant' ? last.text : ''
  })
  const end = (): void => {
    const s = useCompi.getState()
    if (s.dictation.phase !== 'idle') s.cancelDictation()
    s.endConversation()
    s.stopSpeaking()
  }
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 rounded-[24px] bg-ink-950/90 px-10"
      data-voice-stage
    >
      {eyes}
      <div className="text-center">
        <div className="led-text text-[15px]" style={{ color, textShadow: `0 0 12px ${color}88` }}>
          {title}
        </div>
        <div className="mt-1 text-[13px] text-fog-500">{hint}</div>
      </div>
      <Wave level={level} color={color} on={listening} />
      <div className="w-full max-w-[760px] space-y-4">
        {asked && (
          <p className="text-center text-[17px] leading-snug text-fog-300">
            <span className="text-fog-700">Toi · </span>
            {clipEnd(asked, 220)}
          </p>
        )}
        {answer && (
          <p className="text-center text-[21px] leading-snug font-medium text-fog-100">
            <span className="text-[17px] font-normal" style={{ color }}>
              Compi ·{' '}
            </span>
            {clipEnd(answer.replace(/[*_#`>]/g, ''), 360)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {dictating && (
          <Button variant="primary" accent={color} onClick={() => useCompi.getState().stopDictation()}>
            <Send size={14} /> Envoyer
          </Button>
        )}
        <Button variant="subtle" onClick={end}>
          {listening ? <X size={14} /> : <Square size={12} fill="currentColor" />} Terminer
        </Button>
      </div>
      <div className="absolute bottom-4 flex items-center gap-1.5 text-[11.5px] text-fog-700">
        <Mic size={12} /> Échap pour arrêter · la discussion reste écrite derrière
      </div>
    </motion.div>
  )
}
