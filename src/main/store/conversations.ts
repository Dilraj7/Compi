import { join } from 'node:path'
import { app } from 'electron'
import type { Brain, ChatMessage, Conversation, ConversationMeta } from '../../shared/types'
import { log } from '../log'
import { readJson, writeJson } from './jsonFile'

const MAX_CONVERSATIONS = 60

class ConversationStore {
  private path = ''
  private items: Conversation[] = []
  private saveTimer: NodeJS.Timeout | null = null

  load(): void {
    this.path = join(app.getPath('userData'), 'conversations.json')
    this.items = readJson<Conversation[]>(this.path, [])
  }

  list(): ConversationMeta[] {
    return this.items
      .map(({ id, title, updatedAt, brain }) => ({ id, title, updatedAt, brain }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Conversation | undefined {
    return this.items.find((c) => c.id === id)
  }

  create(id: string, firstText: string, brain?: Brain): Conversation {
    const title = firstText.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Nouvelle discussion'
    const conv: Conversation = { id, title, updatedAt: Date.now(), messages: [], brain }
    this.items.unshift(conv)
    if (this.items.length > MAX_CONVERSATIONS) this.items.length = MAX_CONVERSATIONS
    this.scheduleSave()
    return conv
  }

  push(id: string, message: ChatMessage): void {
    const conv = this.get(id)
    if (!conv) return
    conv.messages.push(message)
    conv.updatedAt = Date.now()
    this.scheduleSave()
  }

  patchMessage(id: string, messageId: string, patch: (m: ChatMessage) => void): void {
    const msg = this.get(id)?.messages.find((m) => m.id === messageId)
    if (!msg) return
    patch(msg)
    this.scheduleSave()
  }

  setSession(id: string, sessionId: string): void {
    const conv = this.get(id)
    if (conv && conv.sessionId !== sessionId) {
      conv.sessionId = sessionId
      this.scheduleSave()
    }
  }

  /** Un e-mail ou une invitation a été lu dans cette discussion (consignes piégées possibles). */
  markExternal(id: string): void {
    const conv = this.get(id)
    if (!conv || conv.external) return
    conv.external = true
    this.scheduleSave()
  }

  /** Change de modèle chez le même fournisseur : la discussion continue. */
  setBrain(id: string, brain: Brain): void {
    const conv = this.get(id)
    if (!conv) return
    conv.brain = brain
    this.scheduleSave()
  }

  delete(id: string): void {
    this.items = this.items.filter((c) => c.id !== id)
    this.scheduleSave()
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      writeJson(this.path, this.items)
    } catch (e) {
      log('error', 'historique non enregistré', e)
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => this.flush(), 400)
  }
}

export const conversations = new ConversationStore()
