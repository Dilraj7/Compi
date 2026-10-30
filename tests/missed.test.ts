import { describe, expect, it } from 'vitest'
import {
  isEmptyMissed,
  messagesDuring,
  MISSED_AWAY_MS,
  MISSED_MIN_MS,
  missedCounts,
  missedMailQuery,
  missedNotice,
  periodToSummarize,
  remindersDuring,
  sortMails,
  type MissedInfo
} from '../src/shared/missed'
import type { PendingMessage } from '../src/shared/messages'

const min = 60_000
/** Un jeudi à 14 h (heure locale). */
const T = new Date(2026, 9, 29, 14, 0).getTime()

const msg = (key: string, at: number, sender = 'Paul'): PendingMessage => ({ key, appKey: 'whatsapp', app: 'WhatsApp', sender, at })

const info = (over: Partial<MissedInfo> = {}): MissedInfo => ({
  cause: 'meeting',
  from: T - 60 * min,
  to: T,
  at: T,
  messages: [],
  mails: null,
  mailTotal: 0,
  reminders: [],
  ...over
})

describe('périodes à résumer', () => {
  it('une concentration ou une réunion de 15 min ou plus, pas moins', () => {
    expect(periodToSummarize({ cause: 'focus', from: T - 25 * min, to: T }, 0)).toEqual({ cause: 'focus', from: T - 25 * min, to: T })
    expect(periodToSummarize({ cause: 'meeting', from: T - MISSED_MIN_MS, to: T }, 0)).not.toBeNull()
    expect(periodToSummarize({ cause: 'meeting', from: T - 10 * min, to: T }, 0)).toBeNull()
    expect(periodToSummarize({ cause: 'focus', from: T, to: T }, 0)).toBeNull()
  })

  it('une absence compte à partir de 30 min', () => {
    expect(periodToSummarize({ cause: 'away', from: T - 20 * min, to: T }, 0)).toBeNull()
    expect(periodToSummarize({ cause: 'away', from: T - MISSED_AWAY_MS, to: T }, 0)).not.toBeNull()
  })

  it('la nuit (absence qui passe 5 h du matin) est laissée au résumé du matin', () => {
    const morning = new Date(2026, 9, 29, 7, 30).getTime()
    const evening = new Date(2026, 9, 28, 23, 0).getTime()
    expect(periodToSummarize({ cause: 'away', from: evening, to: morning }, 0)).toBeNull()
    // Absence du matin, après 5 h : résumée.
    expect(periodToSummarize({ cause: 'away', from: morning - 60 * min, to: morning + 60 * min }, 0)).not.toBeNull()
  })

  it('ce qu’une carte précédente a déjà couvert n’est pas repris', () => {
    // Réunion de 14 h à 15 h, pomodoro fini à 14 h 40 : la réunion ne reprend qu'après 14 h 40.
    const p = periodToSummarize({ cause: 'meeting', from: T, to: T + 60 * min, title: 'Point' }, T + 40 * min)
    expect(p).toEqual({ cause: 'meeting', from: T + 40 * min, to: T + 60 * min, title: 'Point' })
    expect(periodToSummarize({ cause: 'meeting', from: T, to: T + 60 * min }, T + 60 * min)).toBeNull()
  })
})

describe('contenu de la carte', () => {
  it('messages et rappels de la période seulement, du plus ancien au plus récent', () => {
    const pending = [msg('b', T - 5 * min), msg('a', T - 50 * min), msg('old', T - 90 * min), msg('future', T + min)]
    expect(messagesDuring(pending, T - 60 * min, T).map((m) => m.key)).toEqual(['a', 'b'])
    const fired = [
      { message: 'Garage', at: T - 10 * min },
      { message: 'Avant', at: T - 2 * 3600_000 }
    ]
    expect(remindersDuring(fired, T - 60 * min, T)).toEqual([{ message: 'Garage', at: T - 10 * min }])
  })

  it('recherche Gmail : non lus de la boîte de réception arrivés depuis le début, en secondes', () => {
    expect(missedMailQuery(1_700_000_000_999)).toBe('is:unread in:inbox -category:promotions -category:social -category:forums after:1700000000')
  })

  it('e-mails importants d’abord, puis les plus récents', () => {
    const sorted = sortMails([
      { id: '1', from: 'a', subject: 'vieux', date: '2026-10-29T12:00:00Z', important: false },
      { id: '2', from: 'b', subject: 'récent', date: '2026-10-29T13:00:00Z', important: false },
      { id: '3', from: 'c', subject: 'important', date: '2026-10-29T11:00:00Z', important: true }
    ])
    expect(sorted.map((m) => m.id)).toEqual(['3', '2', '1'])
  })

  it('carte vide : rien à montrer', () => {
    expect(isEmptyMissed(info())).toBe(true)
    expect(isEmptyMissed(info({ mails: [], mailTotal: 0 }))).toBe(true)
    expect(isEmptyMissed(info({ reminders: [{ message: 'x', at: T }] }))).toBe(false)
  })

  it('le nombre d’e-mails est celui de Gmail, même si la carte n’en montre que 5', () => {
    const mails = Array.from({ length: 5 }, (_, i) => ({ id: String(i), from: 'x', subject: 's', important: false }))
    expect(missedCounts(info({ mails, mailTotal: 12 })).mails).toBe(12)
    // Gmail pas connecté : les e-mails ne comptent pas.
    expect(missedCounts(info({ mails: null, mailTotal: 3 })).mails).toBe(0)
  })
})

describe('texte de l’îlot', () => {
  it('seulement des nombres : ni expéditeur, ni objet, ni titre de réunion', () => {
    const text = missedNotice(
      info({
        title: 'Entretien confidentiel',
        messages: [msg('a', T - min, 'Maman'), msg('b', T - min, 'Maman'), msg('c', T - min)],
        mails: [{ id: '1', from: 'Claire', subject: 'Salaire', important: true }],
        mailTotal: 2,
        reminders: [{ message: 'Médecin', at: T }]
      })
    )
    expect(text).toBe('Pendant ta réunion : 3 messages · 2 e-mails · 1 rappel')
    expect(text).not.toMatch(/Maman|Claire|Salaire|Médecin|Entretien/)
  })

  it('selon la cause, et sans les parties vides', () => {
    expect(missedNotice(info({ cause: 'focus', messages: [msg('a', T)] }))).toBe('Pendant ta concentration : 1 message')
    expect(
      missedNotice(
        info({
          cause: 'away',
          reminders: [
            { message: 'x', at: T },
            { message: 'y', at: T }
          ]
        })
      )
    ).toBe('Pendant ton absence : 2 rappels')
  })
})
