// Préparer une réunion : derniers e-mails échangés avec les participants (Gmail,
// expéditeur, objet et date seulement) et tâches de la réunion d'avant. Calculé
// sur le PC quand l'utilisateur ouvre la préparation ; rien n'est envoyé à un cerveau.

import { pickPrevious, PREP_MAILS, prepMailQuery } from '../../shared/meetingPrep'
import type { MeetingEventLink, MeetingPrep } from '../../shared/types'
import { searchMail } from '../google/gmail'
import { getMeeting, listMeetings } from '../meetings/store'
import { settings } from '../store/settings'

export async function meetingPrep(ev: MeetingEventLink): Promise<MeetingPrep> {
  let mails: MeetingPrep['mails'] = null
  let mailError: string | undefined
  if (settings.get().google.mail) {
    const query = prepMailQuery(ev.attendees)
    mails = []
    if (query) {
      try {
        mails = (await searchMail(query, PREP_MAILS)).mails.map((m) => ({ id: m.id, from: m.from, subject: m.subject, date: m.date }))
      } catch (e) {
        mailError = (e as Error).message
      }
    }
  }
  const prev = pickPrevious(ev, listMeetings())
  const full = prev ? getMeeting(prev.id) : null
  return {
    mails,
    ...(mailError ? { mailError } : {}),
    previous: full ? { id: full.id, title: full.title, startedAt: full.startedAt, tasks: full.summary?.tasks ?? [] } : null
  }
}
