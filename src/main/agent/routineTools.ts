// Outils « routines » : créer (avec l'accord de l'utilisateur, carte à chaque
// fois), lister, supprimer. La routine tourne ensuite sans lui.

import { z } from 'zod'
import { repeatLabel } from '../../shared/day'
import { appLabelOf } from '../../shared/messages'
import { DAY_NAMES, REPEAT_KINDS, ROUTINE_GRANTS, routineRepeat, toolTrigger, triggerLabel, WHEN_KINDS } from '../../shared/routines'
import { settings } from '../store/settings'
import { deleteRoutine, formatRoutines, listRoutines, saveRoutine } from '../routines/store'
import type { RoutineGrant } from '../../shared/types'
import type { ToolHelpers } from './dayTools'

type ToolFn = (typeof import('@anthropic-ai/claude-agent-sdk'))['tool']

const compi = (t: string): string => `mcp__compi__${t}`

/** Créer une routine : une carte à chaque fois (elle agira plus tard, sans l'utilisateur). */
export const ROUTINE_ACTIONS = [compi('routine_create')]

/** Applications suivies par Messages, avec leur nom. */
const followedApps = (): { key: string; label: string }[] => settings.get().messages.apps.map((key) => ({ key, label: appLabelOf(key) }))

/** Ce qu'il faut pour que l'événement arrive, s'il manque. */
function triggerNote(on: 'morning' | 'meeting-end' | 'message'): string {
  const s = settings.get()
  if (on === 'message' && !s.messages.enabled) return ' Attention : Messages est désactivé (Réglages › Journée › Messages), la routine ne se lancera pas avant.'
  if (on === 'meeting-end' && !s.google.calendar && !s.agenda.sources.some((x) => x.enabled))
    return ' Attention : aucun agenda n’est branché, la routine ne se lancera pas avant.'
  return ''
}

export function routineTools(tool: ToolFn, h: Pick<ToolHelpers, 'text' | 'fail'>) {
  const fmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
  return [
    tool(
      'routine_create',
      "Crée une routine : une demande que tu exécuteras seul, de façon répétée : à heure fixe (« chaque lundi à 9 h, résume mes e-mails ») ou sur un événement avec when (premier_allumage : au premier allumage du jour ; fin_rendez_vous : à la fin de chaque rendez-vous de l'agenda ; message : à chaque nouveau message en attente, filtré par message_from et message_app). Pendant une routine, personne ne peut valider d'action : seules les lectures autorisées marchent, plus ce que l'utilisateur lui permet avec allow (web : chercher sur le web et lire des pages ; notes : créer de nouvelles notes dans ses dossiers confiés). Ne mets allow que si la demande en a besoin. Une carte demande l'accord de l'utilisateur. Pour une simple notification, utilise plutôt reminder_create.",
      {
        title: z.string().describe('Nom court, ex. « Résumé des e-mails »'),
        prompt: z.string().describe('Ce que tu devras faire, formulé comme une demande autonome'),
        when: z.enum(WHEN_KINDS).optional().describe('heure par défaut (avec repeat et time)'),
        repeat: z.enum(REPEAT_KINDS).optional().describe('Pour when = heure'),
        time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .optional()
          .describe('Heure locale HH:MM, pour when = heure'),
        message_from: z.string().optional().describe('Pour when = message : expéditeur, tel que Windows l’affiche'),
        message_app: z.string().optional().describe('Pour when = message : application, ex. WhatsApp'),
        days: z.array(z.enum(DAY_NAMES)).optional().describe('Jours pour chaque_semaine, ex. ["lundi"]'),
        day_of_month: z.number().int().min(1).max(31).optional().describe('Jour pour chaque_mois'),
        allow: z
          .array(z.enum(ROUTINE_GRANTS as [RoutineGrant, ...RoutineGrant[]]))
          .optional()
          .describe('Droits en plus, seulement si la demande en a besoin : web, notes')
      },
      async ({ title, prompt, when, repeat, time, days, day_of_month, message_from, message_app, allow }) => {
        try {
          const trigger = toolTrigger(when, message_from, message_app, followedApps())
          if (!trigger && (!repeat || !time)) return h.fail('Donne repeat et time pour une routine à heure fixe, ou when pour un événement.')
          const r = saveRoutine({
            title,
            prompt,
            ...(trigger ? { trigger } : { repeat: routineRepeat(repeat!, time!, days, day_of_month) }),
            allow: allow ?? []
          })
          return h.text(
            r.trigger
              ? `Routine créée : « ${r.title} », ${triggerLabel(r.trigger, (k) => appLabelOf(k))}.${triggerNote(r.trigger.on)} L'utilisateur la retrouve dans Aujourd'hui.`
              : `Routine créée : « ${r.title} », ${repeatLabel(r.repeat!)}. Prochaine exécution : ${fmt.format(new Date(r.nextAt))}. L'utilisateur la retrouve dans Aujourd'hui.`
          )
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
