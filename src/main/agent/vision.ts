// Lecture visuelle par Claude : transcription des PDF scannés (sans couche
// texte) et description d'images pour les modèles locaux qui ne voient pas.
// Utilise la clé API de l'utilisateur.

import Anthropic from '@anthropic-ai/sdk'
import { secrets } from '../store/secrets'
import { settings } from '../store/settings'
import { normalizeWorkspaceId } from './errors'

/** Limites de l'API pour un PDF envoyé en base64. */
export const VISION_MAX_BYTES = 30 * 1024 * 1024
export const VISION_MAX_PAGES = 100

const TRANSCRIBE_MODEL = 'claude-haiku-5-5'

function client(): Anthropic {
  const apiKey = secrets.getApiKey()
  if (!apiKey) throw new Error('clé API absente')
  const workspaceId = normalizeWorkspaceId(settings.get().workspaceId)
  return new Anthropic({
    apiKey,
    defaultHeaders: workspaceId ? { 'anthropic-workspace-id': workspaceId } : undefined
  })
}

const textOf = (message: Anthropic.Message): string =>
  message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
    .trim()

export async function transcribePdf(pdf: Buffer): Promise<string> {
  const message = await client().messages
    .stream({
      model: TRANSCRIBE_MODEL,
      max_tokens: 16000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } },
            {
              type: 'text',
              text:
                'Transcris fidèlement tout le texte de ce document, page par page, en commençant chaque page par « --- Page N --- ». ' +
                'Garde les titres, listes et tableaux (tableaux en Markdown). Décris brièvement entre crochets les images, schémas ou signatures. ' +
                'N’ajoute aucun commentaire.'
            }
          ]
        }
      ]
    })
    .finalMessage()
  return textOf(message)
}

type ImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** Description d'une image, pour un modèle local qui ne voit pas. */
export async function describeImage(base64: string, mimeType: string): Promise<string> {
  const message = await client().messages.create({
    model: TRANSCRIBE_MODEL,
    max_tokens: 3000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType as ImageType, data: base64 } },
          {
            type: 'text',
            text:
              'Décris précisément cette image en français : ce qu’elle montre, la mise en page, et recopie fidèlement tous les textes et chiffres lisibles ' +
              '(tableaux en Markdown). N’ajoute aucun commentaire.'
          }
        ]
      }
    ]
  })
  return textOf(message)
}
