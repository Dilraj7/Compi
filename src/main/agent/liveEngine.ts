// Moteur gardé ouvert pour une discussion avec le cerveau local : un claude.exe en mode
// flux (prompt AsyncIterable de l'Agent SDK), un tour par message. Avant, chaque message
// relançait claude.exe et ses connecteurs : plusieurs secondes avant même la première
// requête au modèle. Un moteur se ferme après quelques minutes sans message, quand un
// autre démarre (s'il est au repos), à l'arrêt d'une réponse, en cas d'erreur, ou quand
// un réglage qui le définit change (empreinte) : le message suivant repart alors comme
// avant, en reprenant la session. Sans Electron : testé dans tests/liveEngine.test.ts.

import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

/** Sans message pendant ce temps, le moteur se ferme (~250 Mo de mémoire rendus). */
export const LIVE_IDLE_MS = 5 * 60_000

/** File des messages de l'utilisateur, lue par le moteur au fil de la discussion. */
export class Inbox implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private ended = false

  push(text: string): void {
    const msg: SDKUserMessage = { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null }
    const w = this.waiting
    this.waiting = null
    if (w) w({ value: msg, done: false })
    else this.queue.push(msg)
  }

  end(): void {
    this.ended = true
    const w = this.waiting
    this.waiting = null
    w?.({ value: undefined, done: true })
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const msg = this.queue.shift()
        if (msg) return Promise.resolve({ value: msg, done: false })
        if (this.ended) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      }
    }
  }
}

export interface LiveEngineInit<T> {
  conversationId: string
  /** Empreinte de tout ce qui définit le moteur (modèle, consignes, outils, connecteurs…). */
  fingerprint: string
  /** Dossiers lisibles par le moteur : une pièce jointe hors de ceux-ci demande un nouveau moteur. */
  dirs: string[]
  /** Ce que l'appelant garde avec le moteur (passerelle, contextes des outils). */
  extra: T
  start: (input: AsyncIterable<SDKUserMessage>) => Query
  /** Appelé une fois, à la fermeture. */
  onClose?: () => void
  idleMs?: number
}

interface Turn {
  handle: (msg: SDKMessage) => void
  resolve: () => void
  reject: (e: Error) => void
}

export class LiveEngine<T = unknown> {
  readonly conversationId: string
  readonly fingerprint: string
  readonly dirs: string[]
  readonly extra: T
  /** Pour les requêtes de contrôle (état des connecteurs…). */
  readonly control: Query
  private readonly inbox = new Inbox()
  private turn: Turn | null = null
  private closed = false
  private idle: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly init: LiveEngineInit<T>) {
    this.conversationId = init.conversationId
    this.fingerprint = init.fingerprint
    this.dirs = init.dirs
    this.extra = init.extra
    this.control = init.start(this.inbox)
    void this.pump()
  }

  get alive(): boolean {
    return !this.closed
  }

  get busy(): boolean {
    return this.turn !== null
  }

  /** Envoie un message ; se résout au résultat du tour (message `result`), rejette si le moteur s'arrête avant. */
  send(text: string, handle: (msg: SDKMessage) => void): Promise<void> {
    if (this.closed) return Promise.reject(new Error('moteur fermé'))
    if (this.turn) return Promise.reject(new Error('moteur occupé'))
    clearTimeout(this.idle)
    return new Promise((resolve, reject) => {
      this.turn = { handle, resolve, reject }
      this.inbox.push(text)
    })
  }

  close(reason: Error = new Error('moteur fermé')): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.idle)
    const turn = this.turn
    this.turn = null
    this.inbox.end()
    try {
      this.control.close()
    } catch {
      // déjà arrêté
    }
    if (engines.get(this.conversationId) === this) engines.delete(this.conversationId)
    this.init.onClose?.()
    turn?.reject(reason)
  }

  private async pump(): Promise<void> {
    let failure: Error | null = null
    try {
      for await (const msg of this.control) {
        const turn = this.turn
        if (!turn) continue
        // Une erreur dans le traitement d'un message arrête le moteur, comme une réponse classique.
        turn.handle(msg)
        if (msg.type === 'result' && this.turn === turn) {
          this.turn = null
          this.idle = setTimeout(() => this.close(), this.init.idleMs ?? LIVE_IDLE_MS)
          this.idle.unref?.()
          turn.resolve()
        }
      }
    } catch (e) {
      failure = e instanceof Error ? e : new Error(String(e))
    }
    this.close(failure ?? new Error('moteur arrêté'))
  }
}

const engines = new Map<string, LiveEngine<unknown>>()

/**
 * Moteur réutilisable pour ce message : même discussion, même empreinte, au repos, et
 * les dossiers des pièces jointes déjà lisibles. Un moteur qui ne convient plus est fermé.
 */
export function reusableEngine<T>(conversationId: string, fingerprint: string, dirs: string[]): LiveEngine<T> | undefined {
  const e = engines.get(conversationId) as LiveEngine<T> | undefined
  if (!e) return undefined
  if (e.alive && !e.busy && e.fingerprint === fingerprint && dirs.every((d) => e.dirs.includes(d))) return e
  e.close()
  return undefined
}

/** Garde le moteur d'une discussion ; ceux des autres discussions, s'ils sont au repos, sont fermés. */
export function registerEngine<T>(engine: LiveEngine<T>): void {
  for (const other of [...engines.values()]) if (other !== engine && !other.busy) other.close()
  engines.get(engine.conversationId)?.close()
  engines.set(engine.conversationId, engine as LiveEngine<unknown>)
}

export function closeEngine(conversationId: string): void {
  engines.get(conversationId)?.close()
}

export function closeAllEngines(): void {
  for (const e of [...engines.values()]) e.close()
}

/** Moteurs ouverts (tests, journal). */
export const openEngines = (): number => engines.size
