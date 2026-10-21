// Masque les secrets avant qu'un contenu (document, presse-papier, écran…)
// parte vers un cerveau en ligne. Chaque motif est vérifié (clé de contrôle
// de l'IBAN, algorithme de Luhn pour les cartes, clé du n° de sécurité
// sociale) pour éviter de masquer un numéro de commande ou un SIRET.
// Fonctions pures, testées dans tests/privacy.test.ts.

export interface Redacted {
  text: string
  /** Nombre de secrets masqués. */
  count: number
}

const digits = (s: string): string => s.replace(/\D/g, '')
const last4 = (s: string): string => s.replace(/[\s-]/g, '').slice(-4)

/** Clé de contrôle d'un IBAN (ISO 13616, modulo 97). */
export function validIban(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  const moved = s.slice(4) + s.slice(0, 4)
  let rest = 0
  for (const ch of moved) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch
    for (const d of v) rest = (rest * 10 + Number(d)) % 97
  }
  return rest === 1
}

/** Algorithme de Luhn (cartes bancaires). */
export function luhn(raw: string): boolean {
  const s = digits(raw)
  let sum = 0
  for (let i = 0; i < s.length; i++) {
    let d = Number(s[s.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return s.length > 0 && sum % 10 === 0
}

/** Carte plausible : 15, 16 ou 19 chiffres, préfixe d'émetteur connu, Luhn valide. */
function validCard(raw: string): boolean {
  const s = digits(raw)
  if (![15, 16, 19].includes(s.length)) return false
  if (s.length === 15 && !/^3[47]/.test(s)) return false
  if (!/^(4|5[1-5]|2[2-7]|3[47]|6)/.test(s)) return false
  return luhn(s)
}

/** N° de sécurité sociale français : 13 chiffres + clé (97 − n mod 97). */
export function validNir(raw: string): boolean {
  const s = raw.replace(/\s/g, '').toUpperCase()
  if (!/^[12]\d{4}(\d{2}|2A|2B)\d{6}\d{2}$/.test(s)) return false
  const body = s.slice(0, 13).replace('2A', '19').replace('2B', '18')
  const key = Number(s.slice(13))
  return 97 - Number(BigInt(body) % 97n) === key
}

type Rule = { re: RegExp; mask: (m: string, ...groups: string[]) => string | null }

const RULES: Rule[] = [
  // Clés privées (bloc PEM complet).
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, mask: () => '[clé privée masquée]' },
  // Clés d'API et jetons aux préfixes connus.
  {
    re: /\b(?:sk-ant-[A-Za-z0-9_-]{20,}|sk-or-v1-[A-Za-z0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
    mask: () => '[clé masquée]'
  },
  // Mot de passe, code PIN, cryptogramme, code de vérification : on garde l'étiquette.
  {
    re: /\b(mots? de passe|mdp|password|passwd|pwd|passphrase|code (?:secret|pin|d['’]accès|de vérification|de confirmation|de sécurité|à usage unique)|pin|cvv|cvc|cryptogramme|verification code|security code|one[- ]time code|otp)(\s*[:=]\s*|\s+(?:est|is)\s+)(\S{3,})/gi,
    mask: (_m, label, sep) => `${label}${sep}[masqué]`
  },
  // « CVV 123 », « code PIN 1234 » : chiffres juste après, sans deux-points.
  { re: /\b(cvv2?|cvc2?|cryptogramme(?: visuel)?|code pin)(\s+)(\d{3,4})\b/gi, mask: (_m, label, sep) => `${label}${sep}[masqué]` },
  // IBAN (avec ou sans espaces), validé par sa clé.
  { re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g, mask: (m) => (validIban(m) ? `[IBAN masqué …${last4(m)}]` : null) },
  // N° de sécurité sociale, validé par sa clé.
  { re: /\b[12] ?\d{2} ?\d{2} ?(?:\d{2}|2A|2B) ?\d{3} ?\d{3} ?\d{2}\b/g, mask: (m) => (validNir(m) ? '[n° de sécurité sociale masqué]' : null) },
  // Cartes bancaires, validées par Luhn.
  { re: /\b\d(?:[ -]?\d){14,18}\b/g, mask: (m) => (validCard(m) ? `[carte masquée …${last4(m)}]` : null) }
]

/** Masque les secrets d'un texte. */
export function redact(text: string): Redacted {
  let count = 0
  let out = text
  for (const rule of RULES) {
    out = out.replace(rule.re, (m: string, ...rest: unknown[]) => {
      const groups = rest.filter((g): g is string => typeof g === 'string')
      const masked = rule.mask(m, ...groups)
      if (masked === null) return m
      count++
      return masked
    })
  }
  return { text: out, count }
}
