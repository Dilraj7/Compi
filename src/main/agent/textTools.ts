// Écriture des fichiers texte (.md, .txt) des dossiers confiés : une carte à chaque fois,
// qui montre les changements, et l'ancienne version gardée pour annuler (bouton « Annuler »
// sous l'action dans la discussion, ou undo_text_edit). Le travail est fait par textEdits.

import { basename, join } from 'node:path'
import { app, shell } from 'electron'
import { z } from 'zod'
import { log } from '../log'
import type { CompiToolContext } from './tools'
import type { ToolHelpers } from './dayTools'
import { allowedFolders } from './folders'
import { applyTextEdit, planTextEdit, undoTextEdit } from './textEdits'

type ToolFn = (typeof import('@anthropic-ai/claude-agent-sdk'))['tool']

/** Journal des modifications et anciennes versions (30 dernières), dans les données de Compi. */
export const editsDir = (): string => join(app.getPath('userData'), 'edits')

/** Annule une modification de fichier (bouton de la discussion) : phrase à afficher. */
export async function undoEdit(id: string): Promise<{ ok: boolean; message: string }> {
  const r = await undoTextEdit(editsDir(), { id }, (p) => shell.trashItem(p))
  if ('error' in r) return { ok: false, message: r.error }
  log('info', 'modification de fichier annulée')
  return { ok: true, message: `${basename(r.path)} est revenu à sa version d’avant.` }
}

/** Numéro de la modification dans la réponse de write_text_file (« modification e12 »). */
export const editIdIn = (text: string): string | undefined => /\bmodification (e\d+)\b/.exec(text)?.[1]

export function textTools(tool: ToolFn, ctx: CompiToolContext, h: ToolHelpers) {
  return [
    tool(
      'write_text_file',
      "Écrit dans un fichier texte (.md, .markdown, .txt) d'un dossier confié : remplace tout son contenu (mode replace, par défaut) ou ajoute à la fin (mode append). Crée le fichier s'il n'existe pas. L'utilisateur valide une carte qui montre les changements, et l'ancienne version est gardée pour annuler. Pour remplir ou modifier un fichier, donne en mode replace le contenu final complet, en reprenant tel quel ce qui doit rester (en-tête, titres). Pas pour Word, Excel ni PDF.",
      {
        path: z.string().describe('Chemin absolu du fichier'),
        content: z.string().describe('Texte à écrire : le contenu complet du fichier en mode replace, ou ce qui s’ajoute à la fin en mode append'),
        mode: z.enum(['replace', 'append']).optional().describe('replace (par défaut) : remplace tout le contenu ; append : ajoute à la fin')
      },
      async ({ path, content, mode }) => {
        const plan = await planTextEdit(path, content, mode ?? 'replace', allowedFolders())
        if ('error' in plan) return h.fail(plan.error)
        if (plan.existed && plan.before === plan.after) return h.text(`${basename(plan.path)} contient déjà exactement ce texte : rien n'a changé.`)
        try {
          const edit = await applyTextEdit(plan, editsDir())
          log('info', `fichier texte écrit (${plan.existed ? (plan.mode === 'append' ? 'ajout' : 'remplacé') : 'créé'})`)
          const lines = plan.after.split(/\r?\n/).length
          return h.text(
            `${plan.existed ? (plan.mode === 'append' ? 'Texte ajouté à la fin de' : 'Contenu écrit dans') : 'Fichier créé :'} ${plan.path} (${lines} ligne(s), modification ${edit.id}). L'utilisateur peut l'annuler.`
          )
        } catch (e) {
          return h.fail(`Écriture impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool(
      'undo_text_edit',
      "Annule la dernière modification faite avec write_text_file (ou celle du fichier indiqué) : l'ancienne version revient (un fichier créé part à la corbeille), seulement si le fichier n'a pas changé depuis. L'utilisateur valide une carte.",
      { path: z.string().optional().describe('Chemin absolu du fichier (la dernière modification par défaut)') },
      async ({ path }) => {
        const r = await undoTextEdit(editsDir(), { path }, (p) => shell.trashItem(p))
        if ('error' in r) return h.fail(r.error)
        log('info', 'modification de fichier annulée')
        return h.personal(ctx, `${r.path} est revenu à sa version d'avant.`)
      }
    )
  ]
}
