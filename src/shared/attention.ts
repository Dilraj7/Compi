// Où montrer une demande d'autorisation ou une question qui vient d'arriver.
// Fonction pure, testée dans tests/attention.test.ts.

import type { ApprovalRequest, IslandMode, PanelView, QuestionRequest } from './types'

interface AttentionInput {
  approvals: ApprovalRequest[]
  questions: QuestionRequest[]
  mode: IslandMode
  view: PanelView
  /** Une discussion est ouverte dans le panneau. */
  hasConversation: boolean
}

/**
 * Vue à afficher, ou `null` pour ne rien changer.
 * - Panneau ouvert sur la discussion : les cartes s'y affichent déjà, au-dessus de la saisie.
 * - Demande de Compi pendant une discussion : on rouvre la discussion, pour garder le contexte.
 * - Sinon (Claude Code, question…) : Activité.
 */
export function attentionView({ approvals, questions, mode, view, hasConversation }: AttentionInput): PanelView | null {
  if (!approvals.length && !questions.length) return null
  if (mode === 'expanded' && view === 'chat') return null
  const latest = [...approvals].sort((a, b) => b.createdAt - a.createdAt)[0]
  const newestIsQuestion = questions.some((q) => !latest || q.createdAt > latest.createdAt)
  if (!newestIsQuestion && latest?.source === 'compi' && hasConversation) return 'chat'
  return 'activity'
}

/** Délai avant qu'un raccourci global puisse répondre à une carte : le temps de la lire. */
export const KEY_MIN_AGE_MS = 700

export type KeyTarget = { kind: 'approval'; request: ApprovalRequest } | { kind: 'question' } | { kind: 'too-soon'; request: ApprovalRequest }

/**
 * Carte visée par Alt+Maj+O / N : la plus ancienne demande, comme la première
 * affichée dans le panneau. Une question ne se répond pas à l'aveugle : le
 * raccourci ouvre le panneau dessus.
 */
export function keyTarget(approvals: ApprovalRequest[], questions: QuestionRequest[], now: number): KeyTarget | null {
  const oldest = [...approvals].sort((a, b) => a.createdAt - b.createdAt)[0]
  if (oldest) return now - oldest.createdAt < KEY_MIN_AGE_MS ? { kind: 'too-soon', request: oldest } : { kind: 'approval', request: oldest }
  return questions.length ? { kind: 'question' } : null
}
