// Réglages « Sources de l'agenda » : ce qui s'affiche dans Aujourd'hui, le
// résumé du matin, les alertes de réunion, et ce que Compi lit quand on lui
// demande son programme. Rien n'est prévu d'avance : chacun choisit ses agendas
// Google, l'outil d'un de ses connecteurs ou un lien .ics.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Link2, Pencil, Plug, RotateCcw, Trash2 } from 'lucide-react'
import type { AgendaDraft, AgendaPreview, AgendaSource, AgendaToolChoice, DayEvent, GoogleCalendarChoice, PublicSettings } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, cx, IconButton, LedDots, Section, TextInput, Toggle } from '../components/ui'

type Props = { s: PublicSettings; apply: (p: Promise<PublicSettings>) => void }
type Mode = 'connector' | 'ics'

const MAX_SOURCES = 8
const TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const SHORT_DAY = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric' })

const cleanError = (e: unknown): string => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Case à cocher (ou choix unique) en forme de puce. */
function Pick({
  on,
  onClick,
  disabled,
  role = 'checkbox',
  children
}: {
  on: boolean
  onClick: () => void
  disabled?: boolean
  role?: 'checkbox' | 'radio'
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role={role}
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={cx(
        'inline-flex h-7.5 max-w-full items-center gap-1.5 rounded-xl px-2.5 text-[12px] ring-1 ring-inset transition-colors disabled:opacity-40',
        on ? 'bg-[var(--led)]/12 text-fog-100 ring-[var(--led)]/40' : 'bg-white/[0.03] text-fog-500 ring-white/[0.08] hover:text-fog-300'
      )}
    >
      <span
        className={cx('grid size-3.5 shrink-0 place-items-center rounded-[4px] ring-1 ring-inset', on ? 'bg-[var(--led)] ring-transparent' : 'ring-white/20')}
        aria-hidden
      >
        {on && <Check size={10} strokeWidth={3} className="text-black" />}
      </span>
      <span className="truncate">{children}</span>
    </button>
  )
}

// ─── Agendas Google ──────────────────────────────────────────────────────────

function GoogleCalendars({ s, apply }: Props) {
  const chosen = s.agenda.googleCalendars
  const [list, setList] = useState<GoogleCalendarChoice[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    window.compi.agendaGoogleCalendars().then(
      (l) => live && setList(l),
      (e) => live && setError(cleanError(e))
    )
    return () => {
      live = false
    }
  }, [chosen])

  const toggle = (id: string): void => {
    if (!list) return
    const next = list.map((c) => (c.id === id ? { ...c, shown: !c.shown } : c))
    setList(next)
    apply(window.compi.agendaSetGoogleCalendars(next.filter((c) => c.shown).map((c) => c.id)))
  }

  return (
    <div className="space-y-2.5 px-3.5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-fog-100">Agendas Google</div>
          <div className="text-[11.5px] leading-snug text-fog-500">
            {chosen === null ? 'Comme dans Google Agenda : les agendas que tu y as cochés.' : 'Seulement les agendas cochés ici.'}
          </div>
        </div>
        {chosen !== null && (
          <Button size="sm" variant="ghost" onClick={() => apply(window.compi.agendaSetGoogleCalendars(null))}>
            <RotateCcw size={12} /> Comme dans Google
          </Button>
        )}
      </div>
      {error ? (
        <div className="text-[11.5px] text-led-amber">{error}</div>
      ) : !list ? (
        <div className="flex items-center gap-2 text-[11.5px] text-fog-500">
          <LedDots /> Je récupère tes agendas…
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map((c) => (
            <Pick key={c.id} on={c.shown} onClick={() => toggle(c.id)}>
              {c.name}
              {c.primary && <span className="text-fog-700"> · principal</span>}
            </Pick>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Une source ajoutée ──────────────────────────────────────────────────────

function SourceRow({ src, s, apply }: Props & { src: AgendaSource }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(src.name)
  const [confirm, setConfirm] = useState(false)

  useEffect(() => setName(src.name), [src.name])
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3500)
    return () => clearTimeout(t)
  }, [confirm])

  const connector = src.kind === 'connector' ? s.connectors.find((c) => c.id === src.connectorId) : undefined
  const problem = src.kind === 'connector' && (!connector ? 'connecteur supprimé' : !connector.enabled ? 'connecteur désactivé dans Extensions' : '')
  const detail = src.kind === 'ics' ? `Lien .ics · ${src.host}` : `${connector?.name ?? 'Connecteur'} · ${src.tool}`

  const save = (): void => {
    setEditing(false)
    if (name.trim() && name.trim() !== src.name) apply(window.compi.agendaUpdate(src.id, { name }))
    else setName(src.name)
  }

  return (
    <div className="flex items-center gap-3 border-t border-white/[0.05] px-3.5 py-2.5">
      <span className={cx('grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05]', src.enabled ? 'text-[var(--led)]' : 'text-fog-700')}>
        {src.kind === 'ics' ? <Link2 size={13} /> : <Plug size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        {editing ? (
          <TextInput
            autoFocus
            aria-label="Nom de la source"
            className="h-7"
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setName(src.name)
                setEditing(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            title="Renommer"
            onClick={() => setEditing(true)}
            className="group flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-fog-100 hover:text-white"
          >
            <span className="truncate">{src.name}</span>
            <Pencil size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
          </button>
        )}
        <div className="truncate text-[11px] text-fog-500">
          {detail}
          {problem && <span className="text-led-amber"> · {problem}</span>}
        </div>
      </div>
      {confirm ? (
        <Button size="sm" variant="danger" onClick={() => apply(window.compi.agendaRemove(src.id))}>
          Retirer
        </Button>
      ) : (
        <IconButton label={`Retirer « ${src.name} »`} onClick={() => setConfirm(true)}>
          <Trash2 size={13} />
        </IconButton>
      )}
      <Toggle checked={src.enabled} onChange={(enabled) => apply(window.compi.agendaUpdate(src.id, { enabled }))} label={`Afficher « ${src.name} »`} />
    </div>
  )
}

// ─── Ajouter une source ──────────────────────────────────────────────────────

function PreviewEvent({ e }: { e: DayEvent }) {
  const when = e.allDay
    ? `${SHORT_DAY.format(new Date(`${e.start}T12:00:00`))} · journée`
    : `${SHORT_DAY.format(new Date(e.start))} · ${TIME.format(new Date(e.start))}`
  return (
    <div className="flex gap-2.5 text-[11.5px]">
      <span className="w-[108px] shrink-0 whitespace-nowrap text-fog-500 tabular-nums">{when}</span>
      <span className="truncate text-fog-100">{e.title}</span>
    </div>
  )
}

function AddSource({ s, apply, mode, onDone }: Props & { mode: Mode; onDone: () => void }) {
  const setView = useCompi((st) => st.setView)
  const connectors = s.connectors.filter((c) => c.enabled)
  const [connectorId, setConnectorId] = useState('')
  const [tools, setTools] = useState<AgendaToolChoice[] | null>(null)
  // Outil choisi : son nom, et l'outil d'exécution s'il vient du catalogue d'une passerelle.
  const [choice, setChoice] = useState<AgendaToolChoice | null>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'' | 'tools' | 'preview' | 'add'>('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<AgendaPreview | null>(null)

  const pickConnector = async (id: string): Promise<void> => {
    setConnectorId(id)
    setTools(null)
    setChoice(null)
    setPreview(null)
    setName('')
    setError('')
    setBusy('tools')
    try {
      const list = await window.compi.agendaTools(id)
      setTools(list)
      setChoice(list.find((t) => !t.problem) ?? null)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy('')
    }
  }

  const draft = (): AgendaDraft =>
    mode === 'ics'
      ? { kind: 'ics', url: url.trim(), name }
      : { kind: 'connector', connectorId, tool: choice?.tool ?? '', ...(choice?.via ? { via: choice.via } : {}), name }
  const ready = mode === 'ics' ? url.trim().length > 8 : Boolean(connectorId && choice)
  const same = (t: AgendaToolChoice): boolean => choice?.tool === t.tool && choice?.via === t.via

  const runPreview = async (): Promise<void> => {
    setBusy('preview')
    setError('')
    setPreview(null)
    try {
      const p = await window.compi.agendaPreview(draft())
      setPreview(p)
      if (p.ok && !name.trim() && p.name) setName(p.name)
    } catch (e) {
      setError(cleanError(e))
    } finally {
      setBusy('')
    }
  }

  const add = async (): Promise<void> => {
    setBusy('add')
    setError('')
    try {
      apply(Promise.resolve(await window.compi.agendaAdd(draft())))
      onDone()
    } catch (e) {
      setError(cleanError(e))
      setBusy('')
    }
  }

  return (
    <div className="space-y-3">
      <div className="text-[12.5px] text-fog-100">{mode === 'ics' ? 'Ajouter un lien .ics' : 'Ajouter l’agenda d’un connecteur'}</div>

      {mode === 'ics' ? (
        <div className="space-y-1.5">
          <TextInput
            type="url"
            autoFocus
            aria-label="Lien de l’agenda"
            placeholder="https://… ou webcal://…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value)
              setPreview(null)
            }}
            onKeyDown={(e) => e.key === 'Enter' && ready && !busy && void runPreview()}
          />
          <p className="text-[11px] leading-snug text-fog-500">
            Outlook : Calendriers partagés › Publier un calendrier. iCloud : partage › Calendrier public. Proton, une école, un club : leur lien « ICS » ou «
            iCal ». Le lien est chiffré sur ton PC, car quiconque l’a peut lire l’agenda.
          </p>
        </div>
      ) : connectors.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] leading-snug text-fog-500">
          Aucun connecteur actif. Ajoute d’abord celui de ton agenda (familial, CRM, outil de réservation…).
          <Button size="sm" variant="subtle" onClick={() => setView('connectors')}>
            <Plug size={12} /> Extensions
          </Button>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Connecteur">
            {connectors.map((c) => (
              <Pick key={c.id} role="radio" on={connectorId === c.id} disabled={busy === 'tools'} onClick={() => void pickConnector(c.id)}>
                {c.name}
              </Pick>
            ))}
          </div>
          {busy === 'tools' && (
            <div className="flex items-center gap-2 text-[11.5px] text-fog-500">
              <LedDots /> Je regarde ce que ce connecteur sait faire…
            </div>
          )}
          {tools && tools.length === 0 && (
            <div className="text-[11.5px] text-led-amber">Ce connecteur n’a aucun outil qui ressemble à une lecture d’agenda.</div>
          )}
          {tools && tools.length > 0 && (
            <div className="space-y-1" role="radiogroup" aria-label="Outil qui lit l’agenda">
              <div className="text-[11px] leading-snug text-fog-500">
                Quel outil lit ton agenda ? Seuls les outils de lecture sont utilisables.
                {tools.some((t) => t.via) && ' Ce connecteur range ses outils dans un catalogue : Compi y a cherché ceux qui parlent d’agenda.'}
              </div>
              {tools.map((t, i) => (
                <button
                  key={`${t.via ?? ''}|${t.tool}`}
                  type="button"
                  role="radio"
                  aria-checked={same(t)}
                  disabled={Boolean(t.problem)}
                  onClick={() => {
                    setChoice(t)
                    setPreview(null)
                  }}
                  className={cx(
                    'block w-full rounded-xl px-3 py-2 text-left ring-1 ring-inset transition-colors',
                    same(t) ? 'bg-[var(--led)]/10 ring-[var(--led)]/40' : 'bg-white/[0.02] ring-white/[0.06] hover:bg-white/[0.05]',
                    t.problem && 'cursor-not-allowed opacity-55 hover:bg-white/[0.02]'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <code className="truncate font-mono text-[11.5px] text-fog-100">{t.tool}</code>
                    {i === 0 && !t.problem && <Badge color="var(--color-led-green)">Le plus probable</Badge>}
                    {t.via && <span className="shrink-0 text-[10.5px] text-fog-700">par {t.via}</span>}
                  </div>
                  {t.description && <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-fog-500">{t.description}</div>}
                  {t.problem && <div className="mt-0.5 text-[11px] text-led-amber">{t.problem}</div>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence initial={false}>
        {preview && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cx(
              'space-y-1.5 rounded-xl px-3 py-2.5 ring-1 ring-inset',
              preview.ok ? 'bg-white/[0.03] ring-white/[0.06]' : 'bg-led-amber/[0.06] ring-led-amber/20'
            )}
          >
            <div className={cx('text-[11.5px] leading-snug', preview.ok ? 'text-fog-300' : 'text-led-amber')}>{preview.message}</div>
            {preview.events.map((e) => (
              <PreviewEvent key={e.id} e={e} />
            ))}
            {preview.count > preview.events.length && <div className="text-[11px] text-fog-700">… et {preview.count - preview.events.length} autres.</div>}
            {preview.ok && (
              <label className="flex items-center gap-2 pt-1">
                <span className="shrink-0 text-[11.5px] text-fog-500">Nom affiché</span>
                <TextInput className="h-7.5" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && <div className="text-[11.5px] leading-snug text-led-amber">{error}</div>}

      <div className="flex items-center justify-end gap-2">
        {(busy === 'preview' || busy === 'add') && <LedDots />}
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button size="sm" variant={preview?.ok ? 'subtle' : 'primary'} disabled={!ready || Boolean(busy)} onClick={() => void runPreview()}>
          {preview ? 'Réessayer' : 'Aperçu'}
        </Button>
        {preview?.ok && (
          <Button size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => void add()}>
            Ajouter
          </Button>
        )}
      </div>
    </div>
  )
}

// ─── Section ─────────────────────────────────────────────────────────────────

export function AgendaSourcesSection({ s, apply }: Props) {
  const [adding, setAdding] = useState<Mode | null>(null)
  const sources = s.agenda.sources
  const full = sources.length >= MAX_SOURCES

  return (
    <Section title="Sources de l’agenda" hint="Pour Aujourd’hui, le résumé du matin, les alertes de réunion, et quand tu demandes ton programme à Compi.">
      {s.google.calendar ? (
        <GoogleCalendars s={s} apply={apply} />
      ) : (
        <div className="px-3.5 py-3 text-[11.5px] leading-snug text-fog-500">
          Agenda Google : non connecté (voir Comptes). Tu peux aussi ajouter d’autres agendas ici.
        </div>
      )}

      {sources.map((src) => (
        <SourceRow key={src.id} src={src} s={s} apply={apply} />
      ))}

      <div className="border-t border-white/[0.05] px-3.5 py-3">
        <AnimatePresence mode="wait" initial={false}>
          {adding ? (
            <motion.div
              key="add"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <AddSource s={s} apply={apply} mode={adding} onDone={() => setAdding(null)} />
            </motion.div>
          ) : (
            <motion.div key="buttons" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="subtle" disabled={full} onClick={() => setAdding('connector')}>
                <Plug size={12} /> Depuis un connecteur
              </Button>
              <Button size="sm" variant="subtle" disabled={full} onClick={() => setAdding('ics')}>
                <Link2 size={12} /> Lien .ics
              </Button>
              <span className="text-[11px] text-fog-700">
                {full ? `${MAX_SOURCES} sources au plus.` : 'Compi essaie la source et te montre ce qu’il trouve avant de l’ajouter.'}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Section>
  )
}
