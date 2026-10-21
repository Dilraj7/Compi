// Routines dans « Aujourd'hui » : une demande que Compi exécute seul, à heure
// fixe (« chaque lundi à 9 h, résume mes e-mails »), puis te notifie.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { CircleAlert, CircleCheck, Pencil, Play, Plus, Repeat, Square, X } from 'lucide-react'
import { brainLabel, defaultBrain } from '@shared/brains'
import { repeatLabel } from '@shared/day'
import { PRIVACY_CATEGORIES, type PrivacyCategory } from '@shared/privacy'
import { ROUTINE_PROMPT_MAX, ROUTINE_TITLE_MAX } from '@shared/routines'
import type { ReminderRepeat, Routine, RoutineDraft } from '@shared/types'
import { useCompi } from '../store'
import { Button, cx, IconButton, LedDots, Segmented, TextArea, TextInput, timeAgo, Toggle } from '../components/ui'

const COLOR = '#2DD4BF'
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

type Kind = ReminderRepeat['every']
/** Lundi d'abord, comme sur un calendrier français. */
const WEEK = [
  { d: 1, l: 'L' },
  { d: 2, l: 'M' },
  { d: 3, l: 'M' },
  { d: 4, l: 'J' },
  { d: 5, l: 'V' },
  { d: 6, l: 'S' },
  { d: 0, l: 'D' }
]
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/** Données dont une routine a souvent besoin. */
const ROUTINE_DATA: PrivacyCategory[] = ['mail', 'calendar', 'files', 'memory']

const EXAMPLES: Array<{ title: string; prompt: string; repeat: ReminderRepeat }> = [
  { title: 'Résumé des e-mails', prompt: 'Résume mes e-mails non lus importants en quelques lignes, et dis-moi lesquels attendent une réponse.', repeat: { every: 'weekdays', time: '08:30' } },
  { title: 'Ma semaine', prompt: 'Prépare ma semaine : mes rendez-vous jour par jour, mes rappels, et ce qui demande de l’attention.', repeat: { every: 'week', days: [1], time: '08:00' } },
  { title: 'Demain', prompt: 'Qu’est-ce qui m’attend demain ? Agenda, météo et rappels, en bref.', repeat: { every: 'day', time: '19:00' } }
]

interface Draft {
  id?: string
  title: string
  prompt: string
  kind: Kind
  time: string
  days: number[]
  day: number
  enabled?: boolean
}

const emptyDraft = (): Draft => ({ title: '', prompt: '', kind: 'weekdays', time: '08:30', days: [1], day: 1 })

function toDraft(r: { id?: string; title: string; prompt: string; repeat: ReminderRepeat; enabled?: boolean }): Draft {
  const rep = r.repeat
  return {
    id: r.id,
    title: r.title,
    prompt: r.prompt,
    kind: rep.every,
    time: rep.time,
    days: rep.every === 'week' ? rep.days : [1],
    day: rep.every === 'month' ? rep.day : 1,
    enabled: r.enabled
  }
}

function repeatOf(d: Draft): ReminderRepeat {
  switch (d.kind) {
    case 'week':
      return { every: 'week', days: d.days.length ? d.days : [1], time: d.time }
    case 'month':
      return { every: 'month', day: Math.min(31, Math.max(1, Math.round(d.day) || 1)), time: d.time }
    default:
      return { every: d.kind, time: d.time }
  }
}

const cleanError = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function RoutineForm({ initial, onDone }: { initial: Draft; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<Draft>): void => {
    setD((x) => ({ ...x, ...patch }))
    setError(null)
  }

  const save = async (): Promise<void> => {
    const draft: RoutineDraft = { ...(d.id ? { id: d.id } : {}), title: d.title, prompt: d.prompt, repeat: repeatOf(d), enabled: d.enabled ?? true }
    try {
      await window.compi.saveRoutine(draft)
      onDone()
    } catch (e) {
      setError(cleanError(e))
    }
  }

  return (
    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
      <div className="space-y-2.5 border-b border-white/[0.05] px-3.5 py-3">
        {!d.id && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.title}
                className="rounded-lg bg-white/[0.05] px-2 py-1 text-[11px] text-fog-300 ring-1 ring-inset ring-white/[0.05] transition-colors hover:bg-white/[0.09] hover:text-fog-100"
                onClick={() => set({ ...toDraft(ex), id: undefined })}
              >
                {ex.title} · {repeatLabel(ex.repeat)}
              </button>
            ))}
          </div>
        )}
        <TextArea
          rows={3}
          autoFocus
          value={d.prompt}
          maxLength={ROUTINE_PROMPT_MAX}
          placeholder="Ce que je dois faire, par exemple « Résume mes e-mails non lus importants »"
          onChange={(e) => set({ prompt: e.target.value })}
        />
        <TextInput value={d.title} maxLength={ROUTINE_TITLE_MAX} placeholder="Nom (facultatif)" onChange={(e) => set({ title: e.target.value })} />
        <Segmented<Kind>
          id="routine-kind"
          value={d.kind}
          onChange={(kind) => set({ kind })}
          options={[
            { value: 'day', label: 'Chaque jour' },
            { value: 'weekdays', label: 'Jours ouvrés' },
            { value: 'week', label: 'Semaine' },
            { value: 'month', label: 'Mois' }
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          {d.kind === 'week' &&
            WEEK.map(({ d: day, l }) => {
              const on = d.days.includes(day)
              return (
                <button
                  key={day}
                  title={DAY_NAMES[day]}
                  aria-pressed={on}
                  onClick={() => set({ days: on ? d.days.filter((x) => x !== day) : [...d.days, day] })}
                  className={cx(
                    'grid size-7 place-items-center rounded-lg text-[11.5px] font-semibold ring-1 ring-inset transition-colors',
                    on ? 'text-black ring-transparent' : 'bg-white/[0.05] text-fog-500 ring-white/[0.06] hover:text-fog-100'
                  )}
                  style={on ? { background: COLOR } : undefined}
                >
                  {l}
                </button>
              )
            })}
          {d.kind === 'month' && (
            <label className="flex items-center gap-1.5 text-[12px] text-fog-500">
              le
              <TextInput type="number" min={1} max={31} className="w-16" value={d.day} onChange={(e) => set({ day: Number(e.target.value) })} />
            </label>
          )}
          <label className="flex items-center gap-1.5 text-[12px] text-fog-500">
            à
            <TextInput type="time" className="w-28 [color-scheme:dark]" value={d.time} onChange={(e) => e.target.value && set({ time: e.target.value })} />
          </label>
        </div>
        {error && <div className="text-[11.5px] text-led-amber">{error}</div>}
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="primary" accent={COLOR} disabled={!d.prompt.trim() || (d.kind === 'week' && !d.days.length)} onClick={() => void save()}>
            {d.id ? 'Enregistrer' : 'Créer la routine'}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDone}>
            Annuler
          </Button>
        </div>
      </div>
    </motion.div>
  )
}

function RoutineRow({ r, onEdit }: { r: Routine; onEdit: () => void }) {
  const loadConversation = useCompi((s) => s.loadConversation)
  const setView = useCompi((s) => s.setView)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(t)
  }, [armed])

  const next = new Date(r.nextAt)
  const today = next.toDateString() === new Date().toDateString()
  const openRun = (): void => {
    if (!r.lastRun?.conversationId) return
    void loadConversation(r.lastRun.conversationId).then(() => setView('chat'))
  }

  return (
    <div className={cx('group flex items-center gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]', !r.enabled && 'opacity-55')}>
      <div className="w-[52px] shrink-0 text-right text-[12px] text-fog-100 tabular-nums">
        {r.running ? <LedDots color={COLOR} /> : r.enabled ? (today ? TIME.format(next) : SHORT_DAY.format(next)) : <span className="text-[11px] text-fog-500">pause</span>}
      </div>
      <span className="h-8 w-[3px] shrink-0 rounded-full" style={{ background: r.running ? COLOR : 'rgb(255 255 255 / 0.12)', boxShadow: r.running ? `0 0 8px ${COLOR}` : undefined }} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] text-fog-100" title={r.prompt}>
          {r.title}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-[11px] text-fog-500">
          <Repeat size={10} className="shrink-0" />
          <span className="truncate">{r.running ? 'En cours…' : repeatLabel(r.repeat)}</span>
          {r.lastRun && !r.running && (
            <button
              className={cx('flex shrink-0 items-center gap-1 truncate', r.lastRun.conversationId && 'hover:text-fog-100')}
              title={r.lastRun.ok ? r.lastRun.preview : r.lastRun.error}
              onClick={openRun}
            >
              ·{' '}
              {r.lastRun.ok ? <CircleCheck size={10} className="text-led-green" /> : <CircleAlert size={10} className="text-led-amber" />}
              {timeAgo(r.lastRun.at)}
            </button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {r.running ? (
          <Button size="sm" variant="ghost" onClick={() => void window.compi.stopRoutine(r.id)}>
            <Square size={11} /> Arrêter
          </Button>
        ) : (
          <div className="flex items-center opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <IconButton label="Lancer maintenant" onClick={() => void window.compi.runRoutine(r.id)}>
              <Play size={13} />
            </IconButton>
            <IconButton label="Modifier" onClick={onEdit}>
              <Pencil size={13} />
            </IconButton>
            <IconButton
              label={armed ? 'Cliquer encore pour supprimer' : 'Supprimer'}
              className={armed ? 'text-led-red hover:text-led-red' : undefined}
              onClick={() => (armed ? void window.compi.deleteRoutine(r.id) : setArmed(true))}
            >
              <X size={14} />
            </IconButton>
          </div>
        )}
        <Toggle
          checked={r.enabled}
          label={r.enabled ? 'Mettre en pause' : 'Réactiver'}
          onChange={(enabled) => void window.compi.saveRoutine({ id: r.id, title: r.title, prompt: r.prompt, repeat: r.repeat, enabled })}
        />
      </div>
    </div>
  )
}

export function RoutinesSection() {
  const settings = useCompi((s) => s.settings)
  const setView = useCompi((s) => s.setView)
  const [routines, setRoutines] = useState<Routine[]>([])
  const [form, setForm] = useState<Draft | null>(null)

  useEffect(() => {
    void window.compi.routines().then(setRoutines)
    return window.compi.onRoutines(setRoutines)
  }, [])

  if (!settings) return null
  const brain = defaultBrain(settings)
  const label = brainLabel(brain, settings)
  const missing = ROUTINE_DATA.filter((c) => settings.privacy[c] !== 'always').map((c) => PRIVACY_CATEGORIES.find((x) => x.id === c)!.label.toLowerCase())

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-0.5">
        <h3 className="led-text flex items-center gap-1.5 text-[11px] text-fog-500">
          <Repeat size={12} /> Routines
        </h3>
        {!form && (
          <Button size="sm" variant="ghost" onClick={() => setForm(emptyDraft())}>
            <Plus size={12} /> Nouvelle
          </Button>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
        <AnimatePresence initial={false}>{form && <RoutineForm key={form.id ?? 'new'} initial={form} onDone={() => setForm(null)} />}</AnimatePresence>
        {routines.map((r) => (
          <RoutineRow key={r.id} r={r} onEdit={() => setForm(toDraft(r))} />
        ))}
        {!routines.length && !form && (
          <div className="px-3.5 py-3 text-[12px] leading-snug text-fog-500">
            Aucune routine. Je peux faire une demande seul, à heure fixe, puis te prévenir : « chaque lundi à 9 h, résume mes e-mails ».
          </div>
        )}
        {(form || routines.length > 0) && (
          <div className="space-y-1 border-t border-white/[0.05] bg-white/[0.015] px-3.5 py-2 text-[11px] leading-snug text-fog-500">
            <div>
              Je les fais seul avec {label} : je lis ce qui est autorisé, je n’agis jamais (pas de brouillon, pas de rendez-vous) et je te dis ce qu’il faudrait faire.
            </div>
            {brain.provider !== 'local' && missing.length > 0 && (
              <div className="text-led-amber/90">
                Pas d’accès pour l’instant à : {missing.join(', ')}. En ton absence, je n’utilise que les données réglées sur « Toujours ».{' '}
                <button className="underline decoration-current/30 underline-offset-2 hover:decoration-current" onClick={() => setView('settings')}>
                  Réglages › Confidentialité
                </button>
              </div>
            )}
            {brain.provider === 'anthropic' && <div>Chaque exécution consomme des crédits Claude.</div>}
            {brain.provider === 'custom' && <div>Chaque exécution est facturée par {settings.custom.name || 'ton service'}.</div>}
            {brain.provider === 'local' && <div>Avec ton cerveau local, tout reste sur ton PC.</div>}
          </div>
        )}
      </div>
    </section>
  )
}
