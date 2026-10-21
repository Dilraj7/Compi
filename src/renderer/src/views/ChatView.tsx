import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowUp, Check, CloudUpload, FileText, Globe, Loader2, Lock, Mic, Paperclip, Square, TriangleAlert, Volume2, X } from 'lucide-react'
import { CATEGORY_SENT_LABEL } from '@shared/privacy'
import { followUpFor } from '@shared/claims'
import { gbText, localPhase } from '@shared/perf'
import type { ChatMessage, RunStats, SentTo, ToolActivity } from '@shared/types'
import { useShallow } from 'zustand/react/shallow'
import { useCompi } from '../store'
import { useMood } from '../mascot/useMood'
import { RobotHead } from '../mascot/RobotHead'
import { Markdown } from '../components/Markdown'
import { PendingRequests } from '../components/Cards'
import { BrainChip, BrainPicker, useBrainReady, WelcomeBrains } from '../components/BrainPicker'
import { Button, LedDots, cx, prettyShortcut } from '../components/ui'

const SUGGESTIONS = [
  { label: 'Résume ce que j’ai copié', prompt: 'Résume le contenu de mon presse-papier.' },
  { label: 'Que vois-tu sur mon écran ?', prompt: 'Regarde mon écran et explique-moi ce que tu vois.' },
  { label: 'Rappelle-moi dans 20 min', prompt: 'Rappelle-moi dans 20 minutes de faire une pause.' },
  { label: 'Météo de demain', prompt: 'Quel temps fera-t-il demain chez moi ?' }
]

function Hero() {
  const { mood, color } = useMood()
  const name = useCompi((s) => s.settings?.userName)
  const send = useCompi((s) => s.send)
  const ready = useBrainReady()
  const [poked, setPoked] = useState(0)

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 pb-2">
      <motion.div
        initial={{ y: 14, opacity: 0, scale: 0.9 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.08 }}
      >
        <RobotHead
          mood={poked ? 'wink' : mood}
          color={color}
          width={118}
          onPoke={() => {
            setPoked((p) => p + 1)
            setTimeout(() => setPoked(0), 900)
          }}
        />
      </motion.div>
      <motion.h2
        className="mt-4 text-[20px] font-semibold tracking-tight text-fog-100"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.16 } }}
      >
        Salut{name ? ` ${name}` : ''}, je suis Compi.
      </motion.h2>
      <motion.p
        className="mt-1 text-center text-[13px] text-fog-500"
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { delay: 0.22 } }}
      >
        Pose-moi une question, demande un coup de main… ou dépose un fichier sur moi.
      </motion.p>
      {ready ? <BrainChip /> : <WelcomeBrains />}
      <div className={cx('mt-5 grid w-full max-w-[520px] grid-cols-2 gap-2', !ready && 'hidden')}>
        {SUGGESTIONS.map((s, i) => (
          <motion.button
            key={s.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0, transition: { delay: 0.28 + i * 0.05 } }}
            onClick={() => void send(s.prompt)}
            className="group rounded-2xl bg-white/[0.04] px-3.5 py-2.5 text-left text-[12.5px] text-fog-300 ring-1 ring-inset ring-white/[0.06] transition-all hover:-translate-y-px hover:bg-white/[0.07] hover:text-fog-100"
          >
            <span className="mr-2 inline-block size-1.5 rounded-[1px] bg-[var(--led)] align-middle opacity-60 shadow-[0_0_6px_var(--led)] transition-opacity group-hover:opacity-100" />
            {s.label}
          </motion.button>
        ))}
      </div>
    </div>
  )
}

function ToolRow({ tool }: { tool: ToolActivity }) {
  const Icon = tool.name === 'WebSearch' || tool.name === 'WebFetch' ? Globe : FileText
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-[11.5px] text-fog-500">
      <span className="grid size-4.5 place-items-center rounded-md bg-white/[0.05]">
        {tool.status === 'running' ? (
          <Loader2 size={11} className="animate-spin text-[var(--led)]" />
        ) : tool.status === 'error' ? (
          <X size={11} className="text-led-red" />
        ) : (
          <Check size={11} className="text-led-green" />
        )}
      </span>
      <Icon size={12} className="opacity-60" />
      <span className="truncate">{tool.label}</span>
    </motion.div>
  )
}

const seconds = (ms: number): string => `${(ms / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} s`

/** Ouvre Activité sur « Ce PC ». */
export function showPerf(): void {
  const s = useCompi.getState()
  s.focusActivity('perf')
  s.setView('activity')
}

/** Vitesse mesurée par la passerelle (cerveaux local et « Autre »), et la cause d'une lenteur. */
function SpeedLine({ stats }: { stats: RunStats }) {
  const parts = [
    stats.firstTokenMs !== undefined && `1er mot en ${seconds(stats.firstTokenMs)}`,
    stats.tokensPerSec !== undefined && `${stats.tokensPerSec} jetons/s`
  ].filter(Boolean)
  if (!parts.length) return null
  const causes = [
    stats.coldStart && 'modèle rechargé',
    stats.gpuShare !== undefined && stats.gpuShare < 0.97 && `${Math.round((1 - stats.gpuShare) * 100)} % sur le processeur`
  ].filter(Boolean)
  const slow = causes.length > 0 || (stats.firstTokenMs ?? 0) > 20_000 || (stats.tokensPerSec !== undefined && stats.tokensPerSec < 15)
  return (
    <span>
      {parts.join(' · ')}
      {causes.length > 0 && <span className="text-led-amber/80"> · {causes.join(' · ')}</span>}
      {slow && (
        <button
          className="ml-1.5 underline decoration-dotted underline-offset-2 hover:text-fog-300"
          onClick={showPerf}
          title="Voir ce qui ralentit le modèle local"
        >
          Pourquoi ?
        </button>
      )}
    </span>
  )
}

/** Avant le premier mot d'une réponse locale : ce qui se passe, et depuis combien de temps. */
function LocalWait() {
  const perf = useCompi((s) => s.perf)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const phase = localPhase(perf)
  if (!phase || !perf?.generating) return null
  const elapsed = Math.max(0, Date.now() - perf.generating.since)
  const free = perf.ram.totalGb - perf.ram.usedGb
  const tight = phase === 'loading' && free < 3
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-fog-500">
      <LedDots /> {phase === 'loading' ? 'Je charge le modèle en mémoire…' : 'Je relis ta demande…'}
      <span className="font-mono text-[11px] text-fog-700">{seconds(Math.round(elapsed / 1000) * 1000)}</span>
      {tight && elapsed > 20_000 && (
        <span className="text-[11.5px] text-led-amber/80">
          Il reste {gbText(free)} de mémoire : ça peut prendre quelques minutes.{' '}
          <button className="underline decoration-dotted underline-offset-2 hover:text-led-amber" onClick={showPerf}>
            Voir Ce PC
          </button>
        </span>
      )}
      {phase === 'reading' && elapsed > 20_000 && (
        <span className="text-[11.5px] text-fog-600">
          Je relis mes consignes et mes outils, ce qui peut prendre quelques minutes sur ce PC. Ensuite je les garde en mémoire : les questions suivantes iront
          bien plus vite.
        </span>
      )}
    </div>
  )
}

/** Ce qui a quitté le PC pour cette réponse, et vers qui. */
function SentLine({ sent }: { sent: SentTo }) {
  if (!sent.destination) {
    return (
      <span className="inline-flex items-center gap-1" title="Ni ta question ni tes données n’ont quitté ce PC.">
        <Lock size={10} /> 100 % sur ton PC
      </span>
    )
  }
  const items = ['ta question', ...sent.categories.map((c) => CATEGORY_SENT_LABEL[c])]
  return (
    <span className="inline-flex items-center gap-1" title="Ce qui est parti vers le service en ligne pour cette réponse.">
      <CloudUpload size={10} /> Envoyé à {sent.destination} : {items.join(' · ')}
      {sent.masked ? ` · ${sent.masked} secret${sent.masked > 1 ? 's' : ''} masqué${sent.masked > 1 ? 's' : ''}` : ''}
    </span>
  )
}

/** Lire la réponse à voix haute, avec une voix de Windows (rien ne quitte le PC). */
function ListenButton({ m }: { m: ChatMessage }) {
  const active = useCompi((s) => s.speaking && s.speakingId === m.id)
  return (
    <button
      className={cx('inline-flex items-center gap-1 transition-colors hover:text-fog-300', active && 'text-[var(--led)]')}
      title={active ? 'Arrêter la lecture' : 'Lire à voix haute (voix de Windows, sur ton PC)'}
      onClick={() => (active ? useCompi.getState().stopSpeaking() : useCompi.getState().speak(m.text, m.id))}
    >
      {active ? <Square size={9} fill="currentColor" /> : <Volume2 size={11} />}
      {active ? 'Arrêter' : 'Écouter'}
    </button>
  )
}

/**
 * La réponse annonce une action (ou un souvenir) que rien n'a faite, même après la
 * relance automatique : l'utilisateur choisit (bouton seulement sous la dernière réponse).
 */
function NoticeLine({ m, last }: { m: ChatMessage; last: boolean }) {
  const busy = useCompi((s) => s.streamingId !== null)
  if (!m.notice) return null
  return (
    <div className="flex items-start gap-2.5 rounded-2xl bg-led-amber/[0.07] px-3.5 py-2.5 text-[12.5px] text-led-amber ring-1 ring-inset ring-led-amber/20">
      <TriangleAlert size={15} className="mt-0.5 shrink-0" />
      <div className="flex-1">
        {m.notice === 'not-saved'
          ? 'Rien n’a été enregistré dans la mémoire de Compi : il l’aura oublié à la prochaine discussion.'
          : m.notice === 'no-action'
            ? 'Aucune action n’a été faite pendant cette réponse : rien n’a changé.'
            : 'Compi a annoncé une action, puis s’est arrêté sans la faire.'}
        {last && (
          <div className="mt-2">
            <Button size="sm" disabled={busy} onClick={() => void useCompi.getState().send(followUpFor(m.notice!))}>
              {m.notice === 'not-saved' ? 'L’enregistrer vraiment' : 'Le faire vraiment'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function Message({ m, streaming, last }: { m: ChatMessage; streaming: boolean; last: boolean }) {
  const phase = useCompi((s) => s.phase)
  const setView = useCompi((s) => s.setView)
  const perf = useCompi((s) => (streaming && !m.text ? s.perf : null))

  if (m.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-end gap-1.5">
        {m.attachments?.length ? (
          <div className="flex flex-wrap justify-end gap-1.5">
            {m.attachments.map((a) => (
              <span key={a} className="inline-flex items-center gap-1 rounded-lg bg-white/[0.05] px-2 py-1 text-[11px] text-fog-300">
                <FileText size={11} /> {a.split(/[\\/]/).pop()}
              </span>
            ))}
          </div>
        ) : null}
        <div className="max-w-[82%] rounded-[18px] rounded-br-md bg-ink-700 px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-fog-100 select-text">
          {m.text}
        </div>
      </motion.div>
    )
  }

  const waitingFirstToken = streaming && !m.text
  const local = waitingFirstToken && phase === 'thinking' && localPhase(perf) !== null
  return (
    <div className="space-y-2">
      {m.tools?.length ? (
        <div className="space-y-1">
          {m.tools.map((t) => (
            <ToolRow key={t.id} tool={t} />
          ))}
        </div>
      ) : null}
      {local && <LocalWait />}
      {waitingFirstToken && !local && (
        <div className="flex items-center gap-2 text-[12px] text-fog-500">
          <LedDots /> {phase === 'tool' ? 'Je travaille…' : 'Je réfléchis…'}
        </div>
      )}
      {m.text && (
        <div className={cx('prose-compi', streaming && phase === 'text' && 'caret')}>
          <Markdown text={m.text} />
        </div>
      )}
      {!streaming && (m.text || m.sentTo || m.stats) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-fog-700">
          {m.text && <ListenButton m={m} />}
          {m.sentTo && <SentLine sent={m.sentTo} />}
          {m.stats && <SpeedLine stats={m.stats} />}
        </div>
      )}
      {!streaming && <NoticeLine m={m} last={last} />}
      {m.error && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-led-red/[0.08] px-3.5 py-2.5 text-[12.5px] text-led-red ring-1 ring-inset ring-led-red/20">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <div className="flex-1">
            {m.error}
            {/clé API|réglages/i.test(m.error) && (
              <div className="mt-2">
                <Button size="sm" variant="danger" onClick={() => setView('settings')}>
                  Ouvrir les réglages
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** Niveau du micro en colonnes de points LED, qui défilent de droite à gauche. */
function MicMeter() {
  const level = useCompi((s) => s.dictation.level)
  const history = useRef<number[]>(Array(18).fill(0))
  history.current = [...history.current.slice(1), level]
  return (
    <span className="flex h-4 items-end gap-[2px]" aria-hidden>
      {history.current.map((v, i) => {
        const dots = Math.max(1, Math.round(Math.min(1, v * 1.6) * 4))
        return (
          <span key={i} className="flex flex-col-reverse gap-[1px]">
            {[0, 1, 2, 3].map((d) => (
              <span
                key={d}
                className="size-[3px] rounded-[0.5px]"
                style={{ background: d < dots ? 'var(--led)' : 'rgb(255 255 255 / 0.08)', boxShadow: d < dots ? '0 0 4px var(--led)' : undefined }}
              />
            ))}
          </span>
        )
      })}
    </span>
  )
}

/** Bandeau de la dictée au-dessus de la saisie : écoute, transcription, erreur. */
function DictationBar() {
  const { phase, preparing, error } = useCompi(useShallow((s) => ({ phase: s.dictation.phase, preparing: s.dictation.preparing, error: s.dictation.error })))
  if (phase === 'idle' && !error) return null
  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mb-1.5 flex items-center gap-2.5 px-2 text-[11.5px]">
      {phase === 'recording' && (
        <>
          <MicMeter />
          <span className="text-fog-100">Je t’écoute…</span>
          <span className="truncate text-fog-700">relâche ou fais une pause pour envoyer · Échap pour annuler</span>
        </>
      )}
      {phase === 'starting' && <span className="text-fog-500">Ouverture du micro…</span>}
      {phase === 'transcribing' && (
        <>
          <LedDots />
          <span className="text-fog-300">{preparing !== null ? `Préparation de la dictée… ${Math.round(preparing * 100)} %` : 'Je transcris…'}</span>
        </>
      )}
      {phase === 'idle' && error && <span className="text-led-amber">{error}</span>}
    </motion.div>
  )
}

function Composer() {
  const send = useCompi((s) => s.send)
  const stop = useCompi((s) => s.stop)
  const streaming = useCompi((s) => s.streamingId !== null)
  const focused = useCompi((s) => s.focused)
  const attachments = useCompi((s) => s.attachments)
  const removeAttachment = useCompi((s) => s.removeAttachment)
  const addAttachments = useCompi((s) => s.addAttachments)
  const brainHint = useCompi((s) => s.brainHint)
  const draft = useCompi((s) => s.draft)
  const setDraft = useCompi((s) => s.setDraft)
  const dictating = useCompi((s) => s.dictation.phase === 'recording' || s.dictation.phase === 'starting')
  const voiceKey = useCompi((s) => (s.settings?.voiceShortcutActive ? s.settings.voice.shortcut : ''))
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = (): void => {
      el.style.height = '0px'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }
    fit()
    // Le panneau s'ouvre en s'élargissant : on remesure quand la largeur change.
    let width = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth
        fit()
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [text])

  useEffect(() => {
    if (focused) setTimeout(() => ref.current?.focus(), 60)
  }, [focused])

  // Texte repris d'une action rapide : placé dans la saisie, curseur à la fin.
  useEffect(() => {
    if (draft === null) return
    setText(draft)
    setDraft(null)
    setTimeout(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
    }, 80)
  }, [draft, setDraft])

  const submit = (): void => {
    if (streaming) return
    if (!text.trim() && !attachments.length) return
    void send(text)
    setText('')
  }

  return (
    <div className="shrink-0 px-4 pt-1 pb-4">
      <AnimatePresence>
        {brainHint && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mb-1.5 px-2 text-[11.5px] text-[var(--led)]"
          >
            {brainHint}
          </motion.div>
        )}
      </AnimatePresence>
      <DictationBar />
      <div className="rounded-[20px] bg-ink-850 ring-1 ring-inset ring-white/[0.08] transition-shadow focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--led)_45%,transparent),0_0_24px_-8px_var(--led)]">
        <AnimatePresence initial={false}>
          {attachments.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex flex-wrap gap-1.5 overflow-hidden px-3 pt-2.5"
            >
              {attachments.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.06] py-1 pr-1 pl-2 text-[11.5px] text-fog-300">
                  <FileText size={12} className="text-[var(--led)]" />
                  {a.split(/[\\/]/).pop()}
                  <button
                    onClick={() => removeAttachment(a)}
                    className="grid size-4 place-items-center rounded text-fog-500 hover:bg-white/10 hover:text-fog-100"
                    aria-label="Retirer"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="flex items-end gap-1.5 p-1.5 pl-2">
          <button
            onClick={async () => {
              const paths = await window.compi.pickFiles()
              if (paths.length) addAttachments(paths)
              ref.current?.focus()
            }}
            className="grid size-8 shrink-0 place-items-center rounded-xl text-fog-500 transition-colors hover:bg-white/[0.06] hover:text-fog-100"
            aria-label="Joindre un fichier"
            title="Joindre un fichier"
          >
            <Paperclip size={16} />
          </button>
          <BrainPicker />
          <textarea
            ref={ref}
            data-chat-input
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="Demande à Compi…"
            className="max-h-[120px] min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] leading-[1.45] text-fog-100 outline-none placeholder:text-fog-700 select-text"
          />
          <button
            onClick={() => (dictating ? useCompi.getState().stopDictation() : void useCompi.getState().startDictation())}
            className={cx(
              'grid size-8 shrink-0 place-items-center rounded-xl transition-colors',
              dictating ? 'bg-[var(--led)]/15 text-[var(--led)] shadow-[0_0_14px_-4px_var(--led)]' : 'text-fog-500 hover:bg-white/[0.06] hover:text-fog-100'
            )}
            aria-label={dictating ? 'Terminer la dictée' : 'Dicter'}
            title={dictating ? 'Terminer et envoyer' : `Dicter, sur ton PC${voiceKey ? ` (maintiens ${prettyShortcut(voiceKey)})` : ''}`}
          >
            <Mic size={16} />
          </button>
          {streaming ? (
            <button
              onClick={stop}
              className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.1] text-fog-100 transition-colors hover:bg-white/[0.16]"
              aria-label="Arrêter"
              title="Arrêter"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim() && !attachments.length}
              className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--led)] text-black shadow-[0_0_16px_-4px_var(--led)] transition-all hover:brightness-110 active:scale-95 disabled:bg-white/[0.08] disabled:text-fog-700 disabled:shadow-none"
              aria-label="Envoyer"
              title="Envoyer (Entrée)"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Demandes d'autorisation affichées sur place : pas besoin de changer d'onglet. */
function PendingTray() {
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  if (!pending) return null
  return (
    <div className="scroll-y max-h-[60%] shrink-0 space-y-2 px-5 pt-1 pb-2">
      <PendingRequests />
    </div>
  )
}

export function ChatView() {
  const messages = useCompi((s) => s.messages)
  const streamingId = useCompi((s) => s.streamingId)
  const pending = useCompi((s) => s.approvals.length + s.questions.length)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const last = messages.at(-1)
  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [messages.length, last?.text, last?.tools?.length])

  return (
    <>
      {messages.length === 0 ? (
        // Une validation attend : on laisse la place à la carte plutôt qu'à l'accueil.
        pending ? (
          <div className="flex-1" />
        ) : (
          <Hero />
        )
      ) : (
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          }}
          className="scroll-y flex-1 space-y-4 px-5 pt-2 pb-3"
        >
          {messages.map((m, i) => (
            <Message key={m.id} m={m} streaming={m.id === streamingId} last={i === messages.length - 1} />
          ))}
        </div>
      )}
      <PendingTray />
      <Composer />
    </>
  )
}
