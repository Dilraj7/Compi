// Serveur HTTP local qui reçoit les hooks de Claude Code.
// - Écoute uniquement sur 127.0.0.1, avec un jeton secret dans l'URL.
// - Refuse toute requête portant un en-tête Origin (une page web ne peut pas s'en servir).
// - Les événements de statut reçoivent `{}` immédiatement ; une demande de
//   permission reste en attente du clic, puis renvoie la décision. Sans
//   réponse dans le délai, on renvoie `{}` : Claude Code affiche alors sa
//   demande habituelle. Si Compi est fermé, la connexion échoue et Claude
//   Code continue normalement : il n'est jamais bloqué.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { QuestionItem } from '../../shared/types'
import { approvalTitle, auditTarget } from '../agent/labels'
import { approvals } from '../approvals'
import { sendIslandCommand } from '../notchWindow'
import { sessions, type HookBody } from './sessions'
import { HOOK_PATH_PREFIX } from './installHooks'
import { describeSuggestions } from './rules'

const MAX_BODY = 4 * 1024 * 1024

export interface HookServerConfig {
  port: number
  token: string
  permissionTimeoutSec: number
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('payload too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function send(res: ServerResponse, status: number, body: unknown = {}): void {
  if (res.writableEnded) return
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

/** Signal annulé si Claude Code coupe la connexion (l'utilisateur a répondu dans le terminal). */
function disconnectSignal(res: ServerResponse): AbortSignal {
  const ac = new AbortController()
  res.on('close', () => {
    if (!res.writableFinished) ac.abort()
  })
  return ac.signal
}

async function handlePermission(body: HookBody, res: ServerResponse, cfg: HookServerConfig): Promise<void> {
  const toolName = String(body.tool_name ?? 'outil')
  const input = (body.tool_input ?? {}) as Record<string, unknown>
  const { title, detail } = approvalTitle(toolName, input)
  const suggestions = Array.isArray(body.permission_suggestions) ? body.permission_suggestions : []

  sessions.handle('PermissionRequest', body)
  sendIslandCommand('attention')

  const outcome = await approvals.request(
    {
      source: 'claude-code',
      title: title.replace(/^Compi/, 'Claude'),
      detail,
      toolName,
      sessionLabel: sessions.label(body),
      canAlwaysAllow: suggestions.length > 0,
      target: auditTarget(toolName, input),
      alwaysRule: describeSuggestions(suggestions)
    },
    { timeoutMs: cfg.permissionTimeoutSec * 1000, signal: disconnectSignal(res) }
  )

  sessions.handle('PermissionResolved', body)
  const decide = (decision: Record<string, unknown>): void =>
    send(res, 200, { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } })

  switch (outcome) {
    case 'allow':
      return decide({ behavior: 'allow' })
    case 'always':
      return decide({ behavior: 'allow', updatedPermissions: suggestions })
    case 'deny':
      return decide({ behavior: 'deny', message: "Refusé par l'utilisateur depuis Compi." })
    default:
      return send(res, 200, {}) // délai dépassé / annulé : Claude Code reprend la main
  }
}

async function handleQuestion(body: HookBody, res: ServerResponse, cfg: HookServerConfig): Promise<void> {
  const input = (body.tool_input ?? {}) as { questions?: QuestionItem[] }
  const questions = Array.isArray(input.questions) ? input.questions : []
  if (!questions.length) return send(res, 200, {})

  sessions.handle('PermissionRequest', body)
  sendIslandCommand('attention')
  const answers = await approvals.ask(sessions.label(body), questions, {
    timeoutMs: cfg.permissionTimeoutSec * 1000,
    signal: disconnectSignal(res)
  })
  sessions.handle('PermissionResolved', body)

  if (answers && typeof answers === 'object') {
    send(res, 200, {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { ...input, answers }
      }
    })
  } else {
    send(res, 200, {}) // « répondre dans le terminal », délai ou annulation
  }
}

let server: Server | null = null

export function startHookServer(cfg: HookServerConfig): Promise<void> {
  stopHookServer()
  const prefix = `${HOOK_PATH_PREFIX}${cfg.token}/`

  server = createServer(async (req, res) => {
    try {
      if (req.method !== 'POST') return send(res, 404, { error: 'not found' })
      if (req.headers.origin) return send(res, 403, { error: 'forbidden' })
      const path = (req.url ?? '').split('?')[0]
      if (!path.startsWith(HOOK_PATH_PREFIX)) return send(res, 404, { error: 'not found' })
      const token = path.slice(HOOK_PATH_PREFIX.length).split('/')[0] ?? ''
      if (!safeEqual(token, cfg.token)) return send(res, 403, { error: 'forbidden' })
      const event = path.slice(prefix.length)

      const body = JSON.parse((await readBody(req)) || '{}') as HookBody

      if (event === 'PermissionRequest') return await handlePermission(body, res, cfg)
      if (event === 'PreToolUse' && body.tool_name === 'AskUserQuestion') {
        sessions.handle('PreToolUse', body)
        return await handleQuestion(body, res, cfg)
      }
      sessions.handle(event, body)
      send(res, 200, {})
    } catch {
      send(res, 400, { error: 'bad request' })
    }
  })

  return new Promise((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(cfg.port, '127.0.0.1', () => {
      server!.off('error', reject)
      resolve()
    })
  })
}

export function stopHookServer(): void {
  server?.close()
  server?.closeAllConnections()
  server = null
}

export function isHookServerRunning(): boolean {
  return server?.listening ?? false
}
