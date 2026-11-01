import { create } from 'zustand'
import { brainLabel, defaultBrain } from '@shared/brains'
import type {
  AgentEvent,
  ApprovalRequest,
  Brain,
  ChatMessage,
  ClaudeSession,
  DictationCommand,
  IslandMode,
  IslandNotice,
  MediaInfo,
  MeetingEvent,
  LiveCall,
  MeetingStartOptions,
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
import { isSpeaking, onSpeaking, onSpeechEnd, speak, speakStream, stopSpeaking, type SpeechStream } from './lib/speech'
import { cancelListening, isRecording, loadModel, startListening, stopListening, TOO_SHORT, transcribeWhisper, type VoicePhase } from './lib/voice'
import { micError, startConverseCapture, type ConverseCapture } from './lib/converse'
import { CONVERSE_OFF, converseStep, micWanted, type ConverseEvent, type ConversePhase, type ConverseState } from '@shared/converse'
import { startCallCapture, type CallCapture } from './lib/callCapture'
import { formatDuration } from '@shared/meetings'
import { SETTINGS_TAB_OF, type ActivityTab, type SettingsFocus, type SettingsTab } from '@shared/settingsTabs'

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

export type { SettingsFocus } from '@shared/settingsTabs'

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
  /** Plein écran (poste de pilotage) : l'îlot ouvert couvre tout l'écran. */
  full: boolean
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
  /** Rubrique des Réglages ouverte (gardée pendant la session). */
  settingsTab: SettingsTab
  messages: ChatMessage[]
  streamingId: string | null
  phase: Phase
  outcome: 'done' | 'error' | null
  attachments: string[]
  /** Réunion jointe au prochain message (« Discuter de cette réunion »). */
  joinedMeeting: { id: string; title: string } | null

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
  /**
   * Dictée : écoute, transcription, niveau du micro (0 à 1), préparation du modèle.
   * `everywhere` : dictée partout en cours (touche maintenue), vers l'application visée.
   */
  dictation: { phase: VoicePhase; level: number; preparing: number | null; error: string | null; everywhere: DictationEverywhere | null }
  /** Conversation vocale : phase, fin de la fenêtre d'écoute (ms), niveau du micro (0 à 1). */
  converse: { phase: ConversePhase; until: number; level: number }
  /** Activité du PC (Ce PC, îlot) : dernier instantané reçu. */
  perf: PerfSnapshot | null
  /** Jeton : la première carte en attente prend le clavier (Alt+Maj+Espace, question par raccourci). */
  focusPendingAt: number
  /** Palette de recherche (Ctrl+K). */
  palette: boolean
  /** Activité : faire défiler jusqu'à « Ce PC ». */
  activityFocus: 'perf' | null
  /** Onglet d'Activité ouvert (gardé pendant la session). */
  activityTab: ActivityTab
  /** Appel en cours d'enregistrement (bandeau rouge de l'îlot). */
  call: CallState | null
  /** Historique : discussions ou réunions. */
  historyTab: 'chats' | 'meetings'
  /** Réunion à ouvrir dans l'historique (fin d'un enregistrement). */
  openMeetingId: string | null
  /** Réunion de l'agenda dont la préparation s'ouvre dans Aujourd'hui (clé « id|début »). */
  prepFocus: string | null

  setSettings(s: PublicSettings): void
  open(view?: PanelView, opts?: { focus?: boolean; attention?: boolean }): void
  /** Collapse sort aussi du plein écran (l'îlot se rétracte dans l'encoche). */
  collapse(): void
  /** Plein écran : l'îlot grandit jusqu'à couvrir l'écran et prend le clavier. */
  enterFull(): void
  /** Retour au panneau de l'encoche (Échap, raccourci, bouton). */
  exitFull(): void
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
  /** Ouvre aussi la rubrique qui montre ce réglage. */
  focusSettings(focus: SettingsFocus | null): void
  setSettingsTab(tab: SettingsTab): void
  /** `voice` : message dicté (la réponse pourra être lue à voix haute). `external` : texte venu d'autres personnes (résumé d'appel). */
  send(text: string, opts?: { voice?: boolean; external?: boolean }): Promise<void>
  stop(): void
  addAttachments(paths: string[]): void
  /** Nouvelle discussion avec la réunion jointe : la première question en parle. */
  discussMeeting(meeting: { id: string; title: string }): void
  setJoinedMeeting(meeting: { id: string; title: string } | null): void
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
  /** Ordre de la touche de dictée partout (processus principal). */
  onDictationCommand(c: DictationCommand): Promise<void>
  /** Arrête la conversation vocale (Échap, bouton, saisie au clavier, PC verrouillé…) ; la lecture en cours continue. */
  endConversation(): void
  setPerf(p: PerfSnapshot | null): void
  focusPending(): void
  setPalette(on: boolean): void
  focusActivity(f: 'perf' | null): void
  setActivityTab(tab: ActivityTab): void
  /** Commence l'enregistrement d'un appel (après « Commencer ») ; `choosePeople` : les voix seront séparées. */
  startCall(opts: MeetingStartOptions, choosePeople?: boolean): Promise<void>
  /** Personnes en face, changées pendant l'appel (`undefined` : automatique). */
  setCallPeople(people: number | undefined): void
  stopCall(): Promise<void>
  /** Annule l'enregistrement : rien n'est gardé. */
  discardCall(): Promise<void>
  onMeetingEvent(e: MeetingEvent): void
  setHistoryTab(tab: 'chats' | 'meetings'): void
  openMeeting(id: string | null): void
  setPrepFocus(key: string | null): void
}

/** Enregistrement d'un appel, vu par l'îlot (aussi envoyé à la transcription flottante). */
export type CallState = LiveCall

/** Dictée partout en cours : mode, touche, application visée (connue juste après le début). */
export interface DictationEverywhere {
  handsFree: boolean
  keyLabel: string
  app?: string
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
/** Dictée partout : arrêt demandé avant que le micro soit ouvert. */
let pendingEnd: 'stop' | 'cancel' | null = null
/** Capture du micro et du son de l'appel en cours. */
let callCapture: CallCapture | null = null
/** Conversation vocale : automate, micro, phrase entendue en attente d'envoi. */
let converse: ConverseState = CONVERSE_OFF
let converseMic: ConverseCapture | null = null
let converseMicOpening = false
let converseText = ''
/** Phrase entendue, le temps du pas qui la fait transcrire. */
let converseAudio: Float32Array | null = null
let converseTimer: ReturnType<typeof setInterval> | undefined

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

  // ─── Conversation vocale ───────────────────────────────────────────────────
  // Après une question dite à voix haute, le micro se rouvre à la fin de la lecture ;
  // la phrase entendue part comme nouvelle question. Désactivée par défaut.

  const converseOn = (): boolean => {
    const v = get().settings?.voice
    return v?.conversation === true && v.speak !== 'never'
  }

  const setConverse = (patch: Partial<CompiState['converse']>): void => set((st) => ({ converse: { ...st.converse, ...patch } }))

  // Le micro suit la phase : ouvert pour écouter (et pendant la lecture si on peut la couper en parlant).
  const syncConverseMic = (): void => {
    const want = micWanted(converse, isSpeaking(), get().settings?.voice.bargeIn !== false)
    if (!want) {
      converseMic?.stop()
      converseMic = null
      setConverse({ level: 0 })
      return
    }
    if (converseMic) return converseMic.setMode(want)
    if (converseMicOpening) return
    converseMicOpening = true
    startConverseCapture(
      {
        level: (level) => setConverse({ level }),
        onset: () => stepConverse({ type: 'onset', reading: isSpeaking() }),
        phrase: (audio) => {
          converseAudio = audio
          stepConverse({ type: 'phrase' })
          converseAudio = null
        },
        error: (message) => {
          get().showNotice({ pill: 'chat', text: message, duration: 6000 })
          stopConverse()
        }
      },
      want
    ).then(
      (mic) => {
        converseMicOpening = false
        converseMic = mic
        // La phase a pu changer pendant l'ouverture du micro.
        syncConverseMic()
      },
      (e) => {
        converseMicOpening = false
        get().showNotice({ pill: 'chat', text: micError(e), duration: 8000 })
        stopConverse()
      }
    )
  }

  const stepConverse = (e: ConverseEvent): void => {
    const r = converseStep(converse, e)
    converse = r.state
    if (get().converse.phase !== converse.phase || get().converse.until !== converse.until) setConverse({ phase: converse.phase, until: converse.until })
    clearInterval(converseTimer)
    if (converse.phase === 'listening') converseTimer = setInterval(() => stepConverse({ type: 'tick', now: Date.now() }), 250)
    // Rien ne reste en attente une fois la conversation finie (sauf la phrase, rendue dans la saisie).
    if (converse.phase === 'off' && converseText) {
      set({ draft: converseText })
      converseText = ''
    }
    syncConverseMic()
    for (const fx of r.effects) {
      if (fx === 'cut-reading') stopSpeaking()
      else if (fx === 'transcribe' && converseAudio) void transcribePhrase(converseAudio)
      else if (fx === 'send') {
        const text = converseText
        converseText = ''
        void get().send(text, { voice: true })
      }
    }
  }

  const stopConverse = (): void => {
    if (converse.phase !== 'off') stepConverse({ type: 'stop' })
  }

  // Même moteur que « Me parler » : celui de la dictée partout s'il est installé, sinon Whisper.
  const transcribePhrase = async (audio: Float32Array): Promise<void> => {
    const s = get().settings
    if (!s) return stopConverse()
    let text: string
    try {
      const engine = s.dictation.engine
      if (engine !== 'whisper' && (await api().speechModelStatus(engine)).installed) text = (await api().dictationTranscribe(audio)).trim()
      else {
        const status = await api().voiceModelStatus(s.voice.model)
        if (!status.installed || !status.variant) throw new Error('Pour parler à Compi, installe d’abord la dictée : Réglages › Voix › Me parler.')
        await loadModel(s.voice.model, status.variant)
        text = await transcribeWhisper(audio)
      }
    } catch (e) {
      get().showNotice({ pill: 'chat', text: (e as Error).message, duration: 8000 })
      return stopConverse()
    }
    // Arrêtée pendant la transcription (Échap, saisie…) : la phrase est oubliée.
    if (converse.phase !== 'transcribing') return
    converseText = text
    stepConverse({ type: 'heard', text, busy: get().streamingId !== null, now: Date.now() })
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
    // La lecture commence : le micro s'ouvre si l'on peut la couper en parlant. (Sa fin passe par onSpeechEnd.)
    if (speaking && converse.phase !== 'off') syncConverseMic()
  })
  onSpeechEnd((reason) => stepConverse({ type: 'speech-end', reason, now: Date.now() }))

  scheduleSleep()

  return {
    settings: null,
    mode: 'compact',
    full: false,
    view: 'chat',
    focused: false,
    attention: false,
    notice: null,
    sleepy: false,

    conversationId: null,
    conversationBrain: null,
    brainHint: null,
    settingsFocus: null,
    settingsTab: 'brain',
    messages: [],
    streamingId: null,
    phase: null,
    outcome: null,
    attachments: [],
    joinedMeeting: null,

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
    dictation: { phase: 'idle', level: 0, preparing: null, error: null, everywhere: null },
    converse: { phase: 'off', until: 0, level: 0 },
    perf: null,
    focusPendingAt: 0,
    palette: false,
    activityFocus: null,
    activityTab: 'perf',
    call: null,
    historyTab: 'chats',
    openMeetingId: null,
    prepFocus: null,

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
      // La fenêtre reprend sa taille quand l'îlot a fini de rétrécir (Island).
      set({ mode: restingMode(), full: false, focused: false, attention: false, palette: false })
      // Le bandeau disparaît avec le panneau : il ne retient plus la notification.
      get().holdNotice(false)
      scheduleSleep()
    },

    enterFull: () => {
      if (get().full) return
      get().holdNotice(false)
      set({ mode: 'expanded', full: true, focused: true, attention: false, sleepy: false, palette: false })
      setInteractive(true)
      api().setFull(true)
    },

    exitFull: () => {
      if (get().full) set({ full: false })
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

    newConversation: () => {
      stopConverse()
      set({ conversationId: null, conversationBrain: null, messages: [], streamingId: null, phase: null, view: 'chat', joinedMeeting: null })
    },

    discussMeeting: (meeting) => {
      get().newConversation()
      set({ joinedMeeting: meeting })
    },
    setJoinedMeeting: (joinedMeeting) => set({ joinedMeeting }),

    loadConversation: async (id) => {
      const conv = await api().getConversation(id)
      if (!conv) return
      const s = get().settings
      // Les anciennes discussions, d'avant le choix du cerveau, étaient avec Claude.
      const brain = conv.brain ?? (s ? { provider: 'anthropic' as const, model: s.model } : null)
      set({ conversationId: conv.id, conversationBrain: brain, messages: conv.messages, streamingId: null, phase: null, view: 'chat', joinedMeeting: null })
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

    focusSettings: (settingsFocus) => set(settingsFocus ? { settingsFocus, settingsTab: SETTINGS_TAB_OF[settingsFocus] } : { settingsFocus }),
    setSettingsTab: (settingsTab) => set({ settingsTab }),

    send: async (text, opts = {}) => {
      const trimmed = text.trim()
      const { attachments, joinedMeeting } = get()
      if (!trimmed && !attachments.length && !joinedMeeting) return
      const prompt = trimmed || (joinedMeeting && !attachments.length ? 'Fais-moi le point sur cette réunion.' : 'Que peux-tu me dire sur ce fichier ?')
      stopSpeaking()
      liveSpeech = null
      set({ attachments: [], joinedMeeting: null, spokenInput: opts.voice ?? false })
      // Question dite à voix haute : la conversation continue après la lecture de la réponse.
      if (opts.voice && converseOn()) stepConverse({ type: 'ask' })
      else stopConverse()
      const res = await api().send({
        conversationId: get().conversationId ?? undefined,
        text: prompt,
        attachments,
        external: opts.external,
        ...(joinedMeeting ? { meeting: joinedMeeting.id } : {})
      })
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
          // Phrase entendue pendant que la réponse s'écrivait : elle part maintenant.
          if (converse.phase === 'queued') stepConverse({ type: 'answer-end' })
          // Rien à lire (réponse vide) : la conversation s'arrête là.
          else if (converse.phase === 'answering' && !isSpeaking()) stepConverse({ type: 'answer-silent' })
          break
        case 'error':
          if (get().streamingId === e.messageId) set({ streamingId: null, phase: null })
          patch((m) => ({ ...m, error: e.error }))
          flashOutcome('error')
          stopConverse()
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
      // Une carte attend un clic : la conversation vocale s'arrête (jamais d'accord à la voix).
      if (approvals.length) stopConverse()
      const after = approvals.length + get().questions.length
      if (after === 0 && before > 0 && get().attention && !get().focused) setTimeout(() => get().collapse(), 700)
    },
    setQuestions: (questions) => {
      const before = get().approvals.length + get().questions.length
      set({ questions })
      if (questions.length) stopConverse()
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
      const intro = q.selection.zone ? 'Voici un texte lu dans une zone de mon écran' : `Voici un texte que j'ai sélectionné${where}`
      set({ quick: null, draft: `${intro} :\n\n« ${excerpt} »\n\n` })
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
      // « Me parler » pendant une conversation : une seule prise du micro, la dictée prend la main.
      stopConverse()
      // Le modèle de la dictée partout (Parakeet, tamoul) s'il est installé, sinon Whisper.
      const engine = s.dictation.engine
      const speech = engine !== 'whisper' && (await api().speechModelStatus(engine)).installed
      const status = speech ? null : await api().voiceModelStatus(s.voice.model)
      if (status && (!status.installed || !status.variant)) {
        // Première fois : on montre où installer la dictée (avec l'accord de l'utilisateur).
        get().focusSettings('voice')
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
      let ready: Promise<void> = Promise.resolve()
      if (status?.variant) {
        ready = loadModel(s.voice.model, status.variant, (r) => setDictation({ preparing: r })).finally(() => setDictation({ preparing: null }))
        // Une erreur de chargement est signalée à la transcription.
        ready.catch(() => undefined)
      } else {
        // Le modèle se charge dans Compi pendant que l'utilisateur parle.
        api().dictationPrepare()
      }
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
        ready,
        { transcribe: speech ? (audio) => api().dictationTranscribe(audio) : undefined }
      )
    },
    stopDictation: () => {
      // Bouton de la pastille pendant une dictée partout : Compi passe à l'écriture.
      if (get().dictation.everywhere) api().dictationStop()
      stopListening()
    },
    cancelDictation: () => {
      if (get().dictation.everywhere) api().dictationEnded()
      cancelListening()
    },

    onDictationCommand: async (c) => {
      const setDictation = (patch: Partial<CompiState['dictation']>): void => set((st) => ({ dictation: { ...st.dictation, ...patch } }))
      const d = get().dictation
      if (c.type === 'target') {
        if (d.everywhere) setDictation({ everywhere: { ...d.everywhere, app: c.app } })
        return
      }
      if (c.type === 'stop' || c.type === 'cancel') {
        if (!d.everywhere) return
        // Micro pas encore ouvert : l'ordre s'applique dès qu'il l'est.
        if (d.phase !== 'recording') pendingEnd = c.type
        else if (c.type === 'stop') stopListening()
        else cancelListening(c.message)
        return
      }
      const s = get().settings
      if (!s || isRecording() || d.phase !== 'idle') {
        api().dictationEnded(s ? 'Une dictée est déjà en cours.' : undefined)
        return
      }
      pendingEnd = null
      stopConverse()
      // La voix de Compi se tait : le micro ne doit pas l'entendre.
      stopSpeaking()
      setDictation({ error: null, everywhere: { handsFree: c.handsFree, keyLabel: c.keyLabel } })
      let ready: Promise<void> = Promise.resolve()
      let transcribe: ((audio: Float32Array) => Promise<string>) | undefined = (audio) => api().dictationTranscribe(audio)
      if (c.engine === 'whisper') {
        const status = await api().voiceModelStatus(s.voice.model)
        if (!status.installed || !status.variant) {
          setDictation({ everywhere: null })
          api().dictationEnded('Pour dicter avec Whisper, télécharge-le d’abord : Réglages › Me parler.')
          return
        }
        ready = loadModel(s.voice.model, status.variant)
        ready.catch(() => undefined)
        transcribe = undefined
      }
      await startListening(
        {
          phase: (phase) => {
            setDictation(phase === 'idle' ? { phase, everywhere: null } : { phase })
            if (phase === 'recording' && pendingEnd) {
              const end = pendingEnd
              pendingEnd = null
              if (end === 'stop') stopListening()
              else cancelListening()
            }
          },
          level: (level) => setDictation({ level }),
          result: (text) => {
            void api()
              .dictationDeliver(text)
              .then((outcome) => {
                // « Compi, … » : une demande à l'assistant, avec les cartes habituelles.
                if (outcome.kind !== 'compi') return
                get().open('chat', { focus: true })
                void get().send(outcome.request, { voice: true })
              })
          },
          // Un appui trop court n'est pas une erreur : rien n'est dit.
          error: (message) => api().dictationEnded(message === TOO_SHORT ? undefined : message)
        },
        ready,
        { autoStop: false, transcribe }
      )
    },

    endConversation: () => stopConverse(),

    setPerf: (perf) => set({ perf }),
    focusPending: () => set({ focusPendingAt: Date.now() }),
    setPalette: (palette) => set({ palette }),
    focusActivity: (activityFocus) => set(activityFocus ? { activityFocus, activityTab: 'perf' } : { activityFocus }),
    setActivityTab: (activityTab) => set({ activityTab }),

    startCall: async (opts, choosePeople = false) => {
      if (get().call) return
      stopConverse()
      const people = opts.others ? opts.people : undefined
      set({ call: { id: '', startedAt: Date.now(), others: opts.others, choosePeople: false, people, phase: 'starting', lines: [] } })
      let id = ''
      try {
        const started = await api().meetingStart(opts)
        id = started.id
        // Le son de l'ordinateur vient de Windows ; l'îlot ne le demande qu'en secours.
        callCapture = await startCallCapture(id, started.systemAudio === 'browser', (message) => {
          get().showNotice({ pill: 'meeting', text: message, duration: 8000 })
          void get().stopCall()
        })
        const others = started.systemAudio === 'windows' || callCapture.others
        set({ call: { id, startedAt: started.startedAt, others, choosePeople: choosePeople && others, people, phase: 'recording', lines: [] } })
        if (opts.others && !others) {
          get().showNotice({ pill: 'meeting', text: 'Son de l’appel indisponible : seul ton micro est enregistré.', duration: 8000 })
        }
      } catch (e) {
        callCapture?.stop()
        callCapture = null
        if (id) await api().meetingDiscard()
        set({ call: null })
        const message = (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
        get().showNotice({
          pill: 'meeting',
          text: /Permission|NotAllowed/i.test(message) ? 'Micro refusé : enregistrement impossible.' : message,
          duration: 8000
        })
      }
    },
    setCallPeople: (people) => {
      const c = get().call
      if (!c || c.phase !== 'recording' || !c.choosePeople) return
      set({ call: { ...c, people } })
      void api().meetingPeople(c.id, people)
    },
    stopCall: async () => {
      const c = get().call
      if (!c || c.phase !== 'recording') return
      callCapture?.stop()
      callCapture = null
      set({ call: { ...c, phase: 'processing', step: 'Je termine la transcription…' } })
      try {
        await api().meetingStop()
      } catch {
        // La fin arrive aussi par onMeetingEvent ; au pire, l'îlot se libère.
        set({ call: null })
      }
    },
    discardCall: async () => {
      callCapture?.stop()
      callCapture = null
      await api().meetingDiscard()
      set({ call: null })
    },
    onMeetingEvent: (e) => {
      const c = get().call
      if (e.type === 'line') {
        if (c?.id === e.id) set({ call: { ...c, lines: [...c.lines, e.line].slice(-60) } })
        return
      }
      if (e.type === 'processing') {
        if (c?.id === e.id) set({ call: { ...c, phase: 'processing', step: e.step } })
        return
      }
      if (e.type === 'notice') {
        get().showNotice({ pill: 'meeting', text: e.message, duration: 8000 })
        return
      }
      if (e.type === 'stopped') {
        // Arrêt décidé par Compi (plus de son, 4 h, veille, annulation) : le micro se coupe.
        if (c?.id === e.id && c.phase === 'recording') {
          callCapture?.stop()
          callCapture = null
          set({ call: { ...c, phase: 'processing' } })
        }
        get().showNotice({ pill: 'meeting', text: e.message, duration: 8000 })
        if (/annulé/.test(e.message)) set({ call: null })
        return
      }
      // Terminé : la réunion est dans l'historique.
      if (c?.id === e.id) set({ call: null })
      set({ historyTab: 'meetings', openMeetingId: e.id })
      get().showNotice({
        pill: 'meeting',
        text: `Appel enregistré · ${formatDuration(e.meta.durationMs)} : clique pour le relire`,
        view: 'history',
        duration: 9000
      })
    },
    setHistoryTab: (historyTab) => set({ historyTab }),
    openMeeting: (openMeetingId) => set({ openMeetingId }),
    setPrepFocus: (prepFocus) => set({ prepFocus })
  }
})
