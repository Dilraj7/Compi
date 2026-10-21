// « Ce que je sais de toi » : tout ce que Compi a retenu, à voir, corriger ou
// effacer. Et l'historique du presse-papier, si l'utilisateur l'active.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy, Lock, Pencil, Pin, PinOff, Plus, Search, X } from 'lucide-react'
import { brainLabel, defaultBrain } from '@shared/brains'
import { searchClips } from '@shared/clipboard'
import { FACT_MAX, searchFacts } from '@shared/memory'
import type { ClipItem, MemoryItem } from '@shared/types'
import { useCompi } from '../store'
import { Button, cx, IconButton, Segmented, TextArea, TextInput, timeAgo, Toggle } from '../components/ui'

type Tab = 'memory' | 'clipboard'

const MEMORY_COLOR = '#C084FC'
const CLIP_COLOR = '#67E8F9'

/** Bouton en deux temps pour ce qui ne se rattrape pas. */
export function ConfirmButton({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <Button
      size="sm"
      variant={armed ? 'danger' : 'ghost'}
      onClick={() => {
        if (!armed) return setArmed(true)
        setArmed(false)
        onConfirm()
      }}
    >
      {armed ? confirm : label}
    </Button>
  )
}

function MemoryRow({ item }: { item: MemoryItem }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.fact)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  const save = async (): Promise<void> => {
    try {
      await window.compi.updateMemory(item.id, text)
      setEditing(false)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
      className="group flex items-start gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]"
    >
      <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px]" style={{ background: MEMORY_COLOR, boxShadow: `0 0 6px ${MEMORY_COLOR}` }} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <div className="space-y-1.5">
            <TextArea
              ref={ref}
              rows={2}
              value={text}
              maxLength={FACT_MAX}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void save()
                }
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setText(item.fact)
                  setEditing(false)
                }
              }}
            />
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="primary" accent={MEMORY_COLOR} onClick={() => void save()}>
                <Check size={12} /> Enregistrer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setText(item.fact)
                  setEditing(false)
                }}
              >
                Annuler
              </Button>
              {error && <span className="text-[11px] text-led-red">{error}</span>}
            </div>
          </div>
        ) : (
          <button className="w-full text-left text-[12.5px] leading-snug text-fog-100 select-text" title="Corriger" onClick={() => setEditing(true)}>
            {item.fact}
          </button>
        )}
        {!editing && (
          <div className="mt-0.5 truncate text-[10.5px] text-fog-700">
            {timeAgo(item.updatedAt ?? item.createdAt)}
            {item.updatedAt ? ' · corrigé' : ''}
            {item.source === 'manual' ? ' · ajouté par toi' : item.conversation ? ` · pendant « ${item.conversation} »` : ''}
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton label="Corriger" onClick={() => setEditing(true)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton label="Oublier" onClick={() => void window.compi.deleteMemory(item.id)}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </motion.div>
  )
}

function MemoryPanel() {
  const settings = useCompi((s) => s.settings)
  const setView = useCompi((s) => s.setView)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void window.compi.memory().then(setItems)
    return window.compi.onMemory(setItems)
  }, [])

  const shown = useMemo(() => (query.trim() ? searchFacts(items, query) : items), [items, query])

  const add = async (): Promise<void> => {
    if (!draft.trim()) return
    try {
      setItems(await window.compi.addMemory(draft))
      setDraft('')
      setError(null)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  if (!settings) return null
  const brain = defaultBrain(settings)
  const online = brain.provider !== 'local'
  const shared = settings.privacy.memory === 'always'

  return (
    <div className="space-y-3">
      <p className="px-0.5 text-[11.5px] leading-snug text-fog-500">
        Ce que j’ai retenu de nos discussions. Clique sur une ligne pour la corriger ; ce que tu effaces est oublié pour de bon.
      </p>

      <div
        className="flex items-start gap-2.5 rounded-2xl px-3.5 py-2.5 text-[11.5px] leading-snug"
        style={{ background: `color-mix(in oklab, ${MEMORY_COLOR} 7%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${MEMORY_COLOR} 22%, transparent)` }}
      >
        <Lock size={13} className="mt-0.5 shrink-0" style={{ color: MEMORY_COLOR }} />
        <span className="text-fog-300">
          {!online ? (
            <>Avec ton cerveau local, ces souvenirs ne quittent jamais ton PC.</>
          ) : shared ? (
            <>
              Ces souvenirs accompagnent tes questions vers {brainLabel(brain, settings)}, car tu as choisi « Toujours » pour la mémoire.{' '}
              <button className="text-fog-100 underline decoration-white/20 underline-offset-2 hover:decoration-white/60" onClick={() => setView('settings')}>
                Changer
              </button>
            </>
          ) : (
            <>
              Ces souvenirs restent sur ton PC : {brainLabel(brain, settings)} ne les reçoit pas tant que tu n’as pas choisi « Toujours » pour la mémoire.{' '}
              <button className="text-fog-100 underline decoration-white/20 underline-offset-2 hover:decoration-white/60" onClick={() => setView('settings')}>
                Réglages › Confidentialité
              </button>
            </>
          )}
        </span>
      </div>

      <div className="flex gap-2">
        <TextInput
          value={draft}
          maxLength={FACT_MAX}
          placeholder="Ajouter quelque chose à retenir…"
          onChange={(e) => {
            setDraft(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
        />
        <Button variant="primary" accent={MEMORY_COLOR} disabled={!draft.trim()} onClick={() => void add()}>
          <Plus size={13} /> Ajouter
        </Button>
      </div>
      {error && <div className="px-1 text-[11.5px] text-led-amber">{error}</div>}

      {items.length > 6 && (
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fog-700" />
          <TextInput className="pl-8" value={query} placeholder={`Chercher parmi ${items.length} souvenirs`} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/[0.1] px-4 py-7 text-center text-[12.5px] leading-relaxed text-fog-500">
          Je ne sais encore rien de toi.
          <br />
          Dis-moi « retiens que je préfère le tutoiement », ou ajoute une info ici.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
          <AnimatePresence initial={false}>
            {shown.map((m) => (
              <MemoryRow key={`${m.id}${m.updatedAt ?? ''}`} item={m} />
            ))}
          </AnimatePresence>
          {shown.length === 0 && <div className="px-3.5 py-3 text-[12px] text-fog-500">Rien ne correspond à « {query} ».</div>}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-between px-0.5">
          <span className="text-[11px] text-fog-700">
            {items.length} souvenir{items.length > 1 ? 's' : ''}
          </span>
          <ConfirmButton label="Tout effacer" confirm="Sûr ? Tout oublier" onConfirm={() => void window.compi.clearMemory().then(setItems)} />
        </div>
      )}
    </div>
  )
}

function ClipRow({ item }: { item: ClipItem }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10, transition: { duration: 0.15 } }}
      className="group flex items-start gap-3 px-3.5 py-2.5 [&+&]:border-t [&+&]:border-white/[0.05]"
    >
      <button
        className="min-w-0 flex-1 text-left"
        title="Recopier"
        onClick={() => void window.compi.copyClip(item.id).then((ok) => ok && setCopied(true))}
      >
        <div className="line-clamp-2 font-mono text-[11.5px] leading-snug break-words whitespace-pre-wrap text-fog-100">{item.text}</div>
        <div className="mt-0.5 truncate text-[10.5px] text-fog-700">
          {copied ? <span style={{ color: CLIP_COLOR }}>Copié</span> : timeAgo(item.at)}
          {item.source ? ` · ${item.source}` : ''}
          {item.text.length > 200 ? ` · ${item.text.length.toLocaleString('fr-FR')} caractères` : ''}
        </div>
      </button>
      <div className={cx('flex shrink-0 items-center transition-opacity group-hover:opacity-100 focus-within:opacity-100', item.pinned ? 'opacity-100' : 'opacity-0')}>
        <IconButton label="Recopier" onClick={() => void window.compi.copyClip(item.id).then((ok) => ok && setCopied(true))}>
          {copied ? <Check size={13} style={{ color: CLIP_COLOR }} /> : <Copy size={13} />}
        </IconButton>
        <IconButton label={item.pinned ? 'Détacher' : 'Épingler (gardé au-delà de 30 jours)'} onClick={() => void window.compi.pinClip(item.id, !item.pinned)}>
          {item.pinned ? <PinOff size={13} style={{ color: CLIP_COLOR }} /> : <Pin size={13} />}
        </IconButton>
        <IconButton label="Effacer" onClick={() => void window.compi.deleteClip(item.id)}>
          <X size={14} />
        </IconButton>
      </div>
    </motion.div>
  )
}

function ClipboardPanel() {
  const settings = useCompi((s) => s.settings)
  const setSettings = useCompi((s) => s.setSettings)
  const [items, setItems] = useState<ClipItem[]>([])
  const [query, setQuery] = useState('')
  const enabled = settings?.clipboardHistory ?? false

  useEffect(() => {
    void window.compi.clips().then(setItems)
    return window.compi.onClips(setItems)
  }, [])

  const shown = useMemo(() => {
    const list = query.trim() ? searchClips(items, query, 200) : items
    // Épinglés d'abord.
    return [...list].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  }, [items, query])

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
        <div className="flex items-center justify-between gap-4 px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-[12.5px] text-fog-100">Garder l’historique du presse-papier</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">
              Retrouve ce que tu as copié, ou demande-moi « qu’est-ce que j’avais copié ce matin ? ». Désactiver efface tout.
            </div>
          </div>
          <Toggle checked={enabled} label="Historique du presse-papier" onChange={(v) => void window.compi.updateSettings({ clipboardHistory: v }).then(setSettings)} />
        </div>
        <div className="space-y-1 border-t border-white/[0.05] px-3.5 py-2.5 text-[11px] leading-snug text-fog-500">
          {[
            'Reste sur ce PC, chiffré par Windows. Texte seulement, 30 jours et 200 éléments au plus.',
            'Jamais gardé : ce que copient les gestionnaires de mots de passe, les mots de passe, IBAN, cartes et clés.',
            'Avec un cerveau en ligne, je te demande avant de m’en servir (Réglages › Confidentialité).'
          ].map((t) => (
            <div key={t} className="flex gap-2">
              <Lock size={11} className="mt-[2px] shrink-0" style={{ color: CLIP_COLOR }} />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {enabled && (
        <>
          {items.length > 5 && (
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fog-700" />
              <TextInput className="pl-8" value={query} placeholder="Chercher dans l’historique" onChange={(e) => setQuery(e.target.value)} />
            </div>
          )}
          {items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/[0.1] px-4 py-6 text-center text-[12.5px] text-fog-500">
              Rien pour l’instant : tes prochaines copies apparaîtront ici.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
              <AnimatePresence initial={false}>
                {shown.map((c) => (
                  <ClipRow key={c.id} item={c} />
                ))}
              </AnimatePresence>
              {shown.length === 0 && <div className="px-3.5 py-3 text-[12px] text-fog-500">Rien ne correspond à « {query} ».</div>}
            </div>
          )}
          {items.length > 0 && (
            <div className="flex items-center justify-between px-0.5">
              <span className="text-[11px] text-fog-700">
                {items.length} élément{items.length > 1 ? 's' : ''}
              </span>
              <ConfirmButton label="Tout effacer" confirm="Sûr ? Tout effacer" onConfirm={() => void window.compi.clearClips().then(setItems)} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function MemoryView() {
  const [tab, setTab] = useState<Tab>('memory')
  return (
    <div className="scroll-y flex-1 space-y-4 px-5 pt-1 pb-5">
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'memory', label: 'Ce que je sais de toi' },
          { value: 'clipboard', label: 'Presse-papier' }
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}>
          {tab === 'memory' ? <MemoryPanel /> : <ClipboardPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
