// « Ce que tu as manqué » : à la fin d'une concentration (pomodoro), d'une réunion de
// l'agenda ou d'une absence, une carte résume ce qui est arrivé pendant ce temps.
// Messages en attente et rappels : déjà sur le PC. E-mails : une recherche Gmail à la
// fin de la période, si Gmail est connecté. Rien n'est envoyé à un cerveau ; la carte
// reste en mémoire seulement, et l'îlot ne montre que des nombres.

import { IPC } from '../../shared/ipc'
import {
  isEmptyMissed,
  messagesDuring,
  MISSED_MAILS,
  missedMailQuery,
  missedNotice,
  periodToSummarize,
  remindersDuring,
  sortMails,
  type MissedInfo,
  type MissedPeriod
} from '../../shared/missed'
import { emit } from '../bus'
import { events } from '../events'
import { searchMail } from '../google/gmail'
import { log } from '../log'
import { markMessagesShown, pendingMessages } from '../messages/watch'
import { settings } from '../store/settings'
import { firedReminders } from './reminders'

let current: MissedInfo | null = null
/** Fin de ce qui a déjà été résumé : une réunion pendant un pomodoro n'est pas montrée deux fois. */
let lastTo = 0
let started = false

export const getMissed = (): MissedInfo | null => current

export function dismissMissed(): void {
  current = null
  emit(IPC.missedChanged, null)
}

async function summarize(p: MissedPeriod): Promise<void> {
  const s = settings.get()
  if (!s.day.missed) return
  const period = periodToSummarize(p, lastTo)
  if (!period) return
  const now = Date.now()
  lastTo = Math.max(lastTo, now)
  // Tout de suite (avant la moindre attente) : ces messages ne seront pas rappelés en plus.
  const messages = messagesDuring(pendingMessages(), period.from, now)
  markMessagesShown(messages.map((m) => m.key))
  const reminders = remindersDuring(firedReminders(), period.from, now)
  let mails: MissedInfo['mails'] = null
  let mailTotal = 0
  let mailError: string | undefined
  if (s.google.mail) {
    try {
      const r = await searchMail(missedMailQuery(period.from), MISSED_MAILS)
      mails = sortMails(r.mails.map((m) => ({ id: m.id, from: m.from, subject: m.subject, date: m.date, important: m.important })))
      mailTotal = r.total
    } catch (e) {
      mailError = (e as Error).message
      log('warn', 'Ce que tu as manqué : Gmail illisible', mailError)
    }
  }
  const info: MissedInfo = { ...period, at: now, messages, mails, mailTotal, ...(mailError ? { mailError } : {}), reminders }
  if (isEmptyMissed(info)) return
  current = info
  emit(IPC.missedChanged, info)
  emit(IPC.islandNotify, { pill: 'today', text: missedNotice(info), view: 'today', duration: 12_000 })
}

const run = (p: MissedPeriod): void => {
  summarize(p).catch((e) => log('warn', 'Ce que tu as manqué', (e as Error).message))
}

export function startMissed(): void {
  if (started) return
  started = true
  events.on('focus-end', ({ from, to }) => run({ cause: 'focus', from, to }))
  events.on('meeting-end', (m) => {
    const from = Date.parse(m.start)
    const to = Date.parse(m.end)
    if (Number.isFinite(from) && Number.isFinite(to)) run({ cause: 'meeting', from, to, title: m.title })
  })
  events.on('back', ({ from }) => run({ cause: 'away', from, to: Date.now() }))
}
