// Bouton « Tester » : une petite réponse (délai, vitesse) puis un appel d'outil
// factice, pour vérifier qu'un cerveau est utilisable par Compi.

import Anthropic from '@anthropic-ai/sdk'
import { normalizeBaseUrl } from '../../shared/brains'
import type { Brain, BrainTestResult, Effort } from '../../shared/types'
import { describeAgentError, normalizeWorkspaceId } from '../agent/errors'
import { secrets } from '../store/secrets'
import { LMSTUDIO_URL, OLLAMA_URL, settings } from '../store/settings'
import { applyDataPolicy, applyStyle } from './gateway'
import { prepareLocalBrain } from './local'
import { loadedModels } from './ollama'

export interface BrainClient {
  client: Anthropic
  model: string
  /** Paramètres du style de réponse à ajouter à la requête (réflexion, max_tokens). */
  style: (maxTokens: number) => Record<string, unknown>
}

/**
 * Client Anthropic pointé sur le cerveau, avec le nom de modèle et le style de réponse
 * à utiliser. `effort` remplace le style réglé (les actions rapides veulent du Vif).
 */
export async function clientFor(brain: Brain, override: { effort?: Effort } = {}): Promise<BrainClient> {
  const s = settings.get()
  const common = { maxRetries: 0, timeout: 180_000 }
  if (brain.provider === 'anthropic') {
    const workspaceId = normalizeWorkspaceId(s.workspaceId)
    return {
      client: new Anthropic({ ...common, apiKey: secrets.getApiKey() ?? null, defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined }),
      model: brain.model,
      style: (maxTokens) => ({ max_tokens: maxTokens })
    }
  }
  if (brain.provider === 'local') {
    const prepared = await prepareLocalBrain(brain.model)
    const base = s.local.baseUrl || (s.local.engine === 'lmstudio' ? LMSTUDIO_URL : OLLAMA_URL)
    const opts = { effort: override.effort ?? s.local.effort, canThink: prepared.thinking, levels: /^gpt-oss/i.test(brain.model) }
    return {
      client: new Anthropic({ ...common, apiKey: null, authToken: s.local.engine, baseURL: normalizeBaseUrl(base) }),
      model: prepared.model,
      style: (maxTokens) => applyStyle({ max_tokens: maxTokens }, opts)
    }
  }
  // apiKey: null — sinon le SDK irait chercher ANTHROPIC_API_KEY et l'enverrait au service tiers.
  return {
    client: new Anthropic({ ...common, apiKey: null, authToken: secrets.getCustomKey() || 'compi', baseURL: normalizeBaseUrl(s.custom.baseUrl) }),
    model: brain.model,
    style: (maxTokens) =>
      applyDataPolicy(applyStyle({ max_tokens: maxTokens }, { effort: override.effort ?? s.custom.effort, canThink: true, levels: false }), normalizeBaseUrl(s.custom.baseUrl), s.custom.denyDataCollection !== false)
  }
}

/** Part du modèle Ollama chargé qui tient dans la carte graphique. */
async function gpuShareOf(model: string): Promise<number | undefined> {
  const l = settings.get().local
  if (l.engine !== 'ollama') return undefined
  const loaded = await loadedModels(l.baseUrl || OLLAMA_URL).catch(() => [])
  return loaded.find((m) => m.name === model)?.gpuShare
}

export async function testBrain(brain: Brain): Promise<BrainTestResult> {
  try {
    const { client, model, style } = await clientFor(brain)
    const t0 = Date.now()
    let first = 0
    const stream = client.messages.stream({
      model,
      ...style(400),
      messages: [{ role: 'user', content: 'Présente-toi en une phrase, en français.' }]
    } as Anthropic.MessageStreamParams)
    stream.on('text', () => {
      if (!first) first = Date.now()
    })
    const reply = await stream.finalMessage()
    const end = Date.now()
    const genSeconds = (end - (first || t0)) / 1000
    const tokensPerSec = reply.usage.output_tokens > 3 && genSeconds > 0.05 ? Math.round(reply.usage.output_tokens / genSeconds) : undefined

    const toolReply = await client.messages.create({
      model,
      max_tokens: 600,
      tools: [{ name: 'get_time', description: "Renvoie l'heure actuelle.", input_schema: { type: 'object', properties: {} } }],
      messages: [{ role: 'user', content: "Quelle heure est-il ? Utilise l'outil get_time." }]
    })
    const tools = toolReply.content.some((b) => b.type === 'tool_use')

    const parts = [`première réponse en ${(((first || end) - t0) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`]
    if (tokensPerSec) parts.push(`${tokensPerSec} jetons/s`)
    const gpu = brain.provider === 'local' ? await gpuShareOf(model) : undefined
    if (gpu !== undefined) parts.push(gpu >= 0.97 ? '100 % dans la carte graphique' : `${Math.round(gpu * 100)} % dans la carte graphique (le reste sur le processeur : plus lent)`)
    parts.push(tools ? 'sait utiliser mes outils' : 'n’a pas utilisé l’outil de test : choisis un modèle marqué « outils »')
    return { ok: true, tokensPerSec, tools, message: `Ça marche : ${parts.join(' · ')}.` }
  } catch (e) {
    return { ok: false, message: describeAgentError((e as Error).message ?? String(e), brain) }
  }
}
