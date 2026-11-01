// Ouvrir la fiche d'une réunion (Historique › Réunions), depuis n'importe quelle vue. Ici
// plutôt que dans FullBlocks, pour ne pas charger le plein écran avec la discussion.

import { useCompi } from '../store'

export function openMeetingView(id: string): void {
  const s = useCompi.getState()
  s.setHistoryTab('meetings')
  s.openMeeting(id)
  s.setView('history')
}
