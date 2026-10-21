// File d'attente des approbations et des questions, partagée entre l'agent
// Compi (canUseTool) et le pont Claude Code (hook PermissionRequest).
// Chaque demande est une promesse en attente du clic de l'utilisateur.

import { randomUUID } from 'node:crypto'
import { IPC } from '../shared/ipc'
import type {
  ApprovalDecision,
  ApprovalRequest,
  QuestionAnswer,
  QuestionItem,
  QuestionRequest
} from '../shared/types'
import { emit } from './bus'
import { log } from './log'
import { recordApproval } from './privacy/approvalLog'

export type ApprovalOutcome = ApprovalDecision | 'timeout' | 'cancelled'

interface Pending<T, R> {
  request: T
  resolve: (outcome: R) => void
  timer?: NodeJS.Timeout
}

type NewApproval = Omit<ApprovalRequest, 'id' | 'createdAt'>

interface WaitOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

class ApprovalQueue {
  private approvals = new Map<string, Pending<ApprovalRequest, ApprovalOutcome>>()
  private questions = new Map<string, Pending<QuestionRequest, Record<string, string> | null | 'timeout' | 'cancelled'>>()
  private listeners = new Set<() => void>()

  /** Demande une approbation et attend la décision de l'utilisateur. */
  request(input: NewApproval, opts: WaitOptions = {}): Promise<ApprovalOutcome> {
    const request: ApprovalRequest = { ...input, id: randomUUID(), createdAt: Date.now() }
    return new Promise((resolve) => {
      const entry: Pending<ApprovalRequest, ApprovalOutcome> = { request, resolve }
      if (opts.timeoutMs) entry.timer = setTimeout(() => this.settle(request.id, 'timeout'), opts.timeoutMs)
      opts.signal?.addEventListener('abort', () => this.settle(request.id, 'cancelled'), { once: true })
      this.approvals.set(request.id, entry)
      this.broadcast()
    })
  }

  decide(id: string, decision: ApprovalDecision): void {
    this.settle(id, decision)
  }

  /** Pose des questions (AskUserQuestion de Claude Code). */
  ask(
    sessionLabel: string,
    questions: QuestionItem[],
    opts: WaitOptions = {}
  ): Promise<Record<string, string> | null | 'timeout' | 'cancelled'> {
    const request: QuestionRequest = {
      id: randomUUID(),
      source: 'claude-code',
      sessionLabel,
      questions,
      createdAt: Date.now()
    }
    return new Promise((resolve) => {
      const entry: Pending<QuestionRequest, Record<string, string> | null | 'timeout' | 'cancelled'> = { request, resolve }
      if (opts.timeoutMs) entry.timer = setTimeout(() => this.settleQuestion(request.id, 'timeout'), opts.timeoutMs)
      opts.signal?.addEventListener('abort', () => this.settleQuestion(request.id, 'cancelled'), { once: true })
      this.questions.set(request.id, entry)
      this.broadcast()
    })
  }

  answer({ id, answers }: QuestionAnswer): void {
    this.settleQuestion(id, answers)
  }

  pendingApprovals(): ApprovalRequest[] {
    return [...this.approvals.values()].map((p) => p.request)
  }

  pendingQuestions(): QuestionRequest[] {
    return [...this.questions.values()].map((p) => p.request)
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  cancelAll(): void {
    for (const id of [...this.approvals.keys()]) this.settle(id, 'cancelled')
    for (const id of [...this.questions.keys()]) this.settleQuestion(id, 'cancelled')
  }

  private settle(id: string, outcome: ApprovalOutcome): void {
    const entry = this.approvals.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.approvals.delete(id)
    entry.resolve(outcome)
    this.broadcast()
    // Le journal ne doit jamais bloquer une réponse.
    try {
      recordApproval(entry.request, outcome)
    } catch (e) {
      log('warn', 'journal des autorisations non écrit', (e as Error).message)
    }
  }

  private settleQuestion(id: string, outcome: Record<string, string> | null | 'timeout' | 'cancelled'): void {
    const entry = this.questions.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.questions.delete(id)
    entry.resolve(outcome)
    this.broadcast()
  }

  private broadcast(): void {
    emit(IPC.approvals, this.pendingApprovals())
    emit(IPC.questions, this.pendingQuestions())
    for (const l of this.listeners) l()
  }
}

export const approvals = new ApprovalQueue()
