// Dictée partout : on maintient une touche (Ctrl droit par défaut), on parle,
// on relâche, et le texte s'écrit dans l'application ouverte. Fonctions pures,
// testées dans tests/dictation.test.ts : la touche (maintien, double appui,
// Échap), le nettoyage, le dictionnaire, « Compi, … » et le temps gagné.

import type { DictationAppStyle, DictationKey, DictationReplacement, DictationSettings, DictationStatRow, DictationStyle } from './types'
import { dayKey } from './usage'

export const DEFAULT_DICTATION: DictationSettings = {
  enabled: false,
  key: 'ControlRight',
  engine: 'parakeet',
  style: 'natural',
  appStyles: [],
  dictionary: [],
  compiPrefix: true,
  polishOnline: false,
  typingWpm: 40
}

export const DICTATION_KEYS: { id: DictationKey; label: string; warning?: string }[] = [
  { id: 'ControlRight', label: 'Ctrl droit' },
  { id: 'ShiftRight', label: 'Maj droite' },
  { id: 'AltRight', label: 'Alt Gr', warning: 'Déconseillé sur un clavier AZERTY : Alt Gr sert à taper @, € et #.' }
]

export const DICTATION_STYLES: { id: DictationStyle; label: string; hint: string }[] = [
  { id: 'raw', label: 'Brut', hint: 'Exactement ce que tu as dit.' },
  { id: 'natural', label: 'Naturel', hint: 'Sans les « euh », espaces et majuscules corrigés. Sur le PC.' },
  { id: 'polished', label: 'Soigné', hint: 'Réécrit proprement par ton cerveau, sans changer le sens.' }
]

export const isDictationKey = (v: unknown): v is DictationKey => DICTATION_KEYS.some((k) => k.id === v)
export const isDictationStyle = (v: unknown): v is DictationStyle => DICTATION_STYLES.some((s) => s.id === v)

// ─── Touche ──────────────────────────────────────────────────────────────────

/** Appui plus long : on écoute. Plus court : une simple tape. */
export const HOLD_MS = 220
/** Deux tapes rapprochées : mains libres, jusqu'à la tape suivante. */
export const DOUBLE_TAP_MS = 350
/** Durée maximale d'une dictée. */
export const DICTATION_MAX_MS = 120_000
/** Relâchement jamais reçu (écran verrouillé, fenêtre administrateur) : on repart de zéro. */
const LOST_UP_MS = 10_000

export type KeyState =
  | { s: 'idle' }
  | { s: 'pressed'; since: number }
  | { s: 'holding'; since: number }
  | { s: 'tapped'; at: number }
  | { s: 'handsfree'; since: number; released: boolean }
  /** Combinaison (Ctrl+C…) ou fin de dictée : on attend que la touche remonte. */
  | { s: 'wait-up'; since: number }

/** `target` : la touche choisie ; `esc` : Échap ; `other` : toute autre touche ou un clic. */
export type KeyEvent = { type: 'down' | 'up'; key: 'target' | 'esc' | 'other' } | { type: 'tick' }

/** `start` : maintien (on écoute tant que la touche reste enfoncée) ; `handsfree` : double appui. */
export type KeyAction = 'start' | 'handsfree' | 'stop' | 'cancel' | null

export const KEY_IDLE: KeyState = { s: 'idle' }

/**
 * Une étape de l'automate. Le micro ne s'ouvre qu'après un vrai maintien :
 * Ctrl droit + C (une combinaison) ou une tape isolée ne déclenchent rien.
 */
export function keyStep(st: KeyState, ev: KeyEvent, now: number): { state: KeyState; action: KeyAction } {
  const keep = { state: st, action: null }
  switch (st.s) {
    case 'idle':
      return ev.type === 'down' && ev.key === 'target' ? { state: { s: 'pressed', since: now }, action: null } : keep
    case 'pressed':
      if (ev.type === 'tick') return now - st.since >= HOLD_MS ? { state: { s: 'holding', since: now }, action: 'start' } : keep
      if (ev.type === 'down') return ev.key === 'target' ? keep : { state: { s: 'wait-up', since: now }, action: null }
      if (ev.key !== 'target') return keep
      return now - st.since < HOLD_MS ? { state: { s: 'tapped', at: now }, action: null } : { state: KEY_IDLE, action: null }
    case 'holding':
      if (ev.type === 'tick') return now - st.since >= DICTATION_MAX_MS ? { state: { s: 'wait-up', since: now }, action: 'stop' } : keep
      if (ev.type === 'up') return ev.key === 'target' ? { state: KEY_IDLE, action: 'stop' } : keep
      // Une autre touche pendant le maintien : c'était un raccourci, pas une dictée.
      return ev.key === 'target' ? keep : { state: { s: 'wait-up', since: now }, action: 'cancel' }
    case 'tapped':
      if (ev.type === 'tick') return now - st.at > DOUBLE_TAP_MS ? { state: KEY_IDLE, action: null } : keep
      if (ev.type === 'up') return keep
      if (ev.key !== 'target') return { state: KEY_IDLE, action: null }
      return now - st.at <= DOUBLE_TAP_MS
        ? { state: { s: 'handsfree', since: now, released: false }, action: 'handsfree' }
        : { state: { s: 'pressed', since: now }, action: null }
    case 'handsfree':
      if (ev.type === 'tick') return now - st.since >= DICTATION_MAX_MS ? { state: KEY_IDLE, action: 'stop' } : keep
      if (ev.type === 'up') return ev.key === 'target' && !st.released ? { state: { ...st, released: true }, action: null } : keep
      if (ev.key === 'esc') return { state: KEY_IDLE, action: 'cancel' }
      if (ev.key === 'target' && st.released) return { state: { s: 'wait-up', since: now }, action: 'stop' }
      return keep
    case 'wait-up':
      if (ev.type === 'tick') return now - st.since >= LOST_UP_MS ? { state: KEY_IDLE, action: null } : keep
      return ev.type === 'up' && ev.key === 'target' ? { state: KEY_IDLE, action: null } : keep
  }
}

/** Échap pendant un maintien (touche encore enfoncée) : annule aussi. */
export const isListening = (st: KeyState): boolean => st.s === 'holding' || st.s === 'handsfree'

// ─── Texte ───────────────────────────────────────────────────────────────────

/** Hésitations retirées par le style Naturel (jamais de vrais mots : « ben » peut être un prénom). */
const FILLERS = /(^|[\s,.;:!?])(?:euh+|heu+|hum+|hmm+|uh+|um+|erm+)(?=$|[\s,.;:!?])[,]?/giu

const FRENCH_HINT = /[àâçéèêëîïôûùüÿœ]|\b(je|tu|il|nous|vous|est|les|des|une|pour|avec|dans|pas|que|qui)\b/i

/** Le texte a l'air français (pour les espaces avant ? ! : ;). */
export const looksFrench = (text: string): boolean => FRENCH_HINT.test(text)

/** Style Naturel : sans hésitations, espaces et majuscule corrigés. Ne réécrit rien. */
export function cleanNatural(text: string): string {
  let t = text.replace(FILLERS, '$1')
  t = t
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/([,.;:!?])\1+/g, '$1')
    .replace(/^[\s,.;:]+/, '')
    .trim()
  if (looksFrench(t)) t = t.replace(/\s*([?!:;])/g, ' $1').replace(/([?!:;]) (?=[?!])/g, '$1')
  // « 15:30 » ou « https:// » ne prennent pas d'espace.
  t = t.replace(/(\d) :(\d)/g, '$1:$2').replace(/(\w) :\/\//g, '$1://')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Remplacements et raccourcis vocaux, mot entier, sans tenir compte des majuscules. */
export function applyDictionary(text: string, entries: DictationReplacement[]): string {
  let t = text
  for (const e of entries) {
    const from = e.from.trim()
    if (!from) continue
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(from).replace(/\s+/g, '\\s+')}(?![\\p{L}\\p{N}])`, 'giu')
    t = t.replace(re, () => e.to)
  }
  return t
}

/** Style d'une application : la règle de l'utilisateur, sinon le style général. */
export function styleFor(process: string | undefined, appStyles: DictationAppStyle[], fallback: DictationStyle): DictationStyle {
  const p = (process ?? '').toLowerCase().replace(/\.exe$/, '')
  return appStyles.find((r) => r.app.toLowerCase().replace(/\.exe$/, '') === p)?.style ?? fallback
}

/** « Compi, rappelle-moi… » → « rappelle-moi… » ; `null` si ce n'est pas une demande à Compi. */
export function compiRequest(text: string): string | null {
  // « Compiègne » ou « compilation » ne sont pas des demandes.
  const m = /^\s*(?:(?:ok|hey|hé|dis)[\s,]+)?(?:compi|compy|compie|kompi|kompy)(?![\p{L}\p{N}])\s*[,:.!]?\s*(.*)$/isu.exec(text)
  if (!m) return null
  const rest = m[1].trim()
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : null
}

/** Consigne du style Soigné : réécrire, jamais répondre. */
export const POLISH_SYSTEM =
  'Tu remets au propre un texte dicté à voix haute. Corrige la grammaire, la ponctuation et les répétitions, retire les hésitations, garde la langue, le sens, le ton et la longueur. ' +
  'Ne réponds jamais au texte, n’ajoute rien, ne commente pas : renvoie seulement le texte corrigé.'

/**
 * Garde-fou du style Soigné : le résultat doit rester un texte de même
 * longueur (0,35 à 1,4 fois l'original), sinon on garde le texte Naturel.
 */
export function acceptPolished(original: string, polished: string): string | null {
  const p = polished
    .trim()
    .replace(/^(?:voici (?:le|ton) texte[^:]*:|texte corrigé\s*:)\s*/i, '')
    .replace(/^["«“]\s*([\s\S]*?)\s*["»”]$/, '$1')
    .trim()
  if (!p) return null
  const ratio = p.length / Math.max(1, original.length)
  return ratio >= 0.35 && ratio <= 1.4 ? p : null
}

/** Mots d'un texte (ce qui contient au moins une lettre ou un chiffre). */
export const wordCount = (text: string): number => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

// ─── Temps gagné ─────────────────────────────────────────────────────────────

/** Minutes gagnées = mots ÷ vitesse de frappe − temps de parole (jamais négatif). */
export function minutesSaved(words: number, speakingMs: number, typingWpm: number): number {
  if (typingWpm <= 0) return 0
  return Math.max(0, words / typingWpm - speakingMs / 60_000)
}

/** Ajoute une dictée aux agrégats du jour ; garde 400 jours. */
export function addDictation(rows: DictationStatRow[], d: { at: number; app: string; words: number; speakingMs: number }): DictationStatRow[] {
  const day = dayKey(d.at)
  const app = d.app.slice(0, 60) || 'Autre'
  const next = rows.map((r) => ({ ...r }))
  let row = next.find((r) => r.day === day && r.app === app)
  if (!row) {
    row = { day, app, dictations: 0, words: 0, speakingMs: 0 }
    next.push(row)
  }
  row.dictations += 1
  row.words += d.words
  row.speakingMs += d.speakingMs
  const oldest = dayKey(d.at - 400 * 86_400_000)
  return next.filter((r) => r.day >= oldest)
}

export interface DictationSummary {
  dictations: number
  words: number
  /** Vitesse de parole (mots par minute). */
  wpm: number
  minutesSaved: number
  /** Jours de suite avec au moins une dictée (aujourd'hui ou hier compris). */
  streak: number
  /** 30 derniers jours, du plus ancien au plus récent. */
  days: Array<{ day: string; words: number; minutesSaved: number }>
  apps: Array<{ app: string; words: number; dictations: number; minutesSaved: number }>
}

/** Résumé des 30 derniers jours. */
export function summarizeDictation(rows: DictationStatRow[], typingWpm: number, now: number): DictationSummary {
  const days: DictationSummary['days'] = []
  for (let i = 29; i >= 0; i--) days.push({ day: dayKey(now - i * 86_400_000), words: 0, minutesSaved: 0 })
  const from = days[0].day
  const inside = rows.filter((r) => r.day >= from)
  const apps = new Map<string, DictationSummary['apps'][number]>()
  let speakingMs = 0
  for (const r of inside) {
    const saved = minutesSaved(r.words, r.speakingMs, typingWpm)
    const d = days.find((x) => x.day === r.day)
    if (d) {
      d.words += r.words
      d.minutesSaved += saved
    }
    const a = apps.get(r.app) ?? { app: r.app, words: 0, dictations: 0, minutesSaved: 0 }
    a.words += r.words
    a.dictations += r.dictations
    a.minutesSaved += saved
    apps.set(r.app, a)
    speakingMs += r.speakingMs
  }
  const words = inside.reduce((n, r) => n + r.words, 0)
  const active = new Set(rows.filter((r) => r.dictations > 0).map((r) => r.day))
  let streak = 0
  // Une série en cours ne se casse pas avant la fin de la journée.
  let i = active.has(dayKey(now)) ? 0 : 1
  while (active.has(dayKey(now - i * 86_400_000))) {
    streak++
    i++
  }
  return {
    dictations: inside.reduce((n, r) => n + r.dictations, 0),
    words,
    wpm: speakingMs > 0 ? Math.round(words / (speakingMs / 60_000)) : 0,
    minutesSaved: days.reduce((n, d) => n + d.minutesSaved, 0),
    streak,
    days,
    apps: [...apps.values()].sort((a, b) => b.words - a.words)
  }
}
