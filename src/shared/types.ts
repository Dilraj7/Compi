// Types partagés entre le processus principal, le preload et l'interface.

import type { MessageNotice } from './claims'
import type { PrivacyCategory, PrivacySettings } from './privacy'

export type ModelId = 'claude-opus-5-5' | 'claude-sonnet-5-5' | 'claude-haiku-5-5'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

// ─── Cerveaux ────────────────────────────────────────────────────────────────

/** Fournisseur du modèle : Claude, un moteur local (Ollama, LM Studio) ou un autre service compatible. */
export type ProviderId = 'anthropic' | 'local' | 'custom'

/** Le cerveau d'une discussion : fournisseur + nom du modèle. */
export interface Brain {
  provider: ProviderId
  model: string
}

export type LocalEngine = 'ollama' | 'lmstudio'

export interface LocalBrainSettings {
  engine: LocalEngine
  baseUrl: string
  model: string
  /** Proposer Claude (avec accord) quand le modèle local ne sait pas faire. */
  cloudHelp: boolean
  /** Style de réponse : `low` (Vif) coupe la réflexion du modèle. */
  effort: Effort
  /** Temps pendant lequel le modèle reste chargé après la dernière question. */
  keepAlive: KeepAlive
  /** Fenêtre de 64 000 jetons (longs documents, grosses extensions) si la carte graphique a la place ; sinon 32 000. */
  longContext?: boolean
}

export type KeepAlive = '30m' | '2h' | '8h'

export interface CustomBrainSettings {
  name: string
  baseUrl: string
  model: string
  /** Style de réponse, comme pour Claude. */
  effort: Effort
  /** OpenRouter : seulement des fournisseurs qui ne conservent pas les messages (vrai par défaut). */
  denyDataCollection?: boolean
}

export type QuizUse = 'write' | 'docs' | 'images' | 'reason' | 'code'

/** Réponses au questionnaire « Aide-moi à choisir ». */
export interface BrainQuizAnswers {
  priority: 'privacy' | 'quality' | 'both'
  uses: QuizUse[]
  language: 'fr' | 'en' | 'multi'
  pace: 'fast' | 'careful'
}

/** Humeur de la mascotte : pilote l'expression des yeux LED et la couleur. */
export type Mood = 'idle' | 'listening' | 'thinking' | 'waiting' | 'happy' | 'error' | 'sleeping' | 'surprised' | 'wink'

export type IslandMode = 'hidden' | 'compact' | 'peek' | 'expanded'

/** `quick` : actions rapides sur le texte sélectionné (hors navigation). */
export type PanelView = 'chat' | 'today' | 'memory' | 'activity' | 'history' | 'connectors' | 'settings' | 'quick'

// ─── Réglages ────────────────────────────────────────────────────────────────

export interface ConnectorConfig {
  id: string
  name: string
  enabled: boolean
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  /** Noms des variables d'environnement (stdio) — valeurs chiffrées à part. */
  envKeys?: string[]
  /** Noms des en-têtes HTTP — valeurs chiffrées à part. */
  headerKeys?: string[]
  templateId?: string
  /** Connexion par compte (OAuth) : les jetons sont chiffrés à part. */
  auth?: 'oauth'
}

/** État de la connexion par compte d'un connecteur. */
export interface ConnectorAuthState {
  connected: boolean
  /** Le service a retiré l'accès : il faut se reconnecter. */
  expired?: boolean
}

/** Recherche par le sens dans les dossiers confiés (vecteurs calculés par Ollama, sur le PC). */
export interface SemanticSettings {
  enabled: boolean
  /** Modèle d'Ollama qui calcule les vecteurs. */
  model: string
}

/** Compte Google (agenda et e-mails). Le secret du client et le jeton sont chiffrés à part. */
export interface GoogleSettings {
  /** ID du client OAuth « Application de bureau » créé par l'utilisateur. */
  clientId: string
  /** Adresse du compte connecté ; vide si aucun compte n'est connecté. */
  email: string
  /** Autorisations réellement accordées par l'utilisateur sur l'écran de Google. */
  calendar: boolean
  mail: boolean
}

/** « Ta journée » : résumé du matin et alertes de réunion. */
export interface DaySettings {
  morning: boolean
  /** Heure du résumé du matin, « HH:MM ». */
  morningTime: string
  /** Ville de la météo (vide : pas de météo). Seule la ville est envoyée à Open-Meteo. */
  city: string
  cityLat?: number
  cityLon?: number
  meetingAlerts: boolean
  /** Minutes avant le début d'une réunion. */
  meetingMinutes: number
}

export interface ClaudeCodeBridgeSettings {
  connected: boolean
  port: number
  token: string
  permissionTimeoutSec: number
}

export interface Settings {
  /** Version du format, pour les migrations. */
  settingsVersion: number
  /** Cerveau par défaut des nouvelles discussions. */
  provider: ProviderId
  /** Modèle Claude (fournisseur `anthropic`). */
  model: ModelId
  /** Style de réponse de Claude (les autres cerveaux ont le leur : `local.effort`, `custom.effort`). */
  effort: Effort
  local: LocalBrainSettings
  custom: CustomBrainSettings
  brainQuiz?: BrainQuizAnswers
  shortcut: string
  /** Raccourci des actions rapides sur la sélection (vide : désactivé). */
  quickShortcut: string
  launchAtLogin: boolean
  autoHide: boolean
  advancedMode: boolean
  /** Outils autorisés « toujours » (noms d'outils de l'agent Compi). */
  alwaysAllow: string[]
  userName: string
  /** Workspace Anthropic (wrkspc_…) pour les clés qui en couvrent plusieurs ; vide sinon. */
  workspaceId: string
  /** Dossiers que Compi peut lire et fouiller sans demander. */
  folders: string[]
  /** Compétences désactivées (noms de dossier). */
  disabledSkills: string[]
  connectors: ConnectorConfig[]
  claudeCode: ClaudeCodeBridgeSettings
  /** Ce que les cerveaux en ligne peuvent recevoir, par type de donnée. */
  privacy: PrivacySettings
  google: GoogleSettings
  day: DaySettings
  /** Sources de l'agenda (Aujourd'hui, résumé du matin, alertes, calendar_events). */
  agenda: AgendaSettings
  /** Afficher la musique en cours dans l'îlot. */
  showMusic: boolean
  voice: VoiceSettings
  /** Garder un historique (chiffré, sur le PC) de ce qui est copié. */
  clipboardHistory: boolean
  semantic: SemanticSettings
  messages: MessagesSettings
  /** Sons discrets : autorisations, rappels, messages. */
  sounds: SoundSettings
  /** Raccourcis pour répondre aux autorisations, actifs seulement quand une carte attend. */
  approvalKeys: ApprovalKeysSettings
  /** Activité du PC (processeur, mémoire, carte graphique). */
  monitor: MonitorSettings
}

export type SoundVolume = 'very-low' | 'low' | 'medium'

export interface SoundSettings {
  enabled: boolean
  volume: SoundVolume
  /** Une carte d'autorisation ou une question attend. */
  approvals: boolean
  /** Rappels, minuteur, réunions, résumé du matin. */
  reminders: boolean
  messages: boolean
  /** Fin d'une routine ou d'une tâche de Claude Code. */
  routines: boolean
  /** Heures sans son (« 22:00 » → « 08:00 »). */
  quietStart: string
  quietEnd: string
}

export interface ApprovalKeysSettings {
  enabled: boolean
  /** Autoriser la plus ancienne carte. */
  allow: string
  /** La refuser. */
  deny: string
}

export interface MonitorSettings {
  /** Mini-jauges dans l'îlot replié. */
  island: boolean
}

/** Messages en attente (notifications des messageries), désactivé par défaut. */
export interface MessagesSettings {
  enabled: boolean
  /** Applications suivies : clé d'une messagerie connue (« whatsapp »…) ou identifiant Windows. */
  apps: string[]
  /** Rappel après ce délai sans lecture (minutes). */
  remindAfterMin: number
  /** Heures calmes, sans rappel (« 22:00 » → « 08:00 »). */
  quietStart: string
  quietEnd: string
  /** Noms des expéditeurs dans l'îlot (sinon, seulement les applications). */
  preview: boolean
  /** Compi peut lire le texte des messages (en mémoire, 24 h). */
  readByCompi: boolean
}

/** État des messages en attente pour l'interface. */
export interface MessagesStatus {
  /** Accès de Windows aux notifications. */
  access: 'allowed' | 'denied' | 'unknown' | 'error'
  pending: import('./messages').PendingMessage[]
  /** Applications vues récemment dans le centre de notifications (nom seulement). */
  seenApps: Array<{ key: string; app: string }>
  reading: boolean
  /** Réglages de notification de Windows : sans eux, les messageries n'envoient rien au centre de notifications. */
  windows?: import('./messages').NotificationHealth
}

/** Réglages tels qu'exposés à l'interface (jamais les secrets eux-mêmes). */
export interface PublicSettings extends Settings {
  hasApiKey: boolean
  /** Une clé est enregistrée pour le service « Autre ». */
  hasCustomKey: boolean
  /** Le raccourci global est bien enregistré (pas pris par une autre app). */
  shortcutActive: boolean
  quickShortcutActive: boolean
  voiceShortcutActive: boolean
  /** Les raccourcis des autorisations n'ont pas pu être pris la dernière fois (autre application). */
  approvalKeysTaken: string[]
  /** Le fichier du client Google (ID + secret) a été importé. */
  hasGoogleClient: boolean
  /** Clés de secrets enregistrées, par connecteur. */
  connectorSecrets: Record<string, string[]>
  /** Connexion par compte, par connecteur (`auth: 'oauth'`). */
  connectorAuth: Record<string, ConnectorAuthState>
}

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface ToolActivity {
  id: string
  name: string
  label: string
  status: 'running' | 'done' | 'error'
}

/** Vitesse mesurée d'une réponse (cerveaux local et « Autre », via la passerelle). */
export interface RunStats {
  /** Délai avant le premier mot de la réponse, en ms. */
  firstTokenMs?: number
  /** Vitesse d'écriture, en jetons par seconde. */
  tokensPerSec?: number
  /** Jetons de prompt réellement lus par le modèle (hors cache), tous appels confondus. */
  inputTokens: number
  outputTokens: number
  /** Nombre d'appels au modèle (un par tour d'outil). */
  requests: number
  /** Cerveau local : le modèle n'était pas chargé au départ (il a fallu le recharger). */
  coldStart?: boolean
  /** Cerveau local : part du modèle dans la carte graphique à la fin (0 à 1). */
  gpuShare?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  tools?: ToolActivity[]
  attachments?: string[]
  error?: string
  /** La réponse annonce une action qu'aucun outil n'a faite (alerte ambre). */
  notice?: MessageNotice
  stats?: RunStats
  /** Ce qui est parti vers un cerveau en ligne pour cette réponse. */
  sentTo?: SentTo
  createdAt: number
}

/** Destination des données d'une réponse : « Envoyé à OpenRouter : ta question · fichiers ». */
export interface SentTo {
  /** Nom du service (`null` : cerveau local, rien n'a quitté le PC). */
  destination: string | null
  categories: PrivacyCategory[]
  /** Nombre de secrets masqués avant l'envoi. */
  masked?: number
}

/** Ligne du journal local des envois (vue Activité). */
export interface SentLogEntry {
  at: number
  destination: string
  categories: PrivacyCategory[]
  masked?: number
  /** Titre de la discussion. */
  conversation: string
}

export interface ConversationMeta {
  id: string
  title: string
  updatedAt: number
  /** Cerveau de la discussion (absent pour les anciennes : Claude). */
  brain?: Brain
}

export interface Conversation extends ConversationMeta {
  sessionId?: string
  /** Empreinte des réglages déjà donnés au modèle dans cette session (prénom, Google, dossiers…). */
  settingsKey?: string
  messages: ChatMessage[]
  /**
   * Un contenu écrit par d'autres (e-mail, invitation) est entré dans la discussion :
   * les outils qui peuvent faire sortir des données demandent alors un OK.
   */
  external?: boolean
}

export interface SendRequest {
  conversationId?: string
  text: string
  attachments?: string[]
}

export interface SendResult {
  conversationId: string
  userMessage: ChatMessage
  assistantMessageId: string
}

export type AgentEvent =
  | { type: 'text'; conversationId: string; messageId: string; delta: string }
  | { type: 'tool'; conversationId: string; messageId: string; tool: ToolActivity }
  | { type: 'thinking'; conversationId: string; messageId: string }
  | { type: 'done'; conversationId: string; messageId: string; costUsd?: number; stats?: RunStats; sentTo?: SentTo; notice?: MessageNotice }
  | { type: 'error'; conversationId: string; messageId: string; error: string }

// ─── Approbations et questions ───────────────────────────────────────────────

export interface ApprovalRequest {
  id: string
  source: 'compi' | 'claude-code'
  /** Phrase affichée : « Compi veut lire ton presse-papier ». */
  title: string
  toolName: string
  /** Détail optionnel : commande, chemin, URL… */
  detail?: string
  /** Pour Claude Code : nom du projet / dossier. */
  sessionLabel?: string
  canAlwaysAllow: boolean
  /** Le contenu partira vers ce service en ligne (garde-fou de confidentialité). */
  destination?: string
  /** Ce qui est visé, en quelques mots (journal des autorisations) : fichier, site, début de commande. */
  target?: string
  /** Ce que « Toujours » enregistre, en clair. */
  alwaysRule?: string
  createdAt: number
}

export type ApprovalDecision = 'allow' | 'deny' | 'always'

/** `auto-deny` : refusé sans carte (routine exécutée sans l'utilisateur). */
export type ApprovalLogOutcome = ApprovalDecision | 'timeout' | 'cancelled' | 'auto-deny'

/** Journal local des autorisations (Activité) : jamais le contenu ni la commande complète. */
export interface ApprovalLogEntry {
  id: string
  at: number
  source: 'compi' | 'claude-code' | 'routine'
  title: string
  tool: string
  target?: string
  /** Projet Claude Code, ou titre de la routine. */
  session?: string
  destination?: string
  outcome: ApprovalLogOutcome
  /** Règle enregistrée par « Toujours ». */
  rule?: string
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  question: string
  header: string
  multiSelect: boolean
  options: QuestionOption[]
}

export interface QuestionRequest {
  id: string
  source: 'claude-code'
  sessionLabel: string
  questions: QuestionItem[]
  createdAt: number
}

export interface QuestionAnswer {
  id: string
  /** `null` = « répondre dans le terminal ». */
  answers: Record<string, string> | null
}

// ─── Sessions Claude Code ────────────────────────────────────────────────────

export interface FileEdit {
  file: string
  added: number
  removed: number
}

export type ClaudeSessionStatus = 'working' | 'waiting' | 'idle' | 'done' | 'ended'

export interface ClaudeSession {
  id: string
  cwd: string
  project: string
  status: ClaudeSessionStatus
  currentTool?: string
  lastPrompt?: string
  lastMessage?: string
  edits: FileEdit[]
  startedAt: number
  updatedAt: number
}

export interface HooksPreview {
  settingsPath: string
  exists: boolean
  before: string
  after: string
}

/** Fin de la connexion par compte d'un connecteur (réglages à jour dans tous les cas). */
export interface ConnectorOAuthResult {
  ok: boolean
  message?: string
  settings: PublicSettings
}

export interface ConnectorTestResult {
  ok: boolean
  message: string
  tools?: string[]
  /** Le service demande une connexion par compte (ou une reconnexion). */
  needsLogin?: boolean
}

/** `attention` : une validation attend (affichée sur place si on discute, sinon dans Activité). */
export type IslandCommand =
  'open-chat' | 'toggle' | 'collapse' | 'open-settings' | 'open-activity' | 'attention' | 'open-quick' | 'open-today' | 'voice' | 'focus-pending'

// ─── Actions rapides sur la sélection ────────────────────────────────────────

export type QuickActionId = 'fix' | 'rephrase' | 'translate' | 'summarize' | 'explain' | 'reply'

/** Texte sélectionné dans une autre application (Alt+Maj+C). */
export interface QuickSelection {
  id: string
  text: string
  /** Fenêtre d'origine : « Mailbird », « Document - Word »… */
  source?: string
  /** On peut remettre le résultat à la place de la sélection. */
  canReplace: boolean
  /** Le cerveau utilisé, et s'il est en ligne (le texte partira vers lui). */
  brainLabel: string
  online: boolean
}

export type QuickEvent =
  { type: 'delta'; id: string; delta: string } | { type: 'done'; id: string; text: string } | { type: 'error'; id: string; error: string }

/** Notification courte affichée dans l'îlot (rappel, fin de tâche…). */
export interface IslandNotice {
  pill: import('./pills').PillId
  text: string
  /** Durée d'affichage en millisecondes (4,8 s par défaut). */
  duration?: number
  /** Vue ouverte par un clic sur l'îlot (la discussion sinon). */
  view?: PanelView
  /** Bouton à droite de la notification : ouvrir un lien (réunion…). */
  action?: { label: string; url: string }
  /** Discussion ouverte par un clic (résultat d'une routine). */
  conversationId?: string
  /** Son joué : celui de la pastille par défaut, `null` pour rester muet. */
  sound?: import('./sounds').SoundKind | null
}

// ─── Ta journée : rappels, agenda, e-mails, météo ────────────────────────────

/** Répétition d'un rappel, toujours à la même heure (`time`, « HH:MM »). */
export type ReminderRepeat =
  | { every: 'day'; time: string }
  | { every: 'weekdays'; time: string }
  /** `days` : 0 = dimanche … 6 = samedi. */
  | { every: 'week'; days: number[]; time: string }
  /** `day` : jour du mois (le dernier jour si le mois est plus court). */
  | { every: 'month'; day: number; time: string }

export interface Reminder {
  id: string
  message: string
  /** Prochaine échéance (ms). */
  dueAt: number
  repeat?: ReminderRepeat
}

export interface DayEvent {
  id: string
  title: string
  /** ISO 8601 ; pour un événement « journée entière », la date seule. */
  start: string
  end: string
  allDay: boolean
  location?: string
  /** Nom de l'agenda ou de la source (vide pour l'agenda Google principal). */
  calendar?: string
  /** Identifiant de l'agenda Google : présent seulement pour un événement Google, que Compi peut modifier. */
  calendarId?: string
  /** Lien de visioconférence reconnu (Meet, Zoom, Teams…). */
  meetUrl?: string
  htmlLink?: string
}

export interface DayMail {
  id: string
  from: string
  subject: string
  date?: string
  important: boolean
}

export interface DayWeather {
  city: string
  label: string
  min: number
  max: number
  /** Probabilité de pluie maximale de la journée (%). */
  rain?: number
}

/**
 * Comment remplir les paramètres de l'outil d'un connecteur pour une période :
 * noms des paramètres de début, de fin ou de jour, et format attendu.
 */
export interface AgendaToolArgs {
  from?: string
  to?: string
  /** Un seul jour par appel (« date ») : Compi appelle l'outil pour chaque jour. */
  day?: string
  /**
   * Filtre sur un champ date, façon base de données : `{ [field]: { [gte]: début, [lt]: fin } }`.
   * `split` : le service veut un seul opérateur par champ, les deux bornes passent par
   * le paramètre `and` (`{ and: [{ [field]: { gte } }, { [field]: { lt } }] }`).
   */
  range?: { field: string; gte: string; lt: string; and?: string; split?: boolean }
  format: 'date' | 'datetime'
  /** Paramètre du fuseau horaire (« timeZone » de Notion Calendar) : rempli avec celui du PC. */
  zone?: string
  /** Paramètres fixes (nombre maximal de résultats, champs à renvoyer…). */
  fixed: Record<string, string | number | boolean | string[]>
}

/**
 * Connecteur « passerelle » : ses vrais outils ne sont pas listés directement, ils
 * passent par un outil d'exécution (catalogue → schéma → exécution).
 */
export interface AgendaVia {
  /** Outil d'exécution (« execute_tool »). */
  tool: string
  /** Paramètre qui reçoit le nom du vrai outil, et celui qui reçoit ses paramètres. */
  nameKey: string
  argsKey: string
}

/** Une source d'agenda ajoutée par l'utilisateur (Google se règle à part). */
export type AgendaSource =
  | { id: string; kind: 'connector'; name: string; enabled: boolean; connectorId: string; tool: string; args: AgendaToolArgs; via?: AgendaVia }
  /** Le lien lui-même est un secret (quiconque l'a lit l'agenda) : il est chiffré, seul le site est ici. */
  | { id: string; kind: 'ics'; name: string; enabled: boolean; host: string }

export interface AgendaSettings {
  /** Agendas Google affichés : `null` = comme dans Google Agenda (les agendas cochés). */
  googleCalendars: string[] | null
  sources: AgendaSource[]
}

/** Un agenda Google, pour le choix dans les réglages. */
export interface GoogleCalendarChoice {
  id: string
  name: string
  primary: boolean
  /** Affiché en ce moment dans Compi. */
  shown: boolean
}

/** Outil d'un connecteur qui pourrait fournir des événements, du plus probable au moins probable. */
export interface AgendaToolChoice {
  tool: string
  description: string
  /** Outil trouvé dans le catalogue d'une passerelle : appelé par cet outil d'exécution. */
  via?: string
  /** Ce qui empêche de l'utiliser (écriture possible, paramètre impossible à remplir). */
  problem?: string
}

export type AgendaDraft = { kind: 'connector'; connectorId: string; tool: string; via?: string; name?: string } | { kind: 'ics'; url: string; name?: string }

export interface AgendaPreview {
  ok: boolean
  message: string
  /** Événements d'aujourd'hui et des 7 jours suivants (les premiers). */
  events: DayEvent[]
  count: number
  /** Nom proposé pour la source. */
  name?: string
}

export interface TodayInfo {
  /** Date du jour, « AAAA-MM-JJ ». */
  date: string
  google: { email: string; calendar: boolean; mail: boolean }
  /** Au moins une source d'agenda active (Google ou une autre). */
  agenda: boolean
  events: DayEvent[]
  /** Non lus de la boîte de réception (estimation de Gmail), et les plus récents. */
  unread?: { count: number; latest: DayMail[] }
  reminders: Reminder[]
  weather?: DayWeather
  /** Ce qui n'a pas pu être chargé (« Agenda : … »). */
  errors: string[]
}

export type GoogleConnectResult = { ok: true; email: string; calendar: boolean; mail: boolean } | { ok: false; message: string }

// ─── Îlot vivant : musique, minuteur, voix ───────────────────────────────────

/** Ce qui joue en ce moment, d'après les contrôles multimédias de Windows. */
export interface MediaInfo {
  status: 'playing' | 'paused' | 'stopped' | 'other'
  title: string
  artist: string
  album: string
  /** Application : « Spotify », « Chrome »… (vide si inconnue). */
  app: string
  /** Pochette en URL `data:`, si l'application en publie une. */
  art?: string
  /** Position (s) au moment `at` (ms) ; durée (s), 0 si inconnue. */
  position: number
  duration: number
  at: number
  canNext: boolean
  canPrevious: boolean
}

export type MediaAction = 'play_pause' | 'next' | 'previous'

/** Le minuteur en cours (un seul à la fois). En pause : pas de `endsAt`. */
export interface TimerState {
  kind: 'timer' | 'pomodoro'
  /** Libellé du minuteur (« Pâtes »), vide sinon. */
  label: string
  /** Durée de la phase en cours (ms). */
  durationMs: number
  endsAt?: number
  remainingMs?: number
  pomodoro?: { phase: 'focus' | 'break'; round: number; rounds: number; focusMin: number; breakMin: number }
}

/** Une voix de synthèse installée dans Windows. */
export interface VoiceInfo {
  id: string
  /** « Julie », « Paul »… */
  name: string
  /** « fr-FR »… */
  lang: string
  gender: string
}

/** Dictée et lecture des réponses à voix haute. */
export interface VoiceSettings {
  /** Jamais, seulement quand j'ai parlé à Compi, ou toujours. */
  speak: 'never' | 'voice' | 'always'
  /** Identifiant de la voix Windows ; vide : la première voix française. */
  voice: string
  /** Vitesse, de 0,5 à 2 (1 : normale). */
  rate: number
  /** Raccourci de la dictée (vide : désactivé). */
  shortcut: string
  /** Modèle Whisper choisi. */
  model: VoiceModelId
}

export type VoiceModelId = 'small' | 'base'
/** Carte graphique (WebGPU) ou processeur. */
export type VoiceVariant = 'gpu' | 'cpu'

export interface VoiceModelStatus {
  model: VoiceModelId
  installed: boolean
  variant?: VoiceVariant
  sizeBytes?: number
  downloading?: { model: VoiceModelId; variant: VoiceVariant; received: number; total: number }
}

// ─── Mémoire, routines, presse-papier, recherche par le sens ─────────────────

/** Un souvenir : ce que Compi a retenu sur l'utilisateur. */
export interface MemoryItem {
  id: string
  fact: string
  /** ms */
  createdAt: number
  updatedAt?: number
  /** Retenu pendant une discussion, ou ajouté à la main. */
  source: 'chat' | 'manual'
  /** Titre de la discussion d'origine. */
  conversation?: string
}

export interface RoutineRun {
  at: number
  ok: boolean
  /** Discussion qui contient le résultat. */
  conversationId?: string
  /** Début de la réponse. */
  preview?: string
  error?: string
}

/** Une routine : une demande à Compi, exécutée sans l'utilisateur à heure fixe. */
export interface Routine {
  id: string
  title: string
  prompt: string
  repeat: ReminderRepeat
  enabled: boolean
  /** Prochaine exécution (ms). */
  nextAt: number
  createdAt: number
  lastRun?: RoutineRun
  /** En cours d'exécution. */
  running?: boolean
}

export interface RoutineDraft {
  id?: string
  title: string
  prompt: string
  repeat: ReminderRepeat
  enabled?: boolean
}

/** Une entrée de l'historique du presse-papier. */
export interface ClipItem {
  id: string
  text: string
  at: number
  /** Application d'où vient la copie, si connue. */
  source?: string
  pinned?: boolean
}

/** Passage trouvé par la recherche par le sens (case « Essayer »). */
export interface SemanticPassage {
  file: string
  page?: number
  text: string
  score: number
}

export interface SemanticStatus {
  /**
   * `off` : désactivée ; `no-ollama` : Ollama absent ; `no-model` : modèle à télécharger ;
   * `indexing` : lecture des documents ; `ready` : prête.
   */
  state: 'off' | 'no-ollama' | 'no-model' | 'indexing' | 'ready' | 'error'
  model: string
  /** Documents trouvés dans les dossiers confiés, et déjà lus. */
  files: number
  indexed: number
  passages: number
  /** Document en cours de lecture. */
  current?: string
  updatedAt?: number
  error?: string
  /** Quand c'est désactivé : le modèle est-il déjà sur le PC (inconnu si Ollama est éteint) ? */
  modelInstalled?: boolean
}

// ─── Extensions : compétences et registre MCP ────────────────────────────────

export interface SkillInfo {
  name: string
  /** Premier titre « # … » des instructions, pour l'affichage. */
  title?: string
  description: string
  /** Compétence de départ fournie avec Compi. */
  builtin: boolean
  /** SKILL.md lisible (en-tête name + description présent). */
  valid: boolean
  /** Le dossier contient d'autres fichiers que SKILL.md (scripts, modèles…). */
  hasFiles: boolean
}

export interface SkillDraft {
  name: string
  description: string
  body: string
  /** Nom actuel, pour un renommage. */
  previousName?: string
}

export interface RegistryEntry {
  id: string
  title: string
  description: string
  kind: 'remote' | 'npm' | 'python'
  /** Logiciel à installer sur le PC pour les serveurs locaux. */
  requirement?: string
  config: ConnectorConfig
  /** Noms des secrets attendus (variables d'environnement ou en-têtes). */
  secrets: string[]
  hints: Record<string, string>
}

// ─── Cerveau local, matériel et recommandation ───────────────────────────────

export interface LocalModelInfo {
  /** Nom à utiliser (`qwen3.5:9b`, `google/gemma-4-12b`…). */
  name: string
  sizeBytes: number
  /** Taille du modèle en paramètres (« 9.7B »), si connue. */
  params?: string
  tools: boolean
  vision: boolean
  thinking: boolean
  contextLength?: number
}

export interface LocalStatus {
  engine: LocalEngine | null
  /** Adresse du moteur détecté. */
  baseUrl: string
  /** Moteur joignable sur son port. */
  running: boolean
  /** Ollama est installé mais ne tourne pas. */
  installed: boolean
  version?: string
  /** Version trop ancienne pour l'API compatible (Ollama < 0.14). */
  outdated: boolean
  /** winget est disponible pour installer Ollama en un clic. */
  canInstall: boolean
  models: LocalModelInfo[]
  /** Modèle actuellement chargé par Ollama, et la part qui tient dans la carte graphique (0 à 1). */
  loaded?: { name: string; gpuShare: number }
}

export interface HardwareInfo {
  ramGb: number
  gpu?: { name: string; vramGb: number; vendor: 'nvidia' | 'amd' | 'intel' | 'other' }
  /** Espace libre sur le disque des modèles, en Go. */
  freeDiskGb?: number
}

/** Fiche d'un modèle du catalogue conseillé. */
export interface CatalogModel {
  id: string
  label: string
  maker: string
  sizeGb: number
  /** Mémoire nécessaire (poids + 32k de contexte), en Go. */
  needGb: number
  vision: boolean
  thinking: boolean
  /** Notes de 1 à 5. */
  scores: { write: number; docs: number; reason: number; code: number; fr: number; multi: number; tools: number; speed: number }
  why: string
}

export interface BrainRecommendation {
  provider: ProviderId
  /** Modèle local conseillé (absent si le conseil est Claude). */
  pick?: CatalogModel
  alternatives: CatalogModel[]
  /** Comment le modèle tournera sur ce PC. */
  fit?: 'gpu' | 'mixed' | 'cpu'
  reasons: string[]
  cloudHelp: boolean
  /** Style de réponse local conseillé d'après le rythme choisi. */
  effort: Effort
}

export interface BrainTestResult {
  ok: boolean
  message: string
  tokensPerSec?: number
  tools?: boolean
}

/** Progression d'une installation (Ollama) ou d'un téléchargement de modèle. */
export interface BrainProgress {
  kind: 'install' | 'pull'
  /** Modèle en cours de téléchargement. */
  model?: string
  status: string
  /** 0 à 1, si connu. */
  progress?: number
  done?: boolean
  error?: string
}
