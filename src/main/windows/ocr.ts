// Lecture de texte dans les images et les PDF scannés, avec le moteur intégré à
// Windows (Windows.Media.Ocr) : rien ne quitte le PC.

import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { callHost } from './host'

export interface OcrPdf {
  pages: string[]
  pageCount: number
}

export async function ocrImage(path: string): Promise<string> {
  return (await callHost<{ text: string }>('ocr_image', { path }, 30_000)).text
}

/** Image en mémoire (capture d'écran…) : passe par un fichier temporaire, aussitôt effacé. */
export async function ocrPng(png: Buffer): Promise<string> {
  const tmp = join(tmpdir(), `compi-ocr-${randomUUID()}.png`)
  try {
    await writeFile(tmp, png)
    return await ocrImage(tmp)
  } finally {
    await rm(tmp, { force: true })
  }
}

export async function ocrPdf(path: string, maxPages = 20): Promise<OcrPdf> {
  return callHost<OcrPdf>('ocr_pdf', { path, maxPages }, Math.min(180_000, 20_000 + maxPages * 6000))
}

/** Le texte lu est trop maigre pour être utile (photo, schéma…). */
export function tooLittleText(text: string, pages = 1): boolean {
  return text.replace(/\s+/g, '').length < 25 * Math.max(1, pages)
}
