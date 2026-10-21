// « Journal » (Activité) : les autorisations données ou refusées, et ce qui est
// parti vers un cerveau en ligne. Les deux restent sur le PC, sans contenu.

import { useEffect, useMemo, useState } from 'react'
import { Ban, Check, CloudUpload, Hourglass, Infinity as InfinityIcon, ShieldAlert, X } from 'lucide-react'
import { CATEGORY_SENT_LABEL } from '@shared/privacy'
import type { ApprovalLogEntry, ApprovalLogOutcome, SentLogEntry } from '@shared/types'
import { useCompi } from '../store'
import { Segmented, timeAgo } from '../components/ui'
import { ConfirmButton } from './MemoryView'

const OUTCOMES: Record<ApprovalLogOutcome, { label: string; color: string; Icon: typeof Check }> = {
  allow: { label: 'Autorisé', color: '#4ADE80', Icon: Check },
  always: { label: 'Toujours', color: '#A78BFA', Icon: InfinityIcon },
  deny: { label: 'Refusé', color: '#F87171', Icon: X },
  timeout: { label: 'Sans réponse', color: '#868695', Icon: Hourglass },
  cancelled: { label: 'Annulé', color: '#575766', Icon: Ban },
  'auto-deny': {
    label: 'Refusé (routine)',
    color: '#FBBF24',
    Icon: ShieldAlert
  }
}

const SOURCES: Record<ApprovalLogEntry['source'], string> = {
  compi: 'Compi',
  'claude-code': 'Claude Code',
  routine: 'Routine'
}

type Filter = 'all' | 'compi' | 'claude-code' | 'routine' | 'denied'
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'Tout' },
  { value: 'compi', label: 'Compi' },
  { value: 'claude-code', label: 'Claude Code' },
  { value: 'routine', label: 'Routines' },
  { value: 'denied', label: 'Refusées' }
]

function match(e: ApprovalLogEntry, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'denied') return e.outcome === 'deny' || e.outcome === 'auto-deny'
  return e.source === f
}

function ApprovalRow({ e }: { e: ApprovalLogEntry }) {
  const o = OUTCOMES[e.outcome]
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-2.5">
      <span
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-md"
        style={{
          background: `color-mix(in oklab, ${o.color} 14%, transparent)`,
          color: o.color
        }}
      >
        <o.Icon size={11} strokeWidth={2.4} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-fog-100">{e.title}</div>
        {e.target && <div className="mt-0.5 truncate font-mono text-[10.5px] text-fog-500">{e.target}</div>}
        <div className="mt-0.5 text-[10.5px] text-fog-700">
          <span style={{ color: o.color }}>{o.label}</span> · {SOURCES[e.source]}
          {e.session ? ` · ${e.session}` : ''}
          {e.destination ? ` · vers ${e.destination}` : ''}
        </div>
        {e.rule && <div className="mt-1 text-[10.5px] leading-snug text-led-violet/80">Règle enregistrée : {e.rule}</div>}
      </div>
      <span className="shrink-0 text-[10.5px] text-fog-700">{timeAgo(e.at)}</span>
    </div>
  )
}

function ApprovalsLog() {
  const [log, setLog] = useState<ApprovalLogEntry[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [limit, setLimit] = useState(20)
  useEffect(() => {
    void window.compi.approvalLog().then(setLog)
    return window.compi.onApprovalLog(setLog)
  }, [])
  const shown = useMemo(() => log.filter((e) => match(e, filter)), [log, filter])

  if (!log.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-5 text-center text-[12px] leading-relaxed text-fog-500">
        Rien pour l’instant. Chaque réponse que tu donnes à une carte d’autorisation (Compi ou Claude Code) apparaîtra ici.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => {
              setFilter(f.value)
              setLimit(20)
            }}
            className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors ${filter === f.value ? 'bg-white/[0.09] text-fog-100' : 'text-fog-500 hover:text-fog-300'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
        {shown.slice(0, limit).map((e) => (
          <ApprovalRow key={e.id} e={e} />
        ))}
        {!shown.length && <div className="px-3.5 py-3 text-[12px] text-fog-500">Rien dans ce filtre.</div>}
        {shown.length > limit && (
          <button className="w-full px-3.5 py-2 text-center text-[11.5px] text-fog-500 hover:text-fog-300" onClick={() => setLimit((l) => l + 30)}>
            Voir plus ({shown.length - limit})
          </button>
        )}
      </div>
      <div className="flex items-center justify-between px-0.5">
        <span className="text-[10.5px] text-fog-700">Gardé sur ce PC : 500 entrées et 90 jours au plus, sans contenu.</span>
        <ConfirmButton label="Effacer le journal" confirm="Sûr ? Tout effacer" onConfirm={() => void window.compi.clearApprovalLog().then(setLog)} />
      </div>
    </div>
  )
}

/** Ce qui est parti vers un cerveau en ligne, et vers qui (jamais le contenu). */
function SentLog() {
  const [log, setLog] = useState<SentLogEntry[]>([])
  useEffect(() => {
    void window.compi.sentLog().then(setLog)
    return window.compi.onSentLog(setLog)
  }, [])
  if (!log.length) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-5 text-center text-[12px] text-fog-500">
        Rien n’est parti vers un cerveau en ligne pour l’instant.
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="divide-y divide-white/[0.05] rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
        {log.slice(0, 20).map((e, i) => (
          <div key={`${e.at}-${i}`} className="flex items-start gap-2.5 px-3.5 py-2.5">
            <CloudUpload size={13} className="mt-0.5 shrink-0 text-fog-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] text-fog-300">{e.conversation || 'Discussion'}</div>
              <div className="text-[11px] text-fog-500">
                {e.destination} · ta question
                {e.categories.map((c) => ` · ${CATEGORY_SENT_LABEL[c]}`).join('')}
                {e.masked ? ` · ${e.masked} secret${e.masked > 1 ? 's' : ''} masqué${e.masked > 1 ? 's' : ''}` : ''}
              </div>
            </div>
            <span className="shrink-0 text-[10.5px] text-fog-700">{timeAgo(e.at)}</span>
          </div>
        ))}
      </div>
      <div className="flex justify-end px-0.5">
        <ConfirmButton
          label="Effacer le journal"
          confirm="Sûr ? Tout effacer"
          onConfirm={() =>
            void window.compi.clearSentLog().then(() => {
              setLog([])
            })
          }
        />
      </div>
    </div>
  )
}

/** Règles « Toujours » de Compi : un lien vers Réglages › Confidentialité pour les retirer. */
function AlwaysRules() {
  const s = useCompi((st) => st.settings)
  const setView = useCompi((st) => st.setView)
  const focusSettings = useCompi((st) => st.focusSettings)
  if (!s) return null
  const categories = Object.values(s.privacy).filter((v) => v === 'always').length
  const n = s.alwaysAllow.length + categories
  return (
    <button
      className="flex w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left ring-1 ring-inset ring-white/[0.06] transition-colors hover:bg-white/[0.03]"
      onClick={() => {
        focusSettings('privacy')
        setView('settings')
      }}
    >
      <span className="text-[12px] text-fog-300">
        {n ? `${n} règle${n > 1 ? 's' : ''} « Toujours » chez Compi` : 'Aucune règle « Toujours » chez Compi'}
        <span className="block text-[10.5px] text-fog-700">Celles de Claude Code se gèrent dans Claude Code, avec /permissions.</span>
      </span>
      <span className="text-[11.5px] text-fog-500">Gérer ›</span>
    </button>
  )
}

type Tab = 'approvals' | 'sent'

export function JournalSection() {
  const [tab, setTab] = useState<Tab>('approvals')
  return (
    <section className="space-y-2.5">
      <h3 className="led-text px-0.5 text-[11px] text-fog-500">Journal</h3>
      <Segmented<Tab>
        id="journal-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'approvals', label: 'Autorisations' },
          { value: 'sent', label: 'Envoyé en ligne' }
        ]}
      />
      {tab === 'approvals' ? <ApprovalsLog /> : <SentLog />}
      <AlwaysRules />
    </section>
  )
}
