import { describe, expect, it } from 'vitest'
import { attentionView, keyTarget, KEY_MIN_AGE_MS } from '../src/shared/attention'
import type { ApprovalRequest, QuestionRequest } from '../src/shared/types'

const approval = (source: ApprovalRequest['source'], createdAt: number): ApprovalRequest => ({
  id: `${source}-${createdAt}`,
  source,
  title: 'Compi veut lire « bail.pdf »',
  toolName: 'mcp__compi__read_document',
  canAlwaysAllow: true,
  createdAt
})
const question = (createdAt: number): QuestionRequest => ({ id: `q-${createdAt}`, source: 'claude-code', sessionLabel: 'compi', questions: [], createdAt })

const base = { approvals: [], questions: [], mode: 'compact' as const, view: 'chat' as const, hasConversation: false }

describe('où montrer une demande', () => {
  it('rien à montrer : on ne change rien', () => {
    expect(attentionView(base)).toBeNull()
  })

  it('panneau ouvert sur la discussion : les cartes y sont déjà', () => {
    expect(attentionView({ ...base, mode: 'expanded', approvals: [approval('claude-code', 1)] })).toBeNull()
  })

  it('demande de Compi pendant une discussion : on rouvre la discussion', () => {
    expect(attentionView({ ...base, approvals: [approval('compi', 1)], hasConversation: true })).toBe('chat')
    expect(attentionView({ ...base, mode: 'expanded', view: 'settings', approvals: [approval('compi', 1)], hasConversation: true })).toBe('chat')
  })

  it('Claude Code, question, ou Compi sans discussion : Activité', () => {
    expect(attentionView({ ...base, approvals: [approval('claude-code', 1)], hasConversation: true })).toBe('activity')
    expect(attentionView({ ...base, approvals: [approval('compi', 1)] })).toBe('activity')
    expect(attentionView({ ...base, questions: [question(1)], hasConversation: true })).toBe('activity')
  })

  it('suit la demande la plus récente', () => {
    const approvals = [approval('compi', 1), approval('claude-code', 5)]
    expect(attentionView({ ...base, approvals, hasConversation: true })).toBe('activity')
    expect(attentionView({ ...base, approvals: [approval('claude-code', 1), approval('compi', 5)], hasConversation: true })).toBe('chat')
    expect(attentionView({ ...base, approvals: [approval('compi', 1)], questions: [question(3)], hasConversation: true })).toBe('activity')
  })
})

describe('cible des raccourcis Alt+Maj+O / N', () => {
  it('rien en attente : rien à faire', () => {
    expect(keyTarget([], [], 10_000)).toBeNull()
  })

  it('la plus ancienne carte, comme la première affichée', () => {
    const t = keyTarget([approval('compi', 5000), approval('claude-code', 1000)], [], 10_000)
    expect(t).toEqual({ kind: 'approval', request: expect.objectContaining({ id: 'claude-code-1000' }) })
  })

  it('une carte qui vient d’arriver ne se valide pas à l’aveugle', () => {
    const now = 10_000
    expect(keyTarget([approval('compi', now - KEY_MIN_AGE_MS + 1)], [], now)?.kind).toBe('too-soon')
    expect(keyTarget([approval('compi', now - KEY_MIN_AGE_MS)], [], now)?.kind).toBe('approval')
  })

  it('seulement une question : le panneau s’ouvre dessus', () => {
    expect(keyTarget([], [question(1)], 10_000)).toEqual({ kind: 'question' })
    // Une carte d'autorisation passe avant la question.
    expect(keyTarget([approval('compi', 1)], [question(2)], 10_000)?.kind).toBe('approval')
  })
})
