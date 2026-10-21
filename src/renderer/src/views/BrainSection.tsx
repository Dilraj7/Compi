// Réglages › Cerveau : Claude, un modèle local (Ollama ou LM Studio) ou un autre
// service compatible. Avec le questionnaire « Aide-moi à choisir », Compi
// conseille un modèle adapté au PC et l'installe en un clic.

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Building2,
  Check,
  ChevronDown,
  Cloud,
  Cpu,
  Download,
  ExternalLink,
  FolderOpen,
  HardDrive,
  KeyRound,
  Laptop,
  Loader2,
  Lock,
  Play,
  Sparkles,
  TriangleAlert,
  Wand2,
  X
} from 'lucide-react'
import { brainLabel, brainMissing, CLAUDE_MODELS, CUSTOM_PRESETS, defaultBrain, isPrivateHost, normalizeBaseUrl } from '@shared/brains'
import type {
  Brain,
  BrainProgress,
  BrainRecommendation,
  BrainTestResult,
  CatalogModel,
  Effort,
  HardwareInfo,
  KeepAlive,
  LocalModelInfo,
  LocalStatus,
  ProviderId,
  PublicSettings,
  Settings
} from '@shared/types'
import { KEEP_ALIVE_LABEL, gbText } from '@shared/perf'
import type { OllamaFolder } from '@shared/ollamaFolder'
import { useCompi } from '../store'
import { Badge, Button, Segmented, TextInput, Toggle, cx } from '../components/ui'
import { BrainQuiz } from './BrainQuiz'

type EffortOption = { value: Effort; label: string; hint: string }

const EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Vif', hint: 'Réponses rapides (recommandé pour discuter)' },
  { value: 'medium', label: 'Réfléchi', hint: 'Un peu plus de réflexion' },
  { value: 'high', label: 'Approfondi', hint: 'Pour les questions difficiles' },
  { value: 'xhigh', label: 'Expert', hint: 'Réflexion maximale, plus lent' }
]

/** En local, la plupart des modèles réfléchissent ou non, sans niveaux. */
const LOCAL_EFFORTS: EffortOption[] = [
  { value: 'low', label: 'Vif', hint: 'Sans réflexion : réponses presque instantanées (recommandé)' },
  { value: 'medium', label: 'Réfléchi', hint: 'Le modèle réfléchit avant de répondre : plus juste, mais plusieurs secondes de plus' }
]

/** Le même réglage pour tous les cerveaux : Vif, Réfléchi… */
function StyleRow({
  value,
  options,
  onChange,
  note,
  className = 'px-3.5 py-3'
}: {
  value: Effort
  options: EffortOption[]
  onChange: (e: Effort) => void
  note?: string
  className?: string
}) {
  const current = options.find((o) => o.value === value) ?? options[0]
  return (
    <div className={className}>
      <div className="mb-2 text-[12.5px] text-fog-100">Style de réponse</div>
      <Segmented value={current.value} options={options} onChange={onChange} />
      <div className="mt-1.5 text-[11.5px] text-fog-500">{note ?? current.hint}</div>
    </div>
  )
}

const PROVIDERS: Array<{ value: ProviderId; label: string; hint: string }> = [
  { value: 'anthropic', label: 'Claude', hint: 'Le plus intelligent, en ligne, payant à l’usage' },
  { value: 'local', label: 'Sur ce PC', hint: 'Privé, gratuit et hors ligne' },
  { value: 'custom', label: 'Autre service', hint: 'Un service en ligne compatible' }
]

const GB = 1024 ** 3
const gb = (n: number): string => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go`
const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

type Apply = (p: Promise<PublicSettings>) => void
type Update = (patch: Partial<Settings>) => void

function Divider() {
  return <div className="border-t border-white/[0.05]" />
}

function ProgressBar({ value }: { value?: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
      {value === undefined ? (
        <motion.div
          className="h-full w-1/3 rounded-full bg-[var(--led)]"
          animate={{ x: ['-100%', '300%'] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        />
      ) : (
        <motion.div
          className="h-full rounded-full bg-[var(--led)] shadow-[0_0_10px_var(--led)]"
          animate={{ width: `${Math.round(value * 100)}%` }}
          transition={{ ease: 'easeOut' }}
        />
      )}
    </div>
  )
}

function TestButton({ brain, disabled }: { brain: Brain; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'running'>('idle')
  const [result, setResult] = useState<BrainTestResult | null>(null)
  useEffect(() => setResult(null), [brain.provider, brain.model])
  return (
    <div className="space-y-1.5">
      <Button
        size="sm"
        variant="subtle"
        disabled={disabled || state === 'running'}
        onClick={() => {
          setState('running')
          setResult(null)
          void window.compi.testBrain(brain).then((r) => {
            setResult(r)
            setState('idle')
          })
        }}
      >
        {state === 'running' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {state === 'running' ? 'Test en cours…' : 'Tester'}
      </Button>
      {result && (
        <div className={cx('text-[11.5px] leading-snug', result.ok ? (result.tools === false ? 'text-led-amber' : 'text-led-green') : 'text-led-red')}>
          {result.message}
        </div>
      )}
    </div>
  )
}

// ─── Claude ──────────────────────────────────────────────────────────────────

function ApiKeyRow({ s, apply }: { s: PublicSettings; apply: Apply }) {
  const [editing, setEditing] = useState(!s.hasApiKey)
  const [key, setKey] = useState('')
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <KeyRound size={15} className="text-fog-500" />
          <div>
            <div className="text-[12.5px] text-fog-100">Clé API Anthropic</div>
            <div className="text-[11.5px] text-fog-500">Chiffrée par Windows, elle ne quitte jamais ton PC sauf vers Anthropic.</div>
          </div>
        </div>
        {s.hasApiKey && !editing ? (
          <div className="flex items-center gap-1.5">
            <Badge color="#4ADE80">
              <Check size={11} /> Enregistrée
            </Badge>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Changer
            </Button>
          </div>
        ) : null}
      </div>
      {editing && (
        <div className="mt-2.5 flex items-center gap-2">
          <TextInput type="password" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
          <Button
            size="md"
            variant="primary"
            disabled={!key.trim()}
            onClick={() => {
              apply(window.compi.setApiKey(key.trim()))
              setKey('')
              setEditing(false)
            }}
          >
            Enregistrer
          </Button>
          {s.hasApiKey && (
            <Button size="md" variant="ghost" onClick={() => setEditing(false)}>
              Annuler
            </Button>
          )}
        </div>
      )}
      {!s.hasApiKey && (
        <button
          onClick={() => void window.compi.openExternal('https://console.anthropic.com/settings/keys')}
          className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[var(--led)] hover:underline"
        >
          Obtenir une clé sur console.anthropic.com <ExternalLink size={11} />
        </button>
      )}
    </div>
  )
}

/** Pour les clés « multi-workspace », Anthropic exige de préciser le workspace à utiliser. */
function WorkspaceRow({ s, update }: { s: PublicSettings; update: Update }) {
  const [value, setValue] = useState(s.workspaceId)
  const save = (): void => {
    if (value.trim() !== s.workspaceId) update({ workspaceId: value.trim() })
  }
  return (
    <div className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Building2 size={15} className="text-fog-500" />
          <div>
            <div className="text-[12.5px] text-fog-100">
              Workspace <span className="text-fog-500">(facultatif)</span>
            </div>
            <div className="text-[11.5px] text-fog-500">Seulement si ta clé couvre plusieurs workspaces.</div>
          </div>
        </div>
        <TextInput
          className="w-52 font-mono text-[11.5px]"
          placeholder="wrkspc_…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <button
        onClick={() => void window.compi.openExternal('https://platform.claude.com/settings/workspaces')}
        className="mt-2 inline-flex items-center gap-1 text-[11.5px] text-[var(--led)] hover:underline"
      >
        Trouver l’ID dans la Console (Settings › Workspaces) <ExternalLink size={11} />
      </button>
    </div>
  )
}

function ClaudePanel({ s, apply, update }: { s: PublicSettings; apply: Apply; update: Update }) {
  return (
    <>
      <ApiKeyRow s={s} apply={apply} />
      <Divider />
      <WorkspaceRow key={s.workspaceId} s={s} update={update} />
      <Divider />
      <div className="px-3.5 py-3">
        <div className="mb-2 text-[12.5px] text-fog-100">Modèle</div>
        <Segmented value={s.model} options={CLAUDE_MODELS} onChange={(model) => update({ model })} />
        <div className="mt-1.5 text-[11.5px] text-fog-500">{CLAUDE_MODELS.find((m) => m.value === s.model)?.hint}</div>
      </div>
      <Divider />
      <StyleRow value={s.effort} options={EFFORTS} onChange={(effort) => update({ effort })} />
      {s.hasApiKey && (
        <>
          <Divider />
          <div className="px-3.5 py-3">
            <TestButton brain={{ provider: 'anthropic', model: s.model }} />
          </div>
        </>
      )}
    </>
  )
}

// ─── Local : état du moteur, téléchargements ─────────────────────────────────

interface LocalState {
  status: LocalStatus | null
  hw: HardwareInfo | null
  install: BrainProgress | null
  pull: BrainProgress | null
  refresh: () => void
}

function useLocal(active: boolean): LocalState {
  const [status, setStatus] = useState<LocalStatus | null>(null)
  const [hw, setHw] = useState<HardwareInfo | null>(null)
  const [install, setInstall] = useState<BrainProgress | null>(null)
  const [pull, setPull] = useState<BrainProgress | null>(null)
  const refresh = useCallback(() => void window.compi.localStatus().then(setStatus), [])

  useEffect(() => {
    if (!active) return
    refresh()
    void window.compi.hardwareInfo().then(setHw)
    return window.compi.onBrainProgress((p) => {
      if (p.kind === 'install') setInstall(p.done && !p.error ? null : p)
      else setPull(p.done && !p.error ? null : p)
      if (p.done) refresh()
    })
  }, [active, refresh])

  // Moteur absent ou arrêté : on revérifie régulièrement (installation manuelle, démarrage…).
  useEffect(() => {
    if (!active || status?.running) return
    const t = setInterval(refresh, 3000)
    return () => clearInterval(t)
  }, [active, status?.running, refresh])

  return { status, hw, install, pull, refresh }
}

const FOLDER_SOURCE: Record<OllamaFolder['source'], string> = {
  app: 'réglé dans Ollama',
  env: 'variable OLLAMA_MODELS',
  default: 'dossier par défaut'
}

/**
 * Où Ollama range les modèles (Compi lui demande de les télécharger, il les met là).
 * Le dossier se change dans Ollama ; Compi le montre et répare le cas où Ollama
 * tourne encore sur l'ancien dossier.
 */
function ModelsFolder({ onRestarted }: { onRestarted: () => void }) {
  const [folder, setFolder] = useState<OllamaFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.compi.modelsFolder().then(setFolder, () => setFolder(null))
  }, [])

  if (!folder) return null
  const restart = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const next = await window.compi.restartOllama()
      setFolder(next)
      if (next?.restartNeeded) setError('Ollama ne voit toujours pas tes modèles. Quitte Ollama (icône près de l’horloge), puis relance-le.')
      onRestarted()
    } catch (e) {
      setError(cleanError(e as Error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1.5 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-inset ring-white/[0.05]">
      <div className="flex items-center gap-2">
        <FolderOpen size={13} className="shrink-0 text-fog-500" />
        <span className="shrink-0 text-[11.5px] text-fog-500">Dossier des modèles</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fog-100 select-text" title={folder.dir}>
          {folder.dir}
        </span>
        <Button size="sm" variant="ghost" disabled={!folder.exists} onClick={() => void window.compi.openModelsFolder()}>
          Ouvrir
        </Button>
      </div>
      <div className="text-[11px] leading-snug text-fog-500">
        {[
          FOLDER_SOURCE[folder.source],
          folder.exists
            ? folder.models > 0
              ? `${folder.models} modèle${folder.models > 1 ? 's' : ''} · ${gbText(folder.sizeGb)}`
              : gbText(folder.sizeGb)
            : 'pas encore créé',
          folder.freeGb !== undefined && `${gbText(folder.freeGb)} libres sur ce disque`
        ]
          .filter(Boolean)
          .join(' · ')}
        . Les modèles se téléchargent ici. Pour changer de dossier : réglages d’Ollama › Model location.
      </div>
      {folder.restartNeeded && (
        <div className="flex items-start gap-2 rounded-lg bg-led-amber/[0.07] px-2.5 py-2 text-[11.5px] leading-snug text-led-amber ring-1 ring-inset ring-led-amber/20">
          <TriangleAlert size={13} className="mt-px shrink-0" />
          <span className="flex-1">
            Ollama ne voit pas tes modèles : il tourne encore sur {folder.runningDir ? `l’ancien dossier (${folder.runningDir})` : 'un autre dossier'}.
            Redémarre-le pour qu’il les retrouve (rien n’est supprimé).
          </span>
          <Button size="sm" variant="subtle" disabled={busy} onClick={() => void restart()}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null} {busy ? 'Redémarrage…' : 'Redémarrer Ollama'}
          </Button>
        </div>
      )}
      {error && <div className="text-[11.5px] text-led-red">{error}</div>}
    </div>
  )
}

function EngineCard({ local }: { local: LocalState }) {
  const { status, install } = local
  if (!status) return <div className="text-[11.5px] text-fog-500">Je cherche un moteur local…</div>

  const installing = install && !install.done
  const name = status.engine === 'lmstudio' ? 'LM Studio' : 'Ollama'
  let body
  if (status.running && !status.outdated) {
    body = (
      <div className="flex items-center gap-2 text-[12.5px] text-fog-100">
        <Badge color="#4ADE80">
          <Check size={11} /> Prêt
        </Badge>
        {name}
        {status.version ? ` ${status.version}` : ''} tourne sur ton PC.
      </div>
    )
  } else if (status.running && status.outdated) {
    body = (
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12.5px] text-fog-100">Ollama {status.version} est trop ancien pour moi (0.14 minimum).</div>
        <Button size="sm" variant="primary" disabled={Boolean(installing)} onClick={() => void window.compi.installOllama()}>
          Mettre à jour
        </Button>
      </div>
    )
  } else if (status.installed) {
    body = (
      <div className="flex items-center justify-between gap-3">
        <div className="text-[12.5px] text-fog-100">Ollama est installé mais arrêté.</div>
        <Button size="sm" variant="primary" onClick={() => void window.compi.startLocalEngine().then(local.refresh)}>
          <Play size={12} /> Démarrer
        </Button>
      </div>
    )
  } else {
    body = (
      <div className="space-y-2">
        <div className="text-[12.5px] text-fog-100">Il me faut un moteur pour faire tourner un modèle sur ton PC.</div>
        <div className="text-[11.5px] leading-snug text-fog-500">
          Ollama est un logiciel libre et gratuit (licence MIT), installé pour ton compte Windows, sans droits administrateur.
          {status.canInstall ? ' En cliquant, tu acceptes sa licence.' : ''}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" disabled={Boolean(installing)} onClick={() => void window.compi.installOllama()}>
            <Download size={12} /> {status.canInstall ? 'Installer Ollama' : 'Télécharger Ollama'}
          </Button>
          <button onClick={() => void window.compi.openExternal('https://lmstudio.ai')} className="text-[11.5px] text-fog-500 hover:text-fog-100">
            ou utilise LM Studio
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {body}
      {status.engine === 'ollama' && (status.running || status.installed) && <ModelsFolder onRestarted={local.refresh} />}
      {status.engine === 'lmstudio' && status.running && (
        <div className="text-[11px] leading-snug text-fog-500">Le dossier des modèles se règle dans LM Studio (Mes modèles).</div>
      )}
      {install && (
        <div className="space-y-1">
          <div className={cx('text-[11.5px]', install.error ? 'text-led-red' : 'text-fog-500')}>
            {install.error ? `Installation impossible : ${install.error}` : `${install.status}…`}
          </div>
          {!install.error && !install.done && <ProgressBar value={install.progress} />}
        </div>
      )}
    </div>
  )
}

function HardwareLine({ hw }: { hw: HardwareInfo }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fog-500">
      <span className="inline-flex items-center gap-1">
        <Laptop size={12} /> {gb(hw.ramGb)} de RAM
      </span>
      {hw.gpu && (
        <span className="inline-flex items-center gap-1">
          <Cpu size={12} /> {hw.gpu.name}
          {hw.gpu.vramGb >= 1 ? ` (${gb(hw.gpu.vramGb)})` : ''}
        </span>
      )}
      {hw.freeDiskGb !== undefined && (
        <span className="inline-flex items-center gap-1">
          <HardDrive size={12} /> {gb(hw.freeDiskGb)} libres
        </span>
      )}
    </div>
  )
}

function ModelBadges({ m }: { m: Pick<LocalModelInfo, 'tools' | 'vision' | 'thinking'> }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {m.tools ? <Badge color="#4ADE80">outils</Badge> : <Badge color="#F87171">sans outils</Badge>}
      {m.vision && <Badge color="#60A5FA">vision</Badge>}
      {m.thinking && <Badge color="#C084FC">réflexion</Badge>}
    </span>
  )
}

function PullBar({ pull }: { pull: BrainProgress }) {
  return (
    <div className="space-y-1.5 rounded-xl bg-black/30 p-2.5 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-center justify-between gap-2 text-[11.5px]">
        <span className={pull.error ? 'text-led-red' : 'text-fog-300'}>
          {pull.error
            ? `${pull.model} : ${pull.error}`
            : `${pull.status} de ${pull.model}${pull.progress !== undefined ? ` · ${Math.round(pull.progress * 100)} %` : ''}`}
        </span>
        {!pull.done && (
          <button onClick={() => void window.compi.cancelPull()} className="text-fog-500 hover:text-fog-100" aria-label="Annuler le téléchargement">
            <X size={13} />
          </button>
        )}
      </div>
      {!pull.error && !pull.done && <ProgressBar value={pull.progress} />}
    </div>
  )
}

function LocalStyle({ s, update, info }: { s: PublicSettings; update: Update; info?: LocalModelInfo }) {
  const levels = /^gpt-oss/i.test(info?.name ?? s.local.model)
  const canThink = info?.thinking ?? true
  return (
    <StyleRow
      className=""
      value={canThink ? s.local.effort : 'low'}
      options={levels ? EFFORTS : canThink ? LOCAL_EFFORTS : LOCAL_EFFORTS.slice(0, 1)}
      note={canThink ? undefined : 'Ce modèle ne réfléchit pas : il répond toujours en mode Vif.'}
      onChange={(effort) => update({ local: { ...s.local, effort } })}
    />
  )
}

function LocalPanel({ s, update, local, onPick }: { s: PublicSettings; update: Update; local: LocalState; onPick: (model: string) => void }) {
  const { status, hw, pull } = local
  const [expert, setExpert] = useState('')
  const selected = s.local.model
  const ollama = status?.engine === 'ollama' && status.running && !status.outdated

  return (
    <div className="space-y-3 px-3.5 py-3">
      <EngineCard local={local} />
      {hw && <HardwareLine hw={hw} />}
      {status?.loaded && (
        <div className={cx('flex items-center gap-1.5 text-[11.5px]', status.loaded.gpuShare >= 0.97 ? 'text-fog-500' : 'text-led-amber')}>
          {status.loaded.gpuShare >= 0.97 ? <Check size={12} className="text-led-green" /> : <TriangleAlert size={12} />}
          {status.loaded.name} est prêt ·{' '}
          {status.loaded.gpuShare >= 0.97
            ? '100 % dans la carte graphique'
            : `${Math.round(status.loaded.gpuShare * 100)} % dans la carte graphique, le reste sur le processeur (plus lent)`}
        </div>
      )}

      {status?.running && (
        <div className="space-y-1.5">
          <div className="text-[12.5px] text-fog-100">Modèles installés</div>
          {status.models.length === 0 ? (
            <div className="text-[11.5px] text-fog-500">
              Aucun pour l’instant.{' '}
              {status.engine === 'lmstudio'
                ? 'Télécharge-en un dans LM Studio, il apparaîtra ici.'
                : 'Laisse-moi t’en conseiller un ci-dessus, ou tape son nom ci-dessous.'}
            </div>
          ) : (
            status.models.map((m) => {
              const active = s.provider === 'local' && selected === m.name
              return (
                <button
                  key={m.name}
                  disabled={!m.tools}
                  title={m.tools ? undefined : 'Ce modèle ne sait pas utiliser mes outils (rappels, documents…).'}
                  onClick={() => onPick(m.name)}
                  className={cx(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors',
                    active ? 'bg-[var(--led)]/10 ring-[var(--led)]/40' : 'bg-white/[0.03] ring-white/[0.05] hover:bg-white/[0.06]',
                    !m.tools && 'opacity-50'
                  )}
                >
                  <span
                    className={cx(
                      'grid size-4 shrink-0 place-items-center rounded-full ring-1',
                      active ? 'bg-[var(--led)] text-black ring-[var(--led)]' : 'ring-white/20'
                    )}
                  >
                    {active && <Check size={10} strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-fog-100">{m.name}</span>
                    <span className="text-[11px] text-fog-500">
                      {m.params ? `${m.params} · ` : ''}
                      {m.sizeBytes ? gb(m.sizeBytes / GB) : ''}
                    </span>
                  </span>
                  <ModelBadges m={m} />
                </button>
              )
            })
          )}
        </div>
      )}

      {pull && <PullBar pull={pull} />}

      {ollama && (
        <div className="flex items-center gap-2">
          <TextInput
            className="font-mono text-[11.5px]"
            placeholder="Mode expert : nom d’un modèle Ollama (ex. qwen3.5:9b)"
            value={expert}
            onChange={(e) => setExpert(e.target.value)}
          />
          <Button
            size="md"
            variant="subtle"
            disabled={!expert.trim() || Boolean(pull && !pull.done)}
            onClick={() => {
              void window.compi.pullModel(expert.trim())
              setExpert('')
            }}
          >
            <Download size={13} /> Télécharger
          </Button>
        </div>
      )}

      {s.provider === 'local' && selected && status?.running && <LocalStyle s={s} update={update} info={status.models.find((m) => m.name === selected)} />}

      {s.provider === 'local' && selected && status?.running && <TestButton brain={{ provider: 'local', model: selected }} />}

      <div className="flex items-center justify-between gap-4 border-t border-white/[0.05] pt-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-fog-100">Me proposer Claude quand je ne sais pas faire</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">
            Pour les scans et les images si le modèle ne les voit pas. Rien ne part sans ton accord.
            {!s.hasApiKey && ' Demande une clé Claude.'}
          </div>
        </div>
        <Toggle checked={s.local.cloudHelp} onChange={(cloudHelp) => update({ local: { ...s.local, cloudHelp } })} label="Me proposer Claude" />
      </div>
      {status?.engine === 'ollama' && (
        <div className="flex items-center justify-between gap-4 border-t border-white/[0.05] pt-3">
          <div className="min-w-0">
            <div className="text-[12.5px] text-fog-100">Garder le modèle prêt</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">
              Après ta dernière question. Plus longtemps : pas d’attente au retour, mais la mémoire vidéo reste prise (Activité › Ce PC pour la libérer).
            </div>
          </div>
          <Segmented<KeepAlive>
            id="brain-keep-alive"
            value={s.local.keepAlive ?? '30m'}
            options={(Object.keys(KEEP_ALIVE_LABEL) as KeepAlive[]).map((k) => ({ value: k, label: KEEP_ALIVE_LABEL[k] }))}
            onChange={(keepAlive) => update({ local: { ...s.local, keepAlive } })}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-white/[0.05] pt-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-fog-100">Longs documents et grosses extensions</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">
            Mémoire de travail doublée (64 000 jetons au lieu de 32 000), si la carte graphique a la place. Prend plus de mémoire vidéo.
          </div>
        </div>
        <Toggle
          checked={s.local.longContext === true}
          onChange={(longContext) => update({ local: { ...s.local, longContext } })}
          label="Longs documents et grosses extensions"
        />
      </div>
      <div className="flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px] leading-snug text-fog-500">
        <Lock size={12} className="mt-0.5 shrink-0 text-fog-300" />
        <span>
          En local, tes messages et tes documents restent sur ton PC. Je lis les pages web moi-même ; pour chercher sur le web, branche le connecteur gratuit
          Brave Search (Extensions › Connecteurs).
        </span>
      </div>
    </div>
  )
}

// ─── Autre service ───────────────────────────────────────────────────────────

function CustomPanel({ s, apply, update }: { s: PublicSettings; apply: Apply; update: Update }) {
  const [d, setD] = useState(s.custom)
  const [key, setKey] = useState('')
  const [editingKey, setEditingKey] = useState(!s.hasCustomKey)
  const preset = CUSTOM_PRESETS.find((p) => normalizeBaseUrl(p.baseUrl) === normalizeBaseUrl(d.baseUrl))
  const save = (next = d): void => {
    if (JSON.stringify(next) !== JSON.stringify(s.custom)) update({ custom: next })
  }
  const host = ((): string => {
    try {
      return d.baseUrl ? new URL(normalizeBaseUrl(d.baseUrl)).hostname : ''
    } catch {
      return ''
    }
  })()
  const insecure = /^http:/i.test(normalizeBaseUrl(d.baseUrl)) && host && !isPrivateHost(host)

  return (
    <div className="space-y-3 px-3.5 py-3">
      <div className="flex flex-wrap gap-1.5">
        {CUSTOM_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              const next = { ...d, name: p.name, baseUrl: p.baseUrl, model: p.model }
              setD(next)
              save(next)
            }}
            className={cx(
              'rounded-lg px-2.5 py-1 text-[11.5px] ring-1 ring-inset transition-colors',
              preset?.id === p.id
                ? 'bg-[var(--led)]/12 text-[var(--led)] ring-[var(--led)]/40'
                : 'bg-white/[0.04] text-fog-300 ring-white/[0.06] hover:bg-white/[0.08]'
            )}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-fog-500">Nom</span>
          <TextInput placeholder="ex. DeepSeek" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} onBlur={() => save()} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-fog-500">Modèle</span>
          <TextInput
            className="font-mono text-[11.5px]"
            placeholder={preset?.modelHint ?? 'nom du modèle'}
            value={d.model}
            onChange={(e) => setD({ ...d, model: e.target.value })}
            onBlur={() => save()}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[11.5px] text-fog-500">Adresse compatible Anthropic</span>
        <TextInput
          className="font-mono text-[11.5px]"
          placeholder="https://…/anthropic"
          value={d.baseUrl}
          onChange={(e) => setD({ ...d, baseUrl: e.target.value })}
          onBlur={() => save()}
        />
      </label>
      {insecure && (
        <div className="flex items-center gap-1.5 text-[11.5px] text-led-amber">
          <TriangleAlert size={12} /> Adresse non chiffrée (http) : ta clé et tes messages circuleraient en clair.
        </div>
      )}
      {host === 'openrouter.ai' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11.5px] leading-snug text-fog-500">
            N’utiliser que des fournisseurs qui ne gardent pas mes messages
            <span className="block text-fog-700">Certains modèles n’en ont aucun : décoche alors cette case.</span>
          </span>
          <Toggle
            checked={d.denyDataCollection !== false}
            onChange={(v) => {
              const next = { ...d, denyDataCollection: v }
              setD(next)
              save(next)
            }}
            label="Fournisseurs qui ne gardent pas mes messages"
          />
        </div>
      )}
      {!preset?.noKey && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11.5px] text-fog-500">Clé du service</span>
            {preset?.keyUrl && (
              <button
                onClick={() => void window.compi.openExternal(preset.keyUrl!)}
                className="inline-flex items-center gap-1 text-[11.5px] text-[var(--led)] hover:underline"
              >
                Obtenir une clé <ExternalLink size={11} />
              </button>
            )}
          </div>
          {s.hasCustomKey && !editingKey ? (
            <div className="flex items-center gap-1.5">
              <Badge color="#4ADE80">
                <Check size={11} /> Enregistrée
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => setEditingKey(true)}>
                Changer
              </Button>
              <Button size="sm" variant="ghost" onClick={() => apply(window.compi.setCustomKey(null))}>
                Supprimer
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <TextInput type="password" placeholder="clé API" value={key} onChange={(e) => setKey(e.target.value)} />
              <Button
                size="md"
                variant="primary"
                disabled={!key.trim()}
                onClick={() => {
                  apply(window.compi.setCustomKey(key.trim()))
                  setKey('')
                  setEditingKey(false)
                }}
              >
                Enregistrer
              </Button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-start gap-2 rounded-xl bg-led-amber/[0.07] px-3 py-2 text-[11.5px] leading-snug text-fog-300 ring-1 ring-inset ring-led-amber/15">
        <Cloud size={12} className="mt-0.5 shrink-0 text-led-amber" />
        <span>Tes messages, les documents que je lis et les résultats de mes outils partent chez ce service. Vérifie sa politique de confidentialité.</span>
      </div>
      <StyleRow
        className=""
        value={d.effort}
        options={EFFORTS}
        onChange={(effort) => {
          const next = { ...d, effort }
          setD(next)
          save(next)
        }}
      />
      {s.custom.baseUrl && s.custom.model && <TestButton brain={{ provider: 'custom', model: s.custom.model }} />}
    </div>
  )
}

// ─── Conseil ─────────────────────────────────────────────────────────────────

function Recommendation({
  rec,
  local,
  onUseClaude,
  onInstall,
  onRetry,
  inline
}: {
  rec: BrainRecommendation
  local: LocalState
  /** Montrer le moteur et le téléchargement ici (le panneau « Sur ce PC » n'est pas affiché). */
  inline: boolean
  onUseClaude: () => void
  onInstall: (m: CatalogModel) => void
  onRetry: () => void
}) {
  const [more, setMore] = useState(false)
  const installed = (id: string): boolean => Boolean(local.status?.models.some((m) => m.name === id || m.name === `${id}:latest`))
  const engineReady = local.status?.running && !local.status.outdated
  const lmstudio = local.status?.engine === 'lmstudio'
  const pulling = Boolean(local.pull && !local.pull.done)

  const action = (m: CatalogModel, primary: boolean) =>
    installed(m.id) ? (
      <Button size="sm" variant={primary ? 'primary' : 'subtle'} onClick={() => onInstall(m)}>
        <Check size={12} /> Utiliser
      </Button>
    ) : (
      <Button size="sm" variant={primary ? 'primary' : 'subtle'} disabled={!engineReady || lmstudio || pulling} onClick={() => onInstall(m)}>
        <Download size={12} /> {primary ? 'Installer et utiliser' : 'Installer'}
      </Button>
    )

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-[var(--led)]/[0.06] p-3.5 ring-1 ring-inset ring-[var(--led)]/25"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <span className="led-text inline-flex items-center gap-1.5 text-[11px] text-[var(--led)]">
          <Sparkles size={12} /> Mon conseil
        </span>
        <button onClick={onRetry} className="text-[11.5px] text-fog-500 hover:text-fog-100">
          Refaire le questionnaire
        </button>
      </div>

      {rec.provider === 'anthropic' ? (
        <div className="text-[14px] font-semibold text-fog-100">Claude</div>
      ) : rec.pick ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-fog-100">{rec.pick.label}</span>
          <span className="text-[11.5px] text-fog-500">
            {rec.pick.maker} · {gb(rec.pick.sizeGb)}
          </span>
          <ModelBadges m={{ tools: true, vision: rec.pick.vision, thinking: rec.pick.thinking }} />
        </div>
      ) : (
        <div className="text-[13px] font-semibold text-fog-100">Pas de modèle local adapté à ce PC</div>
      )}

      <ul className="mt-2 space-y-1">
        {rec.reasons.map((r) => (
          <li key={r} className="flex gap-2 text-[12px] leading-snug text-fog-300">
            <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[var(--led)]" />
            {r}
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {rec.provider === 'anthropic' ? (
          <Button size="sm" variant="primary" onClick={onUseClaude}>
            <Check size={12} /> Utiliser Claude
          </Button>
        ) : (
          rec.pick && action(rec.pick, true)
        )}
        {!inline && rec.provider === 'local' && rec.pick && !installed(rec.pick.id) && !engineReady && (
          <span className="text-[11.5px] text-fog-500">Installe d’abord le moteur ci-dessous.</span>
        )}
        {lmstudio && rec.pick && !installed(rec.pick.id) && (
          <span className="text-[11.5px] text-fog-500">Télécharge-le dans LM Studio, puis choisis-le dans « Sur ce PC ».</span>
        )}
      </div>
      {inline && rec.provider === 'local' && rec.pick && !engineReady && (
        <div className="mt-2.5 rounded-xl bg-black/25 p-3">
          <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-fog-500 uppercase">D’abord, le moteur</div>
          <EngineCard local={local} />
        </div>
      )}
      {inline && local.pull && rec.provider === 'local' && (
        <div className="mt-2.5">
          <PullBar pull={local.pull} />
        </div>
      )}

      {rec.alternatives.length > 0 && (
        <div className="mt-2.5 border-t border-white/[0.06] pt-2">
          <button onClick={() => setMore(!more)} className="inline-flex items-center gap-1 text-[11.5px] text-fog-500 hover:text-fog-100">
            <ChevronDown size={12} className={cx('transition-transform', more && 'rotate-180')} />{' '}
            {rec.provider === 'anthropic' ? 'Rester en local' : 'Autres choix'}
          </button>
          <AnimatePresence>
            {more && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="space-y-1.5 pt-2">
                  {rec.alternatives.map((m) => (
                    <div key={m.id} className="flex items-center gap-2.5 rounded-xl bg-black/20 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] text-fog-100">
                          {m.label} <span className="text-[11px] text-fog-500">· {gb(m.sizeGb)}</span>
                        </div>
                        <div className="text-[11.5px] leading-snug text-fog-500">{m.why}</div>
                      </div>
                      {action(m, false)}
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </motion.div>
  )
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function BrainSection({ s, apply, update }: { s: PublicSettings; apply: Apply; update: Update }) {
  const pickBrain = useCompi((st) => st.pickBrain)
  const focus = useCompi((st) => st.settingsFocus)
  const focusSettings = useCompi((st) => st.focusSettings)
  const [quiz, setQuiz] = useState(false)
  const [rec, setRec] = useState<BrainRecommendation | null>(null)
  const [pendingModel, setPendingModel] = useState<string | null>(null)
  const [error, setError] = useState('')
  const local = useLocal(s.provider === 'local' || Boolean(rec) || quiz)

  // « Aide-moi à choisir » depuis l'écran d'accueil.
  useEffect(() => {
    if (focus === 'quiz') {
      setQuiz(true)
      focusSettings(null)
    }
  }, [focus, focusSettings])

  const pickLocal = useCallback(
    (model: string, fromRec?: { cloudHelp: boolean; effort: Effort }) => {
      const st = local.status
      setError('')
      pickBrain(
        { provider: 'local', model },
        {
          local: {
            ...s.local,
            engine: st?.engine ?? s.local.engine,
            baseUrl: st?.baseUrl ?? s.local.baseUrl,
            cloudHelp: fromRec?.cloudHelp ?? s.local.cloudHelp,
            effort: fromRec?.effort ?? s.local.effort,
            model
          }
        }
      ).catch((e: Error) => setError(cleanError(e)))
    },
    [local.status, pickBrain, s.local]
  )

  // Un modèle conseillé vient d'être téléchargé : on l'utilise aussitôt.
  useEffect(() => {
    if (pendingModel && local.status?.models.some((m) => m.name === pendingModel || m.name === `${pendingModel}:latest`)) {
      pickLocal(local.status.models.find((m) => m.name === pendingModel || m.name === `${pendingModel}:latest`)!.name, rec ?? undefined)
      setPendingModel(null)
    }
  }, [pendingModel, local.status, pickLocal, rec])

  const install = (m: CatalogModel): void => {
    const existing = local.status?.models.find((x) => x.name === m.id || x.name === `${m.id}:latest`)
    if (existing) return pickLocal(existing.name, rec ?? undefined)
    setPendingModel(m.id)
    void window.compi.pullModel(m.id)
  }

  const current = defaultBrain(s)
  const missing = brainMissing(current, s)

  return (
    <section className="space-y-2.5">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <div>
          <h3 className="led-text text-[11px] text-fog-500">Cerveau</h3>
          <p className="mt-0.5 text-[11.5px] text-fog-700">
            Le modèle qui réfléchit pour moi. Tu peux en changer à tout moment, même depuis la zone de saisie.
          </p>
        </div>
        {!quiz && (
          <Button size="sm" variant="ghost" onClick={() => setQuiz(true)}>
            <Wand2 size={12} /> Aide-moi à choisir
          </Button>
        )}
      </div>

      {quiz && (
        <BrainQuiz
          initial={s.brainQuiz}
          onCancel={() => setQuiz(false)}
          onResult={(r) => {
            setRec(r)
            setQuiz(false)
          }}
        />
      )}
      {rec && !quiz && (
        <Recommendation
          rec={rec}
          local={local}
          inline={s.provider !== 'local'}
          onRetry={() => setQuiz(true)}
          onUseClaude={() => update({ provider: 'anthropic', local: { ...s.local, cloudHelp: rec.cloudHelp } })}
          onInstall={(m) => {
            if (s.provider !== 'local') update({ provider: 'local', local: { ...s.local, cloudHelp: rec.cloudHelp, effort: rec.effort } })
            install(m)
          }}
        />
      )}

      <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
        <div className="px-3.5 pt-3">
          <Segmented value={s.provider} options={PROVIDERS} onChange={(provider) => update({ provider })} />
          <div className={cx('mt-2 flex items-center gap-1.5 text-[11.5px]', missing ? 'text-led-amber' : 'text-fog-500')}>
            {missing ? <TriangleAlert size={12} /> : <Check size={12} className="text-led-green" />}
            {missing ?? `J’utilise ${brainLabel(current, s)}${s.provider === 'local' ? ', 100 % sur ton PC' : ''}.`}
          </div>
          {error && <div className="mt-1 text-[11.5px] text-led-red">{error}</div>}
        </div>
        <div className="mt-2 border-t border-white/[0.05]" />
        {s.provider === 'anthropic' && <ClaudePanel s={s} apply={apply} update={update} />}
        {s.provider === 'local' && <LocalPanel s={s} update={update} local={local} onPick={(m) => pickLocal(m)} />}
        {s.provider === 'custom' && <CustomPanel s={s} apply={apply} update={update} />}
      </div>
    </section>
  )
}
