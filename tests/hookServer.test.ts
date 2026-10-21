import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Le serveur importe des modules qui touchent à Electron : on les simule.
const userData = mkdtempSync(join(tmpdir(), 'compi-hooks-'))
vi.mock('electron', () => ({
  BrowserWindow: class {},
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  screen: { on: vi.fn() },
  shell: {},
  app: { getPath: () => userData }
}))

const { startHookServer, stopHookServer } = await import('../src/main/bridge/hookServer')
const { approvals } = await import('../src/main/approvals')
const { sessions } = await import('../src/main/bridge/sessions')
const { listApprovalLog } = await import('../src/main/privacy/approvalLog')
const { describeSuggestions } = await import('../src/main/bridge/rules')

const PORT = 47911
const TOKEN = 'secret-de-test'
const base = `http://127.0.0.1:${PORT}/compi/${TOKEN}`

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

/** Attend la prochaine demande en attente dans la file. */
function nextPending<T>(get: () => T[]): Promise<T> {
  return new Promise((resolve) => {
    const check = (): void => {
      const list = get()
      if (list.length) {
        off()
        resolve(list[0])
      }
    }
    const off = approvals.onChange(check)
    check()
  })
}

beforeAll(async () => {
  await startHookServer({ port: PORT, token: TOKEN, permissionTimeoutSec: 0.4 })
})
afterAll(() => {
  stopHookServer()
  rmSync(userData, { recursive: true, force: true })
})

describe('serveur de hooks Claude Code', () => {
  it('refuse un mauvais jeton', async () => {
    const res = await post(`http://127.0.0.1:${PORT}/compi/mauvais/Stop`, { session_id: 's' })
    expect(res.status).toBe(403)
  })

  it('refuse les requêtes venant d’une page web (en-tête Origin)', async () => {
    const res = await post(`${base}/Stop`, { session_id: 's' }, { Origin: 'https://exemple.com' })
    expect(res.status).toBe(403)
  })

  it('refuse les autres méthodes', async () => {
    expect((await fetch(`${base}/Stop`)).status).toBe(404)
  })

  it('répond {} immédiatement aux événements de statut et suit la session', async () => {
    const res = await post(`${base}/UserPromptSubmit`, { session_id: 'abc', cwd: 'D:\\Projets\\demo', prompt: 'Ajoute des tests' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({})
    const s = sessions.list().find((x) => x.id === 'abc')
    expect(s).toMatchObject({ project: 'demo', status: 'working', lastPrompt: 'Ajoute des tests' })
  })

  it('compte les lignes modifiées après un Edit', async () => {
    await post(`${base}/PostToolUse`, {
      session_id: 'abc',
      tool_name: 'Edit',
      tool_input: { file_path: 'D:\\Projets\\demo\\a.ts', old_string: 'a\nb', new_string: 'a\nc\nd' },
      tool_response: {}
    })
    const s = sessions.list().find((x) => x.id === 'abc')
    expect(s?.edits[0]).toEqual({ file: 'D:\\Projets\\demo\\a.ts', added: 2, removed: 1 })
  })

  it('renvoie la décision « autoriser » choisie dans l’îlot', async () => {
    const pending = post(`${base}/PermissionRequest`, { session_id: 'abc', cwd: 'D:\\Projets\\demo', tool_name: 'Bash', tool_input: { command: 'npm test' } })
    const req = await nextPending(() => approvals.pendingApprovals())
    expect(req).toMatchObject({ source: 'claude-code', toolName: 'Bash', detail: 'npm test', sessionLabel: 'demo' })
    approvals.decide(req.id, 'allow')
    expect(await (await pending).json()).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }
    })
  })

  it('renvoie un refus avec message', async () => {
    const pending = post(`${base}/PermissionRequest`, { session_id: 'abc', tool_name: 'Bash', tool_input: { command: 'rm -rf /' } })
    const req = await nextPending(() => approvals.pendingApprovals())
    approvals.decide(req.id, 'deny')
    const body = (await (await pending).json()) as { hookSpecificOutput: { decision: Record<string, unknown> } }
    expect(body.hookSpecificOutput.decision.behavior).toBe('deny')
    expect(body.hookSpecificOutput.decision.message).toMatch(/Compi/)
  })

  it('« Toujours » renvoie les règles suggérées par Claude Code', async () => {
    const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }]
    const pending = post(`${base}/PermissionRequest`, { session_id: 'abc', tool_name: 'Bash', tool_input: { command: 'npm test' }, permission_suggestions: suggestions })
    const req = await nextPending(() => approvals.pendingApprovals())
    expect(req.canAlwaysAllow).toBe(true)
    approvals.decide(req.id, 'always')
    const body = (await (await pending).json()) as { hookSpecificOutput: { decision: Record<string, unknown> } }
    expect(body.hookSpecificOutput.decision).toEqual({ behavior: 'allow', updatedPermissions: suggestions })
    // Le journal dit en clair ce que Claude Code va enregistrer.
    expect(listApprovalLog()[0]).toMatchObject({ source: 'claude-code', tool: 'Bash', target: 'npm test', outcome: 'always' })
    expect(listApprovalLog()[0].rule).toMatch(/^Autoriser Bash/)
  })

  it('sans réponse dans le délai, rend la main à Claude Code ({})', async () => {
    const res = await post(`${base}/PermissionRequest`, { session_id: 'abc', tool_name: 'Bash', tool_input: { command: 'ls' } })
    expect(await res.json()).toEqual({})
    expect(approvals.pendingApprovals()).toHaveLength(0)
    expect(listApprovalLog()[0]).toMatchObject({ tool: 'Bash', target: 'ls', outcome: 'timeout' })
  })

  it('décrit en clair les règles « Toujours » proposées par Claude Code', () => {
    expect(
      describeSuggestions([{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' }])
    ).toBe('Autoriser Bash(npm test:*) dans ce projet, sur ce PC')
    expect(describeSuggestions([{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }])).toBe(
      'Accepter les modifications de fichiers sans demander pour cette session'
    )
    expect(describeSuggestions([{ type: 'addDirectories', directories: ['D:/Docs'], destination: 'userSettings' }])).toBe('Donner accès à D:/Docs dans tous tes projets')
    expect(describeSuggestions([])).toBeUndefined()
    expect(describeSuggestions('n’importe quoi')).toBeUndefined()
  })

  it('répond aux questions AskUserQuestion via updatedInput.answers', async () => {
    const questions = [{ question: 'Quel framework ?', header: 'Framework', multiSelect: false, options: [{ label: 'React' }, { label: 'Vue' }] }]
    const pending = post(`${base}/PreToolUse`, { session_id: 'abc', tool_name: 'AskUserQuestion', tool_input: { questions } })
    const q = await nextPending(() => approvals.pendingQuestions())
    approvals.answer({ id: q.id, answers: { 'Quel framework ?': 'React' } })
    expect(await (await pending).json()).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        updatedInput: { questions, answers: { 'Quel framework ?': 'React' } }
      }
    })
  })

  it('« Répondre dans le terminal » laisse Claude Code poser la question', async () => {
    const pending = post(`${base}/PreToolUse`, {
      session_id: 'abc',
      tool_name: 'AskUserQuestion',
      tool_input: { questions: [{ question: 'Q ?', header: 'Q', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] }
    })
    const q = await nextPending(() => approvals.pendingQuestions())
    approvals.answer({ id: q.id, answers: null })
    expect(await (await pending).json()).toEqual({})
  })
})
