// Résumé d'une réunion par le cerveau choisi, sans outils : titre, résumé,
// points clés, tâches. Un cerveau sur le PC peut le faire tout seul à la fin de
// l'appel ; un cerveau en ligne seulement si l'utilisateur l'a demandé (clic
// sur « Résumer ») ou l'a permis (catégorie « Réunions » sur « Toujours »).
// Secrets masqués avant l'envoi, envoi noté dans le journal de confidentialité.

import type Anthropic from '@anthropic-ai/sdk'
import { brainLabel, defaultBrain } from '../../shared/brains'
import { IPC } from '../../shared/ipc'
import { parseSummary, SUMMARY_SYSTEM, summaryInput } from '../../shared/meetings'
import { isOnline } from '../../shared/privacy'
import type { Meeting } from '../../shared/types'
import { destinationOf } from '../agent/assistant'
import { clientFor } from '../brains/probe'
import { emit } from '../bus'
import { log } from '../log'
import { logSent } from '../privacy/log'
import { redact } from '../privacy/redact'
import { settings } from '../store/settings'
import { getMeeting, saveMeeting } from './store'

/** Résumé possible sans demander (fin d'appel) : cerveau local, ou réunions permises « toujours ». */
export function canAutoSummarize(): boolean {
  const s = settings.get()
  if (!s.meetings.autoSummary) return false
  return !isOnline(defaultBrain(s).provider) || s.privacy.meetings === 'always'
}

/**
 * Résume la réunion. `confirmed` : l'utilisateur a cliqué sur « Résumer » en
 * sachant où part le texte (cerveau en ligne, catégorie sur « Demander »).
 */
export async function summarizeMeeting(id: string, confirmed: boolean): Promise<Meeting> {
  const m = getMeeting(id)
  if (!m) throw new Error('Réunion introuvable.')
  if (!m.lines.length) throw new Error('Rien à résumer : la transcription est vide.')
  const s = settings.get()
  const brain = defaultBrain(s)
  const destination = destinationOf(brain)
  let input = summaryInput(m)
  let masked = 0
  if (destination) {
    if (s.privacy.meetings === 'never') {
      throw new Error(
        `Tes réglages interdisent d’envoyer tes réunions à ${destination} (Réglages › Confidentialité). Choisis un cerveau sur ce PC pour les résumer.`
      )
    }
    if (s.privacy.meetings === 'ask' && !confirmed)
      throw new Error(`Le résumé enverrait la transcription à ${destination} : clique sur « Résumer » pour l’accepter.`)
    const r = redact(input)
    input = r.text
    masked = r.count
  }
  const { client, model, style } = await clientFor(brain, { effort: 'low' })
  const msg = await client.messages.create({
    model,
    ...style(2048),
    system: SUMMARY_SYSTEM,
    messages: [{ role: 'user', content: `<transcription>\n${input}\n</transcription>` }]
  } as Anthropic.MessageCreateParamsNonStreaming)
  if (destination) emit(IPC.sentLogChanged, logSent({ destination, categories: ['meetings'], masked }, m.title))
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
  const summary = parseSummary(text, brainLabel(brain, s))
  if (!summary) {
    log('warn', 'réunions : résumé illisible (réponse du modèle hors format)')
    throw new Error('Le résumé n’a pas pu être lu. Réessaie, ou choisis un autre cerveau.')
  }
  // Le titre par défaut (« Appel du … ») cède la place à celui du résumé ; un titre choisi reste.
  const fresh = getMeeting(id)
  if (!fresh) throw new Error('Réunion supprimée entre-temps.')
  const title = fresh.title.startsWith('Appel du ') && summary.title ? summary.title : fresh.title
  const next: Meeting = { ...fresh, title, summary, hasSummary: true }
  saveMeeting(next)
  log('info', `réunions : résumé fait par ${destination ?? 'le cerveau local'}`)
  return next
}
