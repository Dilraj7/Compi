import { describe, expect, it } from 'vitest'
import { addClip, CLIP_DAYS, CLIP_MAX, isPasswordLike, PASSWORD_APPS, pruneClips, searchClips } from '../src/shared/clipboard'
import type { ClipItem } from '../src/shared/types'

const day = 86_400_000
const clip = (text: string, at: number, extra: Partial<ClipItem> = {}): ClipItem => ({ id: text, text, at, ...extra })

describe('historique du presse-papier', () => {
  it('reconnaît ce qui ressemble à un mot de passe ou une clé', () => {
    expect(isPasswordLike('Tr0ub4dor&3x')).toBe(true)
    expect(isPasswordLike('sk-ant-api03-AbCdEf123456')).toBe(true)
    expect(isPasswordLike('ghp_A1b2C3d4E5f6G7h8')).toBe(true)
  })

  it('sans faux positif sur les copies courantes', () => {
    for (const t of [
      'Bonjour Paul, merci pour ton retour',
      'https://github.com/anthropics/Claude-Code?tab=1',
      'C:\\Users\\Demo\\Documents\\Contrat-2026.pdf',
      'prenom.nom+compi@gmail.com',
      'motdepasse',
      '0612345678',
      'npm run build:win'
    ]) {
      expect(isPasswordLike(t), t).toBe(false)
    }
  })

  it('reconnaît les gestionnaires de mots de passe', () => {
    for (const app of ['1Password.exe', 'KeePassXC', 'Bitwarden', 'Proton Pass', 'Dashlane']) expect(PASSWORD_APPS.test(app), app).toBe(true)
    for (const app of ['chrome.exe', 'Mailbird.exe', 'WINWORD.EXE']) expect(PASSWORD_APPS.test(app), app).toBe(false)
  })

  it('une nouvelle copie va en tête ; un doublon remonte au lieu de s’ajouter', () => {
    const now = 100 * day
    let items = [clip('a', now - 3000), clip('b', now - 2000)]
    items = addClip(items, clip('c', now - 1000), now)
    expect(items.map((i) => i.text)).toEqual(['c', 'b', 'a'])
    items = addClip(items, { id: 'x', text: 'a', at: now, source: 'notepad.exe' }, now)
    expect(items.map((i) => i.text)).toEqual(['a', 'c', 'b'])
    expect(items[0]).toMatchObject({ id: 'a', source: 'notepad.exe' })
  })

  it('30 jours et 200 éléments au plus, sauf les épinglés', () => {
    const now = 100 * day
    const old = clip('vieux', now - (CLIP_DAYS + 1) * day)
    const pinned = clip('épinglé', now - (CLIP_DAYS + 5) * day, { pinned: true })
    expect(pruneClips([old, pinned, clip('récent', now - day)], now).map((i) => i.text)).toEqual(['récent', 'épinglé'])
    const many = Array.from({ length: CLIP_MAX + 20 }, (_, i) => clip(`t${i}`, now - i * 1000))
    const kept = pruneClips([...many, pinned], now)
    expect(kept.filter((i) => !i.pinned)).toHaveLength(CLIP_MAX)
    expect(kept.some((i) => i.pinned)).toBe(true)
  })

  it('cherche tous les mots, sans accents, aussi dans le nom de l’application', () => {
    const items = [clip('Adresse : 3 rue de la Paix', 1, { source: 'Mailbird.exe' }), clip('Réunion à 10 h', 2), clip('npm run dev', 3)]
    expect(searchClips(items, 'reunion').map((i) => i.text)).toEqual(['Réunion à 10 h'])
    expect(searchClips(items, 'paix mailbird')).toHaveLength(1)
    expect(searchClips(items, '', 2)).toHaveLength(2)
  })
})
