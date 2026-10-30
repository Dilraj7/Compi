// Événements du PC qui peuvent lancer une routine : retour de l'utilisateur (démarrage,
// déverrouillage, sortie de veille, activité après une longue absence), fin d'un rendez-vous,
// nouveau message en attente. Les sources publient, les routines écoutent : aucune
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
  let away = false
  const present = (): void => {
    if (!locked) events.emit('present')
  }
  // Laisse Compi (et le cerveau local) démarrer avant de lancer quoi que ce soit.
  setTimeout(present, 90_000)
  powerMonitor.on('lock-screen', () => (locked = true))
  powerMonitor.on('suspend', () => (locked = true))
  powerMonitor.on('unlock-screen', () => {
    locked = false
    setTimeout(present, 60_000)
  })
  powerMonitor.on('resume', () => {
    locked = false
    setTimeout(present, 60_000)
  })
  // PC jamais verrouillé (allumé toute la nuit) : le retour se voit à l'activité.
  setInterval(() => {
    const idle = powerMonitor.getSystemIdleTime()
    if (idle >= AWAY_SEC) away = true
    else if (away && idle < 120) {
      away = false
      present()
    }
  }, CHECK_MS).unref()
}
