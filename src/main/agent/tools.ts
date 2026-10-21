// Outils internes de Compi, exposés à l'agent comme un serveur MCP en mémoire.
// Les outils sensibles (presse-papier, écran, ouverture d'URL/fichiers) passent
// par une carte d'approbation ; les autres sont autorisés d'office.

import { randomUUID } from 'node:crypto'
import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { app, clipboard, desktopCapturer, nativeImage, net, Notification, screen, shell } from 'electron'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { isPrivateHost } from '../../shared/brains'
import { IPC } from '../../shared/ipc'
import type { ProviderId } from '../../shared/types'
import { approvals } from '../approvals'
import { emit } from '../bus'
import { findClips } from '../clipboard/history'
import { recentMessages } from '../messages/watch'
import { addMemory, deleteMemory, listMemory, searchMemory } from '../memory/store'
import { getNotchWindow, sendIslandCommand } from '../notchWindow'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'
import { dayTools, GOOGLE_ACTIONS } from './dayTools'
import { liveTools } from './liveTools'
import { ROUTINE_ACTIONS, routineTools } from './routineTools'
import { searchDocuments } from './docSearch'
import { extractDocument, htmlToText, IMAGE_EXTENSIONS, paginate, UnsupportedDocumentError } from './documents'
import { allowedFolders, insideAny } from './folders'
import { folderTools, isNetworkPath } from './folderTools'
import { describeImage, transcribePdf, VISION_MAX_BYTES, VISION_MAX_PAGES } from './vision'
import { redact } from '../privacy/redact'
import { semanticSearch } from '../semantic'
import { serverKey } from '../connectors/registry'
import { connectorKeywords, findServer, usableInRoutine, USE_EXTENSION } from '../../shared/localTools'
import { ocrPdf, ocrPng, tooLittleText } from '../windows/ocr'
import { FILE_KINDS, formatHits, searchFiles } from '../windows/search'
import {
  focusWindow,
  formatStatus,
  formatWindow,
  getStatus,
  isSettingsPage,
  launchApp,
  listWindows,
  matchApps,
  mediaControl,
  openSettings,
  setTheme,
  setVolume,
  SETTINGS_PAGES,
  startApps,
  type SettingsPage
} from '../windows/system'

type SdkModule = typeof import('@anthropic-ai/claude-agent-sdk')

export const COMPI_SERVER = 'compi'

/** Outils internes sans risque, autorisés sans demander (lecture seule, ou sans effet sur le PC). */
export const SAFE_COMPI_TOOLS = [
  'get_datetime',
  'notify',
  'memory_search',
  'memory_save',
  'memory_forget',
  'reminder_create',
  'reminder_list',
  'reminder_cancel',
  'weather_forecast',
  'timer_start',
  'pomodoro_start',
  'timer_status',
  'timer_stop',
  'now_playing',
  'routine_list',
  'routine_delete',
  'clipboard_history',
  // Messages reçus : libre en local ; en ligne, une carte à chaque fois (sans « Toujours »).
  'messages_recent',
  'fetch_page',
  'windows_status',
  'list_windows',
  'search_files',
  // Rangement : l'inventaire ne lit que les noms (garde-fou « Fichiers » en ligne) ; ouvrir un dossier ne fait que l'afficher.
  'folder_inventory',
  'open_folder',
  // Modèle local : charge les outils d'un connecteur branché (rien ne s'exécute).
  'use_extension',
  // Lecture du compte Google : libre en local ; pour un cerveau en ligne, le garde-fou s'applique.
  'calendar_events',
  'mail_search',
  'mail_read'
].map((t) => `mcp__${COMPI_SERVER}__${t}`)

/**
 * Actions sur Windows : une carte Autoriser / Refuser à chaque fois, jamais
 * « Toujours ». L'utilisateur reste le maître.
 */
export const WINDOWS_ACTIONS = ['open_app', 'focus_window', 'sound_control', 'set_theme', 'open_settings'].map((t) => `mcp__${COMPI_SERVER}__${t}`)

/** Rangement des dossiers confiés : une carte à chaque fois, jamais « Toujours ». */
export const FOLDER_ACTIONS = ['create_folders', 'move_items', 'undo_moves'].map((t) => `mcp__${COMPI_SERVER}__${t}`)

/** Tout ce qui demande un OK à chaque fois : actions sur Windows, rangement, événements et brouillons Google, routines. */
export const CONFIRM_EACH_TIME = [...WINDOWS_ACTIONS, ...FOLDER_ACTIONS, ...GOOGLE_ACTIONS, ...ROUTINE_ACTIONS]

/**
 * Pendant une routine (sans l'utilisateur) : aucune action ni écriture durable,
 * en plus de tout ce qui demanderait une carte.
 */
export const HEADLESS_BLOCKED = [
  'memory_save',
  'memory_forget',
  'clipboard_write',
  'open_url',
  'open_path',
  'open_folder',
  'create_folders',
  'move_items',
  'undo_moves',
  'routine_create',
  'routine_delete',
  'messages_recent'
].map((t) => `mcp__${COMPI_SERVER}__${t}`)

/** Ce que les outils doivent savoir du cerveau de la discussion. */
export interface CompiToolContext {
  provider: ProviderId
  /** Le modèle voit les images. */
  vision: boolean
  /** Proposer Claude (avec accord) quand le modèle ne sait pas faire. */
  cloudHelp: boolean
  signal?: AbortSignal
  /** Des secrets ont été masqués avant l'envoi à un cerveau en ligne. */
  onMasked?: (count: number) => void
  /** L'utilisateur a accepté d'envoyer un scan ou une image à Claude. */
  onCloudShared?: () => void
  /** Un contenu écrit par d'autres (e-mail, invitation) vient d'être lu. */
  onExternalContent?: () => void
  /** Titre de la discussion (origine d'un souvenir). */
  conversationTitle?: string
  /** Routine exécutée sans l'utilisateur : rien ne s'affiche dans l'îlot. */
  headless?: boolean
}

const text = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }] })
const fail = (t: string): CallToolResult => ({ content: [{ type: 'text', text: t }], isError: true })

/** Contenu personnel : les secrets sont masqués s'il part vers un cerveau en ligne. */
function personal(ctx: CompiToolContext, t: string): CallToolResult {
  if (ctx.provider === 'local') return text(t)
  const r = redact(t)
  if (r.count) ctx.onMasked?.(r.count)
  return text(r.text)
}

// ─── Documents ───────────────────────────────────────────────────────────────

/** Côté le plus long conseillé pour une image envoyée à Claude. */
const IMAGE_MAX_SIDE = 1568
const RAW_IMAGE_TYPES: Record<string, string> = { '.gif': 'image/gif', '.webp': 'image/webp' }

/**
 * Le modèle (local) ne sait pas faire : on propose de confier la tâche à Claude.
 * Rien ne part sans l'accord explicite de l'utilisateur. Renvoie `true` si
 * c'est accepté, sinon l'explication à transmettre au modèle.
 */
async function askClaudeHelp(ctx: CompiToolContext, title: string, detail: string): Promise<true | string> {
  if (!ctx.cloudHelp) return 'L’utilisateur a choisi le mode 100 % local : rien ne doit quitter son PC.'
  if (!secrets.hasApiKey()) return 'Aucune clé Claude n’est enregistrée pour cette lecture visuelle.'
  sendIslandCommand('attention')
  const outcome = await approvals.request({ source: 'compi', title, detail, toolName: 'compi:cloud_help', canAlwaysAllow: false }, { signal: ctx.signal })
  if (outcome !== 'allow' && outcome !== 'always') return 'L’utilisateur a préféré ne pas envoyer ce contenu à Claude.'
  ctx.onCloudShared?.()
  return true
}

/** Image pour le modèle : telle quelle s'il voit, sinon décrite par Claude (avec accord). */
async function imageContent(ctx: CompiToolContext, data: string, mimeType: string, label: string, what: string): Promise<CallToolResult> {
  const info = { type: 'text' as const, text: label }
  if (ctx.vision) return { content: [info, { type: 'image', data, mimeType }] }
  // Le modèle ne voit pas : on lit d'abord le texte de l'image sur le PC.
  let ocr = ''
  try {
    ocr = await ocrPng(Buffer.from(data, 'base64'))
  } catch {
    // lecture de texte indisponible : on passe à la suite
  }
  if (!tooLittleText(ocr)) {
    return personal(ctx, `${label} : texte lu sur ce PC (le modèle ne voit pas l’image elle-même) :\n\n${ocr}`)
  }
  const ok = await askClaudeHelp(
    ctx,
    `Envoyer ${what} à Claude pour la décrire ?`,
    'Le modèle choisi ne voit pas les images, et elle ne contient presque pas de texte.'
  )
  if (ok !== true) {
    return text(`${label} : ce modèle ne voit pas les images. ${ok} Propose à l’utilisateur un modèle marqué « vision » (Réglages › Cerveau).`)
  }
  try {
    return text(`${label}, décrite par Claude :\n\n${await describeImage(data, mimeType)}`)
  } catch (e) {
    return fail(`${label} : description impossible (${(e as Error).message}).`)
  }
}

async function readImage(path: string, ctx: CompiToolContext): Promise<CallToolResult> {
  const ext = extname(path).toLowerCase()
  const label = `Image ${basename(path)}`
  if (RAW_IMAGE_TYPES[ext]) {
    // nativeImage ne décode ni le GIF ni le WebP : on les transmet tels quels.
    const buf = await readFile(path)
    if (buf.length > 5 * 1024 * 1024) return fail('Image trop lourde (5 Mo maximum pour ce format).')
    return imageContent(ctx, buf.toString('base64'), RAW_IMAGE_TYPES[ext], label, `l’image ${basename(path)}`)
  }
  let img = nativeImage.createFromPath(path)
  if (img.isEmpty()) return fail(`Impossible de décoder ${basename(path)} : enregistre-la en PNG ou JPEG.`)
  const { width, height } = img.getSize()
  if (Math.max(width, height) > IMAGE_MAX_SIDE) {
    img = img.resize(width >= height ? { width: IMAGE_MAX_SIDE, quality: 'best' } : { height: IMAGE_MAX_SIDE, quality: 'best' })
  }
  const png = ext === '.png'
  const data = png ? img.toPNG() : img.toJPEG(85)
  return imageContent(ctx, data.toString('base64'), png ? 'image/png' : 'image/jpeg', label, `l’image ${basename(path)}`)
}

/** Transcriptions de PDF scannés déjà payées, par fichier et date de modification. */
const transcriptions = new Map<string, string>()

async function readDocument(path: string, part: number, ctx: CompiToolContext): Promise<CallToolResult> {
  if (IMAGE_EXTENSIONS.includes(extname(path).toLowerCase())) return readImage(path, ctx)
  let doc
  try {
    doc = await extractDocument(path)
  } catch (e) {
    if (e instanceof UnsupportedDocumentError) return fail(e.message)
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return fail(`Fichier introuvable : ${path}`)
    return fail(`Lecture impossible de ${basename(path)} : ${(e as Error).message}`)
  }

  let body = doc.text
  let note = ''
  if (doc.scanned) {
    const { size, mtimeMs } = await stat(path)
    const key = `${path}|${mtimeMs}`
    const local = ctx.provider === 'anthropic' ? null : await ocrPdf(path, 30).catch(() => null)
    if (transcriptions.has(key)) {
      body = transcriptions.get(key)!
      note = ' · scan transcrit par lecture visuelle'
    } else if (local && !tooLittleText(local.pages.join('\n'), local.pages.length)) {
      // Lecture de texte de Windows : le scan ne quitte pas le PC.
      body = local.pages.map((p, i) => (local.pages.length > 1 ? `--- Page ${i + 1} ---\n${p}` : p)).join('\n\n')
      transcriptions.set(key, body)
      note = ` · scan lu sur ce PC${local.pageCount > local.pages.length ? ` (${local.pages.length} premières pages sur ${local.pageCount})` : ''}`
    } else if (size <= VISION_MAX_BYTES && (doc.pages ?? 0) <= VISION_MAX_PAGES) {
      // Avec Claude comme cerveau, la lecture visuelle va de soi ; sinon, on demande l'accord.
      const ok =
        ctx.provider === 'anthropic' ||
        (await askClaudeHelp(ctx, `Envoyer ${basename(path)} à Claude pour le lire ?`, 'Ce PDF est scanné : le modèle choisi ne sait pas lire les scans.'))
      if (ok === true) {
        try {
          body = await transcribePdf(await readFile(path))
          transcriptions.set(key, body)
          note = ' · scan transcrit par lecture visuelle'
        } catch (e) {
          note = ` · PDF scanné, transcription impossible (${(e as Error).message})`
        }
      } else {
        note = ` · PDF scanné (images sans texte) : ${ok}`
      }
    } else {
      note = ` · PDF scanné trop gros pour la lecture visuelle (max ${VISION_MAX_PAGES} pages, 30 Mo)`
    }
  }

  const { chunk, part: p, parts } = paginate(body, part)
  const more = p < parts ? `\n\n[Suite : rappelle read_document avec part=${p + 1}]` : ''
  return personal(ctx, `[${basename(path)} · ${doc.info}${note}${parts > 1 ? ` · partie ${p}/${parts}` : ''}]\n\n${chunk || '(aucun texte)'}${more}`)
}

// ─── Pages web (cerveaux autres que Claude) ──────────────────────────────────

const PAGE_MAX_BYTES = 8 * 1024 * 1024

/** Lit une page web sur ce PC (remplace WebFetch, qui dépend des serveurs d'Anthropic). */
async function fetchPage(url: string, part: number): Promise<CallToolResult> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return fail(`Adresse invalide : ${url}`)
  }
  if (!/^https?:$/.test(target.protocol)) return fail('Seules les adresses http(s) sont autorisées.')
  // Outil autorisé d'office : il ne doit pas servir à sonder le réseau local.
  if (isPrivateHost(target.hostname)) return fail('Les adresses locales ou du réseau privé ne sont pas lisibles avec cet outil.')

  let res: Response
  try {
    res = await net.fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Compi',
        accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.9,*/*;q=0.5'
      },
      signal: AbortSignal.timeout(20_000)
    })
  } catch (e) {
    return fail(`Page injoignable : ${(e as Error).message}`)
  }
  if (!res.ok) return fail(`La page a répondu HTTP ${res.status}.`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > PAGE_MAX_BYTES) return fail('Page trop lourde (8 Mo maximum).')
  const type = (res.headers.get('content-type') ?? '').toLowerCase()

  let body: string
  if (type.includes('pdf')) {
    const tmp = join(tmpdir(), `compi-${randomUUID()}.pdf`)
    try {
      await writeFile(tmp, buf)
      body = (await extractDocument(tmp)).text
    } finally {
      await rm(tmp, { force: true })
    }
  } else if (type.includes('html') || type.includes('xml') || !type) {
    body = htmlToText(buf.toString('utf8'))
  } else if (type.startsWith('text/') || type.includes('json')) {
    body = buf.toString('utf8')
  } else {
    return fail(`Contenu non lisible (${type}).`)
  }
  const { chunk, part: p, parts } = paginate(body.trim(), part)
  const more = p < parts ? `\n\n[Suite : rappelle fetch_page avec part=${p + 1}]` : ''
  return text(`[${res.url}${parts > 1 ? ` · partie ${p}/${parts}` : ''}]\n\n${chunk || '(page vide)'}${more}`)
}

// ─── Capture d'écran ─────────────────────────────────────────────────────────

async function captureScreen(): Promise<string> {
  const win = getNotchWindow()
  const display = screen.getPrimaryDisplay()
  const scale = Math.min(1, 1600 / display.size.width)
  // L'îlot se rend invisible le temps de la capture pour ne pas s'y voir.
  win?.setOpacity(0)
  await new Promise((r) => setTimeout(r, 140))
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(display.size.width * scale),
        height: Math.round(display.size.height * scale)
      }
    })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source) throw new Error('Aucun écran trouvé.')
    return source.thumbnail.toPNG().toString('base64')
  } finally {
    win?.setOpacity(1)
  }
}

// ─── Serveur MCP ─────────────────────────────────────────────────────────────

export function createCompiServer(sdk: SdkModule, ctx: CompiToolContext): ReturnType<SdkModule['createSdkMcpServer']> {
  const { tool, createSdkMcpServer } = sdk

  const tools = [
    tool(
      'get_datetime',
      "Renvoie la date, l'heure et le fuseau horaire actuels de l'utilisateur.",
      {},
      async () => {
        const now = new Date()
        return text(`${now.toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'medium' })} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`)
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'clipboard_read',
      "Lit le contenu actuel du presse-papier de l'utilisateur (texte, ou image si le presse-papier contient une image).",
      {},
      async () => {
        // API du presse-papier asynchrone (modèle W3C) depuis Electron 44.
        for (const item of await clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'))
          if (!type) continue
          const blob = (await item.getType(type)) as Blob
          const png = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).toPNG()
          if (png.length) return imageContent(ctx, png.toString('base64'), 'image/png', 'Image du presse-papier', 'l’image du presse-papier')
        }
        const t = await clipboard.readText()
        return t ? personal(ctx, t) : text('(Le presse-papier est vide.)')
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool('clipboard_write', "Copie un texte dans le presse-papier de l'utilisateur.", { text: z.string().describe('Texte à copier') }, async ({ text: t }) => {
      await clipboard.writeText(t)
      return text('Texte copié dans le presse-papier.')
    }),

    tool(
      'screen_capture',
      "Fait une capture de l'écran principal de l'utilisateur pour voir ce qu'il a sous les yeux. À n'utiliser que si l'utilisateur parle de son écran.",
      {},
      async () => {
        try {
          return await imageContent(ctx, await captureScreen(), 'image/png', 'Capture d’écran', 'la capture d’écran')
        } catch (e) {
          return fail(`Capture impossible : ${(e as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'read_screen_text',
      "Lit le texte affiché sur l'écran principal, sur ce PC (sans envoyer d'image). Plus léger que screen_capture quand seul le texte compte.",
      {},
      async () => {
        try {
          const t = await ocrPng(Buffer.from(await captureScreen(), 'base64'))
          return t.trim() ? personal(ctx, `Texte lu à l’écran :\n\n${t}`) : text('Aucun texte lisible à l’écran.')
        } catch (e) {
          return fail(`Lecture de l’écran impossible : ${(e as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'open_url',
      "Ouvre une adresse web dans le navigateur par défaut de l'utilisateur.",
      { url: z.string().url().describe('Adresse http(s) à ouvrir') },
      async ({ url }) => {
        if (!/^https?:\/\//i.test(url)) return fail('Seules les adresses http(s) sont autorisées.')
        await shell.openExternal(url)
        return text(`Ouvert : ${url}`)
      }
    ),

    tool(
      'open_path',
      "Ouvre un fichier ou un dossier avec l'application par défaut de Windows.",
      { path: z.string().describe('Chemin absolu du fichier ou dossier') },
      async ({ path }) => {
        if (isNetworkPath(path)) return fail('Les chemins réseau ne s’ouvrent pas depuis Compi.')
        const err = await shell.openPath(path)
        return err ? fail(err) : text(`Ouvert : ${path}`)
      }
    ),

    tool(
      'read_document',
      'Lit un document et renvoie son contenu : PDF (y compris scanné), Word (.docx), Excel (.xlsx), PowerPoint (.pptx), OpenDocument, CSV, HTML, texte, code, et images (PNG, JPEG, GIF, WebP). À utiliser pour tous ces formats plutôt que Read. Les longs documents sont découpés en parties.',
      {
        path: z.string().describe('Chemin absolu du fichier'),
        part: z.number().int().positive().optional().describe('Partie à lire pour un long document (1 par défaut)')
      },
      async ({ path, part }) => readDocument(path, part ?? 1, ctx),
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'search_documents',
      "Cherche dans les documents des dossiers confiés par l'utilisateur, y compris à l'intérieur des PDF, Word, Excel et PowerPoint. Quand la recherche par le sens est activée, trouve aussi les passages qui parlent du sujet avec d'autres mots : décris alors ce que tu cherches en une phrase. Renvoie les fichiers les plus pertinents avec des extraits ; lis ensuite les bons avec read_document.",
      {
        query: z.string().describe('Mots-clés, ou une phrase qui décrit le passage cherché'),
        folder: z.string().optional().describe('Limiter la recherche à ce dossier (il doit faire partie des dossiers confiés)')
      },
      async ({ query, folder }) => {
        const roots = allowedFolders()
        if (!roots.length) return text("Aucun dossier n'est confié à Compi. L'utilisateur peut en ajouter dans Connecteurs › Dossiers.")
        if (folder && !insideAny(folder, roots)) return fail(`${folder} ne fait pas partie des dossiers confiés : ${roots.join(', ')}`)
        const where = folder ? [folder] : roots
        const [meaning, { hits, scanned }] = await Promise.all([semanticSearch(query, where), searchDocuments(where, query)])
        const parts: string[] = []
        if (meaning?.length) {
          parts.push(
            `Passages proches par le sens :\n` +
              meaning
                .map(
                  (m) => `- ${m.file}${m.page ? ` (page ${m.page})` : ''} · ${Math.round(m.score * 100)} %\n  > ${m.text.replace(/\s+/g, ' ').slice(0, 400)}`
                )
                .join('\n')
          )
        }
        if (hits.length) {
          parts.push(
            `${hits.length} document(s) contenant les mots, sur ${scanned} parcouru(s) :\n` +
              hits.map((h) => `- ${h.file}${h.snippets.map((sn) => `\n  > …${sn}…`).join('')}`).join('\n')
          )
        }
        if (!parts.length) return text(`Aucun document ne correspond à « ${query} » (${scanned} fichier(s) parcouru(s)).`)
        return personal(ctx, parts.join('\n\n'))
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool('notify', 'Affiche une notification Windows.', { title: z.string(), body: z.string() }, async ({ title, body }) => {
      new Notification({ title, body }).show()
      return text('Notification affichée.')
    }),

    tool(
      'memory_save',
      "Mémorise durablement un fait utile sur l'utilisateur (préférences, informations personnelles qu'il a partagées, contexte de ses projets). À utiliser quand l'utilisateur dit « retiens que… » ou partage une info durable. L'utilisateur voit et peut effacer tout ce que tu retiens.",
      { fact: z.string().describe('Le fait à retenir, formulé de façon autonome (« Préfère qu’on le tutoie »)') },
      async ({ fact }) => {
        try {
          const { item, duplicate } = addMemory(fact, 'chat', ctx.conversationTitle)
          if (duplicate) return text('C’était déjà noté.')
          if (!ctx.headless) emit(IPC.islandNotify, { pill: 'memory', text: `Retenu : ${item.fact}`, duration: 6000, view: 'memory' })
          return text('C’est noté.')
        } catch (e) {
          return fail((e as Error).message)
        }
      }
    ),

    tool(
      'memory_search',
      "Cherche dans la mémoire personnelle de l'utilisateur. Sans requête, renvoie tous les souvenirs, avec leur identifiant.",
      { query: z.string().optional().describe('Mots-clés (facultatif)') },
      async ({ query }) => {
        const hits = searchMemory(query)
        if (!hits.length) return text('Aucun souvenir correspondant.')
        const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
        return personal(ctx, hits.map((h) => `- [${h.id}] ${h.fact} (${day.format(new Date(h.createdAt))})`).join('\n'))
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'memory_forget',
      "Efface un souvenir quand l'utilisateur te demande d'oublier quelque chose (identifiant donné par memory_search).",
      { id: z.string() },
      async ({ id }) => {
        const item = listMemory().find((m) => m.id === id)
        if (!item) return fail('Souvenir introuvable : vérifie avec memory_search.')
        deleteMemory(id)
        if (!ctx.headless) emit(IPC.islandNotify, { pill: 'memory', text: `Oublié : ${item.fact}`, duration: 5000, view: 'memory' })
        return text('C’est oublié.')
      }
    ),

    // ─── Windows : regarder ──────────────────────────────────────────────────

    tool(
      'windows_status',
      'État du PC : batterie, son, réseau, processeur, mémoire, disques, applications gourmandes, thème.',
      {},
      async () => {
        try {
          return text(formatStatus(await getStatus()))
        } catch (e) {
          return fail(`État du PC indisponible : ${(e as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'list_windows',
      "Fenêtres ouvertes, de la plus récente à la plus ancienne : la première est celle où l'utilisateur travaillait.",
      {},
      async () => {
        try {
          const windows = await listWindows()
          return windows.length ? text(windows.map((w, i) => `${i + 1}. ${formatWindow(w)}`).join('\n')) : text('Aucune fenêtre ouverte.')
        } catch (e) {
          return fail(`Liste des fenêtres indisponible : ${(e as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'search_files',
      'Cherche des fichiers sur tout le PC (nom ou contenu), avec l’index de Windows. Ouvre-les ensuite avec read_document ou open_path.',
      {
        query: z.string().describe('Mots du nom ou du contenu'),
        kind: z.enum(FILE_KINDS).optional().describe('Type de fichier'),
        modified_within_days: z.number().int().positive().optional().describe('Modifiés depuis N jours')
      },
      async ({ query, kind, modified_within_days }) => {
        try {
          const hits = await searchFiles({ query, kind, modifiedWithinDays: modified_within_days, limit: 15 })
          return hits.length
            ? text(`${hits.length} fichier(s), du plus récent au plus ancien :\n${formatHits(hits)}`)
            : text(`Aucun fichier trouvé pour « ${query} ».`)
        } catch (e) {
          return fail(`Recherche Windows indisponible (${(e as Error).message}). Le service Windows Search est peut-être arrêté.`)
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    // ─── Windows : agir (toujours avec l'accord de l'utilisateur) ────────────

    tool(
      'open_app',
      'Ouvre une application installée (menu Démarrer).',
      { name: z.string().describe('Nom de l’application, ex. « Word », « Calculatrice »') },
      async ({ name }) => {
        try {
          const [app] = matchApps(await startApps(), name)
          if (!app) return fail(`Aucune application « ${name} » dans le menu Démarrer.`)
          return text(`Ouverte : ${await launchApp(app)}`)
        } catch (e) {
          return fail(`Ouverture impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool(
      'focus_window',
      'Affiche au premier plan une fenêtre déjà ouverte (voir list_windows).',
      { window_title: z.string().describe('Tout ou partie du titre de la fenêtre') },
      async ({ window_title }) => {
        try {
          const q = window_title.toLowerCase()
          const w = (await listWindows()).find((x) => x.title.toLowerCase().includes(q) || x.process.toLowerCase() === q)
          if (!w) return fail(`Aucune fenêtre ouverte ne correspond à « ${window_title} ».`)
          return (await focusWindow(w.handle)) ? text(`Au premier plan : ${formatWindow(w)}`) : fail('Windows n’a pas permis de changer de fenêtre.')
        } catch (e) {
          return fail(`Changement de fenêtre impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool(
      'sound_control',
      'Son et musique : volume, couper/remettre le son, lecture/pause, morceau suivant ou précédent.',
      {
        action: z.enum(['volume', 'mute', 'unmute', 'play_pause', 'next', 'previous']),
        level: z.number().min(0).max(100).optional().describe('Volume en % (action « volume »)')
      },
      async ({ action, level }) => {
        try {
          if (action === 'volume') {
            if (level === undefined) return fail('Indique le volume voulu (level, de 0 à 100).')
            const r = await setVolume({ level })
            return text(`Volume : ${r.volume} %`)
          }
          if (action === 'mute' || action === 'unmute') {
            const r = await setVolume({ mute: action === 'mute' })
            return text(r.muted ? 'Son coupé.' : `Son remis (${r.volume} %).`)
          }
          return (await mediaControl(action)) ? text('C’est fait.') : fail('La commande multimédia n’a pas été envoyée.')
        } catch (e) {
          return fail(`Réglage du son impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool('set_theme', 'Passe Windows en thème sombre ou clair.', { mode: z.enum(['dark', 'light']) }, async ({ mode }) => {
      try {
        await setTheme(mode)
        return text(`Thème ${mode === 'dark' ? 'sombre' : 'clair'} appliqué.`)
      } catch (e) {
        return fail(`Changement de thème impossible : ${(e as Error).message}`)
      }
    }),

    tool(
      'open_settings',
      'Ouvre une page des Paramètres de Windows.',
      { page: z.enum(Object.keys(SETTINGS_PAGES) as [SettingsPage, ...SettingsPage[]]) },
      async ({ page }) => {
        if (!isSettingsPage(page)) return fail('Page inconnue.')
        await openSettings(page)
        return text(`Paramètres ouverts : ${SETTINGS_PAGES[page]}`)
      }
    )
  ]

  // Historique du presse-papier : seulement si l'utilisateur l'a activé.
  const clipTools = !settings.get().clipboardHistory
    ? []
    : [
        tool(
          'clipboard_history',
          "Cherche dans l'historique du presse-papier de l'utilisateur : ce qu'il a copié ces 30 derniers jours (texte, gardé chiffré sur son PC). Sans requête : les copies les plus récentes.",
          {
            query: z.string().optional().describe('Mots à chercher (facultatif)'),
            limit: z.number().int().min(1).max(30).optional().describe('Nombre de copies (10 par défaut)')
          },
          async ({ query, limit }) => {
            const hits = findClips(query, limit ?? 10)
            if (!hits.length) return text('Rien de correspondant dans l’historique du presse-papier.')
            const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            return personal(ctx, hits.map((h) => `- ${when.format(new Date(h.at))}${h.source ? ` · ${h.source}` : ''} : ${h.text.slice(0, 800)}`).join('\n'))
          },
          { annotations: { readOnlyHint: true } }
        )
      ]

  // Messages reçus : seulement si l'utilisateur a choisi « Compi peut lire mes messages ».
  const m = settings.get().messages
  const messageTools = !(m.enabled && m.readByCompi)
    ? []
    : [
        tool(
          'messages_recent',
          "Messages reçus ces dernières 24 h dans les messageries que l'utilisateur a choisies (SMS et applications de son téléphone via Mobile connecté, WhatsApp, Telegram…), tels qu'affichés dans ses notifications Windows. Lecture seule : tu ne peux ni répondre ni marquer comme lu. Les codes reçus sont masqués.",
          {
            app: z.string().optional().describe('Filtrer par application (« WhatsApp », « Mobile connecté »…)'),
            sender: z.string().optional().describe('Filtrer par expéditeur'),
            since_minutes: z.number().int().min(1).max(1440).optional().describe('Seulement les N dernières minutes'),
            limit: z.number().int().min(1).max(50).optional().describe('Nombre de messages (30 par défaut)')
          },
          async ({ app, sender, since_minutes, limit }) => {
            const list = recentMessages({ app, sender, sinceMin: since_minutes, limit })
            if (!list.length)
              return text(
                'Aucun message correspondant ces dernières 24 h (seuls les messages arrivés en notification pendant que le PC était allumé sont connus).'
              )
            const when = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
            return personal(
              ctx,
              list
                .map(
                  (x) => `- ${when.format(new Date(x.at))} · ${x.app} · ${x.sender || 'expéditeur non indiqué (il est peut-être dans le texte)'} : ${x.text}`
                )
                .join('\n')
            )
          },
          { annotations: { readOnlyHint: true } }
        )
      ]

  // Modèle local : les connecteurs ne sont chargés qu'à la demande (shared/localTools.ts).
  // La passerelle voit l'appel dans la discussion et ajoute leurs outils à la requête suivante.
  const connectors = settings.get().connectors.filter((c) => c.enabled)
  const extensionTools =
    ctx.provider !== 'local' || !connectors.length
      ? []
      : [
          tool(
            USE_EXTENSION,
            "Charge les outils d'une extension (connecteur) branchée par l'utilisateur, quand la demande en a besoin. Ses outils sont disponibles dès ton action suivante.",
            {
              name: z.string().describe('Nom de l’extension, tel qu’il figure dans la liste des extensions branchées'),
              tools: z.array(z.string()).optional().describe('Seulement si l’extension est chargée en partie : noms des outils non chargés dont tu as besoin')
            },
            async ({ name, tools: wanted }) => {
              const servers = connectors.map((c) => ({ key: serverKey(c), name: c.name, keywords: connectorKeywords(c.name, c.templateId) }))
              const s = findServer(name, servers)
              if (!s) return fail(`Aucune extension « ${name} ». Extensions branchées : ${servers.map((x) => x.name).join(', ')}.`)
              if (ctx.headless && !usableInRoutine(s.key, settings.get().alwaysAllow))
                return fail(
                  `Dans une routine, l’extension ${s.name} n’est pas utilisable : aucun de ses outils n’est autorisé sans validation (réglage « Toujours »). Dis-le en une phrase dans ta réponse.`
                )
              if (wanted?.length)
                return text(
                  `Outils demandés de l’extension ${s.name} (${wanted.join(', ')}) : ils passent en priorité dès ton action suivante, quitte à laisser de côté des outils moins utiles. S’ils n’apparaissent pas, ce nom d’outil n’existe pas dans cette extension.`
                )
              return text(
                `Extension ${s.name} chargée : ses outils sont disponibles dès ton action suivante. S’ils n’apparaissent pas, elle est déconnectée : dis à l’utilisateur de la vérifier dans Extensions › Connecteurs.`
              )
            },
            { annotations: { readOnlyHint: true } }
          )
        ]

  // Hors Claude, WebFetch n'est pas disponible : Compi lit les pages lui-même, sur ce PC.
  const webTools =
    ctx.provider === 'anthropic'
      ? []
      : [
          tool(
            'fetch_page',
            'Lit une page web (ou un PDF en ligne) et renvoie son texte. Les longues pages sont découpées en parties.',
            {
              url: z.string().describe('Adresse http(s) de la page'),
              part: z.number().int().positive().optional().describe('Partie à lire pour une longue page (1 par défaut)')
            },
            async ({ url, part }) => fetchPage(url, part ?? 1),
            { annotations: { readOnlyHint: true } }
          )
        ]

  return createSdkMcpServer({
    name: COMPI_SERVER,
    version: app.getVersion(),
    instructions:
      'Outils du bureau Windows de l’utilisateur : documents, fichiers du PC, rangement des dossiers confiés, presse-papier, écran, fenêtres, état du PC, son et musique, applications, liens, notifications, mémoire, rappels, météo, et (si son compte Google est connecté) agenda et e-mails.',
    alwaysLoad: true,
    tools: [
      ...tools,
      ...clipTools,
      ...messageTools,
      ...webTools,
      ...extensionTools,
      ...dayTools(tool, ctx, { text, fail, personal }),
      ...liveTools(tool, { text, fail }),
      ...folderTools(tool, ctx, { text, fail, personal }),
      // Aussi dans une routine (créer ou supprimer y est refusé) : la liste d'outils reste
      // celle des discussions, que le modèle local garde en cache.
      ...routineTools(tool, { text, fail })
    ]
  })
}
