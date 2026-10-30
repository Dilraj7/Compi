import { describe, expect, it, vi } from 'vitest'
import {
  canFire,
  cleanDraft,
  cleanGrants,
  messageMatches,
  missedAction,
  recentFires,
  ROUTINE_CATCH_UP_MS,
  routinePreview,
  routineRepeat,
  toolTrigger,
  triggerLabel,
  validRepeat,
  validTrigger,
  webGrantCovers
} from '../src/shared/routines'

vi.mock('electron', () => ({ app: { getPath: () => '.' } }))

const { activityLabel, approvalTitle } = await import('../src/main/agent/labels')

describe('routines : règles de répétition', () => {
  it('valide les règles', () => {
    expect(validRepeat({ every: 'day', time: '08:30' })).toBe(true)
    expect(validRepeat({ every: 'week', days: [1, 3], time: '09:00' })).toBe(true)
    expect(validRepeat({ every: 'week', days: [], time: '09:00' })).toBe(false)
    expect(validRepeat({ every: 'week', days: [7], time: '09:00' })).toBe(false)
    expect(validRepeat({ every: 'month', day: 31, time: '23:59' })).toBe(true)
    expect(validRepeat({ every: 'month', day: 0, time: '10:00' })).toBe(false)
    expect(validRepeat({ every: 'day', time: '24:00' })).toBe(false)
    expect(validRepeat({ every: 'year', time: '10:00' })).toBe(false)
  })

  it('paramètres de l’outil → règle', () => {
    const tuesday = new Date('2026-10-13T12:00:00')
    expect(routineRepeat('chaque_jour', '07:00')).toEqual({ every: 'day', time: '07:00' })
    expect(routineRepeat('jours_ouvres', '08:30')).toEqual({ every: 'weekdays', time: '08:30' })
    expect(routineRepeat('chaque_semaine', '09:00', ['lundi', 'Vendredi', 'lundi'])).toEqual({ every: 'week', days: [1, 5], time: '09:00' })
    // Sans jour précisé : le jour de la création.
    expect(routineRepeat('chaque_semaine', '09:00', [], undefined, tuesday)).toEqual({ every: 'week', days: [2], time: '09:00' })
    expect(routineRepeat('chaque_mois', '10:00', undefined, 15)).toEqual({ every: 'month', day: 15, time: '10:00' })
    expect(routineRepeat('chaque_mois', '10:00', undefined, undefined, tuesday)).toEqual({ every: 'month', day: 13, time: '10:00' })
  })
})

describe('routines : brouillon', () => {
  it('nettoie, trie les jours, donne un titre par défaut', () => {
    const d = cleanDraft({ title: '  ', prompt: '  Résume mes e-mails non lus importants ', repeat: { every: 'week', days: [5, 1, 5], time: '09:00' } })
    expect(d).toEqual({
      title: 'Résume mes e-mails non lus importants',
      prompt: 'Résume mes e-mails non lus importants',
      repeat: { every: 'week', days: [1, 5], time: '09:00' },
      enabled: true
    })
  })

  it('refuse une demande vide ou un moment invalide', () => {
    expect(() => cleanDraft({ title: 'x', prompt: ' ', repeat: { every: 'day', time: '09:00' } })).toThrow(/Dis-moi/)
    expect(() => cleanDraft({ title: 'x', prompt: 'ok', repeat: { every: 'day', time: '9h' } })).toThrow(/invalide/)
  })

  it('droits : gardés seulement s’ils sont donnés, nettoyés, sans doublon', () => {
    const base = { title: 'x', prompt: 'ok', repeat: { every: 'day', time: '09:00' } } as const
    expect(cleanDraft(base)).not.toHaveProperty('allow')
    expect(cleanDraft({ ...base, allow: [] }).allow).toEqual([])
    expect(cleanDraft({ ...base, allow: ['notes', 'web', 'notes', 'admin'] as never }).allow).toEqual(['web', 'notes'])
    expect(cleanGrants('web')).toEqual([])
    expect(cleanGrants(undefined)).toEqual([])
  })

  it('droit « web » : recherche et lecture de pages, connecteurs de recherche, rien d’autre', () => {
    for (const t of ['WebSearch', 'WebFetch', 'mcp__compi__fetch_page', 'mcp__compi__web_search']) expect(webGrantCovers(t, [])).toBe(true)
    expect(webGrantCovers('mcp__brave__brave_web_search', ['brave'])).toBe(true)
    expect(webGrantCovers('mcp__brave__brave_web_search', [])).toBe(false)
    expect(webGrantCovers('mcp__bravex__search', ['brave'])).toBe(false)
    for (const t of ['mcp__compi__open_url', 'Bash', 'PowerShell', 'mcp__notion__notion-search', 'mcp__compi__write_text_file'])
      expect(webGrantCovers(t, ['brave'])).toBe(false)
  })

  it('aperçu sans Markdown pour la notification', () => {
    expect(routinePreview('## Résumé\n\n- **3 e-mails** importants\n- [Facture](https://x.y)')).toBe('Résumé 3 e-mails importants Facture')
    expect(routinePreview('a'.repeat(300), 20)).toHaveLength(20)
  })

  it('PC éteint : rattrape une exécution récente, saute une ancienne', () => {
    const now = 10 * ROUTINE_CATCH_UP_MS
    expect(missedAction(now + 1000, now)).toBe('wait')
    expect(missedAction(now - 3600_000, now)).toBe('catch-up')
    expect(missedAction(now - ROUTINE_CATCH_UP_MS - 1, now)).toBe('skip')
  })
})

describe('routines : cartes et activité', () => {
  it('la carte dit quand, quoi, et que la routine tournera sans action', () => {
    const card = approvalTitle('mcp__compi__routine_create', {
      title: 'Résumé des e-mails',
      prompt: 'Résume mes e-mails non lus',
      repeat: 'chaque_semaine',
      time: '09:00',
      days: ['lundi']
    })
    expect(card.title).toBe('Compi veut créer la routine « Résumé des e-mails »')
    expect(card.detail).toMatch(/^Chaque lundi/i)
    expect(card.detail).toContain('Résume mes e-mails non lus')
    expect(card.detail).toContain('« Toujours »')
    expect(card.detail).toContain('aucune action')
  })

  it('libellés d’activité', () => {
    expect(activityLabel('mcp__compi__memory_forget')).toBe('Oubli d’un souvenir')
    expect(activityLabel('mcp__compi__routine_create', { title: 'Ma semaine' })).toBe('Routine : Ma semaine')
    expect(activityLabel('mcp__compi__clipboard_history', { query: 'adresse' })).toContain('adresse')
  })
})

describe('routines : sur événement', () => {
  const base = { title: 'x', prompt: 'ok' }

  it('brouillon : un déclencheur remplace l’heure, nettoyé', () => {
    const d = cleanDraft({ ...base, trigger: { on: 'message', app: ' WhatsApp ', sender: '  Maman   chérie ' } })
    expect(d.trigger).toEqual({ on: 'message', app: 'WhatsApp', sender: 'Maman chérie' })
    expect(d).not.toHaveProperty('repeat')
    expect(cleanDraft({ ...base, trigger: { on: 'message', app: '', sender: ' ' } }).trigger).toEqual({ on: 'message' })
    expect(cleanDraft({ ...base, trigger: { on: 'morning', extra: 1 } as never }).trigger).toEqual({ on: 'morning' })
    expect(() => cleanDraft({ ...base, trigger: { on: 'boot' } as never })).toThrow(/invalide/)
    expect(() => cleanDraft({ ...base })).toThrow(/invalide/)
    expect(validTrigger({ on: 'meeting-end' })).toBe(true)
    expect(validTrigger({ on: 'message', sender: 3 })).toBe(false)
  })

  it('libellés', () => {
    expect(triggerLabel({ on: 'morning' })).toBe('au premier allumage du jour')
    expect(triggerLabel({ on: 'meeting-end' })).toBe('à la fin de chaque rendez-vous')
    expect(triggerLabel({ on: 'message' })).toBe('à chaque nouveau message')
    expect(triggerLabel({ on: 'message', app: 'whatsapp', sender: 'Sam' }, () => 'WhatsApp')).toBe('à chaque message de « Sam » sur WhatsApp')
  })

  it('premier allumage : une fois par jour, après 5 h', () => {
    const at = (h: number, day = 30) => new Date(2026, 9, day, h, 0).getTime()
    const t = { on: 'morning' } as const
    expect(canFire(t, [], at(4))).toBe(false)
    expect(canFire(t, [], at(5))).toBe(true)
    expect(canFire(t, [at(7)], at(9))).toBe(false)
    expect(canFire(t, [at(7, 29)], at(6))).toBe(true)
    expect(canFire(t, 'nimporte', at(6))).toBe(true)
  })

  it('messages : 30 min d’écart, 5 par jour ; fins de rendez-vous : 8 par jour', () => {
    const now = new Date(2026, 9, 30, 18, 0).getTime()
    const m = { on: 'message' } as const
    expect(canFire(m, [now - 29 * 60_000], now)).toBe(false)
    expect(canFire(m, [now - 31 * 60_000], now)).toBe(true)
    const five = [1, 2, 3, 4, 5].map((h) => now - h * 3600_000)
    expect(canFire(m, five, now)).toBe(false)
    expect(
      canFire(
        m,
        five.map((x) => x - 24 * 3600_000),
        now
      )
    ).toBe(true)
    expect(canFire({ on: 'meeting-end' }, five, now)).toBe(true)
    expect(canFire({ on: 'meeting-end' }, [...five, ...[6, 7, 8].map((h) => now - h * 3600_000)], now)).toBe(false)
    expect(recentFires([now - 25 * 3600_000, now - 60_000, 'x', now + 1], now)).toEqual([now - 60_000])
  })

  it('message : application exacte, expéditeur sans accents ni casse', () => {
    const t = { on: 'message', app: 'whatsapp', sender: 'Élodie' } as const
    expect(messageMatches(t, { appKey: 'whatsapp', sender: 'elodie Martin' })).toBe(true)
    expect(messageMatches(t, { appKey: 'telegram', sender: 'Élodie' })).toBe(false)
    expect(messageMatches(t, { appKey: 'whatsapp', sender: 'Sam' })).toBe(false)
    expect(messageMatches({ on: 'message' }, { appKey: 'x', sender: 'y' })).toBe(true)
    expect(messageMatches({ on: 'morning' }, { appKey: 'x', sender: 'y' })).toBe(false)
  })

  it('outil : when → déclencheur, application cherchée parmi celles suivies', () => {
    const apps = [{ key: 'whatsapp', label: 'WhatsApp' }]
    expect(toolTrigger(undefined, undefined, undefined, apps)).toBeUndefined()
    expect(toolTrigger('heure', undefined, undefined, apps)).toBeUndefined()
    expect(toolTrigger('premier_allumage', undefined, undefined, apps)).toEqual({ on: 'morning' })
    expect(toolTrigger('fin_rendez_vous', undefined, undefined, apps)).toEqual({ on: 'meeting-end' })
    expect(toolTrigger('message', ' Sam ', 'whatsapp', apps)).toEqual({ on: 'message', app: 'whatsapp', sender: 'Sam' })
    expect(() => toolTrigger('message', 'Sam', 'Signal', apps)).toThrow(/WhatsApp/)
  })

  it('la carte dit l’événement', () => {
    const card = approvalTitle('mcp__compi__routine_create', {
      title: 'Suivi',
      prompt: 'Fais le point',
      when: 'message',
      message_from: 'Sam',
      message_app: 'WhatsApp'
    })
    expect(card.detail).toMatch(/^À chaque message de « Sam » sur WhatsApp/)
  })
})
