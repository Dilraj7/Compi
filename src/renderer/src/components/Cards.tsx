import { forwardRef, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bot, Check, CheckCircle2, CircleDashed, Cloud, Hourglass, MessageCircleQuestion, ShieldQuestion, TerminalSquare } from 'lucide-react'
import type { ApprovalRequest, ClaudeSession, QuestionRequest } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, LedDots, cx, prettyShortcut, timeAgo } from './ui'

const AMBER = '#FBBF24'

interface ShellProps {
  children: ReactNode
  accent?: string
  pulse?: boolean
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  onFocusChange?: (focused: boolean) => void
  label?: string
}

const CardShell = forwardRef<HTMLDivElement, ShellProps>(function CardShell({ children, accent = AMBER, pulse, onKeyDown, onFocusChange, label }, ref) {
  return (
    <motion.div
      ref={ref}
      layout
      tabIndex={onKeyDown ? 0 : undefined}
      role={onKeyDown ? 'group' : undefined}
      aria-label={label}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && onFocusChange?.(true)}
      onBlur={(e) => e.target === e.currentTarget && onFocusChange?.(false)}
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      className={cx(
        'relative overflow-hidden rounded-2xl bg-ink-850 p-3.5 outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--accent),0_0_34px_-10px_var(--accent)]',
        pulse && 'scanline'
      )}
      style={{
        ['--accent' as string]: accent,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${accent} 35%, transparent), 0 0 30px -14px ${accent}`
      }}
    >
      {children}
    </motion.div>
  )
})

/** Petit repère de touche sur un bouton, quand la carte a le clavier. */
function Kbd({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null
  return <kbd className="ml-1 rounded-[5px] bg-black/25 px-1 py-px font-mono text-[9.5px] leading-none font-semibold opacity-80">{children}</kbd>
}

const typing = (e: KeyboardEvent): boolean => e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey

/**
 * Une lettre tapée alors qu'une carte a le clavier : l'utilisateur voulait
 * écrire. Le clavier repart dans la saisie de la discussion (si elle est là),
 * pour que l'Entrée suivante envoie le message au lieu d'autoriser.
 */
function backToComposer(): void {
  document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus()
}

interface CardKeys {
  /** Rappel des raccourcis globaux sous la carte (première carte seulement). */
  hint?: string
}

export const ApprovalCard = forwardRef<HTMLDivElement, { a: ApprovalRequest; onDecide: (d: 'allow' | 'deny' | 'always') => void } & CardKeys>(
  function ApprovalCard({ a, onDecide, hint }, ref) {
    const [busy, setBusy] = useState(false)
    const [keys, setKeys] = useState(false)
    const decide = (d: 'allow' | 'deny' | 'always'): void => {
      if (busy) return
      setBusy(true)
      onDecide(d)
    }
    const fromClaude = a.source === 'claude-code'
    // Cerveau local : accord avant d'envoyer un scan ou une image à Claude.
    const cloud = a.toolName === 'compi:cloud_help'
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        // Refuser, sans refermer le panneau.
        e.preventDefault()
        e.stopPropagation()
        decide('deny')
        return
      }
      // Entrée sur un bouton de la carte : c'est le bouton qui répond.
      if (e.target !== e.currentTarget) return
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        if (a.canAlwaysAllow) decide('always')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        decide('allow')
      } else if (typing(e)) backToComposer()
    }
    return (
      <CardShell ref={ref} pulse onKeyDown={onKeyDown} onFocusChange={setKeys} label={`Demande : ${a.title}`}>
        <div className="relative flex items-start gap-3">
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-led-amber/12 text-led-amber">
            {fromClaude ? <TerminalSquare size={16} /> : cloud ? <Cloud size={16} /> : <ShieldQuestion size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge color={AMBER}>{fromClaude ? `Claude Code${a.sessionLabel ? ` · ${a.sessionLabel}` : ''}` : 'Compi'}</Badge>
              <span className="text-[11px] text-fog-700">{timeAgo(a.createdAt)}</span>
            </div>
            <div className="mt-1.5 text-[13.5px] font-medium text-fog-100">{a.title}</div>
            {a.detail && cloud && <div className="mt-1 text-[12px] leading-snug text-fog-500">{a.detail} Rien d’autre ne quitte ton PC.</div>}
            {a.destination && (
              <div className="mt-1.5 flex items-center gap-1.5 text-[12px] text-fog-500">
                <Cloud size={12} className="shrink-0 text-led-amber" /> Le contenu partira vers {a.destination}.
              </div>
            )}
            {a.detail && !cloud && (
              <div className="mt-2 max-h-24 overflow-auto rounded-xl bg-black/60 px-2.5 py-2 font-mono text-[11.5px] leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap text-fog-300 ring-1 ring-inset ring-white/[0.06] select-text">
                {a.detail}
              </div>
            )}
            <div className="mt-3 flex items-center justify-end gap-1.5">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('deny')}>
                {cloud ? 'Garder en local' : 'Refuser'}
                <Kbd show={keys}>Échap</Kbd>
              </Button>
              {a.canAlwaysAllow && (
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={busy}
                  onClick={() => decide('always')}
                  title={
                    a.alwaysRule
                      ? a.source === 'claude-code'
                        ? `${a.alwaysRule} (règle de Claude Code, à retirer avec /permissions)`
                        : a.alwaysRule
                      : a.destination
                        ? `Toujours autoriser ce type de donnée vers ${a.destination} (modifiable dans Réglages › Confidentialité)`
                        : 'Ne plus demander pour cet outil'
                  }
                >
                  Toujours
                  <Kbd show={keys}>Maj+Entrée</Kbd>
                </Button>
              )}
              <Button size="sm" variant="primary" accent={AMBER} disabled={busy} onClick={() => decide('allow')}>
                <Check size={13} strokeWidth={2.6} /> {cloud ? 'Envoyer à Claude' : 'Autoriser'}
                <Kbd show={keys}>Entrée</Kbd>
              </Button>
            </div>
            {hint && <div className="mt-2 text-right text-[10.5px] text-fog-700">{hint}</div>}
          </div>
        </div>
      </CardShell>
    )
  }
)

export const QuestionCard = forwardRef<HTMLDivElement, { q: QuestionRequest; onAnswer: (answers: Record<string, string> | null) => void }>(
  function QuestionCard({ q, onAnswer }, ref) {
    const [picked, setPicked] = useState<Record<string, string[]>>({})
    const [keys, setKeys] = useState(false)
    const complete = q.questions.every((item) => (picked[item.question] ?? []).length > 0)
    const submit = (): void => {
      if (complete) onAnswer(Object.fromEntries(Object.entries(picked).map(([k, v]) => [k, v.join(', ')])))
    }
    // Les chiffres choisissent dans la première question sans réponse (ou la dernière).
    const current = q.questions.find((item) => !(picked[item.question] ?? []).length) ?? q.questions.at(-1)
    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onAnswer(null)
        return
      }
      if (e.target !== e.currentTarget) return
      // Par la position de la touche (AZERTY : « & » pour 1).
      const n = Number(/^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1] ?? NaN)
      if (current && n >= 1 && n <= current.options.length && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        toggle(current.question, current.options[n - 1].label, current.multiSelect)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      } else if (typing(e)) backToComposer()
    }

    const toggle = (question: string, label: string, multi: boolean): void =>
      setPicked((p) => {
        const cur = p[question] ?? []
        const next = multi ? (cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]) : [label]
        return { ...p, [question]: next }
      })

    return (
      <CardShell ref={ref} pulse onKeyDown={onKeyDown} onFocusChange={setKeys} label="Question de Claude Code">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-led-amber/12 text-led-amber">
            <MessageCircleQuestion size={15} />
          </span>
          <Badge color={AMBER}>Claude Code · {q.sessionLabel}</Badge>
          <span className="text-[11px] text-fog-700">{timeAgo(q.createdAt)}</span>
        </div>
        <div className="mt-3 space-y-3.5">
          {q.questions.map((item) => (
            <div key={item.question}>
              <div className="text-[13px] font-medium text-fog-100">
                <span className="led-text mr-2 text-[10.5px] text-led-amber">{item.header}</span>
                {item.question}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {item.options.map((o, i) => {
                  const on = (picked[item.question] ?? []).includes(o.label)
                  return (
                    <button
                      key={o.label}
                      onClick={() => toggle(item.question, o.label, item.multiSelect)}
                      className={cx(
                        'rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-all',
                        on ? 'bg-led-amber/12 ring-led-amber/60' : 'bg-white/[0.03] ring-white/[0.07] hover:bg-white/[0.06]'
                      )}
                    >
                      <div className={cx('text-[12.5px] font-medium', on ? 'text-led-amber' : 'text-fog-100')}>
                        {keys && item === current && i < 9 && <span className="mr-1.5 font-mono text-[10.5px] text-fog-500">{i + 1}</span>}
                        {o.label}
                      </div>
                      {o.description && <div className="mt-0.5 text-[11px] leading-snug text-fog-500">{o.description}</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3.5 flex items-center justify-end gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => onAnswer(null)}>
            Répondre dans le terminal
            <Kbd show={keys}>Échap</Kbd>
          </Button>
          <Button size="sm" variant="primary" accent={AMBER} disabled={!complete} onClick={submit}>
            Envoyer
            <Kbd show={keys}>Entrée</Kbd>
          </Button>
        </div>
      </CardShell>
    )
  }
)

const STATUS_META: Record<ClaudeSession['status'], { label: string; color: string; Icon: typeof Bot }> = {
  working: { label: 'Au travail', color: '#A78BFA', Icon: Bot },
  waiting: { label: 'Attend ta réponse', color: AMBER, Icon: Hourglass },
  idle: { label: 'En attente', color: '#868695', Icon: CircleDashed },
  done: { label: 'Terminé', color: '#4ADE80', Icon: CheckCircle2 },
  ended: { label: 'Fermée', color: '#575766', Icon: CircleDashed }
}

export function SessionCard({ s }: { s: ClaudeSession }) {
  const meta = STATUS_META[s.status]
  const totals = s.edits.reduce((acc, e) => ({ added: acc.added + e.added, removed: acc.removed + e.removed }), { added: 0, removed: 0 })
  const [open, setOpen] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl bg-ink-850/90 p-3.5 ring-1 ring-inset ring-white/[0.06]"
    >
      <div className="flex items-center gap-2.5">
        <span
          className="grid size-8 place-items-center rounded-xl"
          style={{ background: `color-mix(in oklab, ${meta.color} 14%, transparent)`, color: meta.color }}
        >
          <TerminalSquare size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-fog-100">{s.project}</span>
            <Badge color={meta.color}>
              {s.status === 'working' ? <LedDots color={meta.color} /> : <meta.Icon size={11} />}
              {meta.label}
            </Badge>
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-fog-700">{s.cwd}</div>
        </div>
        <span className="shrink-0 text-[11px] text-fog-700">{timeAgo(s.updatedAt)}</span>
      </div>

      {(s.currentTool || s.lastMessage || s.lastPrompt) && (
        <div className="mt-2.5 text-[12px] leading-relaxed text-fog-300">
          {s.status === 'working' && s.currentTool ? (
            <span className="text-led-violet">› {s.currentTool}</span>
          ) : s.lastMessage ? (
            <span className="line-clamp-2">{s.lastMessage}</span>
          ) : (
            <span className="line-clamp-2 text-fog-500">« {s.lastPrompt} »</span>
          )}
        </div>
      )}

      {s.edits.length > 0 && (
        <div className="mt-2.5">
          <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-[11.5px] text-fog-500 hover:text-fog-300">
            <span>
              {s.edits.length} fichier{s.edits.length > 1 ? 's' : ''} modifié{s.edits.length > 1 ? 's' : ''}
            </span>
            <span className="font-mono text-led-green">+{totals.added}</span>
            <span className="font-mono text-led-red">−{totals.removed}</span>
          </button>
          {open && (
            <div className="mt-1.5 space-y-1">
              {s.edits.map((e) => (
                <div key={e.file} className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="min-w-0 flex-1 truncate text-fog-300">{e.file.split(/[\\/]/).slice(-2).join('/')}</span>
                  <span className="text-led-green">+{e.added}</span>
                  <span className="text-led-red">−{e.removed}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  )
}

/** Toutes les demandes en attente : questions d'abord, puis autorisations. */
export function PendingRequests() {
  const approvals = useCompi((s) => s.approvals)
  const questions = useCompi((s) => s.questions)
  const focusAt = useCompi((s) => s.focusPendingAt)
  const keys = useCompi((s) => (s.settings?.approvalKeys.enabled ? s.settings.approvalKeys : null))
  const first = useRef<HTMLDivElement>(null)

  // Alt+Maj+Espace (ou une question par raccourci) : la première carte prend le clavier,
  // après la saisie de la discussion qui le demande aussi à l'ouverture.
  useEffect(() => {
    if (!focusAt || Date.now() - focusAt > 2000) return
    const t = setTimeout(() => first.current?.focus({ preventScroll: false }), 160)
    return () => clearTimeout(t)
  }, [focusAt])

  const hint = keys && keys.allow && keys.deny ? `Depuis n’importe où : ${prettyShortcut(keys.allow)} autorise, ${prettyShortcut(keys.deny)} refuse` : undefined
  return (
    <AnimatePresence initial={false}>
      {questions.map((q, i) => (
        <QuestionCard key={q.id} ref={i === 0 ? first : undefined} q={q} onAnswer={(answers) => void window.compi.answer({ id: q.id, answers })} />
      ))}
      {approvals.map((a, i) => (
        <ApprovalCard
          key={a.id}
          ref={i === 0 && !questions.length ? first : undefined}
          a={a}
          hint={i === 0 ? hint : undefined}
          onDecide={(d) => void window.compi.decide(a.id, d)}
        />
      ))}
    </AnimatePresence>
  )
}
