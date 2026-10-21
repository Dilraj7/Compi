// Minuteur et pomodoro : un seul à la fois, enregistré dans
// userData/timer.json pour survivre à un redémarrage de Compi. À la fin :
// notification Windows et message dans l'îlot ; un pomodoro enchaîne seul
// concentration et pauses.

import { join } from 'node:path'
import { app, Notification } from 'electron'
import { IPC } from '../../shared/ipc'
import type { TimerState } from '../../shared/types'
import { newPomodoro, newTimer, paused, pomodoroNext, remainingMs, resumed, timerEndText } from '../../shared/timer'
import { emit } from '../bus'
import { readJson, writeJson } from '../store/jsonFile'
import { toastSilent } from '../store/settings'

const file = (): string => join(app.getPath('userData'), 'timer.json')

let state: TimerState | null = null
let endTimer: NodeJS.Timeout | null = null

function set(next: TimerState | null): void {
  state = next
  writeJson(file(), next ?? {})
  if (endTimer) clearTimeout(endTimer)
  endTimer = null
  if (next?.endsAt !== undefined) endTimer = setTimeout(finish, Math.max(0, next.endsAt - Date.now()))
  emit(IPC.timerChanged, next)
}

function announce(text: string): void {
  new Notification({ title: 'Compi', body: text, silent: toastSilent() }).show()
  emit(IPC.islandNotify, { pill: 'timer', text, duration: 10_000 })
}

function finish(): void {
  endTimer = null
  const t = state
  if (!t || t.endsAt === undefined) return
  // setTimeout peut se réveiller un peu tôt.
  if (t.endsAt - Date.now() > 250) {
    endTimer = setTimeout(finish, t.endsAt - Date.now())
    return
  }
  const next = pomodoroNext(t, Date.now())
  announce(timerEndText(t, next))
  set(next)
}

/** Au démarrage : reprend le minuteur, ou signale qu'il a sonné pendant l'absence. */
export function restoreTimer(): void {
  const saved = readJson<Partial<TimerState>>(file(), {})
  if (!saved.kind || typeof saved.durationMs !== 'number') return
  const t = saved as TimerState
  if (t.endsAt !== undefined && t.endsAt <= Date.now()) {
    if (Date.now() - t.endsAt < 3600_000) setTimeout(() => announce(`${timerEndText(t, null)} (pendant que Compi était fermé)`), 4000)
    set(null)
    return
  }
  set(t)
}

export const getTimer = (): TimerState | null => state

export function startTimer(durationMs: number, label = ''): TimerState {
  const t = newTimer(durationMs, label, Date.now())
  set(t)
  return t
}

export function startPomodoro(opts: { focusMin?: number; breakMin?: number; rounds?: number } = {}): TimerState {
  const t = newPomodoro(opts, Date.now())
  set(t)
  return t
}

export function pauseTimer(): TimerState | null {
  if (state) set(paused(state, Date.now()))
  return state
}

export function resumeTimer(): TimerState | null {
  if (state) set(resumed(state, Date.now()))
  return state
}

/** Arrête le minuteur ; renvoie celui qui tournait (ou `null`). */
export function stopTimer(): TimerState | null {
  const was = state
  if (was) set(null)
  return was
}

export const timerRemaining = (): number => (state ? remainingMs(state, Date.now()) : 0)

export function stopTimers(): void {
  if (endTimer) clearTimeout(endTimer)
  endTimer = null
}
