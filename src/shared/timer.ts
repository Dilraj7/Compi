// Minuteur et pomodoro : logique pure partagée (testée). Un seul minuteur à
// la fois ; en pause, `endsAt` est absent et `remainingMs` garde le reste.

import type { TimerState } from './types'

export const POMODORO_DEFAULTS = { focusMin: 25, breakMin: 5, rounds: 4 } as const

/** Limites : de 5 secondes à 12 heures. */
export const TIMER_MIN_MS = 5_000
export const TIMER_MAX_MS = 12 * 3600_000

export const isRunning = (t: TimerState): boolean => t.endsAt !== undefined

/** Temps restant (ms). */
export function remainingMs(t: TimerState, now: number): number {
  return t.endsAt !== undefined ? Math.max(0, t.endsAt - now) : Math.max(0, t.remainingMs ?? 0)
}

/** Part écoulée, de 0 à 1 (pour l'anneau de progression). */
export function progress(t: TimerState, now: number): number {
  if (t.durationMs <= 0) return 1
  return Math.min(1, Math.max(0, 1 - remainingMs(t, now) / t.durationMs))
}

export function newTimer(durationMs: number, label: string, now: number): TimerState {
  const ms = Math.round(Math.min(TIMER_MAX_MS, Math.max(TIMER_MIN_MS, durationMs)))
  return { kind: 'timer', label: label.trim().slice(0, 80), durationMs: ms, endsAt: now + ms }
}

export function newPomodoro(opts: { focusMin?: number; breakMin?: number; rounds?: number }, now: number): TimerState {
  const clamp = (v: number | undefined, d: number, lo: number, hi: number): number =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v!))) : d
  const focusMin = clamp(opts.focusMin, POMODORO_DEFAULTS.focusMin, 1, 120)
  const breakMin = clamp(opts.breakMin, POMODORO_DEFAULTS.breakMin, 1, 60)
  const rounds = clamp(opts.rounds, POMODORO_DEFAULTS.rounds, 1, 12)
  const ms = focusMin * 60_000
  return { kind: 'pomodoro', label: '', durationMs: ms, endsAt: now + ms, pomodoro: { phase: 'focus', round: 1, rounds, focusMin, breakMin } }
}

export function paused(t: TimerState, now: number): TimerState {
  if (!isRunning(t)) return t
  return { ...t, endsAt: undefined, remainingMs: remainingMs(t, now) }
}

export function resumed(t: TimerState, now: number): TimerState {
  if (isRunning(t)) return t
  return { ...t, endsAt: now + (t.remainingMs ?? 0), remainingMs: undefined }
}

/**
 * Pomodoro : la phase suivante quand la phase en cours se termine, ou `null`
 * quand la dernière concentration est finie (pas de pause inutile à la fin).
 */
export function pomodoroNext(t: TimerState, now: number): TimerState | null {
  const p = t.pomodoro
  if (t.kind !== 'pomodoro' || !p) return null
  if (p.phase === 'focus') {
    if (p.round >= p.rounds) return null
    const ms = p.breakMin * 60_000
    return { ...t, durationMs: ms, endsAt: now + ms, remainingMs: undefined, pomodoro: { ...p, phase: 'break' } }
  }
  const ms = p.focusMin * 60_000
  return { ...t, durationMs: ms, endsAt: now + ms, remainingMs: undefined, pomodoro: { ...p, phase: 'focus', round: p.round + 1 } }
}

/** « Minuteur · Pâtes », « Pomodoro 2/4 · concentration ». */
export function timerTitle(t: TimerState): string {
  if (t.kind === 'pomodoro' && t.pomodoro) {
    const p = t.pomodoro
    return `Pomodoro ${p.round}/${p.rounds} · ${p.phase === 'focus' ? 'concentration' : 'pause'}`
  }
  return t.label ? `Minuteur · ${t.label}` : 'Minuteur'
}

/** Message de fin de phase (notification et îlot). */
export function timerEndText(t: TimerState, next: TimerState | null): string {
  if (t.kind === 'pomodoro' && t.pomodoro) {
    if (!next) return `Bravo, ${t.pomodoro.rounds} pomodoro${t.pomodoro.rounds > 1 ? 's' : ''} terminé${t.pomodoro.rounds > 1 ? 's' : ''} !`
    return next.pomodoro?.phase === 'break'
      ? `Pause de ${next.pomodoro.breakMin} min : lève-toi, bois un verre d’eau.`
      : `C’est reparti : concentration ${next.pomodoro!.round}/${next.pomodoro!.rounds}.`
  }
  return t.label ? `Minuteur terminé : ${t.label}` : 'Minuteur terminé !'
}

/** « 10 min », « 1 h 30 », « 45 s » (durées annoncées par l'outil). */
export function durationLabel(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const min = Math.round(s / 60)
  if (min < 60) return s % 60 && min < 10 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${min} min`
  const h = Math.floor(min / 60)
  const rest = min % 60
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`
}
