import { describe, expect, it } from 'vitest'
import { DEFAULT_PRIVACY, filterAutoAllowed, privacyDecision, shareMemoryInPrompt } from '../src/shared/privacy'
import { luhn, redact, validIban, validNir } from '../src/main/privacy/redact'

const doc = 'mcp__compi__read_document'
const clip = 'mcp__compi__clipboard_read'

describe('garde-fou de confidentialité', () => {
  it('cerveau local : rien à demander, rien ne quitte le PC', () => {
    expect(privacyDecision('local', doc, { ...DEFAULT_PRIVACY, files: 'never' })).toBeNull()
    expect(shareMemoryInPrompt('local', { ...DEFAULT_PRIVACY, memory: 'never' })).toBe(true)
  })

  it('cerveau en ligne : demander par défaut, toujours, ou jamais', () => {
    expect(privacyDecision('anthropic', doc, DEFAULT_PRIVACY)).toBe('ask')
    expect(privacyDecision('custom', clip, { ...DEFAULT_PRIVACY, clipboard: 'always' })).toBe('allow')
    expect(privacyDecision('custom', 'mcp__compi__screen_capture', { ...DEFAULT_PRIVACY, screen: 'never' })).toBe('deny')
    // Réglages anciens sans section confidentialité : on demande.
    expect(privacyDecision('custom', clip, undefined)).toBe('ask')
  })

  it('les outils sans donnée personnelle ne sont pas concernés', () => {
    expect(privacyDecision('anthropic', 'mcp__compi__get_datetime', DEFAULT_PRIVACY)).toBeNull()
    expect(privacyDecision('anthropic', 'mcp__compi__fetch_page', DEFAULT_PRIVACY)).toBeNull()
  })

  it('la mémoire ne part dans les consignes en ligne que sur « toujours »', () => {
    expect(shareMemoryInPrompt('anthropic', DEFAULT_PRIVACY)).toBe(false)
    expect(shareMemoryInPrompt('custom', { ...DEFAULT_PRIVACY, memory: 'always' })).toBe(true)
  })

  it('autorisations d’office : la carte passe tant que ce n’est pas « toujours », les actions Windows jamais', () => {
    const tools = ['mcp__compi__get_datetime', 'mcp__compi__list_windows', 'mcp__compi__search_files', clip, 'mcp__compi__set_theme']
    const blocked = ['mcp__compi__set_theme']
    expect(filterAutoAllowed(tools, 'local', DEFAULT_PRIVACY, blocked)).toEqual(['mcp__compi__get_datetime', 'mcp__compi__list_windows', 'mcp__compi__search_files', clip])
    expect(filterAutoAllowed(tools, 'anthropic', DEFAULT_PRIVACY, blocked)).toEqual(['mcp__compi__get_datetime'])
    expect(filterAutoAllowed(tools, 'custom', { ...DEFAULT_PRIVACY, window: 'always', files: 'never' }, blocked)).toEqual(['mcp__compi__get_datetime', 'mcp__compi__list_windows'])
  })
})

describe('masquage des secrets', () => {
  it('contrôles : IBAN (modulo 97), cartes (Luhn), n° de sécurité sociale (clé)', () => {
    expect(validIban('FR76 3000 6000 0112 3456 7890 189')).toBe(true)
    expect(validIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(validIban('FR76 3000 6000 0112 3456 7890 188')).toBe(false)
    expect(luhn('4111 1111 1111 1111')).toBe(true)
    expect(luhn('4111 1111 1111 1112')).toBe(false)
    expect(validNir('1 85 05 78 006 084 91')).toBe(true)
    expect(validNir('1 85 05 78 006 084 92')).toBe(false)
  })

  it('masque IBAN, cartes, n° de sécurité sociale, en gardant les 4 derniers chiffres utiles', () => {
    const r = redact(
      'Virement sur FR76 3000 6000 0112 3456 7890 189 ou DE89370400440532013000. Carte 4111 1111 1111 1111, Amex 3782-822463-10005. Sécu : 1 85 05 78 006 084 91.'
    )
    expect(r.text).toBe(
      'Virement sur [IBAN masqué …0189] ou [IBAN masqué …3000]. Carte [carte masquée …1111], Amex [carte masquée …0005]. Sécu : [n° de sécurité sociale masqué].'
    )
    expect(r.count).toBe(5)
  })

  it('masque mots de passe, codes et clés d’API, en gardant l’étiquette', () => {
    const r = redact(
      [
        'Mot de passe : Hunter2!',
        'mdp=azerty123',
        'Ton code de vérification : 482913',
        'CVV 123',
        'Clé : sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
        'OpenRouter sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef',
        'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
        'AKIAIOSFODNN7EXAMPLE'
      ].join('\n')
    )
    expect(r.text).toBe(
      [
        'Mot de passe : [masqué]',
        'mdp=[masqué]',
        'Ton code de vérification : [masqué]',
        'CVV [masqué]',
        'Clé : [clé masquée]',
        'OpenRouter [clé masquée]',
        '[clé masquée]',
        '[clé masquée]'
      ].join('\n')
    )
    expect(r.count).toBe(8)
  })

  it('bloc de clé privée complet', () => {
    const r = redact('avant\n-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nIBAAKC\n-----END RSA PRIVATE KEY-----\naprès')
    expect(r.text).toBe('avant\n[clé privée masquée]\naprès')
  })

  it('ne touche pas aux numéros ordinaires', () => {
    const ordinary = [
      'Appelle-moi au 06 12 34 56 78 ou au +33 6 12 34 56 78.',
      'SIRET 732 829 320 00074, SIREN 732 829 320.',
      'Commande n° 4000123456789012, facture 2026-104.',
      'Total : 1 234 567,89 €, le 13/10/2026 à 14:30.',
      'Code postal : 75001. Code client : ABC123.',
      'IBAN invalide FR76 3000 6000 0112 3456 7890 188.',
      'Le mot de passe doit contenir 12 caractères.',
      'Version 4111.1111.1111.1111 du logiciel.'
    ].join('\n')
    expect(redact(ordinary)).toEqual({ text: ordinary, count: 0 })
  })
})
