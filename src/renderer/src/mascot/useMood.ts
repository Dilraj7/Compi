import { useEffect } from 'react'
import { MOOD_COLORS, PILLS } from '@shared/pills'
import type { Mood } from '@shared/types'
import { useCompi } from '../store'

/** Humeur globale de la mascotte, déduite de l'état de l'app. */
export function useMood(): { mood: Mood; color: string } {
  const notice = useCompi((s) => s.notice)
  const waiting = useCompi((s) => s.approvals.length + s.questions.length > 0)
  const streaming = useCompi((s) => s.streamingId !== null)
  const phase = useCompi((s) => s.phase)
  const outcome = useCompi((s) => s.outcome)
  const sessionsWorking = useCompi((s) => s.sessions.some((x) => x.status === 'working'))
  const sleepy = useCompi((s) => s.sleepy)
  const quickRunning = useCompi((s) => s.quick?.status === 'running')
  const dictation = useCompi((s) => s.dictation.phase)
  const speaking = useCompi((s) => s.speaking)

  let mood: Mood = 'idle'
  const pill = notice ? (PILLS[notice.pill] ?? PILLS.chat) : null
  if (pill) mood = pill.mood
  else if (waiting) mood = 'waiting'
  else if (dictation === 'recording' || dictation === 'starting') mood = 'listening'
  else if (dictation === 'transcribing') mood = 'thinking'
  else if (outcome === 'error') mood = 'error'
  else if (streaming) mood = phase === 'text' ? 'listening' : 'thinking'
  else if (quickRunning || speaking) mood = 'listening'
  else if (outcome === 'done') mood = 'happy'
  else if (sessionsWorking) mood = 'thinking'
  else if (sleepy) mood = 'sleeping'

  const color = pill ? pill.color : MOOD_COLORS[mood]

  useEffect(() => {
    document.documentElement.style.setProperty('--led', color)
  }, [color])

  return { mood, color }
}
