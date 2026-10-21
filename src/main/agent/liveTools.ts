// Outils « îlot vivant » : minuteur, pomodoro, musique en cours.
// Le minuteur ne touche qu'à Compi : autorisé sans demander. La musique en
// cours est une lecture seule (catégorie « fenêtre » du garde-fou).

import { z } from 'zod'
import { durationLabel, remainingMs, timerTitle, TIMER_MAX_MS, TIMER_MIN_MS } from '../../shared/timer'
import { formatClock, mediaPosition } from '../../shared/media'
import type { MediaInfo } from '../../shared/types'
import { getTimer, startPomodoro, startTimer, stopTimer } from '../day/timer'
import { nowPlaying } from '../windows/media'
import type { ToolHelpers } from './dayTools'

type ToolFn = typeof import('@anthropic-ai/claude-agent-sdk')['tool']

/** « En lecture : Titre — Artiste (Spotify), 1:12 / 3:40. » */
export function formatMedia(m: MediaInfo | null, now: number): string {
  if (!m) return 'Aucune musique ni vidéo en cours.'
  const state = m.status === 'playing' ? 'En lecture' : m.status === 'paused' ? 'En pause' : 'Ouvert'
  const who = [m.artist, m.app ? `(${m.app})` : ''].filter(Boolean).join(' ')
  const time = m.duration > 0 ? `, ${formatClock(mediaPosition(m, now) * 1000)} / ${formatClock(m.duration * 1000)}` : ''
  return `${state} : ${m.title}${who ? ` — ${who}` : ''}${time}.`
}

export function liveTools(tool: ToolFn, h: Pick<ToolHelpers, 'text' | 'fail'>) {
  return [
    tool(
      'timer_start',
      'Lance un minuteur, affiché dans l’îlot ; une notification sonne à la fin. Remplace le minuteur en cours.',
      {
        minutes: z.number().min(0).max(720).optional().describe('Durée en minutes'),
        seconds: z.number().min(0).max(3600).optional().describe('Secondes en plus (ou seules)'),
        label: z.string().max(80).optional().describe('Pour quoi : « Pâtes », « Appel »…')
      },
      async ({ minutes, seconds, label }) => {
        const ms = ((minutes ?? 0) * 60 + (seconds ?? 0)) * 1000
        if (ms < TIMER_MIN_MS || ms > TIMER_MAX_MS) return h.fail('Durée invalide : entre 5 secondes et 12 heures.')
        const t = startTimer(ms, label ?? '')
        return h.text(`${timerTitle(t)} lancé : ${durationLabel(t.durationMs)}.`)
      }
    ),

    tool(
      'pomodoro_start',
      'Lance un pomodoro : des périodes de concentration séparées par de courtes pauses, enchaînées automatiquement, avec une notification à chaque changement.',
      {
        focus_minutes: z.number().int().min(1).max(120).optional().describe('Concentration (25 par défaut)'),
        break_minutes: z.number().int().min(1).max(60).optional().describe('Pause (5 par défaut)'),
        rounds: z.number().int().min(1).max(12).optional().describe('Nombre de périodes de concentration (4 par défaut)')
      },
      async ({ focus_minutes, break_minutes, rounds }) => {
        const t = startPomodoro({ focusMin: focus_minutes, breakMin: break_minutes, rounds })
        const p = t.pomodoro!
        return h.text(`Pomodoro lancé : ${p.rounds} × ${p.focusMin} min de concentration, ${p.breakMin} min de pause entre chaque.`)
      }
    ),

    tool(
      'timer_status',
      'Le minuteur ou pomodoro en cours, et le temps restant.',
      {},
      async () => {
        const t = getTimer()
        if (!t) return h.text('Aucun minuteur en cours.')
        return h.text(`${timerTitle(t)} : ${formatClock(remainingMs(t, Date.now()))} restant${t.endsAt === undefined ? ' (en pause)' : ''}.`)
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool('timer_stop', 'Arrête le minuteur ou le pomodoro en cours.', {}, async () => {
      const t = stopTimer()
      return t ? h.text(`${timerTitle(t)} arrêté.`) : h.text('Aucun minuteur en cours.')
    }),

    tool(
      'now_playing',
      'La musique ou la vidéo en cours sur le PC (titre, artiste, application). Pour mettre en pause ou passer au suivant : sound_control.',
      {},
      async () => {
        try {
          return h.text(formatMedia(await nowPlaying(), Date.now()))
        } catch (e) {
          return h.fail(`Musique en cours indisponible : ${(e as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true } }
    )
  ]
}
