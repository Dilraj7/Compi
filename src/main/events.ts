// Événements du PC qui peuvent lancer une routine : retour de l'utilisateur (démarrage,
// déverrouillage, sortie de veille, activité après une longue absence), fin d'un rendez-vous,
// nouveau message en attente. « Ce que tu as manqué » écoute aussi la fin d'une
// concentration et les retours après une absence (avec leur début). Les sources publient, les routines écoutent : aucune
// dépendance de l'une à l'autre. Rien n'est lu au-delà de ce que chaque source garde déjà.

import { EventEmitter } from 'node:events'
import { powerMonitor } from 'electron'

export interface MeetingEnded {
  key: string
  title: string
  start: string
  end: string
}

export interface MessageArrived {
  appKey: string
  app: string
  sender: string
  at: number
}

interface EventMap {
  /** L'utilisateur est devant son PC (démarrage, déverrouillage, retour d'absence). */
  present: []
  'meeting-end': [MeetingEnded]
  message: [MessageArrived]
  /** Fin d'une phase de concentration du pomodoro. */
  'focus-end': [{ from: number; to: number }]
  /** Retour devant le PC après une absence (verrouillage, veille, inactivité) commencée à `from`. */
  back: [{ from: number }]
  /** Routines modifiées : les sources revoient ce qu'elles doivent suivre. */
  'routines-changed': []
}

const bus = new EventEmitter()

export const events = {
  emit<K extends keyof EventMap>(name: K, ...args: EventMap[K]): void {
    bus.emit(name, ...args)
  },
  on<K extends keyof EventMap>(name: K, fn: (...args: EventMap[K]) => void): void {
    bus.on(name, fn as (...a: unknown[]) => void)
  }
}

/** Pas d'activité depuis plus longtemps : un retour devant le PC compte comme une présence. */
const AWAY_SEC = 30 * 60
const CHECK_MS = 5 * 60_000
let started = false

/** Présence de l'utilisateur : peu après le démarrage, au déverrouillage, et au retour d'une longue absence. */
export function startPresenceEvents(): void {
  if (started) return
  started = true
  let locked = false
  /** Déverrouillé depuis moins d'une minute : le retour est signalé par le déverrouillage. */
  let returning = false
  /** Début du verrouillage, de la veille ou de l'inactivité en cours (0 : présent). */
  let awaySince = 0
  const present = (): void => {
    if (!locked) events.emit('present')
  }
  const back = (): void => {
    const from = awaySince
    awaySince = 0
    if (from) events.emit('back', { from })
  }
  const leave = (): void => {
    locked = true
    if (!awaySince) awaySince = Date.now()
  }
  // Laisse Compi (et le cerveau local) démarrer avant de lancer quoi que ce soit.
  setTimeout(present, 90_000)
  powerMonitor.on('lock-screen', leave)
  powerMonitor.on('suspend', leave)
  // Le délai laisse les messages et le réseau reprendre avant de résumer l'absence.
  const unlocked = (): void => {
    locked = false
    returning = true
    setTimeout(() => {
      returning = false
      if (locked) return
      present()
      back()
    }, 60_000)
  }
  powerMonitor.on('unlock-screen', unlocked)
  powerMonitor.on('resume', unlocked)
  // PC jamais verrouillé (allumé toute la nuit) : le retour se voit à l'activité.
  setInterval(() => {
    if (locked || returning) return
    const idle = powerMonitor.getSystemIdleTime()
    if (idle >= AWAY_SEC) {
      if (!awaySince) awaySince = Date.now() - idle * 1000
    } else if (awaySince && idle < 120) {
      present()
      back()
    }
  }, CHECK_MS).unref()
}
