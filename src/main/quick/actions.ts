// Actions rapides : Alt+Maj+C copie la sélection de l'application ouverte,
// l'îlot propose Corriger, Reformuler, Traduire… puis Remplacer ou Copier.
// Appel direct au cerveau, sans outils : rapide, et rien d'autre que le texte
// sélectionné n'est transmis.

import { randomUUID } from 'node:crypto'
import type Anthropic from '@anthropic-ai/sdk'
import { clipboard, screen } from 'electron'
import { brainLabel, brainMissing, defaultBrain } from '../../shared/brains'
import { IPC } from '../../shared/ipc'
import { isOnline } from '../../shared/privacy'
import type { Brain, QuickActionId, QuickEvent, QuickSelection } from '../../shared/types'
import { visionSize, zoneToImage } from '../../shared/zone'
import { destinationOf } from '../agent/assistant'
import { describeAgentError } from '../agent/errors'
import { prepareLocalBrain } from '../brains/local'
import { clientFor } from '../brains/probe'
import { emit } from '../bus'
import { log } from '../log'
import { sendIslandCommand } from '../notchWindow'
import { logSent } from '../privacy/log'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'
import { grabDisplay, hideIsland } from '../windows/capture'
import { ocrPng } from '../windows/ocr'
import { captureSelection, replaceSelection } from '../windows/selection'
import type { WindowInfo } from '../windows/system'
import { canReplaceWith, cleanQuickResult, isQuickAction, quickPrompt } from './prompts'
import { pickZone } from './zonePicker'

interface QuickSession {
  id: string
  text: string
  window: WindowInfo | null
  action?: QuickActionId
  result: string
  abort?: AbortController
  /** Zone d'écran : image de la zone (PNG, en mémoire seulement) et ce qu'on peut en faire. */
  zone?: { png: Buffer; vision: boolean; blocked: boolean }
}

let session: QuickSession | null = null
let capturing = false

/** Cerveau prêt (clé, service) ; sinon le dit dans l'îlot et ouvre les réglages. */
function brainReady(): Brain | null {
  const s = settings.get()
  const brain = defaultBrain(s)
  const missing = brainMissing(brain, { hasApiKey: secrets.hasApiKey(), hasCustomKey: secrets.hasCustomKey(), custom: s.custom })
  if (!missing) return brain
  notify(missing, true)
  sendIslandCommand('open-settings')
  return null
}

/** Le cerveau voit les images : Claude, ou un modèle local qui en est capable (gemma4…). */
async function seesImages(brain: Brain): Promise<boolean> {
  if (brain.provider === 'anthropic') return true
  if (brain.provider !== 'local') return false
  try {
    return (await prepareLocalBrain(brain.model)).vision
  } catch {
    return false
  }
}

const notify = (text: string, error = false): void => emit(IPC.islandNotify, { pill: error ? 'error' : 'chat', text })
const send = (e: QuickEvent): void => emit(IPC.quickEvent, e)

function sourceLabel(w: WindowInfo): string {
  const title = w.title.length > 60 ? `${w.title.slice(0, 57)}…` : w.title
  return title || w.process
}

/** Raccourci pressé : copie la sélection et ouvre les actions rapides. */
export async function onQuickShortcut(): Promise<void> {
  if (capturing) return
  capturing = true
  try {
    const captured = await captureSelection()
    if (!captured.ok) {
      if (captured.reason === 'self') sendIslandCommand('open-chat')
      else if (captured.reason === 'keys') notify('Relâche les touches du raccourci, puis réessaie.')
      else if (captured.reason === 'error') notify(`Copie impossible : ${captured.message ?? 'Windows ne répond pas.'}`, true)
      else notify('Sélectionne d’abord un texte, puis appuie à nouveau sur le raccourci.')
      return
    }
    const s = settings.get()
    const brain = brainReady()
    if (!brain) return
    session?.abort?.abort()
    session = { id: randomUUID(), text: captured.text, window: captured.window, result: '' }
    const selection: QuickSelection = {
      id: session.id,
      text: captured.text,
      source: captured.window ? sourceLabel(captured.window) : undefined,
      canReplace: Boolean(captured.window),
      brainLabel: brainLabel(brain, s),
      online: isOnline(brain.provider)
    }
    emit(IPC.quickOpen, selection)
  } catch (e) {
    log('error', 'actions rapides', e)
    notify('Les actions rapides ont rencontré un problème.', true)
  } finally {
    capturing = false
  }
}

/**
 * Zone d'écran : fige l'écran sous la souris, laisse encadrer une zone, en lit le texte
 * sur le PC (OCR de Windows), puis ouvre les actions rapides. Rien ne part avant un clic.
 */
export async function onZoneShortcut(): Promise<void> {
  if (capturing) return
  capturing = true
  try {
    const brain = brainReady()
    if (!brain) return
    const s = settings.get()
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    // L'îlot reste caché jusqu'à la fin de la sélection : ni sur la capture, ni par-dessus.
    const show = await hideIsland()
    let pick: Awaited<ReturnType<typeof pickZone>> = null
    let shot: Electron.NativeImage
    try {
      shot = await grabDisplay(display)
      pick = await pickZone(display, shot)
    } finally {
      show()
    }
    if (!pick) return
    const rect = zoneToImage(pick.rect, pick.view, shot.getSize())
    if (!rect) return
    const crop = shot.crop(rect)
    const online = isOnline(brain.provider)
    const blocked = online && s.privacy.screen === 'never'
    const [text, vision] = await Promise.all([ocrPng(crop.toPNG()).then((t) => t.trim()), blocked ? false : seesImages(brain)])
    if (!text && !vision) {
      notify(blocked ? 'Aucun texte lisible dans cette zone.' : 'Aucun texte lisible dans cette zone, et ton cerveau ne voit pas les images.')
      return
    }
    const size = visionSize(crop.getSize())
    const png = (size.width === rect.width ? crop : crop.resize({ ...size, quality: 'best' })).toPNG()
    session?.abort?.abort()
    session = { id: randomUUID(), text, window: null, result: '', zone: { png, vision, blocked } }
    const selection: QuickSelection = {
      id: session.id,
      text,
      source: 'Zone d’écran',
      canReplace: false,
      brainLabel: brainLabel(brain, s),
      online,
      zone: { vision, blocked }
    }
    emit(IPC.quickOpen, selection)
  } catch (e) {
    log('error', 'zone d’écran', e)
    notify(`Zone d’écran impossible : ${(e as Error).message}`, true)
  } finally {
    capturing = false
  }
}

/** Copie le texte lu dans la zone (sans cerveau). */
export async function copyQuickText(id: string): Promise<boolean> {
  const q = session
  if (!q || q.id !== id || !q.text.trim()) return false
  await clipboard.writeText(q.text)
  return true
}

/** Lance une action sur la sélection ; le résultat arrive au fil de l'eau. */
export async function runQuick(id: string, action: string): Promise<void> {
  const q = session
  if (!q || q.id !== id || !isQuickAction(action)) return
  q.abort?.abort()
  const abort = new AbortController()
  q.abort = abort
  q.action = action
  q.result = ''
  const brain = defaultBrain(settings.get())
  const zone = q.zone
  // Seulement « Expliquer » montre l'image (graphique, schéma) ; les autres actions travaillent sur le texte.
  const image = Boolean(zone?.vision && action === 'explain')
  const refused = zone?.blocked
    ? `L’écran est sur « Jamais » (Réglages › Confidentialité) : rien de cette zone ne part vers ${destinationOf(brain)}. Copie le texte, ou choisis un cerveau sur ce PC.`
    : zone && !image && !q.text
      ? 'Aucun texte lu dans cette zone : seul « Expliquer » peut regarder l’image.'
      : null
  if (refused) {
    send({ type: 'error', id, error: refused })
    return
  }
  try {
    // Toujours en style Vif : une action rapide doit l'être.
    const { client, model, style } = await clientFor(brain, { effort: 'low' })
    const { system, user } = quickPrompt(action, q.text, { zone: Boolean(zone), image })
    const content: Anthropic.MessageParam['content'] =
      image && zone
        ? [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: zone.png.toString('base64') } },
            { type: 'text', text: user }
          ]
        : user
    const destination = zone ? destinationOf(brain) : null
    if (destination) emit(IPC.sentLogChanged, logSent({ destination, categories: ['screen'], masked: 0 }, 'Zone d’écran'))
    const stream = client.messages.stream({ model, ...style(4096), system, messages: [{ role: 'user', content }] } as Anthropic.MessageStreamParams, {
      signal: abort.signal
    })
    stream.on('text', (delta) => {
      if (abort.signal.aborted) return
      q.result += delta
      send({ type: 'delta', id, delta })
    })
    await stream.finalMessage()
    if (!abort.signal.aborted) send({ type: 'done', id, text: cleanQuickResult(q.result) })
  } catch (e) {
    if (abort.signal.aborted) return
    const raw = (e as Error).message ?? String(e)
    log('error', `action rapide ${action} (${brain.provider} ${brain.model}) : ${raw}`)
    send({ type: 'error', id, error: describeAgentError(raw, brain) })
  }
}

export function stopQuick(): void {
  session?.abort?.abort()
}

/** Remet le résultat à la place de la sélection, dans la fenêtre d'origine. */
export async function replaceQuick(id: string): Promise<{ ok: boolean; message?: string }> {
  const q = session
  if (!q || q.id !== id || !q.window || !q.action || !canReplaceWith(q.action) || !q.result.trim()) {
    return { ok: false, message: 'Rien à remettre à la place de la sélection.' }
  }
  const text = cleanQuickResult(q.result)
  // L'îlot se referme d'abord, pour rendre la main à la fenêtre d'origine.
  sendIslandCommand('collapse')
  await new Promise((r) => setTimeout(r, 120))
  const r = await replaceSelection(q.window, text)
  if (r.ok) {
    session = null
    return { ok: true }
  }
  const message =
    r.reason === 'focus'
      ? `Je n’ai pas pu revenir à « ${sourceLabel(q.window)} » (fenêtre fermée ou bloquée). Utilise Copier, puis colle avec Ctrl+V.`
      : r.reason === 'keys'
        ? 'Des touches étaient encore enfoncées : rien n’a été collé. Réessaie.'
        : `Rien n’a été collé : ${r.message ?? 'Windows ne répond pas.'}`
  sendIslandCommand('open-quick')
  return { ok: false, message }
}

/** Copie le résultat (le presse-papier garde ce texte : c'est ce qu'on a demandé). */
export async function copyQuick(id: string): Promise<boolean> {
  const q = session
  if (!q || q.id !== id || !q.result.trim()) return false
  await clipboard.writeText(cleanQuickResult(q.result))
  return true
}
