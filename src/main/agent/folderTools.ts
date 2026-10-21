// Outils de rangement des dossiers confiés : inventaire réel, création de dossiers,
// déplacements (une carte à chaque fois, sans « Toujours »), annulation, ouverture
// dans l'Explorateur. Jamais de suppression. Le travail est fait par folderOps.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { app, shell } from 'electron'
import { z } from 'zod'
import { formatInventory, isLauncher } from '../../shared/folderPlan'
import { log } from '../log'
import type { CompiToolContext } from './tools'
import type { ToolHelpers } from './dayTools'
import { allowedFolders, insideAny } from './folders'
import { createFolders, insideScope, inventory, moveItems, undoMoves, type FolderScope } from './folderOps'

type ToolFn = (typeof import('@anthropic-ai/claude-agent-sdk'))['tool']

/** Bureau de l'utilisateur (suit la redirection vers OneDrive). */
export const desktopDir = (): string => app.getPath('desktop')

const journalDir = (): string => join(app.getPath('userData'), 'moves')

function readShortcut(path: string): string | undefined {
  if (process.platform !== 'win32') return undefined
  try {
    return shell.readShortcutLink(path).target || undefined
  } catch {
    return undefined
  }
}

export function folderScope(): FolderScope {
  return { roots: allowedFolders(), publicDesktop: process.env.PUBLIC ? join(process.env.PUBLIC, 'Desktop') : undefined, readShortcut }
}

/**
 * Ouvrir ce chemin lance un programme : exécutable ou script, raccourci qui y mène
 * (ou illisible), lien autre que web (steam://, file:…).
 */
export function launchesProgram(path: string): boolean {
  if (isLauncher(path)) return true
  const ext = extname(path).toLowerCase()
  if (ext === '.lnk') {
    const target = readShortcut(path)
    return target ? isLauncher(target) : true
  }
  if (ext === '.url') {
    try {
      const url = /^URL=(.+)$/im.exec(readFileSync(path, 'utf8'))?.[1]?.trim() ?? ''
      return !/^https?:\/\//i.test(url)
    } catch {
      return true
    }
  }
  return false
}

/** Chemin réseau (\\serveur\partage) : refusé, Windows s'y connecterait avec l'identité de l'utilisateur. */
export const isNetworkPath = (p: string): boolean => /^\\\\|^\/\//.test(p.trim())

export function folderTools(tool: ToolFn, ctx: CompiToolContext, h: ToolHelpers) {
  const noRoots = (): ReturnType<ToolHelpers['fail']> =>
    h.fail("L'utilisateur ne t'a confié aucun dossier. Il peut en ajouter dans Extensions › Dossiers (le Bureau, par exemple).")

  return [
    tool(
      'folder_inventory',
      "Liste ce que contient vraiment un dossier confié (le Bureau par défaut) : dossiers, fichiers, raccourcis, avec type, taille, date, cible des raccourcis et remarques (nom peu clair, doublon, raccourci cassé, fichier d'application). Propose aussi un plan de rangement. À utiliser avant tout rangement, plutôt qu'une capture d'écran. Ne lit pas le contenu des fichiers.",
      { path: z.string().optional().describe('Chemin absolu du dossier (Bureau par défaut)') },
      async ({ path }) => {
        const scope = folderScope()
        if (!scope.roots.length) return noRoots()
        const desktop = desktopDir()
        const dir = path?.trim() || (insideAny(desktop, scope.roots) ? desktop : scope.roots[0])
        try {
          const real = await insideScope(dir, scope)
          const isDesktop = Boolean(real && real.toLowerCase() === (await insideScope(desktop, scope))?.toLowerCase())
          const items = await inventory(dir, scope, { withPublic: isDesktop })
          return h.personal(ctx, formatInventory(real ?? dir, items))
        } catch (e) {
          return h.fail(`Inventaire impossible : ${(e as Error).message}`)
        }
      },
      { annotations: { readOnlyHint: true } }
    ),

    tool(
      'create_folders',
      "Crée des dossiers dans un dossier confié (l'utilisateur valide une carte). Un dossier qui existe déjà est signalé, rien n'est remplacé. Pour ranger, move_items crée lui-même les dossiers de destination manquants.",
      {
        parent: z.string().describe('Chemin absolu du dossier où les créer'),
        names: z.array(z.string()).min(1).max(20).describe('Noms des dossiers à créer')
      },
      async ({ parent, names }) => {
        const scope = folderScope()
        if (!scope.roots.length) return noRoots()
        try {
          const r = await createFolders(parent, names, scope)
          const parts = [
            r.created.length ? `Créés : ${r.created.join(', ')}.` : 'Aucun dossier créé.',
            r.existing.length ? `Existaient déjà : ${r.existing.join(', ')}.` : '',
            r.refused.length ? `Refusés : ${r.refused.map((x) => `${x.name} (${x.why})`).join(', ')}.` : ''
          ]
          return h.personal(ctx, parts.filter(Boolean).join('\n'))
        } catch (e) {
          return h.fail(`Création impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool(
      'move_items',
      "Déplace des fichiers ou dossiers vers un dossier, à l'intérieur des dossiers confiés (l'utilisateur valide une seule carte avec toute la liste). Crée les dossiers de destination manquants, ne supprime et n'écrase jamais rien (un nom déjà pris devient « nom (2) »), garde un journal pour annuler. 200 déplacements au plus. Appelle-le seulement après l'accord de l'utilisateur sur le plan, puis vérifie avec folder_inventory.",
      {
        moves: z
          .array(
            z.object({
              from: z.string().describe("Chemin absolu de l'élément à déplacer"),
              to: z.string().describe('Dossier de destination : chemin absolu, ou nom relatif au dossier de l’élément (« Documents »)')
            })
          )
          .min(1)
          .max(200)
      },
      async ({ moves }) => {
        const scope = folderScope()
        if (!scope.roots.length) return noRoots()
        try {
          const r = await moveItems(moves, scope, journalDir())
          log('info', `rangement : ${r.moved.length} élément(s) déplacé(s), ${r.refused.length} refusé(s)`)
          const parts = [
            r.moved.length ? `Déplacés (${r.moved.length}) :\n${r.moved.map((m) => `- ${m.from} → ${m.to}`).join('\n')}` : 'Rien n’a été déplacé.',
            r.refused.length ? `Non déplacés (${r.refused.length}) :\n${r.refused.map((m) => `- ${m.from} : ${m.why}`).join('\n')}` : '',
            r.id ? `Pour annuler : undo_moves (rangement ${r.id}).` : ''
          ]
          return h.personal(ctx, parts.filter(Boolean).join('\n\n'))
        } catch (e) {
          return h.fail(`Déplacement impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool(
      'undo_moves',
      "Annule le dernier rangement fait avec move_items (ou celui indiqué) : remet chaque élément à sa place, sans rien écraser (l'utilisateur valide une carte).",
      { id: z.string().optional().describe('Numéro du rangement (le dernier par défaut)') },
      async ({ id }) => {
        const scope = folderScope()
        try {
          const r = await undoMoves(id, scope, journalDir())
          log('info', `rangement annulé : ${r.restored.length} élément(s) remis en place, ${r.skipped.length} ignoré(s)`)
          const parts = [
            r.restored.length ? `Remis en place (${r.restored.length}) :\n${r.restored.map((m) => `- ${m.to}`).join('\n')}` : 'Rien n’a été remis en place.',
            r.skipped.length ? `Ignorés : ${r.skipped.map((m) => `${m.path || 'rangement'} (${m.why})`).join(', ')}` : ''
          ]
          return h.personal(ctx, parts.filter(Boolean).join('\n\n'))
        } catch (e) {
          return h.fail(`Annulation impossible : ${(e as Error).message}`)
        }
      }
    ),

    tool(
      'open_folder',
      "Ouvre un dossier dans l'Explorateur de Windows, pour que l'utilisateur le voie (dossiers locaux seulement).",
      { path: z.string().describe('Chemin absolu du dossier') },
      async ({ path }) => {
        if (isNetworkPath(path)) return h.fail('Les dossiers réseau ne s’ouvrent pas depuis Compi.')
        if (!existsSync(path) || !statSync(path).isDirectory()) return h.fail(`Ce dossier n'existe pas : ${path}`)
        const err = await shell.openPath(path)
        return err ? h.fail(err) : h.text(`Dossier ouvert dans l'Explorateur : ${path}`)
      }
    )
  ]
}
