import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { MessageCircle, Plus, Trash2 } from 'lucide-react'
import { brainLabel } from '@shared/brains'
import type { ConversationMeta } from '@shared/types'
import { useCompi } from '../store'
import { BrainIcon } from '../components/BrainPicker'
import { Button, timeAgo } from '../components/ui'

export function HistoryView() {
  const [items, setItems] = useState<ConversationMeta[] | null>(null)
  const current = useCompi((s) => s.conversationId)
  const load = useCompi((s) => s.loadConversation)
  const newConversation = useCompi((s) => s.newConversation)
  const settings = useCompi((s) => s.settings)

  useEffect(() => {
    void window.compi.listConversations().then(setItems)
  }, [])

  const remove = async (id: string): Promise<void> => {
    await window.compi.deleteConversation(id)
    setItems((list) => list?.filter((c) => c.id !== id) ?? null)
    if (id === current) newConversation()
  }

  return (
    <div className="flex flex-1 flex-col px-5 pt-1 pb-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="led-text px-0.5 text-[11px] text-fog-500">Discussions récentes</h3>
        <Button size="sm" variant="subtle" onClick={newConversation}>
          <Plus size={13} /> Nouvelle
        </Button>
      </div>
      <div className="scroll-y -mx-1 flex-1 space-y-1 px-1">
        {items?.length === 0 && <div className="py-10 text-center text-[12.5px] text-fog-500">Pas encore de discussion. Dis-moi bonjour !</div>}
        {items?.map((c, i) => (
          <motion.div
            key={c.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0, transition: { delay: i * 0.02 } }}
            className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${c.id === current ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}
          >
            <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void load(c.id)}>
              <MessageCircle size={14} className="shrink-0 text-fog-700" />
              <span className="truncate text-[13px] text-fog-100">{c.title}</span>
              {c.brain && c.brain.provider !== 'anthropic' && (
                <span className="inline-flex max-w-[140px] shrink-0 items-center gap-1 rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[10.5px] text-fog-500">
                  <BrainIcon provider={c.brain.provider} size={9} />
                  <span className="truncate">{brainLabel(c.brain, settings ?? undefined)}</span>
                </span>
              )}
            </button>
            <span className="shrink-0 text-[11px] text-fog-700">{timeAgo(c.updatedAt)}</span>
            <button
              onClick={() => void remove(c.id)}
              className="grid size-6.5 shrink-0 place-items-center rounded-lg text-fog-700 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-led-red/10 hover:text-led-red"
              aria-label="Supprimer"
            >
              <Trash2 size={13} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
