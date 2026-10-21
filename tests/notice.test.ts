import { describe, expect, it } from 'vitest'
import { NOTICE_DEFAULT_MS, NOTICE_END_PAUSE_MS, NOTICE_MAX_MS, noticeDuration, TICKER_DELAY_MS, tickerMs } from '../src/shared/notice'

describe('notifications qui défilent', () => {
  it('un texte qui tient ne défile pas', () => {
    expect(tickerMs(0)).toBe(0)
    expect(tickerMs(-12)).toBe(0)
  })

  it('le défilement dure le délai plus le trajet à vitesse de lecture', () => {
    expect(tickerMs(90)).toBe(TICKER_DELAY_MS + 2000)
  })

  it('garde la durée demandée quand rien ne défile', () => {
    expect(noticeDuration(undefined)).toBe(NOTICE_DEFAULT_MS)
    expect(noticeDuration(2500)).toBe(2500)
  })

  it('prolonge le temps de lire jusqu’au bout, sans dépasser le plafond', () => {
    expect(noticeDuration(2500, 6000)).toBe(6000 + NOTICE_END_PAUSE_MS)
    expect(noticeDuration(9000, 1000)).toBe(9000)
    expect(noticeDuration(undefined, 60_000)).toBe(NOTICE_MAX_MS)
  })

  it('une durée longue demandée (réunion) est gardée', () => {
    expect(noticeDuration(60_000, 5000)).toBe(60_000)
  })
})
