// Aides pures (sans Electron) pour l'agent : en-tête de workspace et messages
// d'erreur lisibles. Testées dans tests/agentErrors.test.ts.

import type { Brain } from '../../shared/types'

const WORKSPACE_ID = /wrkspc_[A-Za-z0-9]+/

/**
 * Nettoie un identifiant de workspace saisi par l'utilisateur. On accepte l'ID
 * seul ou une URL de la Console qui le contient. Tout caractère hors
 * [A-Za-z0-9_-] est retiré : la valeur finit dans un en-tête HTTP, un retour à
 * la ligne permettrait d'en injecter d'autres.
 */
export function normalizeWorkspaceId(input: string): string {
  const match = input.match(WORKSPACE_ID)
  if (match) return match[0]
  return input.replace(/[^A-Za-z0-9_-]/g, '')
}

/**
 * Valeur de ANTHROPIC_CUSTOM_HEADERS pour le moteur Claude Code : les en-têtes
 * déjà définis par l'utilisateur sont conservés, et l'en-tête
 * `anthropic-workspace-id` est ajouté (ou remplacé) si un workspace est choisi.
 */
export function customHeadersEnv(workspaceId: string, existing?: string): string | undefined {
  const id = normalizeWorkspaceId(workspaceId)
  const lines = (existing ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^anthropic-workspace-id\s*:/i.test(l))
  if (id) lines.push(`anthropic-workspace-id: ${id}`)
  return lines.length ? lines.join('\n') : undefined
}

/**
 * Message à afficher pour une erreur de l'agent. Le Claude Agent SDK signale
 * les erreurs d'API par un code court (`unknown`, `invalid_request`…) et met le
 * vrai message dans le texte : on garde toujours ce détail.
 */
export function describeAgentError(raw: string, brain?: Brain): string {
  const detail = raw.replace(/^API Error:\s*/i, '').trim() || 'Erreur inconnue'
  const r = detail.toLowerCase()

  if (brain?.provider === 'local') {
    const unreachable = r.includes('econnrefused') || r.includes('fetch failed') || r.includes('connection error') || r.includes('unable to connect')
    if (unreachable) return 'Le moteur local (Ollama ou LM Studio) ne répond pas. Lance-le, ou change de cerveau dans Réglages › Cerveau.'
    if (r.includes('not found') || r.includes('no such model') || /\b404\b/.test(r))
      return `Le modèle « ${brain.model} » n’est pas installé. Télécharge-le dans Réglages › Cerveau, ou choisis-en un autre.`
    if (r.includes('does not support tools') || r.includes('tools are not supported'))
      return `« ${brain.model} » ne sait pas utiliser d’outils : choisis un modèle marqué « outils » dans Réglages › Cerveau.`
    if (r.includes('does not support images') || r.includes('vision')) return `« ${brain.model} » ne voit pas les images : choisis un modèle marqué « vision ».`
    if (r.includes('out of memory') || r.includes('requires more system memory') || r.includes('cudamalloc'))
      return 'Pas assez de mémoire pour ce modèle : ferme des applications ou choisis un modèle plus léger.'
    if (r.includes('timed out') || r.includes('timeout')) return 'Le modèle local a mis trop de temps à répondre. Un modèle plus léger sera plus rapide.'
    return `Le modèle local a renvoyé une erreur : ${detail}`
  }
  if (brain?.provider === 'custom') {
    if (/\b401\b/.test(r) || r.includes('unauthorized') || r.includes('invalid api key') || r.includes('authentication'))
      return 'Le service refuse la clé. Vérifie-la dans Réglages › Cerveau › Autre.'
    if (/\b402\b/.test(r) || r.includes('insufficient') || r.includes('balance') || r.includes('credits')) return 'Le service indique un solde insuffisant sur ton compte.'
    if (r.includes('data policy') || r.includes('data_collection') || r.includes('data collection'))
      return `Aucun fournisseur de « ${brain.model} » ne garantit de ne pas garder tes messages. Choisis un autre modèle, ou décoche « N’utiliser que des fournisseurs qui ne gardent pas mes messages » dans Réglages › Cerveau › Autre.`
    // OpenRouter : « No endpoints found that support tool use », ou un simple « 400 Invalid request ».
    if (/support[s]? (tool|function)|tool use|tools? (are|is) not supported/.test(r))
      return `« ${brain.model} » n’accepte pas les outils dont Compi a besoin. Choisis un modèle marqué « tools » (sur OpenRouter, filtre « Tools »).`
    if (/\b400\b/.test(r) && r.includes('invalid request') && !r.includes('model'))
      return `Le service a refusé la requête. Le plus souvent, « ${brain.model} » n’accepte pas les outils dont Compi a besoin : choisis un modèle marqué « tools » (sur OpenRouter, filtre « Tools »).`
    if (r.includes('model') &&(r.includes('not found') || r.includes('not exist') || r.includes('invalid')))
      return `Le service ne connaît pas le modèle « ${brain.model} ». Vérifie son nom dans Réglages › Cerveau › Autre.`
    if (r.includes('enotfound') || r.includes('econnrefused') || r.includes('fetch failed') || r.includes('connection error'))
      return 'Impossible de joindre le service. Vérifie son adresse et ta connexion Internet.'
    if (r.includes('rate') || /\b429\b/.test(r)) return 'Trop de requêtes pour le moment, réessaie dans un instant.'
    return `Le service a renvoyé une erreur : ${detail}`
  }

  if (r.includes('not scoped to a workspace') || r.includes('anthropic-workspace-id'))
    return (
      'Ta clé API couvre plusieurs workspaces : Anthropic doit savoir lequel utiliser. ' +
      'Indique l’ID du workspace (wrkspc_…) dans Réglages › Cerveau › Workspace, ' +
      'ou crée une clé rattachée à un seul workspace sur platform.claude.com.'
    )
  if (r.includes('invalid api key') || r.includes('invalid x-api-key') || r.includes('authentication_failed') || /\b401\b/.test(r))
    return 'Ta clé API Anthropic semble invalide. Vérifie-la dans les réglages.'
  if (/\b403\b/.test(r) || r.includes('permission_error'))
    return `Ta clé API n’a pas accès à cette ressource (workspace ou modèle). Détail : ${detail}`
  if (r.includes('credit balance') || r.includes('billing'))
    return 'Ton compte Anthropic manque de crédits (platform.claude.com › Billing).'
  if (r.includes('rate_limit') || /\b429\b/.test(r)) return 'Trop de requêtes pour le moment, réessaie dans un instant.'
  if (r.includes('overloaded') || /\b529\b/.test(r)) return 'Les serveurs de Claude sont surchargés, réessaie dans un instant.'
  if (r.includes('model') && (r.includes('not found') || r.includes('not_found') || r.includes('does not exist')))
    return `Ce modèle n’est pas disponible pour ta clé. Choisis-en un autre dans les réglages. Détail : ${detail}`
  if (r.includes('native cli binary') || r.includes('enoent') || r.includes('spawn'))
    return `Le moteur de l’agent n’a pas pu démarrer : ${detail}`
  if (r.includes('enotfound') || r.includes('econnrefused') || r.includes('etimedout') || r.includes('fetch failed'))
    return 'Impossible de joindre Anthropic. Vérifie ta connexion Internet.'
  return detail
}
