// Historique › Réunions : lancer l'enregistrement d'un appel (avec le rappel
// de prévenir les participants), la liste des appels enregistrés, et chaque
// réunion : résumé, tâches, transcription, noms des voix, export.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Check, Copy, Download, FileText, Mic, Phone, RotateCcw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { brainLabel, defaultBrain } from '@shared/brains'
import { clockAt, CONSENT_SENTENCE, followUpPrompt, formatDuration, PEOPLE_CHOICES, speakerLabel, transcriptText } from '@shared/meetings'
import { isOnline } from '@shared/privacy'
import { SPEECH_MODELS } from '@shared/speechModels'
import type { Meeting, MeetingMeta, SpeechModelId, SpeechModelStatus } from '@shared/types'
import { useCompi } from '../store'
import { REC } from '../components/CallLive'
import { Badge, Button, cx, Segmented, TextInput, Toggle, timeAgo } from '../components/ui'

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const VOICE_COLORS = ['#F472B6', '#FBBF24', '#34D399', '#A78BFA', '#60A5FA', '#FB923C']
const voiceColor = (who: string): string => {
  if (who === 'me') return 'var(--led)'
  const n = /^s(\d+)$/.exec(who)
  return n ? VOICE_COLORS[(Number(n[1]) - 1) % VOICE_COLORS.length] : '#9CA3AF'
}

const ENGINES: Array<{ value: SpeechModelId; label: string; hint: string }> = [
  { value: 'parakeet', label: 'Français · anglais', hint: SPEECH_MODELS.parakeet.hint },
  { value: 'omnilingual', label: 'தமிழ் · tamoul', hint: SPEECH_MODELS.omnilingual.hint }
]

type PeopleValue = 'auto' | `${(typeof PEOPLE_CHOICES)[number]}`
const PEOPLE: Array<{ value: PeopleValue; label: string; hint: string }> = [
  { value: 'auto', label: 'Auto', hint: 'Compi compte les voix lui-même' },
  ...PEOPLE_CHOICES.map((n) => ({
    value: `${n}` as PeopleValue,
    label: `${n}`,
    hint: 'Une seule personne : toutes ses phrases à la même voix'
  }))
]

export function MeetingsView({ tabs }: { tabs: ReactNode }) {
  const [list, setList] = useState<MeetingMeta[] | null>(null)
  const openId = useCompi((s) => s.openMeetingId)
  const openMeeting = useCompi((s) => s.openMeeting)
  const call = useCompi((s) => s.call)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void window.compi.meetings().then(setList)
    return window.compi.onMeetings(setList)
  }, [])

  if (openId) return <MeetingDetail id={openId} onBack={() => openMeeting(null)} />

  return (
    <div className="flex flex-1 flex-col px-5 pt-1 pb-5">
      <div className="mb-3 flex items-center justify-between">
        {tabs}
        <Button size="sm" variant="subtle" disabled={Boolean(call) || starting} onClick={() => setStarting(true)}>
          <span className="size-2 rounded-full" style={{ background: REC, boxShadow: `0 0 6px ${REC}` }} />
          {call ? 'Enregistrement en cours' : 'Enregistrer un appel'}
        </Button>
      </div>
      <div className="scroll-y -mx-1 flex-1 space-y-1 px-1">
        {starting && <StartCallCard onClose={() => setStarting(false)} />}
        {list?.length === 0 && !starting && (
          <div className="py-10 text-center text-[12.5px] leading-relaxed text-fog-500">
            Pas encore d’appel enregistré.
            <br />
            Compi transcrit sur ton PC ; rien ne part sans ton accord.
          </div>
        )}
        {list?.map((m, i) => (
          <MeetingRow key={m.id} m={m} index={i} onOpen={() => openMeeting(m.id)} />
        ))}
      </div>
    </div>
  )
}

function MeetingRow({ m, index, onOpen }: { m: MeetingMeta; index: number; onOpen: () => void }) {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3000)
    return () => clearTimeout(t)
  }, [confirm])
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transition: { delay: index * 0.02 } }}
      className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
    >
      <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={onOpen}>
        {m.others ? <Phone size={14} className="shrink-0 text-fog-700" /> : <Mic size={14} className="shrink-0 text-fog-700" />}
        <span className="truncate text-[13px] text-fog-100">{m.title}</span>
        {m.status === 'recording' && <Badge color={REC}>En cours</Badge>}
        {m.status === 'processing' && <Badge color="#60A5FA">Transcription…</Badge>}
        {m.status === 'interrupted' && <Badge color="#FBBF24">Interrompu</Badge>}
        {m.hasSummary && <Sparkles size={12} className="shrink-0 text-fog-500" aria-label="Résumé" />}
      </button>
      <span className="shrink-0 text-[11px] text-fog-700 tabular-nums">{formatDuration(m.durationMs)}</span>
      <span className="w-14 shrink-0 text-right text-[11px] text-fog-700">{timeAgo(m.startedAt)}</span>
      {m.status !== 'recording' && (
        <button
          onClick={() => (confirm ? void window.compi.deleteMeeting(m.id) : setConfirm(true))}
          className={cx(
            'grid h-6.5 shrink-0 place-items-center rounded-lg px-1.5 text-fog-700 transition-opacity hover:bg-led-red/10 hover:text-led-red',
            confirm ? 'text-led-red opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          aria-label="Supprimer"
        >
          {confirm ? <span className="text-[11px]">Supprimer ?</span> : <Trash2 size={13} />}
        </button>
      )}
    </motion.div>
  )
}

/** Avant d'enregistrer : prévenir les participants, choisir la langue et ce qui est capté. */
function StartCallCard({ onClose }: { onClose: () => void }) {
  const settings = useCompi((s) => s.settings)
  const [engine, setEngine] = useState<SpeechModelId>(settings?.meetings.engine ?? 'parakeet')
  const [others, setOthers] = useState(true)
  const [people, setPeople] = useState<PeopleValue>('auto')
  const [status, setStatus] = useState<SpeechModelStatus | null>(null)
  const [voicesPack, setVoicesPack] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void window.compi.speechModelStatus(engine).then(setStatus)
  }, [engine])
  useEffect(() => {
    void window.compi.speechModelStatus('voices').then((st) => setVoicesPack(st.installed))
  }, [])

  const ready = status?.model === engine && status.installed
  // Le nombre de personnes ne sert qu'à la séparation des voix (pack téléchargé, option active).
  const separate = others && voicesPack && Boolean(settings?.meetings.voices)
  const start = (): void => {
    if (settings && settings.meetings.engine !== engine) void window.compi.updateSettings({ meetings: { ...settings.meetings, engine } })
    onClose()
    void useCompi.getState().startCall({ engine, others, people: separate && people !== 'auto' ? Number(people) : undefined }, separate)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-2 space-y-3 rounded-2xl bg-white/[0.035] p-3.5 ring-1 ring-white/[0.06] ring-inset"
    >
      <div className="rounded-xl px-3 py-2.5 text-[12px] leading-snug" style={{ background: `${REC}12`, boxShadow: `inset 0 0 0 1px ${REC}33` }}>
        <div className="font-semibold text-fog-100">Préviens les participants avant de commencer.</div>
        <div className="mt-1 text-fog-300">Enregistrer une conversation sans prévenir est interdit. Tu peux lire ou envoyer cette phrase :</div>
        <div className="mt-1.5 flex items-start gap-2">
          <span className="flex-1 text-fog-100 italic">« {CONSENT_SENTENCE} »</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard.writeText(CONSENT_SENTENCE)
              setCopied(true)
            }}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiée' : 'Copier'}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-fog-100">Langue de l’appel</span>
        <Segmented<SpeechModelId> id="call-engine" value={engine} options={ENGINES} onChange={setEngine} />
      </div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] text-fog-100">Capter aussi le son de l’appel</div>
          <div className="text-[11px] leading-snug text-fog-500">
            Les autres participants, depuis le son de ton PC. Avec des haut-parleurs, ton micro les entend aussi : Compi retire les doublons, mais un casque
            donne un meilleur résultat.
          </div>
        </div>
        <Toggle checked={others} onChange={setOthers} label="Capter le son de l’appel" />
      </div>
      {separate && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] text-fog-100">Personnes en face</span>
            <Segmented<PeopleValue> id="call-people" value={people} options={PEOPLE} onChange={setPeople} />
          </div>
          <div className="text-[11px] leading-snug text-fog-500">
            Une seule personne : choisis 1, ses phrases restent à la même voix. Avec Auto, Compi compare les voix et en trouve parfois trop : donne le même nom
            à deux voix pour les réunir. Se change jusqu’à l’arrêt.
          </div>
        </div>
      )}

      {status && !ready && (
        <div className="text-[11.5px] text-led-amber">
          Le modèle {SPEECH_MODELS[engine].label} n’est pas téléchargé.{' '}
          <button
            className="underline underline-offset-2 hover:text-fog-100"
            onClick={() => {
              useCompi.getState().focusSettings('voice')
              useCompi.getState().setView('settings')
            }}
          >
            Réglages › Me parler
          </button>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Annuler
        </Button>
        <Button size="sm" variant="primary" accent={REC} disabled={!ready} onClick={start}>
          <span className="size-2 rounded-full bg-black/80" /> Commencer
        </Button>
      </div>
    </motion.div>
  )
}

function MeetingDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const settings = useCompi((s) => s.settings)
  const [m, setM] = useState<Meeting | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Réunion effacée ou illisible : retour à la liste, jamais une fiche vide sans issue.
  const reload = (): void => void window.compi.meeting(id).then((x) => (x ? setM(x) : onBack()))
  useEffect(() => {
    reload()
    const offList = window.compi.onMeetings(() => reload())
    const offEvent = window.compi.onMeetingEvent((e) => {
      if (e.id === id && e.type === 'processing') setBusy(e.step)
    })
    return () => {
      offList()
      offEvent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!m) return <div className="flex-1" />

  const brain = settings ? defaultBrain(settings) : null
  const online = brain ? isOnline(brain.provider) : false
  const blocked = online && settings?.privacy.meetings === 'never'
  const where = brain && settings ? brainLabel(brain, settings) : ''

  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    setError('')
    setBusy(label)
    try {
      await fn()
      reload()
    } catch (e) {
      setError(cleanError(e as Error))
    } finally {
      setBusy(null)
    }
  }

  const followUp = (): void => {
    const s = useCompi.getState()
    s.newConversation()
    s.open('chat', { focus: true })
    void s.send(followUpPrompt(m), { external: true })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-5 pt-1 pb-4">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onBack} className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[12px] text-fog-500 hover:bg-white/[0.05] hover:text-fog-100">
          <ArrowLeft size={13} /> Réunions
        </button>
      </div>

      <div className="scroll-y -mx-1 min-h-0 flex-1 space-y-3 px-1">
        <div>
          {editing ? (
            <TitleInput
              initial={m.title}
              onDone={(title) => {
                setEditing(false)
                if (title && title !== m.title) void window.compi.renameMeeting(id, title).then((x) => x && setM(x))
              }}
            />
          ) : (
            <button className="text-left text-[16px] font-semibold text-fog-100 hover:text-white" onClick={() => setEditing(true)} title="Renommer">
              {m.title}
            </button>
          )}
          <div className="mt-0.5 text-[11.5px] text-fog-500">
            {new Date(m.startedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })} · {formatDuration(m.durationMs)} ·{' '}
            {m.others ? 'ton micro et le son de l’appel' : 'ton micro seul'}
            {m.speakers ? ` · ${m.speakers} voix chez les autres` : ''}
          </div>
        </div>

        {m.status === 'interrupted' && (
          <div className="rounded-xl bg-led-amber/10 px-3 py-2.5 text-[12px] text-fog-300 ring-1 ring-led-amber/25 ring-inset">
            L’enregistrement a été interrompu avant la fin de la transcription.
            {m.audio ? ' Le son est gardé sur ton PC.' : ''}
            {m.audio && (
              <div className="mt-2">
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={Boolean(busy)}
                  onClick={() => void run('Je reprends la transcription…', () => window.compi.resumeMeeting(id))}
                >
                  <RotateCcw size={13} /> Reprendre la transcription
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          {!m.summary && m.status === 'done' && (
            <Button
              size="sm"
              variant="subtle"
              disabled={Boolean(busy) || blocked || !m.lines.length}
              title={online ? `La transcription part à ${where} (secrets masqués)` : 'Le résumé est fait sur ton PC'}
              onClick={() => void run('Je résume l’appel…', () => window.compi.summarizeMeeting(id))}
            >
              <Wand2 size={13} /> {online ? `Résumer avec ${where}` : 'Résumer (sur ce PC)'}
            </Button>
          )}
          {m.summary && (
            <Button
              size="sm"
              variant="subtle"
              disabled={blocked}
              onClick={followUp}
              title="Rappels, e-mail de suivi, rendez-vous : chaque action te sera proposée avant d’être faite"
            >
              <Sparkles size={13} /> Suite avec Compi
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => void window.compi.exportMeeting(id)}>
            <Download size={13} /> Exporter
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!m.lines.length}
            onClick={() => {
              void navigator.clipboard.writeText(transcriptText(m))
              setCopied(true)
            }}
          >
            {copied ? <Check size={13} /> : <FileText size={13} />} {copied ? 'Copiée' : 'Copier le texte'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={m.status === 'recording' || m.status === 'processing'}
            onClick={() => (confirmDelete ? void window.compi.deleteMeeting(id).then(onBack) : setConfirmDelete(true))}
          >
            <Trash2 size={13} /> {confirmDelete ? 'Supprimer pour de bon ?' : 'Supprimer'}
          </Button>
        </div>
        {blocked && (
          <div className="text-[11.5px] text-fog-500">
            Tes réglages interdisent d’envoyer tes réunions à {where} : choisis un cerveau sur ce PC pour les résumer.
          </div>
        )}
        {busy && <div className="text-[12px] text-fog-300">{busy}</div>}
        {error && <div className="text-[12px] text-led-amber">{error}</div>}

        {m.summary && (
          <div className="space-y-2.5 rounded-2xl bg-white/[0.035] p-3.5 ring-1 ring-white/[0.06] ring-inset">
            <p className="text-[12.5px] leading-relaxed text-fog-100">{m.summary.summary}</p>
            {m.summary.points.length > 0 && (
              <ul className="space-y-1 text-[12px] text-fog-300">
                {m.summary.points.map((p, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-fog-500" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
            {m.summary.tasks.length > 0 && (
              <div>
                <div className="led-text mb-1 text-[10.5px] text-fog-500">Tâches</div>
                <ul className="space-y-1 text-[12px] text-fog-100">
                  {m.summary.tasks.map((t, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[3px] size-3 shrink-0 rounded-[4px] ring-1 ring-fog-500 ring-inset" />
                      <span>
                        {t.text}
                        {(t.owner || t.due) && <span className="text-fog-500"> · {[t.owner, t.due].filter(Boolean).join(', ')}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="text-[10.5px] text-fog-700">Résumé par {m.summary.brain} · transcription automatique, à vérifier</div>
          </div>
        )}

        <VoiceNames m={m} onChange={setM} />

        <div className="space-y-2 pb-2">
          {m.lines.length === 0 && <div className="py-6 text-center text-[12px] text-fog-500">Aucune parole transcrite.</div>}
          {m.lines.map((l, i) => (
            <div key={i} className="flex gap-2.5 text-[12.5px] leading-snug">
              <span className="w-11 shrink-0 pt-px text-right text-[10.5px] text-fog-700 tabular-nums">{clockAt(l.start)}</span>
              <div className="min-w-0">
                <span className="mr-1.5 font-semibold" style={{ color: voiceColor(l.who) }}>
                  {speakerLabel(l.who, m.names)}
                </span>
                <span className="text-fog-300">{l.text}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function TitleInput({ initial, onDone }: { initial: string; onDone: (title: string) => void }) {
  const [value, setValue] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <TextInput
      ref={ref}
      value={value}
      maxLength={80}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim())
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone(initial)
        }
      }}
    />
  )
}

/** Les voix des autres, à nommer (« Personne 1 » → « Léa »). */
function VoiceNames({ m, onChange }: { m: Meeting; onChange: (m: Meeting) => void }) {
  const voices = [...new Set(m.lines.map((l) => l.who).filter((w) => w !== 'me'))]
  const [editing, setEditing] = useState<string | null>(null)
  if (!voices.length) return null
  const save = (who: string, name: string): void => {
    setEditing(null)
    if (name !== (m.names[who] ?? '')) void window.compi.nameMeetingVoice(m.id, who, name).then((x) => x && onChange(x))
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
      <span className="text-fog-500">Voix :</span>
      {voices.map((who) =>
        editing === who ? (
          <VoiceInput key={who} initial={m.names[who] ?? ''} placeholder={speakerLabel(who)} onDone={(name) => save(who, name)} />
        ) : (
          <button
            key={who}
            onClick={() => setEditing(who)}
            title="Donner un nom à cette voix (le même nom pour deux voix les réunit)"
            className="rounded-full px-2 py-0.5 ring-1 ring-white/[0.08] ring-inset hover:bg-white/[0.06]"
            style={{ color: voiceColor(who) }}
          >
            {speakerLabel(who, m.names)}
          </button>
        )
      )}
    </div>
  )
}

function VoiceInput({ initial, placeholder, onDone }: { initial: string; placeholder: string; onDone: (name: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      autoFocus
      value={value}
      maxLength={40}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value.trim())
        if (e.key === 'Escape') {
          e.stopPropagation()
          onDone(initial)
        }
      }}
      className="h-6 w-28 rounded-full bg-white/[0.06] px-2 text-[11.5px] text-fog-100 ring-1 ring-white/[0.12] outline-none ring-inset"
    />
  )
}
