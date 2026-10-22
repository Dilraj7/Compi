import { describe, expect, it } from 'vitest'
import { ACTIVITY_TABS, SETTINGS_TAB_OF, SETTINGS_TABS } from '../src/shared/settingsTabs'

describe('rubriques des Réglages', () => {
  it('envoie chaque réglage vers une rubrique qui existe', () => {
    const tabs = new Set(SETTINGS_TABS.map((t) => t.value))
    for (const tab of Object.values(SETTINGS_TAB_OF)) expect(tabs.has(tab)).toBe(true)
  })

  it('ne laisse aucune rubrique sans réglage', () => {
    const used = new Set(Object.values(SETTINGS_TAB_OF))
    for (const t of SETTINGS_TABS) expect(used.has(t.value)).toBe(true)
  })

  it('garde les sauts déjà utilisés dans leur rubrique', () => {
    expect(SETTINGS_TAB_OF.quiz).toBe('brain')
    expect(SETTINGS_TAB_OF.voice).toBe('voice')
    expect(SETTINGS_TAB_OF.agenda).toBe('day')
    expect(SETTINGS_TAB_OF.messages).toBe('day')
    expect(SETTINGS_TAB_OF.keys).toBe('general')
    expect(SETTINGS_TAB_OF.sounds).toBe('island')
    expect(SETTINGS_TAB_OF.privacy).toBe('privacy')
  })

  it('a des noms d’onglets uniques', () => {
    for (const list of [SETTINGS_TABS, ACTIVITY_TABS]) expect(new Set(list.map((t) => t.label)).size).toBe(list.length)
    expect(ACTIVITY_TABS[0].value).toBe('perf')
  })
})
