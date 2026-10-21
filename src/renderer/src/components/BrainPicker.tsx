// Choisir son cerveau à tout moment : pastille dans la zone de saisie, puce
// sous l'accueil, et cartes « Choisis mon cerveau » au premier lancement.

import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, ChevronDown, Cloud, Lock, Settings2, Sparkles, Wand2 } from 'lucide-react'
import { brainLabel, brainMissing, CLAUDE_MODELS, defaultBrain } from '@shared/brains'
import type { Brain, LocalStatus, ProviderId, Settings } from '@shared/types'
import { useCompi } from '../store'
import { cx } from './ui'

export function BrainIcon({ provider, size = 11 }: { provider: ProviderId; size?: number }) {
  if (provider === 'local') return <Lock size={size} />
  if (provider === 'custom') return <Cloud size={size} />
  return <Sparkles size={size} />
}

function Item({ label, hint, active, disabled, onClick }: { label: string; hint?: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors disabled:opacity-40',
        active ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'
      )}
    >
      <span className="grid size-3.5 shrink-0 place-items-center text-[var(--led)]">{active && <Check size={12} strokeWidth={3} />}</span>
      <span className="min-w-0 flex-1 truncate text-[12px] text-fog-100">{label}</span>
      {hint && <span className="shrink-0 text-[10.5px] text-fog-500">{hint}</span>}
    </button>
  )
}

function Group({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-1.5 px-2 pb-0.5 text-[10.5px] font-semibold tracking-wide text-fog-500 uppercase">
        {icon} {title}
      </div>
      {children}
    </div>
  )
}

/** Pastille de la zone de saisie : le cerveau de la discussion, modifiable d'un clic. */
export function BrainPicker() {
  const s = useCompi((st) => st.settings)
  const conversationBrain = useCompi((st) => st.conversationBrain)
  const pickBrain = useCompi((st) => st.pickBrain)
  const open = useCompi((st) => st.open)
  const [show, setShow] = useState(false)
  const [local, setLocal] = useState<LocalStatus | null>(null)

  useEffect(() => {
    if (show) void window.compi.localStatus().then(setLocal)
  }, [show])

  if (!s) return null
  const brain = conversationBrain ?? defaultBrain(s)
  const same = (b: Brain): boolean => b.provider === brain.provider && b.model === brain.model
  const choose = (b: Brain, extra?: Partial<Settings>): void => {
    setShow(false)
    if (!same(b)) void pickBrain(b, extra)
  }
  const manage = (): void => {
    setShow(false)
    open('settings')
  }
  const localModels = local?.running ? local.models.filter((m) => m.tools) : []

  return (
    <div className="relative shrink-0">
      <button
        onClick={() => setShow(!show)}
        title="Changer de cerveau"
        className={cx(
          'flex h-8 max-w-[150px] items-center gap-1 rounded-xl px-2 text-[11.5px] transition-colors',
          show ? 'bg-white/[0.08] text-fog-100' : 'text-fog-500 hover:bg-white/[0.06] hover:text-fog-100'
        )}
      >
        <BrainIcon provider={brain.provider} />
        <span className="truncate">{brainLabel(brain, s)}</span>
        <ChevronDown size={11} className={cx('shrink-0 transition-transform', show && 'rotate-180')} />
      </button>
      <AnimatePresence>
        {show && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShow(false)} />
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="absolute bottom-10 left-0 z-20 w-64 origin-bottom-left rounded-2xl bg-ink-900/95 p-1.5 shadow-[0_18px_40px_-12px_rgb(0_0_0/0.8)] ring-1 ring-inset ring-white/[0.1] backdrop-blur"
            >
              <Group title="Claude" icon={<Sparkles size={10} />}>
                {CLAUDE_MODELS.map((m) => (
                  <Item
                    key={m.value}
                    label={m.label}
                    hint={m.hint}
                    disabled={!s.hasApiKey}
                    active={same({ provider: 'anthropic', model: m.value })}
                    onClick={() => choose({ provider: 'anthropic', model: m.value })}
                  />
                ))}
                {!s.hasApiKey && <div className="px-2 pt-0.5 text-[10.5px] text-fog-700">Ajoute une clé Claude dans les réglages.</div>}
              </Group>
              <Group title="Sur ce PC · privé" icon={<Lock size={10} />}>
                {local === null ? (
                  <div className="px-2 py-1 text-[11.5px] text-fog-700">Je regarde…</div>
                ) : localModels.length ? (
                  localModels.map((m) => (
                    <Item
                      key={m.name}
                      label={m.name}
                      hint={m.vision ? 'vision' : undefined}
                      active={same({ provider: 'local', model: m.name })}
                      onClick={() =>
                        choose(
                          { provider: 'local', model: m.name },
                          { local: { ...s.local, engine: local.engine ?? s.local.engine, baseUrl: local.baseUrl, model: m.name } }
                        )
                      }
                    />
                  ))
                ) : (
                  <Item label={local.running ? 'Installer un modèle…' : 'Installer un modèle local…'} onClick={manage} />
                )}
              </Group>
              {s.custom.baseUrl && s.custom.model && (
                <Group title={s.custom.name || 'Autre service'} icon={<Cloud size={10} />}>
                  <Item label={s.custom.model} active={same({ provider: 'custom', model: s.custom.model })} onClick={() => choose({ provider: 'custom', model: s.custom.model })} />
                </Group>
              )}
              <div className="mt-0.5 border-t border-white/[0.06] pt-1">
                <button onClick={manage} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[11.5px] text-fog-500 hover:bg-white/[0.05] hover:text-fog-100">
                  <Settings2 size={12} /> Gérer les cerveaux…
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Puce discrète sous l'accueil : quel cerveau répond. */
export function BrainChip() {
  const s = useCompi((st) => st.settings)
  if (!s) return null
  const brain = defaultBrain(s)
  return (
    <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/[0.05] px-2.5 py-1 text-[11px] text-fog-500 ring-1 ring-inset ring-white/[0.06]">
      <BrainIcon provider={brain.provider} size={10} />
      {brainLabel(brain, s)}
      {brain.provider === 'local' && <span className="text-fog-700">· 100 % sur ton PC</span>}
    </span>
  )
}

/** Le cerveau par défaut est prêt (clé, modèle ou service configuré). */
export function useBrainReady(): boolean {
  const s = useCompi((st) => st.settings)
  if (!s) return true
  return !brainMissing(defaultBrain(s), s)
}

const WELCOME: Array<{ provider: ProviderId; title: string; hint: string }> = [
  { provider: 'anthropic', title: 'Claude', hint: 'Le plus intelligent · en ligne, payant à l’usage' },
  { provider: 'local', title: 'Sur ce PC', hint: 'Privé et gratuit · moins puissant' },
  { provider: 'custom', title: 'Autre service', hint: 'OpenRouter, DeepSeek, serveur maison…' }
]

/** Premier lancement : trois cartes pour choisir son cerveau, ou le questionnaire. */
export function WelcomeBrains() {
  const setSettings = useCompi((st) => st.setSettings)
  const open = useCompi((st) => st.open)
  const focusSettings = useCompi((st) => st.focusSettings)
  return (
    <div className="mt-5 w-full max-w-[540px]">
      <div className="mb-2 text-center text-[12.5px] text-fog-300">D’abord, choisis mon cerveau :</div>
      <div className="grid grid-cols-3 gap-2">
        {WELCOME.map((c, i) => (
          <motion.button
            key={c.provider}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.28 + i * 0.05 } }}
            onClick={() => {
              void window.compi.updateSettings({ provider: c.provider }).then(setSettings)
              open('settings')
            }}
            className="group rounded-2xl bg-white/[0.04] p-3 text-left ring-1 ring-inset ring-white/[0.06] transition-all hover:-translate-y-px hover:bg-white/[0.07]"
          >
            <span className="mb-1.5 grid size-7 place-items-center rounded-lg bg-[var(--led)]/10 text-[var(--led)]">
              <BrainIcon provider={c.provider} size={14} />
            </span>
            <span className="block text-[12.5px] font-semibold text-fog-100">{c.title}</span>
            <span className="block text-[11px] leading-snug text-fog-500">{c.hint}</span>
          </motion.button>
        ))}
      </div>
      <button
        onClick={() => {
          focusSettings('quiz')
          open('settings')
        }}
        className="mx-auto mt-3 flex items-center gap-1.5 text-[12px] text-[var(--led)] hover:underline"
      >
        <Wand2 size={12} /> Je ne sais pas : aide-moi à choisir
      </button>
    </div>
  )
}
