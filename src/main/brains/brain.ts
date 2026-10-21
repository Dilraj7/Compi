// Branche le moteur Claude Code sur le cerveau choisi. Ollama, LM Studio,
// llama.cpp et plusieurs services en ligne parlent le même format que Claude
// (POST /v1/messages) : il suffit de changer l'adresse et le modèle.
// Fonctions pures, testées dans tests/brains.test.ts.

import type { Brain, Conversation, Settings } from '../../shared/types'
import { defaultBrain, normalizeBaseUrl } from '../../shared/brains'
import { customHeadersEnv } from '../agent/errors'

/** Cerveau d'une discussion. Les anciennes discussions, d'avant le choix du cerveau, étaient avec Claude. */
export function resolveBrain(s: Settings, conv?: Pick<Conversation, 'brain'>): Brain {
  if (!conv) return defaultBrain(s)
  return conv.brain ?? { provider: 'anthropic', model: s.model }
}

export interface BrainEnvContext {
  /** Clé Anthropic (fournisseur `anthropic`). */
  apiKey?: string
  workspaceId?: string
  existingHeaders?: string
  /** Adresse du moteur local ou du service (autres fournisseurs). */
  baseUrl?: string
  /** Clé du service « Autre », ou jeton factice pour un moteur local. */
  authToken?: string
  /** Fenêtre de contexte réelle du modèle local, en jetons. */
  contextTokens?: number
  /** Le modèle local sait réfléchir. */
  thinking?: boolean
}

/**
 * Variables laissées par un autre agent quand Compi est lancé depuis lui (terminal de
 * Claude Code…) : identité du compte (e-mail, organisation), session, canal de messages.
 * Le moteur les ajouterait aux messages, y compris vers un service tiers.
 */
const INHERITED_AGENT_VARS = /^(CLAUDECODE|CLAUDE_CODE_|CLAUDE_AGENT_SDK_|CLAUDE_EFFORT$|CLAUDE_PID$|CLAUDE_PREVIEW_|AI_AGENT$)/

/** Environnement du PC, sans les variables héritées d'un autre agent. */
export function hostEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !INHERITED_AGENT_VARS.test(k)))
}

/** Variables d'environnement à imposer au moteur pour ce cerveau. `undefined` retire la variable. */
export function brainEnv(brain: Brain, ctx: BrainEnvContext): Record<string, string | undefined> {
  if (brain.provider === 'anthropic') {
    return {
      ANTHROPIC_API_KEY: ctx.apiKey,
      // Clés « multi-workspace » : Anthropic exige l'en-tête anthropic-workspace-id.
      ANTHROPIC_CUSTOM_HEADERS: customHeadersEnv(ctx.workspaceId ?? '', ctx.existingHeaders),
      // Avec la clé API, le moteur envoie par défaut des statistiques d'usage à Anthropic.
      // Seule la conversation part ; ce que reçoit le modèle reste identique.
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1'
    }
  }

  const m = brain.model
  const env: Record<string, string | undefined> = {
    ANTHROPIC_BASE_URL: normalizeBaseUrl(ctx.baseUrl ?? ''),
    ANTHROPIC_AUTH_TOKEN: ctx.authToken || 'compi',
    // Vide (et non absente) : aucune clé Anthropic ne doit partir vers un tiers.
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_CUSTOM_HEADERS: undefined,
    CLAUDE_CODE_USE_BEDROCK: undefined,
    CLAUDE_CODE_USE_VERTEX: undefined,
    CLAUDE_CODE_USE_FOUNDRY: undefined,
    // Tous les appels, y compris ceux de fond, vont vers ce modèle et jamais vers un modèle Claude.
    ANTHROPIC_MODEL: m,
    ANTHROPIC_DEFAULT_OPUS_MODEL: m,
    ANTHROPIC_DEFAULT_SONNET_MODEL: m,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: m,
    ANTHROPIC_SMALL_FAST_MODEL: m,
    CLAUDE_CODE_SUBAGENT_MODEL: m,
    // Aucun appel annexe vers Anthropic (télémétrie, mises à jour…).
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    // Début de prompt identique d'un tour à l'autre : le moteur local réutilise son cache.
    CLAUDE_CODE_ATTRIBUTION_HEADER: '0',
    DISABLE_PROMPT_CACHING: '1',
    // Requêtes au format standard : ni niveau d'effort (Ollama le traduit en demande de
    // réflexion), ni fonctions expérimentales réservées à Claude.
    CLAUDE_CODE_EFFORT_LEVEL: 'auto',
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1'
  }
  if (brain.provider === 'local') {
    // Demander de réfléchir à un modèle qui ne sait pas le faire est refusé par Ollama.
    if (!ctx.thinking) env.CLAUDE_CODE_DISABLE_THINKING = '1'
    env.API_TIMEOUT_MS = '600000'
    // Le moteur résume la conversation à temps pour rester dans la vraie fenêtre du modèle.
    if (ctx.contextTokens) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(ctx.contextTokens)
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '8192'
  }
  return env
}
