// Outils « routines » : créer (avec l'accord de l'utilisateur, carte à chaque
// fois), lister, supprimer. La routine tourne ensuite sans lui.

import { z } from 'zod'
import { repeatLabel } from '../../shared/day'
import { DAY_NAMES, REPEAT_KINDS, routineRepeat } from '../../shared/routines'
import { deleteRoutine, formatRoutines, listRoutines, saveRoutine } from '../routines/store'
import type { ToolHelpers } from './dayTools'

type ToolFn = typeof import('@anthropic-ai/claude-agent-sdk')['tool']

const compi = (t: string): string => `mcp__compi__${t}`

/** Créer une routine : une carte à chaque fois (elle agira plus tard, sans l'utilisateur). */
export const ROUTINE_ACTIONS = [compi('routine_create')]

export function routineTools(tool: ToolFn, h: Pick<ToolHelpers, 'text' | 'fail'>) {
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return [
    tool(
      'routine_create',
      "Crée une routine : une demande que tu exécuteras seul, à heure fixe et de façon répétée (« chaque lundi à 9 h, résume mes e-mails »). Pendant une routine, personne ne peut valider d'action : seules les lectures autorisées marchent. Une carte demande l'accord de l'utilisateur. Pour une simple notification, utilise plutôt reminder_create.",
      {
        title: z.string().describe('Nom court, ex. « Résumé des e-mails »'),
        prompt: z.string().describe('Ce que tu devras faire, formulé comme une demande autonome'),
        repeat: z.enum(REPEAT_KINDS),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).describe('Heure locale HH:MM'),
        days: z.array(z.enum(DAY_NAMES)).optional().describe('Jours pour chaque_semaine, ex. ["lundi"]'),
        day_of_month: z.number().int().min(1).max(31).optional().describe('Jour pour chaque_mois')
      },
      async ({ title, prompt, repeat, time, days, day_of_month }) => {
        try {
          const r = saveRoutine({ title, prompt, repeat: routineRepeat(repeat, time, days, day_of_month) })
          return h.text(`Routine créée : « ${r.title} », ${repeatLabel(r.repeat)}. Prochaine exécution : ${fmt.format(new Date(r.nextAt))}. L'utilisateur la retrouve dans Aujourd'hui.`)
        } catch (e) {
          return h.fail((e as Error).message)
        }
      }
    ),

    tool('routine_list', 'Liste les routines programmées (avec leur identifiant).', {}, async () => h.text(formatRoutines(listRoutines(), repeatLabel)), {
      annotations: { readOnlyHint: true }
    }),

    tool('routine_delete', 'Supprime une routine (identifiant donné par routine_list).', { id: z.string() }, async ({ id }) =>
      deleteRoutine(id) ? h.text('Routine supprimée.') : h.fail('Routine introuvable : vérifie avec routine_list.')
    )
  ]
}
