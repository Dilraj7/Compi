// Libellés en français des outils : activité affichée pendant le travail de
// l'agent, et phrases des cartes d'approbation.

import { basename } from 'node:path'
import { repeatLabel } from '../../shared/day'
import { isLauncher, movesSummary } from '../../shared/folderPlan'
import { REPEAT_KINDS, routineRepeat, type RepeatKind } from '../../shared/routines'
import { isSettingsPage, SETTINGS_PAGES } from '../../shared/windows'
import { eventByReference, type EventRef } from '../google/eventRefs'
import { redact } from '../privacy/redact'

type Input = Record<string, unknown>

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const moveList = (input: Input): Array<{ from: string; to: string }> =>
  Array.isArray(input.moves) ? (input.moves as Array<{ from?: unknown; to?: unknown }>).map((m) => ({ from: str(m.from), to: str(m.to) })) : []

let semanticReady = false
/** La recherche par le sens est prête : la discussion l'indique sur la ligne de recherche. */
export function noteSemanticReady(on: boolean): void {
  semanticReady = on
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** « notion-741c » → « notion » : nom d'extension lisible. */
const extensionName = (server: string): string => server.replace(/-[0-9a-f]{4}$/, '')

function splitMcp(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name)
  return m ? { server: m[1], tool: m[2] } : null
}

/** Libellé court de l'activité en cours (« Recherche web : météo Paris »). */
export function activityLabel(name: string, input: Input = {}): string {
  switch (name) {
    case 'WebSearch':
      return `Recherche web : ${str(input.query)}`
    case 'WebFetch':
      return `Lecture de ${host(str(input.url))}`
    case 'Read':
      return `Lecture de ${basename(str(input.file_path))}`
    case 'Glob':
    case 'Grep':
      return 'Recherche dans les fichiers'
    case 'ListMcpResourcesTool':
      return `Documents de l’extension ${extensionName(str(input.server))}`.trimEnd()
    case 'ReadMcpResourceTool':
      return `Lecture de ${str(input.uri)}`
    case 'Bash':
    case 'PowerShell':
      return `Commande : ${str(input.command).slice(0, 80)}`
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return `Modification de ${basename(str(input.file_path))}`
    case 'TodoWrite':
      return 'Organisation des tâches'
    case 'Skill':
      return `Compétence : ${str(input.skill) || str(input.name)}`
  }
  const mcp = splitMcp(name)
  if (mcp?.server === 'compi') {
    switch (mcp.tool) {
      case 'get_datetime':
        return "Coup d'œil à l'heure"
      case 'clipboard_read':
        return 'Lecture du presse-papier'
      case 'clipboard_write':
        return 'Copie dans le presse-papier'
      case 'screen_capture':
        return "Capture d'écran"
      case 'open_url':
        return `Ouverture de ${host(str(input.url))}`
      case 'open_path':
        return `Ouverture de ${basename(str(input.path))}`
      case 'folder_inventory':
        return `Inventaire de ${basename(str(input.path)) || 'ton Bureau'}`
      case 'create_folders':
        return `Création de dossiers : ${strs(input.names).join(', ')}`
      case 'move_items':
        return `Rangement : ${moveList(input).length} élément(s)`
      case 'undo_moves':
        return 'Annulation du rangement'
      case 'open_folder':
        return `Ouverture du dossier ${basename(str(input.path))}`
      case 'notify':
        return 'Notification'
      case 'memory_save':
        return 'Mémorisation'
      case 'memory_search':
        return 'Consultation de la mémoire'
      case 'memory_forget':
        return 'Oubli d’un souvenir'
      case 'routine_create':
        return `Routine : ${str(input.title)}`
      case 'routine_list':
        return 'Coup d’œil aux routines'
      case 'routine_delete':
        return 'Suppression d’une routine'
      case 'clipboard_history':
        return input.query ? `Recherche dans l’historique du presse-papier : ${str(input.query)}` : 'Coup d’œil à l’historique du presse-papier'
      case 'messages_recent':
        return `Lecture de tes messages reçus${input.app ? ` (${str(input.app)})` : ''}`
      case 'reminder_create':
        return `Rappel : ${str(input.message)}`
      case 'reminder_list':
        return 'Coup d’œil aux rappels'
      case 'reminder_cancel':
        return 'Annulation d’un rappel'
      case 'weather_forecast':
        return `Météo${str(input.city) ? ` : ${str(input.city)}` : ''}`
      case 'timer_start':
        return `Minuteur${str(input.label) ? ` : ${str(input.label)}` : ''}`
      case 'pomodoro_start':
        return 'Lancement d’un pomodoro'
      case 'timer_status':
        return 'Coup d’œil au minuteur'
      case 'timer_stop':
        return 'Arrêt du minuteur'
      case 'now_playing':
        return 'Coup d’œil à la musique en cours'
      case 'calendar_events':
        return input.query ? `Recherche dans ton agenda : ${str(input.query)}` : 'Coup d’œil à ton agenda'
      case 'calendar_create_event':
        return `Agenda : ${str(input.title)}`
      case 'calendar_update_event':
        return `Agenda : modification de « ${eventByReference(input.ref)?.title ?? str(input.ref)} »`
      case 'calendar_delete_event':
        return `Agenda : suppression de « ${eventByReference(input.ref)?.title ?? str(input.ref)} »`
      case 'mail_search':
        return `Recherche dans tes e-mails : ${str(input.query)}`
      case 'mail_read':
        return 'Lecture d’un e-mail'
      case 'mail_create_draft':
        return 'Préparation d’un brouillon'
      case 'read_document':
        return `Lecture de ${basename(str(input.path))}`
      case 'search_documents':
        return `Recherche dans tes documents${semanticReady ? ' (par le sens)' : ''} : ${str(input.query)}`
      case 'fetch_page':
        return `Lecture de ${host(str(input.url))}`
      case 'read_screen_text':
        return 'Lecture du texte de l’écran'
      case 'windows_status':
        return 'Coup d’œil à l’état du PC'
      case 'list_windows':
        return 'Coup d’œil aux fenêtres ouvertes'
      case 'search_files':
        return `Recherche sur le PC : ${str(input.query)}`
      case 'use_extension':
        return `Chargement des outils : ${str(input.name)}`
      case 'open_app':
        return `Ouverture de ${str(input.name)}`
      case 'focus_window':
        return `Fenêtre : ${str(input.window_title)}`
      case 'sound_control':
        return soundPhrase(input, false)
      case 'set_theme':
        return input.mode === 'light' ? 'Thème clair' : 'Thème sombre'
      case 'open_settings':
        return `Paramètres : ${settingsLabel(input.page)}`
    }
  }
  if (mcp) return `${mcp.server.replace(/-[0-9a-f]{4}$/, '')} · ${mcp.tool.replace(/_/g, ' ')}`
  return name
}

const DAY_TIME = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
const DAY_ONLY = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/** « mardi 14 octobre, 15:00 → 16:00 » ou « mardi 14 octobre, toute la journée ». */
function whenLabel(start: string, end: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return `${DAY_ONLY.format(new Date(`${start}T12:00:00`))}, toute la journée`
  const s = new Date(start)
  if (Number.isNaN(s.getTime())) return start
  const e = end ? new Date(end) : null
  const endText = e && !Number.isNaN(e.getTime()) ? ` → ${e.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : ''
  return `${DAY_TIME.format(s)}${endText}`
}

const UNKNOWN_REF = "Réf inconnue : l'outil va échouer. Compi doit d'abord relire l'agenda."

/** Date d'arrivée d'un déplacement ; sans fin donnée, la durée est gardée (comme patchBody). */
function movedWhen(old: EventRef, start: string, end: string): string {
  if (!start) return end ? whenLabel(old.start, end) : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(start) || end) return whenLabel(start, end)
  const s = new Date(start)
  if (Number.isNaN(s.getTime())) return start
  const keep = !old.allDay && Date.parse(old.end) > Date.parse(old.start) ? Date.parse(old.end) - Date.parse(old.start) : 60 * 60_000
  return whenLabel(start, new Date(s.getTime() + keep).toISOString())
}

function periodLabel(input: Input): string {
  const days = typeof input.days === 'number' ? input.days : 1
  const from = str(input.from)
  const start = from ? DAY_ONLY.format(new Date(`${from}T12:00:00`)) : 'aujourd’hui'
  return days > 1 ? `${start}, sur ${days} jours` : start
}

const settingsLabel = (page: unknown): string => (typeof page === 'string' && isSettingsPage(page) ? SETTINGS_PAGES[page] : str(page))

/** « régler le son à 40 % », « passer au morceau suivant »… */
function soundPhrase(input: Input, verb: boolean): string {
  const level = typeof input.level === 'number' ? Math.round(input.level) : undefined
  const phrases: Record<string, [string, string]> = {
    volume: [`régler le son à ${level ?? '?'} %`, `Son à ${level ?? '?'} %`],
    mute: ['couper le son', 'Son coupé'],
    unmute: ['remettre le son', 'Son remis'],
    play_pause: ['mettre en pause ou relancer la musique', 'Lecture / pause'],
    next: ['passer au morceau suivant', 'Morceau suivant'],
    previous: ['revenir au morceau précédent', 'Morceau précédent']
  }
  const p = phrases[str(input.action)] ?? ['régler le son', 'Son']
  return verb ? p[0] : p[1]
}

function routineDetail(input: Input): string {
  const kind = str(input.repeat)
  let when = ''
  if ((REPEAT_KINDS as readonly string[]).includes(kind)) {
    const days = Array.isArray(input.days) ? input.days.map(String) : undefined
    const dom = typeof input.day_of_month === 'number' ? input.day_of_month : undefined
    when = repeatLabel(routineRepeat(kind as RepeatKind, str(input.time) || '09:00', days, dom))
  }
  const prompt = str(input.prompt)
  return [
    when && when.charAt(0).toUpperCase() + when.slice(1),
    prompt.slice(0, 400) + (prompt.length > 400 ? '…' : ''),
    'Elle tournera sans toi : seulement les données réglées sur « Toujours », aucune action.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/**
 * Ce qui est visé, en quelques mots, pour le journal des autorisations : nom du
 * fichier, site, début de la commande (secrets masqués). Rien pour les outils de
 * Compi, dont la phrase de la carte le dit déjà.
 */
export function auditTarget(name: string, input: Input = {}): string | undefined {
  const short = (s: string, n: number): string => {
    const line = redact(s.split(/\r?\n/).find((l) => l.trim()) ?? '').text.trim()
    return line.length > n ? `${line.slice(0, n - 1)}…` : line
  }
  let out = ''
  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      out = basename(str(input.file_path) || str(input.notebook_path))
      break
    case 'Glob':
    case 'Grep':
      out = short(str(input.pattern), 60)
      break
    case 'WebFetch':
      out = str(input.url) ? host(str(input.url)) : ''
      break
    case 'WebSearch':
      out = short(str(input.query), 80)
      break
    case 'Bash':
    case 'PowerShell':
      out = short(str(input.command), 100)
      break
  }
  return out || undefined
}

/** Phrase de la carte d'approbation (« Compi veut lire ton presse-papier »). */
export function approvalTitle(name: string, input: Input = {}): { title: string; detail?: string } {
  switch (name) {
    case 'Read':
      return { title: 'Compi veut lire un fichier', detail: str(input.file_path) }
    case 'Glob':
    case 'Grep':
      return { title: 'Compi veut chercher dans tes fichiers', detail: str(input.path) || str(input.pattern) }
    case 'WebFetch':
      return { title: 'Compi veut lire une page web', detail: str(input.url) }
    case 'WebSearch':
      return { title: 'Compi veut faire une recherche web', detail: str(input.query) }
    case 'ReadMcpResourceTool':
      return { title: `Compi veut lire un document de l’extension ${extensionName(str(input.server))}`.trimEnd(), detail: str(input.uri) }
    case 'Bash':
    case 'PowerShell':
      return { title: 'Compi veut exécuter une commande', detail: str(input.command) }
    case 'Write':
      return { title: 'Compi veut créer un fichier', detail: str(input.file_path) }
    case 'Edit':
    case 'NotebookEdit':
      return { title: 'Compi veut modifier un fichier', detail: str(input.file_path) }
  }
  const mcp = splitMcp(name)
  if (mcp?.server === 'compi') {
    switch (mcp.tool) {
      case 'clipboard_read':
        return { title: 'Compi veut lire ton presse-papier' }
      case 'clipboard_write':
        return { title: 'Compi veut copier du texte dans ton presse-papier', detail: str(input.text).slice(0, 200) }
      case 'screen_capture':
        return { title: 'Compi veut regarder ton écran' }
      case 'open_url':
        return { title: 'Compi veut ouvrir un lien', detail: str(input.url) }
      case 'open_path': {
        const path = str(input.path)
        if (isLauncher(path))
          return { title: `Compi veut lancer « ${basename(path)} »`, detail: `${path}\n\nC’est un programme ou un script : il s’exécutera sur ton PC.` }
        return { title: `Compi veut ouvrir ${/\.[a-z0-9]{1,8}$/i.test(path) ? '' : 'le dossier '}« ${basename(path)} »`, detail: path }
      }
      case 'create_folders':
        return { title: `Compi veut créer ${strs(input.names).length} dossier(s)`, detail: `${strs(input.names).join(', ')}\n\nDans ${str(input.parent)}` }
      case 'move_items': {
        const moves = moveList(input)
        return { title: `Compi veut déplacer ${moves.length} élément(s)`, detail: movesSummary(moves) }
      }
      case 'undo_moves':
        return { title: 'Compi veut annuler le dernier rangement', detail: 'Chaque élément retourne à sa place d’origine, sans rien écraser.' }
      case 'read_document':
        return { title: 'Compi veut lire un document hors de tes dossiers', detail: str(input.path) }
      case 'fetch_page':
        return { title: 'Compi veut lire une page web', detail: str(input.url) }
      case 'read_screen_text':
        return { title: 'Compi veut lire le texte de ton écran' }
      case 'windows_status':
        return { title: 'Compi veut consulter l’état de ton PC', detail: 'Batterie, son, réseau, mémoire, disques, applications ouvertes' }
      case 'list_windows':
        return { title: 'Compi veut voir la liste de tes fenêtres ouvertes', detail: 'Titres des fenêtres et noms des applications' }
      case 'now_playing':
        return { title: 'Compi veut savoir quelle musique joue', detail: 'Titre, artiste et application' }
      case 'search_files':
        return { title: 'Compi veut chercher des fichiers sur ton PC', detail: str(input.query) }
      case 'memory_search':
        return { title: 'Compi veut consulter ce qu’il a retenu sur toi', detail: str(input.query) || undefined }
      case 'clipboard_history':
        return { title: 'Compi veut consulter l’historique de ton presse-papier', detail: str(input.query) || undefined }
      case 'messages_recent': {
        const filters = [
          str(input.app),
          str(input.sender) && `de ${str(input.sender)}`,
          typeof input.since_minutes === 'number' && `${input.since_minutes} dernières minutes`
        ].filter(Boolean)
        return { title: 'Compi veut lire tes messages reçus', detail: filters.length ? filters.join(' · ') : 'Messages des dernières 24 h' }
      }
      case 'routine_create':
        return { title: `Compi veut créer la routine « ${str(input.title)} »`, detail: routineDetail(input) }
      case 'search_documents':
        return { title: 'Compi veut chercher dans tes documents', detail: str(input.query) }
      case 'open_app':
        return { title: `Compi veut ouvrir l’application « ${str(input.name)} »` }
      case 'focus_window':
        return { title: `Compi veut afficher la fenêtre « ${str(input.window_title)} »` }
      case 'sound_control':
        return { title: `Compi veut ${soundPhrase(input, true)}` }
      case 'set_theme':
        return { title: `Compi veut passer Windows en thème ${input.mode === 'light' ? 'clair' : 'sombre'}` }
      case 'open_settings':
        return { title: `Compi veut ouvrir les Paramètres › ${settingsLabel(input.page)}` }
      case 'calendar_events':
        return { title: 'Compi veut consulter ton agenda', detail: [periodLabel(input), str(input.query)].filter(Boolean).join(' · ') }
      case 'calendar_create_event':
        return {
          title: `Compi veut ajouter « ${str(input.title)} » à ton agenda`,
          detail: [whenLabel(str(input.start), str(input.end)), str(input.location), 'Sans invité : personne ne sera prévenu.'].filter(Boolean).join('\n')
        }
      case 'calendar_update_event': {
        const ev = eventByReference(input.ref)
        if (!ev) return { title: 'Compi veut modifier un événement de ton agenda', detail: UNKNOWN_REF }
        const when = movedWhen(ev, str(input.start), str(input.end))
        const title = str(input.title).trim()
        return {
          title: `Compi veut ${when ? 'déplacer' : 'modifier'} « ${ev.title} »`,
          detail: [
            when ? `Avant : ${whenLabel(ev.start, ev.end)}\nAprès : ${when}` : whenLabel(ev.start, ev.end),
            title && title !== ev.title ? `Nouveau titre : « ${title} »` : '',
            str(input.location) ? `Lieu : ${str(input.location)}` : '',
            'Le même événement, sans doublon. Personne ne sera prévenu.'
          ]
            .filter(Boolean)
            .join('\n')
        }
      }
      case 'calendar_delete_event': {
        const ev = eventByReference(input.ref)
        if (!ev) return { title: 'Compi veut supprimer un événement de ton agenda', detail: UNKNOWN_REF }
        return {
          title: `Compi veut supprimer « ${ev.title} » de ton agenda`,
          detail: `${whenLabel(ev.start, ev.end)}\nRécupérable 30 jours dans la corbeille de Google Agenda. Personne ne sera prévenu.`
        }
      }
      case 'mail_search':
        return { title: 'Compi veut chercher dans tes e-mails', detail: str(input.query) }
      case 'mail_read':
        return { title: 'Compi veut lire un e-mail' }
      case 'mail_create_draft': {
        const to = str(input.to)
        return {
          title: `Compi veut préparer un brouillon ${to ? `pour ${to}` : 'de réponse'}`,
          detail: [
            str(input.subject) ? `Objet : ${str(input.subject)}` : '',
            str(input.body).slice(0, 400) + (str(input.body).length > 400 ? '…' : ''),
            'Rien ne sera envoyé : tu relis le brouillon dans Gmail et tu l’envoies toi-même.'
          ]
            .filter(Boolean)
            .join('\n\n')
        }
      }
    }
  }
  if (mcp) {
    const detail = JSON.stringify(input)
    return {
      title: `Compi veut utiliser ${mcp.server.replace(/-[0-9a-f]{4}$/, '')} · ${mcp.tool.replace(/_/g, ' ')}`,
      detail: detail === '{}' ? undefined : detail.slice(0, 300)
    }
  }
  return { title: `Compi veut utiliser l'outil ${name}`, detail: JSON.stringify(input).slice(0, 300) }
}
