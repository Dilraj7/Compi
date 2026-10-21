import { TerminalSquare } from 'lucide-react'
import { useCompi } from '../store'
import { PendingRequests, SessionCard } from '../components/Cards'
import { Button } from '../components/ui'
import { JournalSection } from './JournalSection'
import { PerfSection } from './PerfSection'
import { UsageSection } from './UsageSection'

export function ActivityView() {
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  const sessions = useCompi((s) => s.sessions)
  const connected = useCompi((s) => s.settings?.claudeCode.connected)
  const setView = useCompi((s) => s.setView)

  return (
    <div className="scroll-y flex-1 space-y-5 px-5 pt-1 pb-5">
      {pending > 0 && (
        <section className="space-y-2.5">
          <h3 className="led-text px-0.5 text-[11px] text-led-amber">En attente de toi · {pending}</h3>
          <PendingRequests />
        </section>
      )}

      <PerfSection />

      <section className="space-y-2.5">
        <h3 className="led-text px-0.5 text-[11px] text-fog-500">Claude Code</h3>
        {!connected ? (
          <div className="flex items-center gap-3.5 rounded-2xl bg-ink-850/80 p-4 ring-1 ring-inset ring-white/[0.06]">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#F59E7B]/12 text-[#F59E7B]">
              <TerminalSquare size={18} />
            </span>
            <div className="flex-1">
              <div className="text-[13px] font-medium text-fog-100">Suis tes sessions Claude Code ici</div>
              <div className="mt-0.5 text-[12px] text-fog-500">
                Statut en direct, fichiers modifiés, et validation des permissions sans quitter ce que tu fais.
              </div>
            </div>
            <Button size="sm" variant="subtle" onClick={() => setView('settings')}>
              Connecter
            </Button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-[12.5px] text-fog-500">
            Aucune session pour l’instant. Lance <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] text-fog-300">claude</code> dans
            un terminal : elle apparaîtra ici.
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <SessionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      <UsageSection />

      <JournalSection />
    </div>
  )
}
