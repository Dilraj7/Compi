import { create } from 'zustand'
import { brainLabel, defaultBrain } from '@shared/brains'
import type {
  AgentEvent,
  ApprovalRequest,
  Brain,
  ChatMessage,
  ClaudeSession,
  IslandMode,
  IslandNotice,
  MediaInfo,
  ModelId,
  PanelView,
  PublicSettings,
  QuestionRequest,
  QuickActionId,
  QuickEvent,
  QuickSelection,
  Settings,
  TimerState
} from '@shared/types'
import type { PerfSnapshot } from '@shared/perf'
import { noticeDuration } from '@shared/notice'
import { onSpeaking, speak, speakStream, stopSpeaking, type SpeechStream } from './lib/speech'
import { cancelListening, isRecording, loadModel, startListening, stopListening, type VoicePhase } from './lib/voice'

const api = () => window.compi

let interactive = false
/**
 * Clic traversant : la fenêtre ignore la souris hors de l'îlot. Un seul état
 * partagé par le survol (App) et l'ouverture du panneau, pour ne jamais
 * laisser la fenêtre transparente bloquer les clics vers les autres apps.
 */
export function setInteractive(v: boolean): void {
  if (v === interactive) return
  interactive = v
  api().setInteractive(v)
}

/** Ordre des onglets de l'en-tête : Ctrl+1 … Ctrl+7. */
export const TAB_ORDER: PanelView[] = ['chat', 'today', 'activity', 'history', 'memory', 'connectors', 'settings']

/** Partie des réglages à montrer en ouvrant Réglages. */
export type SettingsFocus = 'quiz' | 'voice' | 'privacy' | 'messages' | 'brain' | 'island' | 'sounds' | 'keys' | 'agenda'

type Phase = 'thinking' | 'tool' | 'text' | null

/** Actions rapides sur le texte sélectionné dans une autre application. */
export interface QuickState {
  selection: QuickSelection
  action: QuickActionId | null
  result: string
  status: 'idle' | 'running' | 'done' | 'error'
  error?: string
  /** Message après Remplacer / Copier. */
  notice?: string
}

interface CompiState {
  settings: PublicSettings | null
  mode: IslandMode
  view: PanelView
  /** Le panneau a le focus clavier (ouvert pour discuter). */
  focused: boolean
  /** Ouvert automatiquement pour une validation (se refermera seul). */
  attention: boolean
  notice: IslandNotice | null
  sleepy: boolean

  conversationId: string | null
  /** Cerveau de la discussion ouverte (`null` : nouvelle discussion, cerveau par défaut). */
  conversationBrain: Brain | null
  /** Indice affiché un instant au-dessus de la saisie (« Nouvelle discussion avec… »). */
  brainHint: string | null
  /** Ouvrir les réglages directement sur le questionnaire du cerveau. */
  settingsFocus: SettingsFocus | null
  messages: ChatMessage[]
  streamingId: string | null
  phase: Phase
  outcome: 'done' | 'error' | null
  attachments: string[]

  approvals: ApprovalRequest[]
  questions: QuestionRequest[]
  sessions: ClaudeSession[]

  quick: QuickState | null
  /** Texte à placer dans la saisie du chat (« Continuer dans la discussion »). */
  draft: string | null

  /** Îlot vivant : musique en cours, minuteur, lecture à voix haute. */
  media: MediaInfo | null
  timer: TimerState | null
  speaking: boolean
  /** Message en cours de lecture (bouton « Écouter » / « Arrêter »). */
  speakingId: string | null
  /** Le dernier message a été dicté (pour « Lire les réponses : quand je parle »). */
  spokenInput: boolean
  /** Dictée : écoute, transcription, niveau du micro (0 à 1), préparation du modèle. */
  dictation: { phase: VoicePhase; level: number; preparing: number | null; error: string | null }
  /** Activité du PC (Ce PC, îlot) : dernier instantané reçu. */
  perf: PerfSnapshot | null
  /** Jeton : la première carte en attente prend le clavier (Alt+Maj+Espace, question par raccourci). */
  focusPendingAt: number
  /** Palette de recherche (Ctrl+K). */
  palette: boolean
  /** Activité : faire défiler jusqu'à « Ce PC ». */
  activityFocus: 'perf' | null

  setSettings(s: PublicSettings): void
  open(view?: PanelView, opts?: { focus?: boolean; attention?: boolean }): void
  collapse(): void
  hover(on: boolean): void
  setView(v: PanelView): void
  showNotice(n: IslandNotice): void
  dismissNotice(): void
  /** Souris sur la notification : elle reste affichée, puis repart 2 s après le départ de la souris. */
  holdNotice(on: boolean): void
  /** Le texte de la notification défile pendant `ms` à partir de `startedAt` : on attend la fin. */
  noticeScrollTime(ms: number, startedAt: number): void
  wake(): void

  newConversation(): void
  loadConversation(id: string): Promise<void>
  /** Choisit un cerveau : devient celui par défaut, et celui de la discussion si le fournisseur est le même. */
  pickBrain(brain: Brain, extra?: Partial<Settings>): Promise<void>
  focusSettings(focus: SettingsFocus | null): void
  /** `voice` : message dicté (la réponse pourra être lue à voix haute). */
  send(text: string, opts?: { voice?: boolean }): Promise<void>
  stop(): void
  addAttachments(paths: string[]): void
  removeAttachment(path: string): void
  onAgentEvent(e: AgentEvent): void

  setApprovals(a: ApprovalRequest[]): void
  setQuestions(q: QuestionRequest[]): void
  setSessions(s: ClaudeSession[]): void

  openQuick(selection: QuickSelection): void
  runQuick(action: QuickActionId): void
  onQuickEvent(e: QuickEvent): void
  setQuickNotice(notice: string | undefined): void
  continueQuick(): void
  setDraft(draft: string | null): void

  setMedia(m: MediaInfo | null): void
  setTimer(t: TimerState | null): void
  /** Lit un texte à voix haute (remplace la lecture en cours). */
  speak(text: string, messageId?: string): void
  stopSpeaking(): void
  /** Dictée : démarre l'écoute (le modèle doit être installé). */
  startDictation(): Promise<void>
  /** Fin de la prise de parole : transcription puis envoi. */
  stopDictation(): void
  cancelDictation(): void
  setPerf(p: PerfSnapshot | null): void
  focusPending(): void
  setPalette(on: boolean): void
  focusActivity(f: 'perf' | null): void
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined
/** Notification affichée : son arrivée, son défilement, et la souris qui la retient. */
let noticeShownAt = 0
let noticeScroll = { ms: 0, startedAt: 0 }
let noticeFloor = 0
let noticeHeld = false
/** Réponse lue au fil de l'eau pendant qu'elle s'écrit. */
let liveSpeech: { messageId: string; stream: SpeechStream } | null = null
let outcomeTimer: ReturnType<typeof setTimeout> | undefined
let sleepTimer: ReturnType<typeof setTimeout> | undefined
let hoverTimer: ReturnType<typeof setTimeout> | undefined
let hintTimer: ReturnType<typeof setTimeout> | undefined
let dictationErrorTimer: ReturnType<typeof setTimeout> | undefined

const SLEEP_AFTER_MS = 4 * 60_000

export const useCompi = create<CompiState>((set, get) => {
  const flashOutcome = (outcome: 'done' | 'error'): void => {
    clearTimeout(outcomeTimer)
    set({ outcome })
    outcomeTimer = setTimeout(() => set({ outcome: null }), outcome === 'error' ? 3500 : 2400)
  }

  const scheduleSleep = (): void => {
    clearTimeout(sleepTimer)
    sleepTimer = setTimeout(() => {
      const s = get()
      if (s.mode !== 'expanded' && !s.streamingId) set({ sleepy: true })
    }, SLEEP_AFTER_MS)
  }

  const restingMode = (): IslandMode => (get().settings?.autoHide ? 'hidden' : 'compact')

  // Lire les réponses à voix haute : toujours, ou quand la question était dictée.
  const wantsSpeech = (): boolean => {
    const { settings, spokenInput } = get()
    const mode = settings?.voice.speak ?? 'never'
    return mode === 'always' || (mode === 'voice' && spokenInput)
  }

  // Réponse en cours : chaque phrase terminée est lue sans attendre la fin.
  const followSpeech = (messageId: string, text: string): void => {
    if (liveSpeech?.messageId !== messageId) {
      if (get().streamingId !== messageId || !wantsSpeech() || !text.trim()) return
      liveSpeech = { messageId, stream: speakStream() }
      set({ speakingId: messageId })
    }
    liveSpeech.stream.push(text)
  }

  // Réponse terminée : la fin est lue (ou toute la réponse, si rien n'a été lu en route).
  const finishSpeech = (messageId: string): void => {
    const text = get().messages.find((m) => m.id === messageId)?.text ?? ''
    if (liveSpeech?.messageId === messageId) {
      liveSpeech.stream.end(text)
      liveSpeech = null
    } else if (wantsSpeech() && text.trim()) get().speak(text, messageId)
  }

  // La notification s'efface à la fin de sa durée, prolongée le temps de son défilement,
  // sauf si la souris la retient.
  const scheduleNotice = (): void => {
    clearTimeout(noticeTimer)
    const n = get().notice
    if (!n || noticeHeld) return
    const scroll = noticeScroll.ms > 0 ? noticeScroll.startedAt - noticeShownAt + noticeScroll.ms : 0
    const end = Math.max(noticeFloor, noticeShownAt + noticeDuration(n.duration, scroll))
    noticeTimer = setTimeout(() => set({ notice: null }), Math.max(0, end - Date.now()))
  }

  onSpeaking((speaking) => {
    if (get().speaking !== speaking) set(speaking ? { speaking } : { speaking, speakingId: null })
  })

  scheduleSleep()

  return {
    settings: null,
    mode: 'compact',
    view: 'chat',
    focused: false,
    attention: false,
    notice: null,
    sleepy: false,

    conversationId: null,
    conversationBrain: null,
    brainHint: null,
    settingsFocus: null,
    messages: [],
    streamingId: null,
    phase: null,
    outcome: null,
    attachments: [],

    approvals: [],
    questions: [],
    sessions: [],

    quick: null,
    draft: null,

    media: null,
    timer: null,
    speaking: false,
    speakingId: null,
    spokenInput: false,
    dictation: { phase: 'idle', level: 0, preparing: null, error: null },
    perf: null,
    focusPendingAt: 0,
    palette: false,
    activityFocus: null,

    setSettings: (settings) => {
      set({ settings })
      const { mode } = get()
      if (mode === 'compact' || mode === 'hidden') set({ mode: settings.autoHide ? 'hidden' : 'compact' })
    },

    open: (view, opts = {}) => {
      const focus = opts.focus ?? false
      const s = get()
      // Une longue notification (réunion…) ne doit pas réapparaître à la fermeture.
      if (s.notice && (s.notice.duration ?? 0) > 5000) {
        clearTimeout(noticeTimer)
        set({ notice: null })
      } else {
        // Le panneau remplace l'aperçu sous la souris : la notification repart (bandeau).
        get().holdNotice(false)
      }
      set({
        mode: 'expanded',
        view: view ?? s.view,
        focused: focus || s.focused,
        attention: opts.attention ?? (s.mode === 'expanded' ? s.attention : !focus),
        sleepy: false
      })
      setInteractive(true)
      // Ouvert sans le clavier, le panneau doit quand même répondre au premier clic.
      if (focus) api().setFocusable(true)
      else api().setActivatable(true)
    },

    collapse: () => {
      api().setFocusable(false)
      set({ mode: restingMode(), focused: false, attention: false, palette: false })
      // Le bandeau disparaît avec le panneau : il ne retient plus la notification.
      get().holdNotice(false)
      scheduleSleep()
    },

    hover: (on) => {
      clearTimeout(hoverTimer)
      const { mode } = get()
      if (mode === 'expanded') return
      if (on) {
        get().wake()
        hoverTimer = setTimeout(() => {
          if (get().mode !== 'expanded') set({ mode: 'peek' })
        }, 110)
      } else {
        hoverTimer = setTimeout(() => {
          if (get().mode === 'peek') set({ mode: restingMode() })
        }, 260)
      }
    },

    setView: (view) => set({ view }),

    showNotice: (notice) => {
      noticeShownAt = Date.now()
      noticeScroll = { ms: 0, startedAt: 0 }
      noticeFloor = 0
      set({ notice, sleepy: false })
      scheduleNotice()
    },

    dismissNotice: () => {
      clearTimeout(noticeTimer)
      noticeHeld = false
      set({ notice: null })
    },

    holdNotice: (on) => {
      if (on === noticeHeld) return
      noticeHeld = on
      if (!on) noticeFloor = Date.now() + 2000
      scheduleNotice()
    },

    noticeScrollTime: (ms, startedAt) => {
      noticeScroll = { ms, startedAt }
      scheduleNotice()
    },

    wake: () => {
      if (get().sleepy) set({ sleepy: false })
      scheduleSleep()
    },

    newConversation: () => set({ conversationId: null, conversationBrain: null, messages: [], streamingId: null, phase: null, view: 'chat' }),

    loadConversation: async (id) => {
      const conv = await api().getConversation(id)
      if (!conv) return
      const s = get().settings
      // Les anciennes discussions, d'avant le choix du cerveau, étaient avec Claude.
      const brain = conv.brain ?? (s ? { provider: 'anthropic' as const, model: s.model } : null)
      set({ conversationId: conv.id, conversationBrain: brain, messages: conv.messages, streamingId: null, phase: null, view: 'chat' })
    },

    pickBrain: async (brain, extra = {}) => {
      const s = get().settings
      if (!s) return
      const patch: Partial<Settings> =
        brain.provider === 'anthropic'
          ? { provider: 'anthropic', model: brain.model as ModelId }
          : brain.provider === 'local'
            ? { provider: 'local', local: { ...s.local, ...extra.local, model: brain.model } }
            : { provider: 'custom' }
      const next = await api().updateSettings({ ...extra, ...patch })
      get().setSettings(next)
      const { conversationId, messages, conversationBrain } = get()
      if (!conversationId || !messages.length) return
      const current = conversationBrain ?? defaultBrain(s)
      if (current.provider === brain.provider) {
        await api().setConversationBrain(conversationId, brain)
        set({ conversationBrain: brain })
      } else {
        // Un autre fournisseur ne peut pas reprendre la discussion : on en ouvre une nouvelle.
        get().newConversation()
        clearTimeout(hintTimer)
        set({ brainHint: `Nouvelle discussion avec ${brainLabel(brain, next)}` })
        hintTimer = setTimeout(() => set({ brainHint: null }), 4500)
      }
    },

    focusSettings: (settingsFocus) => set({ settingsFocus }),

    send: async (text, opts = {}) => {
      const trimmed = text.trim()
      const { attachments } = get()
      if (!trimmed && !attachments.length) return
      const prompt = trimmed || 'Que peux-tu me dire sur ce fichier ?'
      stopSpeaking()
      liveSpeech = null
      set({ attachments: [], spokenInput: opts.voice ?? false })
      const res = await api().send({ conversationId: get().conversationId ?? undefined, text: prompt, attachments })
      const settings = get().settings
      set((s) => ({
        conversationId: res.conversationId,
        conversationBrain: s.conversationBrain ?? (settings ? defaultBrain(settings) : null),
        brainHint: null,
        messages: [...s.messages, res.userMessage, { id: res.assistantMessageId, role: 'assistant', text: '', tools: [], createdAt: Date.now() }],
        streamingId: res.assistantMessageId,
        phase: 'thinking'
      }))
    },

    stop: () => {
      const { conversationId } = get()
      if (conversationId) void api().stop(conversationId)
    },

    addAttachments: (paths) => set((s) => ({ attachments: [...new Set([...s.attachments, ...paths])] })),
    removeAttachment: (path) => set((s) => ({ attachments: s.attachments.filter((a) => a !== path) })),

    onAgentEvent: (e) => {
      if (e.conversationId !== get().conversationId) {
        if (e.type === 'done') flashOutcome('done')
        return
      }
      const patch = (fn: (m: ChatMessage) => ChatMessage): void => set((s) => ({ messages: s.messages.map((m) => (m.id === e.messageId ? fn(m) : m)) }))

      switch (e.type) {
        case 'thinking':
          set({ phase: get().phase === 'text' ? 'text' : 'thinking' })
          break
        case 'text':
          set({ phase: 'text' })
          patch((m) => ({ ...m, text: m.text + e.delta }))
          followSpeech(e.messageId, get().messages.find((m) => m.id === e.messageId)?.text ?? '')
          break
        case 'tool':
          set({ phase: e.tool.status === 'running' ? 'tool' : get().phase })
          patch((m) => {
            const tools = m.tools ?? []
            const exists = tools.some((t) => t.id === e.tool.id)
            return { ...m, tools: exists ? tools.map((t) => (t.id === e.tool.id ? e.tool : t)) : [...tools, e.tool] }
          })
          break
        case 'done':
          // Seule la réponse en cours s'arrête (une ancienne réponse peut finir en retard).
          if (get().streamingId === e.messageId) set({ streamingId: null, phase: null })
          if (e.stats || e.sentTo || e.notice) patch((m) => ({ ...m, stats: e.stats ?? m.stats, sentTo: e.sentTo ?? m.sentTo, notice: e.notice ?? m.notice }))
          flashOutcome('done')
          finishSpeech(e.messageId)
          break
        case 'error':
          if (get().streamingId === e.messageId) set({ streamingId: null, phase: null })
          patch((m) => ({ ...m, error: e.error }))
          flashOutcome('error')
          // Ce qui était déjà en file est lu, rien de plus.
          if (liveSpeech?.messageId === e.messageId) {
            liveSpeech.stream.end()
            liveSpeech = null
          }
          break
      }
    },

    setApprovals: (approvals) => {
      const before = get().approvals.length + get().questions.length
      set({ approvals })
      const after = approvals.length + get().questions.length
      if (after === 0 && before > 0 && get().attention && !get().focused) setTimeout(() => get().collapse(), 700)
    },
    setQuestions: (questions) => {
      const before = get().approvals.length + get().questions.length
      set({ questions })
      const after = get().approvals.length + questions.length
      if (after === 0 && before > 0 && get().attention && !get().focused) setTimeout(() => get().collapse(), 700)
    },
    setSessions: (sessions) => set({ sessions }),

    openQuick: (selection) => {
      set({ quick: { selection, action: null, result: '', status: 'idle' } })
      get().open('quick', { focus: true, attention: false })
    },

    runQuick: (action) => {
      const q = get().quick
      if (!q) return
      set({ quick: { ...q, action, result: '', status: 'running', error: undefined, notice: undefined } })
      void api().quickRun(q.selection.id, action)
    },

    onQuickEvent: (e) => {
      const q = get().quick
      if (!q || q.selection.id !== e.id) return
      if (e.type === 'delta') set({ quick: { ...q, result: q.result + e.delta } })
      else if (e.type === 'done') set({ quick: { ...q, result: e.text, status: 'done' } })
      else set({ quick: { ...q, status: 'error', error: e.error } })
    },

    setQuickNotice: (notice) => {
      const q = get().quick
      if (q) set({ quick: { ...q, notice } })
    },

    continueQuick: () => {
      const q = get().quick
      if (!q) return
      const excerpt = q.selection.text.length > 4000 ? `${q.selection.text.slice(0, 4000)}…` : q.selection.text
      void api().quickStop()
      get().newConversation()
      const where = q.selection.source ? ` dans « ${q.selection.source} »` : ''
      set({ quick: null, draft: `Voici un texte que j'ai sélectionné${where} :\n\n« ${excerpt} »\n\n` })
      get().open('chat', { focus: true })
    },

    setDraft: (draft) => set({ draft }),

    setMedia: (media) => set({ media }),
    setTimer: (timer) => set({ timer }),
    speak: (text, messageId) => {
      void speak(text)
      set({ speakingId: messageId ?? null })
    },
    stopSpeaking: () => stopSpeaking(),

    startDictation: async () => {
      if (isRecording() || get().dictation.phase !== 'idle') return
      const s = get().settings
      if (!s) return
      const status = await api().voiceModelStatus(s.voice.model)
      if (!status.installed || !status.variant) {
        // Première fois : on montre où installer la dictée (avec l'accord de l'utilisateur).
        set({ settingsFocus: 'voice' })
        get().open('settings', { focus: true })
        return
      }
      stopSpeaking()
      get().open('chat', { focus: true })
      const setDictation = (patch: Partial<CompiState['dictation']>): void => set((st) => ({ dictation: { ...st.dictation, ...patch } }))
      // Message affiché sous la saisie quelques secondes (l'îlot est ouvert).
      const showError = (error: string): void => {
        clearTimeout(dictationErrorTimer)
        setDictation({ error })
        dictationErrorTimer = setTimeout(() => setDictation({ error: null }), 7000)
      }
      setDictation({ error: null })
      const ready = loadModel(s.voice.model, status.variant, (r) => setDictation({ preparing: r })).finally(() => setDictation({ preparing: null }))
      // Une erreur de chargement est signalée à la transcription.
      ready.catch(() => undefined)
      await startListening(
        {
          phase: (phase) => setDictation({ phase }),
          level: (level) => setDictation({ level }),
          result: (text) => {
            // Pendant une réponse, la transcription attend dans la saisie.
            if (text && get().streamingId) set({ draft: text })
            else if (text) void get().send(text, { voice: true })
            else showError('Je n’ai pas compris. Réessaie en parlant un peu plus près du micro.')
          },
          error: showError
        },
        ready
      )
    },
    stopDictation: () => stopListening(),
    cancelDictation: () => cancelListening(),

    setPerf: (perf) => set({ perf }),
    focusPending: () => set({ focusPendingAt: Date.now() }),
    setPalette: (palette) => set({ palette }),
    focusActivity: (activityFocus) => set({ activityFocus })
  }
})
