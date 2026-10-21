// Actions rapides sur le texte sélectionné : liste partagée entre l'interface
// et le processus principal (qui en écrit les consignes, src/main/quick).

import type { QuickActionId } from './types'

export const QUICK_ACTIONS: { id: QuickActionId; label: string; replace: boolean }[] = [
  { id: 'fix', label: 'Corriger', replace: true },
  { id: 'rephrase', label: 'Reformuler', replace: true },
  { id: 'translate', label: 'Traduire', replace: true },
  { id: 'summarize', label: 'Résumer', replace: false },
  { id: 'explain', label: 'Expliquer', replace: false },
  { id: 'reply', label: 'Répondre', replace: false }
]

export function isQuickAction(id: string): id is QuickActionId {
  return QUICK_ACTIONS.some((a) => a.id === id)
}

/** Le résultat peut remplacer la sélection (sinon : Copier). */
export function canReplaceWith(id: QuickActionId): boolean {
  return QUICK_ACTIONS.find((a) => a.id === id)?.replace ?? false
}
