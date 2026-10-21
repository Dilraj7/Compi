// « Ce PC » (Activité) : processeur, mémoire, carte graphique et mémoire vidéo
// en direct, l'état du modèle local et des conseils pour qu'il réponde plus
// vite. Tout est mesuré sur le PC ; rien ne part en ligne.

import { useEffect, useRef, useState } from 'react'
import { Cpu, Gauge, Lightbulb, MemoryStick, MonitorCog, TriangleAlert, Zap } from 'lucide-react'
import {
  KEEP_ALIVE_LABEL,
  gaugeLevel,
  gbText,
  perfAdvice,
  type AdviceAction,
  type LocalModelState,
  type PerfAdvice,
  type PerfSnapshot,
  type VramUse
} from '@shared/perf'
import type { KeepAlive } from '@shared/types'
import { useCompi } from '../store'
import { Button, LedDots, Segmented, cx } from '../components/ui'

const LEVEL_COLOR = { ok: 'var(--led)', high: '#FBBF24', full: '#F87171' } as const
const VRAM_COLOR: Record<VramUse['kind'], string> = { model: '#A78BFA', windows: '#60A5FA', app: '#FBBF24', other: '#868695' }
const MODEL_COLOR = '#A78BFA'

const pct = (x: number): string => `${Math.round(x)} %`
const waitText = (ms: number): string => (ms >= 90_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`)
const timeLabel = (ts: number): string => new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

/** Rangée de points LED : la part allumée suit la valeur, la couleur son niveau. */
export function LedBar({ value, dots = 16 }: { value: number; dots?: number }) {
  const lit = value > 0 ? Math.max(1, Math.round(Math.min(1, value) * dots)) : 0
  const color = LEVEL_COLOR[gaugeLevel(value)]
  return (
    <div className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: dots }, (_, i) => (
        <span
          key={i}
          className="h-[5px] flex-1 rounded-[1.5px] transition-colors duration-500"
          style={i < lit ? { background: color, boxShadow: `0 0 5px ${color}` } : { background: 'rgb(255 255 255 / 0.06)' }}
        />
      ))}
    </div>
  )
}

function GaugeTile({
  icon,
  label,
  value,
  detail,
  level,
  hint
}: {
  icon: React.ReactNode
  label: string
  value: string
  detail?: string
  level: number
  hint?: string
}) {
  const color = LEVEL_COLOR[gaugeLevel(level)]
  return (
    <div className="min-w-0 space-y-2 rounded-xl bg-white/[0.025] p-2.5 ring-1 ring-inset ring-white/[0.04]" title={hint}>
      <div className="flex items-center gap-1.5 text-[11px] text-fog-500">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="text-[17px] leading-none font-semibold tabular-nums"
          style={{ color, textShadow: `0 0 14px color-mix(in oklab, ${color} 40%, transparent)` }}
        >
          {value}
        </span>
        {detail && <span className="truncate text-[11px] tabular-nums text-fog-500">{detail}</span>}
      </div>
      <LedBar value={level} />
    </div>
  )
}

/** Mémoire vidéo par usage : une barre empilée, puis la légende. */
function VramBar({ gpu }: { gpu: NonNullable<PerfSnapshot['gpu']> }) {
  const total = Math.max(gpu.vramTotalGb, gpu.vramUsedGb, 0.1)
  const free = Math.max(0, total - gpu.vramUsedGb)
  const listed = gpu.vram.reduce((n, v) => n + v.gb, 0)
  // Ce que Windows compte sans le rattacher à une application.
  const rest = Math.max(0, gpu.vramUsedGb - listed)
  const parts = [...gpu.vram, ...(rest > 0.15 ? [{ label: 'Système', gb: rest, kind: 'other' as const }] : [])]
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-white/[0.06]">
        {parts.map((v) => (
          <div
            key={v.label}
            className="h-full transition-[width] duration-700 first:rounded-l-full"
            style={{ width: `${(v.gb / total) * 100}%`, background: VRAM_COLOR[v.kind], boxShadow: v.kind === 'model' ? `0 0 10px ${MODEL_COLOR}` : undefined }}
            title={`${v.label} : ${gbText(v.gb)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[11px]">
        {parts.map((v) => (
          <span key={v.label} className="inline-flex items-center gap-1.5 text-fog-300">
            <span className="size-2 rounded-[2px]" style={{ background: VRAM_COLOR[v.kind] }} />
            {v.label} <span className="tabular-nums text-fog-500">{gbText(v.gb)}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-fog-500">
          <span className="size-2 rounded-[2px] bg-white/[0.08]" />
          Libre <span className="tabular-nums">{gbText(free)}</span>
        </span>
      </div>
    </div>
  )
}

function useNowEvery(ms: number): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function ModelRow({ m, now, onUnload, busy }: { m: LocalModelState; now: number; onUnload?: () => void; busy: boolean }) {
  const onGpu = m.gpuShare >= 0.97
  const left = m.expiresAt ? Math.max(0, m.expiresAt - now) : null
  const role = m.role === 'chat' ? 'Discussion' : m.role === 'embed' ? 'Recherche par le sens' : 'Autre modèle'
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[12.5px] font-medium text-fog-100">{m.name}</span>
          <span className="shrink-0 text-[11px] text-fog-500">
            {role} · {gbText(m.sizeGb)}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px]">
          {onGpu ? (
            <span className="text-led-green">Entièrement sur la carte graphique</span>
          ) : (
            <span className="text-led-amber">
              {pct(m.gpuShare * 100)} sur la carte graphique · {pct((1 - m.gpuShare) * 100)} sur le processeur
            </span>
          )}
          {left !== null && (
            <span className="text-fog-500">
              · se libère dans {left >= 3_600_000 ? `${Math.round(left / 3_600_000)} h` : `${Math.max(1, Math.round(left / 60_000))} min`}
            </span>
          )}
        </div>
      </div>
      {onUnload && (
        <Button size="sm" variant="ghost" disabled={busy} onClick={onUnload}>
          Libérer
        </Button>
      )}
    </div>
  )
}

function AdviceCard({ a, onAction, busy }: { a: PerfAdvice; onAction: (x: AdviceAction) => void; busy: boolean }) {
  const label: Record<AdviceAction, string> = {
    'smaller-model': 'Modèle plus léger',
    'unload-embed': 'Libérer',
    'keep-longer': 'Garder prêt 2 h',
    'new-chat': 'Nouvelle discussion'
  }
  const warn = a.level === 'warn'
  return (
    <div
      className={cx(
        'flex items-start gap-2.5 rounded-xl px-3 py-2.5 text-[12px] leading-snug ring-1 ring-inset',
        warn ? 'bg-led-amber/[0.06] text-fog-100 ring-led-amber/20' : 'bg-white/[0.03] text-fog-300 ring-white/[0.05]'
      )}
    >
      {warn ? <TriangleAlert size={14} className="mt-px shrink-0 text-led-amber" /> : <Lightbulb size={14} className="mt-px shrink-0 text-[var(--led)]" />}
      <span className="flex-1">{a.text}</span>
      {a.action && (
        <Button size="sm" variant="subtle" disabled={busy} onClick={() => onAction(a.action!)}>
          {label[a.action]}
        </Button>
      )}
    </div>
  )
}

export function PerfSection() {
  const perf = useCompi((s) => s.perf)
  const settings = useCompi((s) => s.settings)
  const focus = useCompi((s) => s.activityFocus)
  const ref = useRef<HTMLElement>(null)
  const [busy, setBusy] = useState(false)
  const now = useNowEvery(30_000)

  // Mesuré seulement tant que la vue est ouverte.
  useEffect(() => {
    void window.compi.perfWatch('activity', true, 2000).then((p) => p && useCompi.getState().setPerf(p))
    return () => void window.compi.perfWatch('activity', false)
  }, [])

  // « Pourquoi ? » sous une réponse : on arrive ici.
  useEffect(() => {
    if (focus !== 'perf') return
    const t = setTimeout(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      useCompi.getState().focusActivity(null)
    }, 250)
    return () => clearTimeout(t)
  }, [focus])

  const unload = async (which: 'all' | 'embed'): Promise<void> => {
    setBusy(true)
    try {
      const p = await window.compi.perfUnload(which)
      if (p) useCompi.getState().setPerf(p)
    } finally {
      setBusy(false)
    }
  }

  const setKeepAlive = async (keepAlive: KeepAlive): Promise<void> => {
    if (!settings) return
    useCompi.getState().setSettings(await window.compi.updateSettings({ local: { ...settings.local, keepAlive } }))
  }

  const onAction = (a: AdviceAction): void => {
    const s = useCompi.getState()
    if (a === 'unload-embed') void unload('embed')
    else if (a === 'keep-longer') void setKeepAlive('2h')
    else if (a === 'new-chat') {
      s.newConversation()
      s.open('chat', { focus: true })
    } else {
      s.focusSettings('brain')
      s.setView('settings')
    }
  }

  const advice = perf ? perfAdvice(perf) : []
  const local = perf?.local
  const ramFree = perf ? perf.ram.totalGb - perf.ram.usedGb : 0

  return (
    <section ref={ref} className="scroll-mt-2 space-y-2.5">
      <h3 className="led-text flex items-center gap-2 px-0.5 text-[11px] text-fog-500">
        Ce PC
        {perf?.generating && (
          <span className="inline-flex items-center gap-1.5 normal-case" style={{ color: MODEL_COLOR }}>
            <LedDots color={MODEL_COLOR} /> réponse locale en cours
          </span>
        )}
      </h3>
      {!perf ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl bg-ink-850/80 px-4 py-5 text-[12px] text-fog-500 ring-1 ring-inset ring-white/[0.06]">
          <LedDots /> Je mesure l’activité du PC…
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl bg-ink-850/80 p-3.5 ring-1 ring-inset ring-white/[0.06]">
          <div className={cx('grid gap-2', perf.gpu ? 'grid-cols-4' : 'grid-cols-2')}>
            <GaugeTile icon={<Cpu size={12} />} label="Processeur" value={pct(perf.cpu)} level={perf.cpu / 100} />
            <GaugeTile
              icon={<MemoryStick size={12} />}
              label="Mémoire"
              value={gbText(perf.ram.usedGb)}
              detail={`/ ${gbText(perf.ram.totalGb)}`}
              level={perf.ram.usedGb / perf.ram.totalGb}
              hint={`${gbText(ramFree)} libres`}
            />
            {perf.gpu && (
              <>
                <GaugeTile
                  icon={<Gauge size={12} />}
                  label="Carte graphique"
                  value={pct(perf.gpu.util)}
                  detail={perf.gpu.busyApp && perf.gpu.busyApp.util >= 20 ? perf.gpu.busyApp.name : undefined}
                  level={perf.gpu.util / 100}
                  hint={perf.gpu.name}
                />
                <GaugeTile
                  icon={<MonitorCog size={12} />}
                  label="Mémoire vidéo"
                  value={gbText(perf.gpu.vramUsedGb)}
                  detail={`/ ${gbText(perf.gpu.vramTotalGb)}`}
                  level={perf.gpu.vramUsedGb / perf.gpu.vramTotalGb}
                  hint={perf.gpu.name}
                />
              </>
            )}
          </div>

          {perf.ram.top.length > 0 && (
            <div className="text-[11px] text-fog-500">
              Mémoire la plus prise :{' '}
              {perf.ram.top.map((t, i) => (
                <span key={t.name}>
                  {i > 0 && ' · '}
                  <span className="text-fog-300">{t.name}</span> {gbText(t.gb)}
                </span>
              ))}
            </div>
          )}

          {perf.gpu && perf.gpu.vram.length > 0 && <VramBar gpu={perf.gpu} />}

          {local && (
            <div className="space-y-2.5 border-t border-white/[0.05] pt-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-fog-300">
                  <Zap size={12} style={{ color: MODEL_COLOR }} /> Modèle local ({local.engine === 'ollama' ? 'Ollama' : 'LM Studio'})
                </span>
                {local.engine === 'ollama' && local.models.length > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void unload('all')}
                    title="Décharge les modèles : la mémoire vidéo est rendue tout de suite."
                  >
                    Libérer la mémoire vidéo
                  </Button>
                )}
              </div>
              {local.models.length === 0 ? (
                <div className="text-[11.5px] text-fog-500">
                  Aucun modèle chargé : la prochaine question le chargera{local.chatModel ? ` (${local.chatModel})` : ''}, ce qui prend un peu de temps.
                </div>
              ) : (
                local.models.map((m) => (
                  <ModelRow
                    key={m.name}
                    m={m}
                    now={now}
                    busy={busy}
                    onUnload={m.role === 'embed' && local.engine === 'ollama' ? () => void unload('embed') : undefined}
                  />
                ))
              )}
              {local.engine === 'ollama' && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11.5px] text-fog-500">Garder le modèle prêt après ta dernière question</span>
                  <div className="w-48">
                    <Segmented
                      id="keep-alive"
                      value={local.keepAlive}
                      onChange={(v) => void setKeepAlive(v)}
                      options={(Object.keys(KEEP_ALIVE_LABEL) as KeepAlive[]).map((k) => ({ value: k, label: KEEP_ALIVE_LABEL[k] }))}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {perf.runs.length > 0 && (
            <div className="space-y-1 border-t border-white/[0.05] pt-3">
              <div className="text-[11.5px] font-medium text-fog-300">Dernières réponses locales</div>
              {perf.runs
                .slice(-4)
                .reverse()
                .map((r) => (
                  <div key={r.at} className="flex items-center gap-2.5 text-[11.5px] tabular-nums">
                    <span className="w-11 shrink-0 text-fog-700">{timeLabel(r.at)}</span>
                    <span className="w-28 shrink-0 truncate text-fog-500" title={r.model}>
                      {r.model}
                    </span>
                    <span className="w-24 shrink-0 text-fog-300">{r.firstTokenMs !== undefined ? `1er mot ${waitText(r.firstTokenMs)}` : '—'}</span>
                    <span className="w-20 shrink-0 text-fog-300">{r.tokensPerSec !== undefined ? `${r.tokensPerSec} jetons/s` : ''}</span>
                    <span className="min-w-0 flex-1 truncate text-led-amber/80">
                      {[r.coldStart && 'modèle rechargé', r.gpuShare !== undefined && r.gpuShare < 0.97 && `${pct((1 - r.gpuShare) * 100)} sur le processeur`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
            </div>
          )}

          {(advice.length > 0 || local) && (
            <div className="space-y-1.5 border-t border-white/[0.05] pt-3">
              {advice.length ? (
                advice.map((a) => <AdviceCard key={a.id} a={a} busy={busy} onAction={onAction} />)
              ) : (
                <div className="flex items-center gap-2 text-[11.5px] text-led-green">
                  <Lightbulb size={13} /> Rien à signaler : le modèle a la place qu’il lui faut.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
