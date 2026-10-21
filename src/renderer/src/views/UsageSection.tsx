// « Utilisation » (Activité) : Claude Code, lu sur le PC dans ses fichiers de
// session, et Compi, réponse par réponse. Rien n'est envoyé nulle part.

import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Timer } from 'lucide-react'
import {
  currentBlock,
  formatTokens,
  formatUsd,
  summarizeCompiUsage,
  summarizeUsage,
  type ClaudeCodeUsage,
  type CompiUsageRow,
  type UsagePeriod
} from '@shared/usage'
import { LedDots, Segmented, timeAgo } from '../components/ui'

const CC_COLOR = '#F59E7B'
const COMPI_COLOR = 'var(--led)'

const PERIODS: Array<{ value: UsagePeriod; label: string }> = [
  { value: 'today', label: 'Aujourd’hui' },
  { value: 'week', label: '7 jours' },
  { value: 'month', label: '30 jours' }
]

const hourLabel = (ts: number): string => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }).replace(':', ' h ')
const dayLabel = (day: string): string =>
  new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  })

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div
        className="truncate text-[17px] leading-tight font-semibold tabular-nums text-fog-100"
        style={color ? { color, textShadow: `0 0 14px ${color}55` } : undefined}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-fog-500">{label}</div>
    </div>
  )
}

/** Une colonne de points LED par jour. */
function DayBars({ days, color }: { days: Array<{ day: string; total: number; cost: number }>; color: string }) {
  const max = Math.max(1, ...days.map((d) => d.total))
  const ROWS = 7
  return (
    <div className="flex h-[58px] items-end gap-[3px]">
      {days.map((d) => {
        const lit = d.total ? Math.max(1, Math.ceil((d.total / max) * ROWS)) : 0
        return (
          <div
            key={d.day}
            className="flex flex-1 flex-col-reverse items-center gap-[3px]"
            title={`${dayLabel(d.day)} · ${formatTokens(d.total)} jetons · ${formatUsd(d.cost)}`}
          >
            {Array.from({ length: ROWS }, (_, i) => (
              <span
                key={i}
                className="aspect-square w-full max-w-[7px] rounded-full"
                style={i < lit ? { background: color, boxShadow: `0 0 5px ${color}` } : { background: 'rgb(255 255 255 / 0.06)' }}
              />
            ))}
          </div>
        )
      })}
    </div>
  )
}

function ShareRow({ name, total, cost, max, color }: { name: string; total: number; cost?: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2.5 text-[11.5px]">
      <span className="w-28 shrink-0 truncate text-fog-300" title={name}>
        {name}
      </span>
      <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.max(3, (total / max) * 100)}%`,
            background: color
          }}
        />
      </div>
      <span className="w-14 shrink-0 text-right tabular-nums text-fog-500">{formatTokens(total)}</span>
      {cost !== undefined && <span className="w-16 shrink-0 text-right tabular-nums text-fog-300">{formatUsd(cost)}</span>}
    </div>
  )
}

function ClaudeCodePanel({ period }: { period: UsagePeriod }) {
  const [usage, setUsage] = useState<ClaudeCodeUsage | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    void window.compi.claudeCodeUsage().then(setUsage)
    void window.compi.refreshClaudeCodeUsage().then(setUsage)
    const off = window.compi.onClaudeCodeUsage(setUsage)
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => {
      off()
      clearInterval(t)
    }
  }, [])

  const summary = useMemo(() => (usage ? summarizeUsage(usage, period, now) : null), [usage, period, now])
  const block = useMemo(() => (usage ? currentBlock(usage.rows, now) : null), [usage, now])

  if (!usage || !summary) return null
  if (!usage.available) {
    return (
      <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-5 text-center text-[12px] text-fog-500">
        Claude Code n’a encore rien enregistré sur ce PC.
      </div>
    )
  }
  if (usage.scanning && !usage.rows.length) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl bg-ink-850/80 px-4 py-5 text-[12px] text-fog-500 ring-1 ring-inset ring-white/[0.06]">
        <LedDots color={CC_COLOR} /> Lecture de l’historique de Claude Code…
      </div>
    )
  }

  const topProject = summary.projects[0]?.total ?? 1
  const shown = summary.total > 0

  return (
    <div className="space-y-3 rounded-2xl bg-ink-850/80 p-3.5 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-start gap-3">
        <Stat value={formatTokens(summary.total)} label="jetons" color={CC_COLOR} />
        <Stat value={`≈ ${formatUsd(summary.cost)}`} label="au tarif de l’API" />
        <Stat value={String(summary.sessions)} label={`session${summary.sessions > 1 ? 's' : ''}`} />
      </div>

      {block && (
        <div className="space-y-1.5 rounded-xl bg-black/30 px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
          <div className="flex items-center gap-2 text-[11.5px]">
            <Timer size={12} style={{ color: CC_COLOR }} />
            <span className="text-fog-100">Bloc de 5 h en cours</span>
            <span className="text-fog-500">
              {hourLabel(block.start)} → {hourLabel(block.end)}
            </span>
            <span className="ml-auto tabular-nums text-fog-300">{formatTokens(block.tokens)} jetons</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, ((now - block.start) / (block.end - block.start)) * 100)}%`,
                background: CC_COLOR
              }}
            />
          </div>
          <div className="text-[10.5px] text-fog-700">Estimation, à la manière des limites de l’abonnement : Anthropic ne publie pas les seuils exacts.</div>
        </div>
      )}

      {period !== 'today' && shown && <DayBars days={summary.days} color={CC_COLOR} />}

      {shown ? (
        <>
          <div className="space-y-1.5">
            <div className="text-[10.5px] text-fog-700">Projets</div>
            {summary.projects.slice(0, 3).map((p) => (
              <ShareRow key={p.name} name={p.name} total={p.total} cost={p.cost} max={topProject} color={CC_COLOR} />
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {summary.models.map((m) => (
              <span key={m.name} className="rounded-lg bg-white/[0.05] px-2 py-1 text-[11px] text-fog-300">
                {m.name} <span className="text-fog-500">· {Math.round((m.total / summary.total) * 100)} %</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="text-[12px] text-fog-500">Aucune activité de Claude Code sur cette période.</div>
      )}

      <div className="flex items-start justify-between gap-3 border-t border-white/[0.05] pt-2.5 text-[10.5px] leading-snug text-fog-700">
        <span>
          Coût réel si tu utilises une clé API, indicatif avec l’abonnement Pro ou Max.
          {summary.unpriced > 0 ? ` ${formatTokens(summary.unpriced)} jetons d’un modèle au tarif inconnu ne sont pas chiffrés.` : ''} Lu sur ce PC, rien n’est
          envoyé.
        </span>
        <button
          className="flex shrink-0 items-center gap-1 text-fog-500 hover:text-fog-300 disabled:opacity-40"
          disabled={busy}
          title="Relire les fichiers de Claude Code"
          onClick={() => {
            setBusy(true)
            void window.compi
              .refreshClaudeCodeUsage()
              .then(setUsage)
              .finally(() => {
                setBusy(false)
                setNow(Date.now())
              })
          }}
        >
          <RefreshCw size={11} className={busy ? 'animate-spin' : ''} />
          {usage.scannedAt ? timeAgo(usage.scannedAt) : 'Relire'}
        </button>
      </div>
    </div>
  )
}

function CompiPanel({ period }: { period: UsagePeriod }) {
  const [rows, setRows] = useState<CompiUsageRow[]>([])
  useEffect(() => {
    void window.compi.compiUsage().then(setRows)
    return window.compi.onCompiUsage(setRows)
  }, [])
  const summary = useMemo(() => summarizeCompiUsage(rows, period, Date.now()), [rows, period])
  const top = summary.brains[0]?.replies ?? 1

  return (
    <div className="space-y-3 rounded-2xl bg-ink-850/80 p-3.5 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-start gap-3">
        <Stat value={String(summary.replies)} label={`réponse${summary.replies > 1 ? 's' : ''}`} color={COMPI_COLOR} />
        <Stat value={formatUsd(summary.costUsd)} label="payé à Claude" />
        <Stat value={String(summary.brains.length)} label={`cerveau${summary.brains.length > 1 ? 'x' : ''}`} />
      </div>
      {summary.brains.length ? (
        <div className="space-y-1.5">
          {summary.brains.map((b) => (
            <div key={b.brain} className="flex items-center gap-2.5 text-[11.5px]">
              <span className="w-36 shrink-0 truncate text-fog-300" title={b.brain}>
                {b.brain}
              </span>
              <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(3, (b.replies / top) * 100)}%`,
                    background: COMPI_COLOR
                  }}
                />
              </div>
              <span className="w-16 shrink-0 text-right tabular-nums text-fog-500">{b.replies} rép.</span>
              <span className="w-16 shrink-0 text-right tabular-nums text-fog-300">
                {b.provider === 'anthropic' ? formatUsd(b.costUsd) : b.provider === 'local' ? 'gratuit' : `${formatTokens(b.tokens)} j.`}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[12px] text-fog-500">Aucune réponse sur cette période.</div>
      )}
      <div className="border-t border-white/[0.05] pt-2.5 text-[10.5px] leading-snug text-fog-700">
        Coût donné par Claude pour chaque réponse. Sur ce PC, c’est gratuit ; pour un autre service, seul le nombre de jetons est connu.
      </div>
    </div>
  )
}

type Tab = 'claude-code' | 'compi'

export function UsageSection() {
  const [tab, setTab] = useState<Tab>('claude-code')
  const [period, setPeriod] = useState<UsagePeriod>('today')
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <h3 className="led-text text-[11px] text-fog-500">Utilisation</h3>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`rounded-lg px-2 py-0.5 text-[11px] transition-colors ${period === p.value ? 'bg-white/[0.09] text-fog-100' : 'text-fog-500 hover:text-fog-300'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <Segmented<Tab>
        id="usage-tab"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'claude-code', label: 'Claude Code' },
          { value: 'compi', label: 'Compi' }
        ]}
      />
      {tab === 'claude-code' ? <ClaudeCodePanel period={period} /> : <CompiPanel period={period} />}
    </section>
  )
}
