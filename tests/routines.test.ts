import { describe, expect, it, vi } from 'vitest'
import { cleanDraft, missedAction, ROUTINE_CATCH_UP_MS, routinePreview, routineRepeat, validRepeat } from '../src/shared/routines'

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
    expect(d).toEqual({ title: 'Résume mes e-mails non lus importants', prompt: 'Résume mes e-mails non lus importants', repeat: { every: 'week', days: [1, 5], time: '09:00' }, enabled: true })
  })

  it('refuse une demande vide ou un moment invalide', () => {
    expect(() => cleanDraft({ title: 'x', prompt: ' ', repeat: { every: 'day', time: '09:00' } })).toThrow(/Dis-moi/)
    expect(() => cleanDraft({ title: 'x', prompt: 'ok', repeat: { every: 'day', time: '9h' } })).toThrow(/invalide/)
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
