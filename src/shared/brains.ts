// Aides partagées (processus principal et interface) autour du « cerveau » :
// libellés, cerveau par défaut, vérification qu'il est prêt, adresses.

import type { Brain, CustomBrainSettings, ModelId, Settings } from './types'

export const CLAUDE_MODELS: Array<{ value: ModelId; label: string; hint: string }> = [
  { value: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'Le plus intelligent' },
  { value: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'Rapide et polyvalent' },
  { value: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'Éclair et très économique' }
]

/** Services en ligne compatibles (adresses vérifiées dans leur documentation, octobre 2026). */
export const CUSTOM_PRESETS: Array<{ id: string; name: string; baseUrl: string; model: string; modelHint: string; keyUrl?: string; noKey?: boolean }> = [
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api', model: '', modelHint: 'fournisseur/modèle (voir openrouter.ai/models)', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-flash', modelHint: 'deepseek-v4-flash ou deepseek-v4-pro', keyUrl: 'https://platform.deepseek.com' },
  { id: 'moonshot', name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/anthropic', model: '', modelHint: 'nom du modèle Kimi (voir platform.moonshot.ai)', keyUrl: 'https://platform.moonshot.ai' },
  { id: 'zai', name: 'GLM (Z.ai)', baseUrl: 'https://api.z.ai/api/anthropic', model: '', modelHint: 'nom du modèle GLM (voir docs.z.ai)', keyUrl: 'https://z.ai' },
  { id: 'llamacpp', name: 'llama.cpp (sur ce PC)', baseUrl: 'http://127.0.0.1:8080', model: 'local', modelHint: 'nom du modèle chargé', noKey: true }
]

type BrainSettings = Pick<Settings, 'provider' | 'model' | 'local' | 'custom'>

/** Cerveau des nouvelles discussions. */
export function defaultBrain(s: BrainSettings): Brain {
  switch (s.provider) {
    case 'local':
      return { provider: 'local', model: s.local.model }
    case 'custom':
      return { provider: 'custom', model: s.custom.model }
    default:
      return { provider: 'anthropic', model: s.model }
  }
}

export function brainLabel(brain: Brain, s?: Pick<Settings, 'custom'>): string {
  switch (brain.provider) {
    case 'anthropic':
      return CLAUDE_MODELS.find((m) => m.value === brain.model)?.label ?? brain.model
    case 'local':
      return brain.model || 'Modèle local'
    case 'custom':
      return `${s?.custom.name || 'Autre'}${brain.model ? ` · ${brain.model}` : ''}`
  }
}

/** Ce qui manque pour utiliser ce cerveau, ou `null` s'il est prêt. */
export function brainMissing(brain: Brain, s: { hasApiKey: boolean; hasCustomKey: boolean; custom: Pick<CustomBrainSettings, 'name' | 'baseUrl'> & Partial<CustomBrainSettings> }): string | null {
  switch (brain.provider) {
    case 'anthropic':
      return s.hasApiKey ? null : 'Ajoute ta clé API Anthropic dans les réglages pour que je puisse répondre.'
    case 'local':
      return brain.model ? null : 'Choisis un modèle local dans Réglages › Cerveau.'
    case 'custom': {
      if (!s.custom.baseUrl || !brain.model) return 'Indique l’adresse et le modèle du service dans Réglages › Cerveau › Autre.'
      // Un serveur sur ce PC ou le réseau local peut se passer de clé ; un service en ligne, non.
      return s.hasCustomKey || isPrivateHost(hostOf(s.custom.baseUrl)) ? null : `Ajoute la clé ${s.custom.name || 'du service'} dans Réglages › Cerveau › Autre.`
    }
  }
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).hostname
  } catch {
    return ''
  }
}

/**
 * Adresse de base pour le moteur Claude Code : sans « / » final ni « /v1 »
 * (il ajoute lui-même /v1/messages). Sans protocole, http pour une adresse
 * locale, https sinon.
 */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `${isPrivateHost(url.split(/[/:]/)[0]) ? 'http' : 'https'}://${url}`
  return url.replace(/\/+$/, '').replace(/\/v1$/i, '')
}

/** Machine locale ou réseau privé (localhost, 127.x, 10.x, 192.168.x, 172.16-31.x, ::1). */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '0.0.0.0') return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true
  const m = /^172\.(\d+)\./.exec(h)
  return Boolean(m && Number(m[1]) >= 16 && Number(m[1]) <= 31)
}
