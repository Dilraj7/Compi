// État des sessions Claude Code, reconstruit à partir des événements de hooks.

import { basename } from 'node:path'
import { IPC } from '../../shared/ipc'
import type { ClaudeSession, FileEdit } from '../../shared/types'
import { activityLabel } from '../agent/labels'
import { emit } from '../bus'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HookBody = Record<string, any>

const STALE_MS = 6 * 60 * 60 * 1000
const ENDED_LINGER_MS = 60 * 1000

/** Compte les lignes ajoutées / supprimées d'une modification de fichier. */
export function countEdit(toolName: string, input: HookBody = {}, response: HookBody = {}): Omit<FileEdit, 'file'> | null {
  const patch = response?.structuredPatch
  if (Array.isArray(patch)) {
    let added = 0
    let removed = 0
    for (const hunk of patch) {
      for (const line of hunk?.lines ?? []) {
        if (typeof line !== 'string') continue
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }
    return { added, removed }
  }

  const lines = (s: unknown): string[] => (typeof s === 'string' && s.length ? s.split(/\r?\n/) : [])
  const diff = (oldS: unknown, newS: unknown): { added: number; removed: number } => {
    const a = lines(oldS)
    const b = lines(newS)
    const pool = new Map<string, number>()
    for (const l of a) pool.set(l, (pool.get(l) ?? 0) + 1)
    let common = 0
    for (const l of b) {
      const n = pool.get(l) ?? 0
      if (n > 0) {
        common++
        pool.set(l, n - 1)
      }
    }
    return { added: b.length - common, removed: a.length - common }
  }

  switch (toolName) {
    case 'Edit':
      return diff(input.old_string, input.new_string)
    case 'MultiEdit': {
      const edits: HookBody[] = Array.isArray(input.edits) ? input.edits : []
      return edits.reduce<{ added: number; removed: number }>(
        (acc, e) => {
          const d = diff(e.old_string, e.new_string)
          return { added: acc.added + d.added, removed: acc.removed + d.removed }
        },
        { added: 0, removed: 0 }
      )
    }
    case 'Write':
      return { added: lines(input.content).length, removed: 0 }
    default:
      return null
  }
}

type Listener = (event: 'done', session: ClaudeSession) => void

class SessionTracker {
  private sessions = new Map<string, ClaudeSession>()
  private listeners = new Set<Listener>()

  list(): ClaudeSession[] {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  label(body: HookBody): string {
    const s = this.sessions.get(String(body.session_id))
    return s?.project ?? (body.cwd ? basename(String(body.cwd)) : 'Claude Code')
  }

  on(l: Listener): () => void {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  handle(event: string, body: HookBody): void {
    const id = String(body.session_id ?? '')
    if (!id) return
    const now = Date.now()
    let s = this.sessions.get(id)
    if (!s) {
      const cwd = String(body.cwd ?? '')
      s = { id, cwd, project: cwd ? basename(cwd) : 'Claude Code', status: 'idle', edits: [], startedAt: now, updatedAt: now }
      this.sessions.set(id, s)
    }
    s.updatedAt = now

    switch (event) {
      case 'SessionStart':
        s.status = 'idle'
        break
      case 'UserPromptSubmit':
        s.status = 'working'
        s.lastPrompt = String(body.prompt ?? '').slice(0, 240)
        s.lastMessage = undefined
        break
      case 'PreToolUse':
        s.status = 'working'
        s.currentTool = activityLabel(String(body.tool_name), body.tool_input)
        break
      case 'PermissionRequest':
        s.status = 'waiting'
        break
      case 'PermissionResolved':
        s.status = 'working'
        break
      case 'PostToolUse': {
        s.currentTool = undefined
        const file = body.tool_input?.file_path ?? body.tool_input?.notebook_path
        const counts = countEdit(String(body.tool_name), body.tool_input, body.tool_response)
        if (file && counts) {
          const existing = s.edits.find((e) => e.file === file)
          if (existing) {
            existing.added += counts.added
            existing.removed += counts.removed
          } else {
            s.edits.unshift({ file: String(file), ...counts })
          }
        }
        break
      }
      case 'Notification':
        if (body.notification_type === 'permission_prompt') s.status = 'waiting'
        else if (body.notification_type === 'idle_prompt') s.status = 'idle'
        if (body.message) s.lastMessage = String(body.message).slice(0, 240)
        break
      case 'Stop':
        s.status = 'done'
        s.currentTool = undefined
        if (body.last_assistant_message) s.lastMessage = String(body.last_assistant_message).slice(0, 400)
        for (const l of this.listeners) l('done', s)
        break
      case 'SessionEnd':
        s.status = 'ended'
        setTimeout(() => {
          if (this.sessions.get(id)?.status === 'ended') {
            this.sessions.delete(id)
            this.broadcast()
          }
        }, ENDED_LINGER_MS)
        break
    }

    for (const [key, other] of this.sessions) if (now - other.updatedAt > STALE_MS) this.sessions.delete(key)
    this.broadcast()
  }

  clear(): void {
    this.sessions.clear()
    this.broadcast()
  }

  broadcast(): void {
    emit(IPC.sessions, this.list())
  }
}

export const sessions = new SessionTracker()
