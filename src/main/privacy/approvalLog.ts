// Journal des autorisations (vue Activité) : chaque réponse à une carte, de
// Compi ou de Claude Code, et ce que les routines se sont vu refuser. Il reste
// sur le PC ; seulement la phrase de la carte et une cible abrégée (nom de
// fichier, site, début de commande aux secrets masqués), jamais le contenu.

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import type { ApprovalLogEntry, ApprovalLogOutcome, ApprovalRequest } from '../../shared/types'
import { emit } from '../bus'
import { readJson, writeJson } from '../store/jsonFile'

export const APPROVAL_LOG_MAX = 500
export const APPROVAL_LOG_DAYS = 90

const file = (): string => join(app.getPath('userData'), 'approvals-log.json')

/** Garde les 500 dernières entrées, de moins de 90 jours. */
export function pruneApprovalLog(list: ApprovalLogEntry[], now = Date.now()): ApprovalLogEntry[] {
  const since = now - APPROVAL_LOG_DAYS * 86_400_000
  return list.filter((e) => e.at >= since).slice(0, APPROVAL_LOG_MAX)
}

export function listApprovalLog(): ApprovalLogEntry[] {
  const list = readJson<ApprovalLogEntry[]>(file(), [])
  return Array.isArray(list) ? pruneApprovalLog(list) : []
}

function add(entry: Omit<ApprovalLogEntry, 'id' | 'at'>): void {
  const next = pruneApprovalLog([{ id: randomUUID(), at: Date.now(), ...entry }, ...listApprovalLog()])
  writeJson(file(), next)
  emit(IPC.approvalLogChanged, next)
}

/** Réponse à une carte (ou délai dépassé, annulation). */
export function recordApproval(request: ApprovalRequest, outcome: ApprovalLogOutcome): void {
  add({
    source: request.source,
    title: request.title.slice(0, 160),
    tool: request.toolName,
    target: request.target?.slice(0, 120),
    session: request.sessionLabel?.slice(0, 80),
    destination: request.destination,
    outcome,
    rule: outcome === 'always' ? request.alwaysRule?.slice(0, 300) : undefined
  })
}

/** Refus sans carte : une routine a voulu utiliser un outil qu'elle n'a pas le droit d'utiliser. */
export function recordRoutineDenial(title: string, tool: string, routine?: string, target?: string): void {
  add({
    source: 'routine',
    title: title.slice(0, 160),
    tool,
    target: target?.slice(0, 120),
    session: routine?.slice(0, 80),
    outcome: 'auto-deny'
  })
}

export function clearApprovalLog(): ApprovalLogEntry[] {
  writeJson(file(), [])
  emit(IPC.approvalLogChanged, [])
  return []
}
