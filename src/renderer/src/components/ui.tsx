// Primitives d'interface de Compi.

import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes
} from 'react'
import { motion } from 'motion/react'
import { TICKER_DELAY_MS, TICKER_PX_PER_S, tickerMs } from '@shared/notice'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger' | 'accent'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md'; accent?: string }>(
  function Button({ variant = 'subtle', size = 'md', accent, className, style, ...rest }, ref) {
    const base =
      'inline-flex items-center justify-center gap-1.5 rounded-xl font-medium whitespace-nowrap transition-[background,color,box-shadow,transform] duration-150 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--led)]/60'
    const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12px]' : 'h-8.5 px-3.5 text-[12.5px]'
    const variants: Record<Variant, string> = {
      primary: 'text-black shadow-[0_0_18px_-4px_var(--btn)] hover:brightness-110',
      accent: 'text-black shadow-[0_0_18px_-4px_var(--btn)] hover:brightness-110',
      ghost: 'text-fog-300 hover:text-fog-100 hover:bg-white/[0.06]',
      subtle: 'bg-white/[0.06] text-fog-100 hover:bg-white/[0.1] ring-1 ring-inset ring-white/[0.06]',
      danger: 'bg-led-red/10 text-led-red hover:bg-led-red/20 ring-1 ring-inset ring-led-red/20'
    }
    const btn = variant === 'primary' || variant === 'accent' ? (accent ?? 'var(--led)') : undefined
    return (
      <button
        ref={ref}
        className={cx(base, sizes, variants[variant], className)}
        style={btn ? { ...style, background: btn, ['--btn' as string]: btn } : style}
        {...rest}
      />
    )
  }
)

export function IconButton({
  label,
  active,
  badge,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; badge?: number }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'relative grid size-8 place-items-center rounded-[10px] transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--led)]/60',
        active ? 'bg-white/[0.09] text-fog-100' : 'text-fog-500 hover:text-fog-100 hover:bg-white/[0.05]',
        className
      )}
      {...rest}
    >
      {children}
      {active && <span className="absolute -bottom-[3px] left-1/2 h-[2px] w-3 -translate-x-1/2 rounded-full bg-[var(--led)] shadow-[0_0_8px_var(--led)]" />}
      {badge ? (
        <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-led-amber px-1 text-[10px] font-bold text-black shadow-[0_0_10px_rgb(251_191_36/0.7)]">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-5.5 w-9.5 shrink-0 rounded-full transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--led)]/60',
        checked ? 'bg-[var(--led)]' : 'bg-white/[0.12]'
      )}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 size-4.5 rounded-full bg-white shadow"
        animate={{ x: checked ? 16 : 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
      />
    </button>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id
}: {
  value: T
  options: Array<{ value: T; label: string; hint?: string }>
  onChange: (v: T) => void
  /** Identifiant unique quand plusieurs sélecteurs ont les mêmes options (animation). */
  id?: string
}) {
  return (
    <div className="flex rounded-xl bg-white/[0.05] p-0.5 ring-1 ring-inset ring-white/[0.05]">
      {options.map((o) => (
        <button
          key={o.value}
          title={o.hint}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative flex-1 rounded-[10px] px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors',
            value === o.value ? 'text-fog-100' : 'text-fog-500 hover:text-fog-300'
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${id ?? options.map((x) => x.value).join('')}`}
              className="absolute inset-0 rounded-[10px] bg-white/[0.1] ring-1 ring-inset ring-white/[0.08]"
              transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      className={cx(
        'h-8.5 w-full rounded-xl bg-white/[0.05] px-3 text-[12.5px] text-fog-100 placeholder:text-fog-700 ring-1 ring-inset ring-white/[0.07] outline-none transition-shadow focus:ring-[var(--led)]/50 select-text',
        className
      )}
      {...rest}
    />
  )
})

/** Heure « HH:MM » (heures calmes…). */
export function TimeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="h-8 rounded-lg bg-white/[0.05] px-2 text-[12px] text-fog-100 ring-1 ring-white/[0.08] outline-none ring-inset [color-scheme:dark] focus:ring-[var(--led)]/50"
    />
  )
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      spellCheck={false}
      className={cx(
        'w-full resize-y rounded-xl bg-white/[0.05] px-3 py-2 text-[12.5px] leading-relaxed text-fog-100 placeholder:text-fog-700 ring-1 ring-inset ring-white/[0.07] outline-none transition-shadow focus:ring-[var(--led)]/50 select-text',
        className
      )}
      {...rest}
    />
  )
})

export function Section({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <div>
          <h3 className="led-text text-[11px] text-fog-500">{title}</h3>
          {hint && <p className="mt-0.5 text-[11.5px] text-fog-700">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">{children}</div>
    </section>
  )
}

export function Row({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-3 [&+&]:border-t [&+&]:border-white/[0.05]">
      <div className="min-w-0">
        <div className="text-[12.5px] text-fog-100">{label}</div>
        {hint && <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/** Petit indicateur d'activité façon LED (trois points). */
export function LedDots({ color = 'var(--led)' }: { color?: string }) {
  return (
    <span className="inline-flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-[4px] rounded-[1px]"
          style={{ background: color, boxShadow: `0 0 6px ${color}` }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  )
}

/**
 * Texte sur une ligne : s'il dépasse, il défile jusqu'au bout après un court délai.
 * `onScrollTime` reçoit la durée du défilement et son point de départ, pour garder la
 * notification affichée jusqu'à la fin.
 */
export function Ticker({ text, className, onScrollTime }: { text: string; className?: string; onScrollTime?: (ms: number, startedAt: number) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLSpanElement>(null)
  const [overflow, setOverflow] = useState(0)
  const startedAt = useRef(0)
  const report = useRef(onScrollTime)
  report.current = onScrollTime

  useLayoutEffect(() => {
    const b = box.current
    const i = inner.current
    if (!b || !i) return
    let last = -1
    // L'îlot s'élargit avec un ressort : on remesure tant que la largeur change. Chaque
    // changement relance le défilement (délai compris) : on note son nouveau départ.
    const measure = (): void => {
      const raw = Math.ceil(i.scrollWidth - b.clientWidth)
      // Un peu plus loin que la fin : les derniers mots sortent du fondu de droite.
      const over = raw > 4 ? raw + 32 : 0
      if (over === last) return
      last = over
      startedAt.current = Date.now()
      setOverflow(over)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(b)
    return () => ro.disconnect()
  }, [text])

  useEffect(() => {
    report.current?.(tickerMs(overflow), startedAt.current)
  }, [overflow, text])

  return (
    <div
      ref={box}
      className={cx(
        'overflow-hidden whitespace-nowrap',
        overflow > 0 && '[mask-image:linear-gradient(to_right,black_calc(100%_-_28px),transparent)]',
        className
      )}
    >
      <motion.span
        key={text}
        ref={inner}
        className="inline-block"
        initial={{ x: 0 }}
        animate={{ x: -overflow }}
        transition={overflow ? { delay: TICKER_DELAY_MS / 1000, duration: overflow / TICKER_PX_PER_S, ease: 'linear' } : { duration: 0 }}
      >
        {text}
      </motion.span>
    </div>
  )
}

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-md px-1.5 text-[10.5px] font-semibold tracking-wide"
      style={{
        color: color ?? 'var(--color-fog-300)',
        background: color ? `color-mix(in oklab, ${color} 14%, transparent)` : 'rgb(255 255 255 / 0.06)'
      }}
    >
      {children}
    </span>
  )
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return "à l'instant"
  const m = Math.round(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `il y a ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'hier'
  if (d < 7) return `il y a ${d} j`
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

/** « Control+Shift+Space » → « Ctrl + Maj + Espace ». */
export function prettyShortcut(acc: string): string {
  const map: Record<string, string> = {
    Control: 'Ctrl',
    CommandOrControl: 'Ctrl',
    Shift: 'Maj',
    Alt: 'Alt',
    Super: 'Win',
    Space: 'Espace',
    Return: 'Entrée',
    Escape: 'Échap'
  }
  return acc
    .split('+')
    .map((k) => map[k] ?? k)
    .join(' + ')
}

const KEY_NAMES: Record<string, string> = { Space: 'Space', Enter: 'Return', Escape: 'Escape', Backquote: '`' }

/** Saisie d'un raccourci clavier : on clique, puis on appuie sur la combinaison. */
export function ShortcutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') return setRecording(false)
      let key = KEY_NAMES[e.code]
      if (!key && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
      if (!key && /^Digit\d$/.test(e.code)) key = e.code.slice(5)
      if (!key && /^F\d{1,2}$/.test(e.code)) key = e.code
      const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
      if (!key || mods.length === 0) return
      onChange([...mods, key].join('+'))
      setRecording(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, onChange])

  return (
    <button
      onClick={() => setRecording(true)}
      className={`h-8 rounded-xl px-3 font-mono text-[11.5px] ring-1 ring-inset transition-all ${
        recording ? 'bg-[var(--led)]/10 text-[var(--led)] ring-[var(--led)]/50' : 'bg-white/[0.05] text-fog-100 ring-white/[0.08] hover:bg-white/[0.08]'
      }`}
    >
      {recording ? 'Appuie sur ta combinaison…' : prettyShortcut(value)}
    </button>
  )
}
