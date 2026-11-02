import type {
  AgendaDraft,
  AgendaPreview,
  AgendaToolChoice,
  AgentEvent,
  GoogleCalendarChoice,
  ApprovalDecision,
  ApprovalLogEntry,
  ApprovalRequest,
  Brain,
  BrainProgress,
  BrainQuizAnswers,
  BrainRecommendation,
  BrainTestResult,
  ClipItem,
  HardwareInfo,
  LocalStatus,
  MessagesStatus,
  ClaudeSession,
  ConnectorConfig,
  ConnectorOAuthResult,
  ConnectorTestResult,
  Conversation,
  ConversationMeta,
  DictationCommand,
  DictationOutcome,
  DictationStatRow,
  GoogleConnectResult,
  HooksPreview,
  IslandCommand,
  IslandNotice,
  MediaAction,
  MediaInfo,
  MemoryItem,
  PublicSettings,
  QuestionAnswer,
  QuestionRequest,
  QuickEvent,
  QuickSelection,
  RegistryEntry,
  Reminder,
  Routine,
  RoutineDraft,
  SpeechPackId,
  SpeechModelStatus,
  Meeting,
  MeetingEvent,
  MeetingMeta,
  MeetingNoteResult,
  FloatingCommand,
  FloatingState,
  LiveCall,
  MeetingStart,
  MeetingStartOptions,
  MeetingEventLink,
  MeetingPrep,
  MeetingTrack,
  SemanticPassage,
  SemanticStatus,
  SendRequest,
  SendResult,
  SentLogEntry,
  Settings,
  SkillDraft,
  SkillInfo,
  TimerState,
  TaskItem,
  TasksInfo,
  TodayInfo,
  WeekInfo,
  RecentsInfo,
  LocalSearch,
  FileSearchHit,
  VoiceInfo,
  VoiceModelId,
  VoiceModelStatus,
  VoiceVariant,
  WebSearchTestResult
} from '../shared/types'
import type { ClaudeCodeUsage, CompiUsageRow } from '../shared/usage'
import type { PerfSnapshot } from '../shared/perf'
import type { OllamaFolder } from '../shared/ollamaFolder'
import type { PillId } from '../shared/pills'
import type { MissedInfo } from '../shared/missed'
import type { SoundKind } from '../shared/sounds'

export type Unsubscribe = () => void

export interface CompiApi {
  platform: string
  // îlot
  setInteractive(interactive: boolean): void
  /** `true` : le panneau prend le clavier ; `false` : il le rend et redevient inerte. */
  setFocusable(focusable: boolean): void
  /** Le panneau répond au clic sans prendre le clavier tant qu'on n'y clique pas. */
  setActivatable(activatable: boolean): void
  /** Plein écran : `true` la fenêtre prend tout l'écran ; `false` elle reprend sa taille (après l'animation). */
  setFull(full: boolean): void
  /** Taille du texte d'un cran (1, −1) ou 100 % (0) dans le mode affiché ; renvoie la nouvelle taille (pour cent). */
  zoomStep(dir: -1 | 0 | 1): Promise<number>
  onZoomStepped(cb: (z: { mode: 'notch' | 'full'; pct: number }) => void): Unsubscribe
  onIslandCommand(cb: (cmd: IslandCommand) => void): Unsubscribe
  onIslandNotice(cb: (notice: IslandNotice) => void): Unsubscribe
  // réglages
  getSettings(): Promise<PublicSettings>
  updateSettings(patch: Partial<Settings>): Promise<PublicSettings>
  setApiKey(key: string | null): Promise<PublicSettings>
  onSettings(cb: (s: PublicSettings) => void): Unsubscribe
  // chat
  listConversations(): Promise<ConversationMeta[]>
  getConversation(id: string): Promise<Conversation | null>
  deleteConversation(id: string): Promise<void>
  send(req: SendRequest): Promise<SendResult>
  stop(conversationId: string): Promise<void>
  /** Annule une modification de fichier texte faite par Compi (numéro de la modification) : phrase à afficher. */
  undoTextEdit(id: string): Promise<{ ok: boolean; message: string }>
  onAgentEvent(cb: (e: AgentEvent) => void): Unsubscribe
  /** Ouvrir une discussion (clic sur la notification d'une routine). */
  onOpenConversation(cb: (conversationId: string) => void): Unsubscribe
  // approbations / questions
  onApprovals(cb: (list: ApprovalRequest[]) => void): Unsubscribe
  decide(id: string, decision: ApprovalDecision): Promise<void>
  onQuestions(cb: (list: QuestionRequest[]) => void): Unsubscribe
  answer(answer: QuestionAnswer): Promise<void>
  // Claude Code
  onSessions(cb: (list: ClaudeSession[]) => void): Unsubscribe
  previewHooks(): Promise<HooksPreview>
  connectClaudeCode(): Promise<PublicSettings>
  disconnectClaudeCode(): Promise<PublicSettings>
  // connecteurs
  saveConnector(config: ConnectorConfig, secrets: Record<string, string>): Promise<PublicSettings>
  deleteConnector(id: string): Promise<PublicSettings>
  testConnector(id: string): Promise<ConnectorTestResult>
  searchRegistry(query: string): Promise<RegistryEntry[]>
  /** Connexion par compte : ouvre la page du service et attend l'accord (5 minutes au plus). */
  connectorOAuth(config: ConnectorConfig, clientSecret?: string): Promise<ConnectorOAuthResult>
  connectorOAuthCancel(): Promise<void>
  // dossiers et compétences
  /** Ouvre le sélecteur de dossiers de Windows et ajoute les dossiers choisis. */
  pickFolders(): Promise<PublicSettings>
  /** Ouvre le sélecteur de fichiers de Windows (le panneau reste ouvert) : les fichiers à joindre au message. */
  pickFiles(): Promise<string[]>
  listSkills(): Promise<SkillInfo[]>
  getSkill(name: string): Promise<SkillDraft | null>
  saveSkill(draft: SkillDraft): Promise<SkillInfo[]>
  deleteSkill(name: string): Promise<SkillInfo[]>
  /** Ouvre un sélecteur (dossier ou archive .zip/.skill) puis importe la compétence. */
  importSkill(kind: 'folder' | 'archive'): Promise<SkillInfo[]>
  openSkillsFolder(): Promise<void>
  // cerveaux
  localStatus(): Promise<LocalStatus>
  /** Installe (ou met à jour) Ollama ; la progression arrive par onBrainProgress. */
  installOllama(): Promise<void>
  startLocalEngine(): Promise<LocalStatus>
  /** Dossier des modèles d'Ollama (réglé dans Ollama), taille, place libre, redémarrage nécessaire. */
  modelsFolder(): Promise<OllamaFolder | null>
  openModelsFolder(): Promise<void>
  /** Arrête les serveurs d'Ollama pour qu'il reparte sur le bon dossier (les modèles ne sont pas touchés). */
  restartOllama(): Promise<OllamaFolder | null>
  /** Télécharge un modèle Ollama ; la progression arrive par onBrainProgress. */
  pullModel(name: string): Promise<void>
  cancelPull(): Promise<void>
  onBrainProgress(cb: (p: BrainProgress) => void): Unsubscribe
  hardwareInfo(): Promise<HardwareInfo>
  /** Mémorise les réponses au questionnaire et renvoie le conseil. */
  recommendBrain(answers: BrainQuizAnswers): Promise<BrainRecommendation>
  testBrain(brain: Brain): Promise<BrainTestResult>
  setCustomKey(key: string | null): Promise<PublicSettings>
  /** Clé du compte Ollama pour la recherche web (chiffrée, jamais renvoyée). */
  setWebSearchKey(key: string | null): Promise<PublicSettings>
  /** Essai de la recherche web réglée : une recherche « wikipedia » envoyée au service choisi. */
  testWebSearch(): Promise<WebSearchTestResult>
  setConversationBrain(conversationId: string, brain: Brain): Promise<void>
  // confidentialité
  // journal des autorisations et utilisation (Activité)
  approvalLog(): Promise<ApprovalLogEntry[]>
  clearApprovalLog(): Promise<ApprovalLogEntry[]>
  onApprovalLog(cb: (log: ApprovalLogEntry[]) => void): Unsubscribe
  /** Utilisation de Claude Code, lue sur le PC (lecture seule). */
  claudeCodeUsage(): Promise<ClaudeCodeUsage>
  /** Relit les fichiers modifiés depuis (une fois par minute au plus). */
  refreshClaudeCodeUsage(): Promise<ClaudeCodeUsage>
  onClaudeCodeUsage(cb: (u: ClaudeCodeUsage) => void): Unsubscribe
  compiUsage(): Promise<CompiUsageRow[]>
  onCompiUsage(cb: (rows: CompiUsageRow[]) => void): Unsubscribe
  // messages en attente (notifications des messageries)
  messagesStatus(): Promise<MessagesStatus>
  /** Clic sur « Activer » : vérifie ou demande l'accès de Windows aux notifications, puis active. */
  activateMessages(): Promise<MessagesStatus>
  /** Ouvre l'application du message. */
  openMessage(key: string): Promise<boolean>
  /** « Plus tard » : nouveau rappel dans 1 h. */
  snoozeMessage(key: string): Promise<MessagesStatus>
  ignoreMessage(key: string): Promise<MessagesStatus>
  /** Paramètres Windows › Confidentialité › Notifications. */
  /** `notifications` : Paramètres › Système › Notifications ; sinon l'accès des applications aux notifications. */
  openNotificationSettings(page?: 'notifications' | 'privacy'): Promise<void>
  onMessages(cb: (s: MessagesStatus) => void): Unsubscribe
  sentLog(): Promise<SentLogEntry[]>
  clearSentLog(): Promise<void>
  onSentLog(cb: (log: SentLogEntry[]) => void): Unsubscribe

  /** Ouvre un sélecteur de fichier et importe le JSON du client Google. */
  googleImportClient(): Promise<PublicSettings>
  /** Ouvre l'écran de Google dans le navigateur et attend la fin de la connexion. */
  googleConnect(want: { calendar: boolean; mail: boolean; tasks: boolean }): Promise<GoogleConnectResult>
  googleCancel(): Promise<void>
  googleDisconnect(): Promise<PublicSettings>

  /** Agendas du compte Google, avec ceux affichés dans Compi. */
  agendaGoogleCalendars(): Promise<GoogleCalendarChoice[]>
  /** `null` : comme dans Google Agenda (les agendas cochés). */
  agendaSetGoogleCalendars(ids: string[] | null): Promise<PublicSettings>
  /** Outils du connecteur qui pourraient fournir des événements. */
  agendaTools(connectorId: string): Promise<AgendaToolChoice[]>
  /** Essaie une source sans l'enregistrer (aujourd'hui et 7 jours). */
  agendaPreview(draft: AgendaDraft): Promise<AgendaPreview>
  agendaAdd(draft: AgendaDraft): Promise<PublicSettings>
  agendaUpdate(id: string, patch: { enabled?: boolean; name?: string }): Promise<PublicSettings>
  agendaRemove(id: string): Promise<PublicSettings>

  today(): Promise<TodayInfo>
  /** Les 7 prochains jours (plein écran). */
  week(): Promise<WeekInfo>
  /** Dernières réunions et fichiers récents des dossiers confiés (plein écran). */
  recents(): Promise<RecentsInfo>
  /** Ouvre un fichier d'un dossier confié ; un programme est seulement montré dans l'Explorateur. */
  openConfidedFile(file: string): Promise<'opened' | 'shown' | 'refused'>
  /** Montre un fichier trouvé (carte du chat) dans l'Explorateur, sans l'ouvrir. */
  revealFile(file: string): Promise<boolean>
  /** Recherche du plein écran : applis, réunions, discussions, rappels, tâches, souvenirs. */
  searchLocal(query: string): Promise<LocalSearch>
  /** Fichiers des dossiers confiés (index de Windows). */
  searchFiles(query: string): Promise<FileSearchHit[]>
  /** Lance une appli du menu Démarrer choisie dans la recherche. */
  launchStartApp(id: string): Promise<boolean>
  /** Tâches Google à faire, toutes listes (dans l'ordre d'affichage). */
  /** « Ce que tu as manqué » : la dernière carte, tant qu'elle n'est pas fermée. */
  missed(): Promise<MissedInfo | null>
  dismissMissed(): Promise<void>
  onMissed(cb: (info: MissedInfo | null) => void): Unsubscribe
  tasks(): Promise<TasksInfo>
  /** Clic de l'utilisateur : cocher ou décocher une tâche. */
  setTaskDone(listId: string, id: string, done: boolean): Promise<TaskItem | null>
  /** Ajoute une tâche dans la liste par défaut (échéance « AAAA-MM-JJ » facultative). */
  addTask(title: string, due?: string): Promise<TaskItem>
  /** Tâches changées (ajoutée, cochée, modifiée) : relire. */
  onTasks(cb: () => void): Unsubscribe
  /** Règle la ville de la météo (vide : pas de météo). */
  setCity(name: string): Promise<PublicSettings>
  reminders(): Promise<Reminder[]>
  onReminders(cb: (list: Reminder[]) => void): Unsubscribe
  cancelReminder(id: string): Promise<boolean>
  snoozeReminder(id: string, minutes: number): Promise<Reminder | null>
  // îlot vivant : musique, minuteur, voix
  media(): Promise<MediaInfo | null>
  onMedia(cb: (m: MediaInfo | null) => void): Unsubscribe
  /** Lecture/pause, suivant, précédent sur l'application qui joue. */
  mediaControl(action: MediaAction): Promise<boolean>
  timer(): Promise<TimerState | null>
  onTimer(cb: (t: TimerState | null) => void): Unsubscribe
  startTimer(minutes: number, label?: string): Promise<TimerState>
  startPomodoro(): Promise<TimerState>
  pauseTimer(): Promise<TimerState | null>
  resumeTimer(): Promise<TimerState | null>
  stopTimer(): Promise<TimerState | null>
  voices(): Promise<VoiceInfo[]>
  /** Un morceau de texte dit par la voix choisie : un fichier WAV. */
  speak(text: string): Promise<Uint8Array>
  voiceModelStatus(model?: VoiceModelId): Promise<VoiceModelStatus>
  /** Télécharge le modèle de dictée (après l'accord de l'utilisateur). */
  voiceModelDownload(model: VoiceModelId, variant: VoiceVariant): Promise<VoiceModelStatus>
  voiceModelCancel(): Promise<void>
  voiceModelDelete(model: VoiceModelId): Promise<VoiceModelStatus>
  onVoiceModelProgress(cb: (s: VoiceModelStatus) => void): Unsubscribe
  // dictée partout
  speechModelStatus(model: SpeechPackId): Promise<SpeechModelStatus>
  /** Télécharge le modèle de la dictée partout (après l'accord de l'utilisateur). */
  speechModelDownload(model: SpeechPackId): Promise<SpeechModelStatus>
  speechModelCancel(): Promise<void>
  speechModelDelete(model: SpeechPackId): Promise<SpeechModelStatus>
  onSpeechModelProgress(cb: (s: SpeechModelStatus) => void): Unsubscribe
  onDictationCommand(cb: (c: DictationCommand) => void): Unsubscribe
  /** Son en 16 kHz mono → texte (sherpa-onnx, sur le PC). */
  dictationTranscribe(audio: Float32Array): Promise<string>
  /** Charge d'avance le modèle de la dictée partout (dictée vers Compi qui commence). */
  dictationPrepare(): void
  /** Texte transcrit → collé dans l'application visée (ou demande à Compi). */
  dictationDeliver(text: string): Promise<DictationOutcome>
  /** L'îlot n'a pas pu enregistrer ou transcrire. */
  dictationEnded(message?: string): void
  /** Bouton « Terminer » de la pastille. */
  dictationStop(): void
  dictationStats(): Promise<DictationStatRow[]>
  clearDictationStats(): Promise<DictationStatRow[]>
  onDictationStats(cb: (rows: DictationStatRow[]) => void): Unsubscribe
  // réunions (enregistreur d'appels)
  /** Commence un enregistrement (après le clic sur « Commencer »). */
  meetingStart(opts: MeetingStartOptions): Promise<MeetingStart>
  /** Préparer une réunion de l'agenda : derniers e-mails avec les participants, tâches de la fois d'avant (sur le PC). */
  meetingPrep(event: MeetingEventLink): Promise<MeetingPrep>
  /** Morceau de son d'une piste (16 bits, 16 kHz). */
  meetingAudio(id: string, track: MeetingTrack, data: Int16Array): void
  meetingStop(): Promise<MeetingMeta | null>
  /** Annule l'enregistrement en cours : rien n'est gardé. */
  meetingDiscard(): Promise<void>
  /** Personnes en face pendant l'appel (1, `undefined` : automatique) ; faux si l'appel est déjà arrêté. */
  meetingPeople(id: string, people: number | undefined): Promise<boolean>
  onMeetingEvent(cb: (e: MeetingEvent) => void): Unsubscribe
  /** Îlot : état de l'appel en cours, pour la transcription flottante. */
  pushFloatingCall(call: LiveCall | null): void
  openFloating(): Promise<void>
  floatingState(): Promise<FloatingState>
  floatingCommand(cmd: FloatingCommand): Promise<void>
  onFloatingState(cb: (s: FloatingState) => void): Unsubscribe
  /** Îlot : « Arrêter » ou personnes en face, demandés depuis la fenêtre flottante. */
  onFloatingToIsland(cb: (cmd: FloatingCommand) => void): Unsubscribe
  meetings(): Promise<MeetingMeta[]>
  meeting(id: string): Promise<Meeting | null>
  deleteMeeting(id: string): Promise<MeetingMeta[]>
  renameMeeting(id: string, title: string): Promise<Meeting | null>
  /** Nom d'une voix (« s1 » → « Paul ») ; vide pour revenir à « Personne 1 ». */
  nameMeetingVoice(id: string, who: string, name: string): Promise<Meeting | null>
  resumeMeeting(id: string): Promise<MeetingMeta | null>
  /** Refait la séparation des voix (son encore là) : `people` imposé, sinon automatique. */
  redoMeetingVoices(id: string, people?: number): Promise<MeetingMeta>
  /** Rattache une phrase à une autre voix (existante, ou la suivante). */
  moveMeetingLine(id: string, index: number, who: string): Promise<Meeting | null>
  /** Efface tout de suite le son gardé (la transcription reste). */
  deleteMeetingAudio(id: string): Promise<Meeting | null>
  summarizeMeeting(id: string): Promise<Meeting>
  /** Écrit la note de la réunion dans le dossier de notes (le clic vaut accord). */
  saveMeetingNote(id: string): Promise<MeetingNoteResult>
  openMeetingNote(path: string): Promise<boolean>
  /** Choisit (et confie) le dossier des notes de réunion. */
  pickNotesFolder(): Promise<PublicSettings>
  /** Enregistre la réunion en Markdown (fenêtre « Enregistrer sous »). */
  exportMeeting(id: string): Promise<boolean>
  onMeetings(cb: (list: MeetingMeta[]) => void): Unsubscribe
  // ce que je sais de toi
  memory(): Promise<MemoryItem[]>
  addMemory(fact: string): Promise<MemoryItem[]>
  updateMemory(id: string, fact: string): Promise<MemoryItem[]>
  deleteMemory(id: string): Promise<MemoryItem[]>
  clearMemory(): Promise<MemoryItem[]>
  onMemory(cb: (list: MemoryItem[]) => void): Unsubscribe
  // routines
  routines(): Promise<Routine[]>
  saveRoutine(draft: RoutineDraft): Promise<Routine[]>
  deleteRoutine(id: string): Promise<Routine[]>
  runRoutine(id: string): Promise<Routine[]>
  stopRoutine(id: string): Promise<Routine[]>
  onRoutines(cb: (list: Routine[]) => void): Unsubscribe
  // historique du presse-papier
  clips(): Promise<ClipItem[]>
  copyClip(id: string): Promise<boolean>
  pinClip(id: string, pinned: boolean): Promise<ClipItem[]>
  deleteClip(id: string): Promise<ClipItem[]>
  clearClips(): Promise<ClipItem[]>
  onClips(cb: (list: ClipItem[]) => void): Unsubscribe
  // recherche par le sens
  semanticStatus(): Promise<SemanticStatus>
  /** Télécharge le modèle s'il manque (la progression arrive par onBrainProgress), puis lit les documents. */
  enableSemantic(): Promise<SemanticStatus>
  disableSemantic(removeModel?: boolean): Promise<SemanticStatus>
  reindexSemantic(): Promise<SemanticStatus>
  /** Essai depuis la carte : passages proches, calculés sur le PC (aucun cerveau). `null` si pas prête. */
  trySemantic(query: string): Promise<SemanticPassage[] | null>
  /** Ouvre un document trouvé (seulement dans un dossier confié). */
  openSemanticFile(file: string): Promise<boolean>
  onSemantic(cb: (s: SemanticStatus) => void): Unsubscribe
  // activité du PC (Ce PC, îlot) et sons
  /** S'abonne (`on`) ou se désabonne ; renvoie le dernier instantané. Mesuré seulement tant que quelqu'un regarde. */
  perfWatch(id: string, on: boolean, everyMs?: number): Promise<PerfSnapshot | null>
  onPerf(cb: (s: PerfSnapshot) => void): Unsubscribe
  /** « Libérer » : décharge le modèle de la recherche par le sens, ou tous les modèles locaux. */
  perfUnload(which: 'all' | 'embed'): Promise<PerfSnapshot | null>
  /** Mémoire des conversations d'Ollama : limiter (Mo), rétablir (`null`) ou appliquer la limite réglée (`undefined`). Redémarre Ollama. */
  perfOllamaCache(mb: number | null | undefined): Promise<PerfSnapshot | null>
  /** Carnet de fiabilité des modèles locaux (essais d'outil, actions écrites en texte). */
  modelHealth(): Promise<import('../shared/modelHealth').HealthBook>
  /** Le son peut-il jouer maintenant (réglages, heures calmes, réunion, pomodoro, plein écran) ? */
  soundAllowed(kind: SoundKind, pill?: PillId): Promise<boolean>
  // actions rapides sur la sélection
  onQuickOpen(cb: (selection: QuickSelection) => void): Unsubscribe
  onQuickEvent(cb: (e: QuickEvent) => void): Unsubscribe
  quickRun(id: string, action: string): Promise<void>
  quickStop(): Promise<void>
  /** Remet le résultat à la place de la sélection ; `message` explique un échec. */
  quickReplace(id: string): Promise<{ ok: boolean; message?: string }>
  quickCopy(id: string): Promise<boolean>
  /** Zone d'écran : copie le texte lu (sans cerveau). */
  quickCopyText(id: string): Promise<boolean>
  /** Zone d'écran : comme le raccourci (palette Ctrl+K). */
  zoneStart(): Promise<void>
  // fichiers / divers
  getPathForFile(file: File): string
  openExternal(url: string): Promise<void>
  /** Ouvre dans l'Explorateur un dossier confié (rien d'autre). */
  openFolder(path: string): Promise<void>
  quit(): void
}

declare global {
  interface Window {
    compi: CompiApi
  }
  /** Version de package.json, posée au moment du build (electron.vite.config.ts). */
  const __APP_VERSION__: string
}
