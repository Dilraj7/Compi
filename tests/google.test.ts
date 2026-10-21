import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '.' },
  net: { fetch: vi.fn() },
  shell: { openExternal: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../src/main/log', () => ({ log: vi.fn() }))

const auth = await import('../src/main/google/auth')
const { buildMime, cleanHeader, encodeWord, parseAddresses, replySubject } = await import('../src/main/google/mime')
const { messageText } = await import('../src/main/google/gmail')
const { eventBody, formatEvents, isMeetingUrl, meetingLink, patchBody, toDayEvent } = await import('../src/main/google/calendar')
const { eventByReference, forgetEvent, rememberEvent } = await import('../src/main/google/eventRefs')
const { activityLabel, approvalTitle } = await import('../src/main/agent/labels')
const { gmailWebUrl, isMailId } = await import('../src/shared/day')

const b64 = (s: string, enc: BufferEncoding = 'utf8'): string => Buffer.from(s, enc).toString('base64url')

describe('connexion Google', () => {
  it('PKCE conforme à la RFC 7636 (vecteur de test officiel)', () => {
    expect(auth.challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
    const { verifier, challenge } = auth.pkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge).toBe(auth.challengeFor(verifier))
  })

  it('écran de consentement : PKCE S256, état, retour sur 127.0.0.1, jeton durable', () => {
    const url = new URL(
      auth.authUrl(auth.GOOGLE_ENDPOINTS, {
        clientId: 'x.apps.googleusercontent.com',
        redirectUri: 'http://127.0.0.1:5123',
        scopes: auth.scopesFor({ calendar: true, mail: false }),
        state: 'st',
        challenge: 'ch'
      })
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      redirect_uri: 'http://127.0.0.1:5123',
      response_type: 'code',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline'
    })
    expect(url.searchParams.get('scope')).not.toContain('gmail')
  })

  it('autorisations : les plus étroites, et ce que l’utilisateur a vraiment coché', () => {
    expect(auth.scopesFor({ calendar: true, mail: true })).toEqual([
      'openid',
      'email',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose'
    ])
    // Jamais l'accès complet à Gmail (suppression définitive possible).
    expect(auth.scopesFor({ calendar: true, mail: true })).not.toContain('https://mail.google.com/')
    expect(auth.grantedFrom('openid https://www.googleapis.com/auth/gmail.readonly')).toEqual({ calendar: false, mail: true, drafts: false })
    expect(auth.grantedFrom(undefined)).toEqual({ calendar: false, mail: false, drafts: false })
  })

  it('fichier du client : « Application de bureau » seulement', () => {
    const ok = JSON.stringify({ installed: { client_id: '123-abc.apps.googleusercontent.com', client_secret: 'GOCSPX-test' } })
    expect(auth.parseClientFile(ok)).toEqual({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'GOCSPX-test' })
    expect(() => auth.parseClientFile(JSON.stringify({ web: { client_id: 'x' } }))).toThrow(/Application de bureau/)
    expect(() => auth.parseClientFile('pas du json')).toThrow(/JSON/)
    expect(() => auth.parseClientFile(JSON.stringify({ installed: { client_id: 'evil.example.com', client_secret: 's' } }))).toThrow(/inattendu/)
  })

  it('faux Google des tests : accepté seulement sur ce PC', () => {
    expect(auth.endpointsFor(undefined)).toBe(auth.GOOGLE_ENDPOINTS)
    expect(auth.endpointsFor('http://127.0.0.1:47999').token).toBe('http://127.0.0.1:47999/token')
    expect(auth.endpointsFor('https://evil.example.com')).toBe(auth.GOOGLE_ENDPOINTS)
    expect(auth.endpointsFor('http://192.168.1.5:80')).toBe(auth.GOOGLE_ENDPOINTS)
  })

  it('adresse du compte lue dans le jeton d’identité', () => {
    expect(auth.emailFromIdToken(`h.${b64(JSON.stringify({ email: 'alex@example.com' }))}.s`)).toBe('alex@example.com')
    expect(auth.emailFromIdToken('n.importe.quoi')).toBeUndefined()
    expect(auth.emailFromIdToken(undefined)).toBeUndefined()
  })

  it('erreurs claires (API non activée, autorisation manquante, limite)', () => {
    expect(
      auth.googleErrorMessage(403, '{"error":{"message":"Gmail API has not been used in project 123 before or it is disabled","status":"PERMISSION_DENIED"}}')
    ).toMatch(/« Gmail API » n'est pas activée/)
    expect(auth.googleErrorMessage(403, '{"error":{"message":"Request had insufficient authentication scopes."}}')).toMatch(/Reconnecte/)
    expect(auth.googleErrorMessage(429, '')).toMatch(/réessaie dans une minute/)
  })
})

describe('brouillons', () => {
  it('pas d’injection d’en-tête', () => {
    expect(cleanHeader('Bonjour\r\nBcc: espion@evil.com')).toBe('Bonjour Bcc: espion@evil.com')
    const mime = buildMime({ to: ['a@b.fr'], subject: 'Salut\r\nBcc: espion@evil.com', body: 'x' })
    expect(mime).not.toMatch(/^Bcc:/m)
    expect(() => parseAddresses('a@b.fr\r\nBcc: espion@evil.com')).toThrow(/invalide/)
  })

  it('accents encodés (RFC 2047), décodables', () => {
    expect(encodeWord('Hello')).toBe('Hello')
    const word = encodeWord('Réunion de l’équipe — été 2026')
    const decoded = word
      .split('\r\n ')
      .map((w) => Buffer.from(/^=\?UTF-8\?B\?(.+)\?=$/.exec(w)![1], 'base64').toString('utf8'))
      .join('')
    expect(decoded).toBe('Réunion de l’équipe — été 2026')
  })

  it('adresses validées, avec ou sans nom', () => {
    expect(parseAddresses('claire@exemple.fr; Paul <paul@exemple.fr>')).toEqual(['claire@exemple.fr', '"Paul" <paul@exemple.fr>'])
    expect(parseAddresses('Élodie <elodie@exemple.fr>')[0]).toMatch(/^=\?UTF-8\?B\?.+\?= <elodie@exemple\.fr>$/)
    expect(() => parseAddresses('pas-une-adresse')).toThrow()
  })

  it('message complet : CRLF, texte en base 64, fil de la réponse', () => {
    const mime = buildMime({
      to: ['a@b.fr'],
      subject: replySubject('Ordre du jour'),
      body: 'Bonjour,\nÀ jeudi.',
      inReplyTo: '<abc@mail.gmail.com>',
      references: '<x@y> pas-un-id'
    })
    const [head, body] = mime.split('\r\n\r\n')
    expect(head.split('\r\n')).toEqual([
      'To: a@b.fr',
      'Subject: Re: Ordre du jour',
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      'In-Reply-To: <abc@mail.gmail.com>',
      'References: <x@y> <abc@mail.gmail.com>'
    ])
    expect(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8')).toBe('Bonjour,\r\nÀ jeudi.')
    expect(replySubject('RE: déjà')).toBe('RE: déjà')
  })

  it('Compi n’a aucune fonction d’envoi d’e-mail', () => {
    const files = [...readdirSync('src/main/google').map((f) => join('src/main/google', f)), 'src/main/agent/dayTools.ts']
    for (const f of files) {
      const code = readFileSync(f, 'utf8')
      expect(code, f).not.toMatch(/\/send\b|messages\.send|drafts\.send|sendUpdates=(all|externalOnly)/i)
      // Pas d'invités dans les événements créés : personne n'est prévenu.
      expect(code, f).not.toMatch(/attendees\s*:/)
    }
  })
})

describe('lecture des e-mails', () => {
  it('texte brut d’abord, sinon le HTML converti ; pièces jointes listées', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }],
              body: { data: b64('Bonjour Alex,\r\nÀ jeudi.') }
            },
            { mimeType: 'text/html', body: { data: b64('<p>HTML</p>') } }
          ]
        },
        { mimeType: 'application/pdf', filename: 'facture.pdf', body: { attachmentId: 'a1' } }
      ]
    }
    expect(messageText(payload)).toEqual({ text: 'Bonjour Alex,\nÀ jeudi.', attachments: ['facture.pdf'] })
    expect(messageText({ mimeType: 'text/html', body: { data: b64('<p>Salut <b>toi</b></p><script>x()</script>') } }).text).toBe('Salut toi')
  })

  it('jeux de caractères anciens (ISO-8859-1)', () => {
    const part = {
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }],
      body: { data: b64('Réunion à 14h', 'latin1') }
    }
    expect(messageText(part).text).toBe('Réunion à 14h')
  })

  it('identifiants et liens Gmail sûrs', () => {
    expect(isMailId('18c2f0a9b7e3d4f1')).toBe(true)
    expect(isMailId('../../users')).toBe(false)
    expect(gmailWebUrl('a@b.fr', { messageId: '18c2f0a9b7e3d4f1' })).toBe('https://mail.google.com/mail/u/?authuser=a%40b.fr#all/18c2f0a9b7e3d4f1')
    expect(gmailWebUrl('a@b.fr', { messageId: '#evil' })).toBe('https://mail.google.com/mail/u/?authuser=a%40b.fr#all/')
  })
})

describe('agenda', () => {
  it('liens de visio reconnus, sans se faire piéger', () => {
    expect(isMeetingUrl('https://meet.google.com/abc-defg-hij')).toBe(true)
    expect(isMeetingUrl('https://acme.zoom.us/j/123')).toBe(true)
    expect(isMeetingUrl('https://teams.microsoft.com/l/meetup-join/x')).toBe(true)
    expect(isMeetingUrl('http://meet.google.com/abc')).toBe(false)
    expect(isMeetingUrl('https://meet.google.com.evil.io/abc')).toBe(false)
    expect(isMeetingUrl('https://evilzoom.us/j/1')).toBe(false)
    expect(meetingLink({ description: 'Rejoindre : <a href="https://us02web.zoom.us/j/8812?pwd=x">ici</a>.' })).toBe('https://us02web.zoom.us/j/8812?pwd=x')
    expect(meetingLink({ hangoutLink: 'https://meet.google.com/xyz', description: 'https://zoom.us/j/1' })).toBe('https://meet.google.com/xyz')
    expect(meetingLink({ location: 'Salle B', description: 'https://phishing.example.com/meet' })).toBeUndefined()
  })

  it('événements ignorés : annulés, refusés, lieu de travail', () => {
    const base = { id: '1', summary: 'Point', start: { dateTime: '2026-10-14T09:00:00+02:00' }, end: { dateTime: '2026-10-14T09:30:00+02:00' } }
    expect(toDayEvent(base)?.title).toBe('Point')
    expect(toDayEvent({ ...base, status: 'cancelled' })).toBeNull()
    expect(toDayEvent({ ...base, eventType: 'workingLocation' })).toBeNull()
    expect(toDayEvent({ ...base, attendees: [{ self: true, responseStatus: 'declined' }] })).toBeNull()
    expect(toDayEvent({ id: '2', start: { date: '2026-10-14' }, end: { date: '2026-10-15' } })).toMatchObject({ allDay: true, title: '(sans titre)' })
  })

  it('création : heure locale + fuseau, 1 h par défaut, journée entière, jamais d’invités', () => {
    expect(eventBody({ title: 'Dentiste', start: '2026-10-14T17:30' }, 'Europe/Paris')).toEqual({
      summary: 'Dentiste',
      start: { dateTime: '2026-10-14T17:30:00', timeZone: 'Europe/Paris' },
      end: { dateTime: '2026-10-14T18:30:00', timeZone: 'Europe/Paris' }
    })
    expect(eventBody({ title: 'Congés', start: '2026-10-20' }, 'Europe/Paris')).toEqual({
      summary: 'Congés',
      start: { date: '2026-10-20' },
      end: { date: '2026-10-21' }
    })
    expect(() => eventBody({ title: 'X', start: 'demain 15h' }, 'Europe/Paris')).toThrow(/Date invalide/)
    expect(() => eventBody({ title: 'X', start: '2026-10-14T10:00', end: '2026-10-14T09:00' }, 'Europe/Paris')).toThrow(/après le début/)
    expect(() => eventBody({ title: '  ', start: '2026-10-14' }, 'Europe/Paris')).toThrow(/titre/)
  })

  it('liste lisible, groupée par jour', () => {
    const text = formatEvents([
      {
        id: '1',
        title: 'Point équipe',
        start: '2026-10-14T09:00:00',
        end: '2026-10-14T09:30:00',
        allDay: false,
        meetUrl: 'https://meet.google.com/x',
        calendar: 'Travail'
      },
      { id: '2', title: 'Congés', start: '2026-10-15', end: '2026-10-16', allDay: true }
    ])
    expect(text).toBe('mercredi 14 octobre\n- 09:00–09:30 · Point équipe · visio Google Meet · agenda Travail\n\njeudi 15 octobre\n- toute la journée · Congés')
  })
})

describe('déplacer et supprimer un événement', () => {
  const old = { start: '2026-10-16T20:30:00', end: '2026-10-16T21:30:00', allDay: false }

  it('nouveau début : même durée, fuseau renseigné, format horaire imposé', () => {
    expect(patchBody(old, { start: '2026-10-21T20:30' }, 'Europe/Paris')).toEqual({
      start: { date: null, dateTime: '2026-10-21T20:30:00', timeZone: 'Europe/Paris' },
      end: { date: null, dateTime: '2026-10-21T21:30:00', timeZone: 'Europe/Paris' }
    })
    expect(patchBody(old, { start: '2026-10-21T20:30:00+02:00' }, 'Europe/Paris')).toEqual({
      start: { date: null, dateTime: '2026-10-21T20:30:00+02:00', timeZone: 'Europe/Paris' },
      end: { date: null, dateTime: '2026-10-21T19:30:00.000Z', timeZone: 'Europe/Paris' }
    })
    expect(patchBody({ start: '2026-10-20', end: '2026-10-21', allDay: true }, { start: '2026-10-22T09:00' }, 'Europe/Paris')).toMatchObject({
      end: { dateTime: '2026-10-22T10:00:00' }
    })
  })

  it('journée entière, titre seul, erreurs claires', () => {
    expect(patchBody({ start: '2026-10-20', end: '2026-10-23', allDay: true }, { start: '2026-11-02' }, 'Europe/Paris')).toEqual({
      start: { date: '2026-11-02', dateTime: null, timeZone: null },
      end: { date: '2026-11-05', dateTime: null, timeZone: null }
    })
    expect(patchBody(old, { start: '2026-10-21' }, 'Europe/Paris')).toMatchObject({ start: { date: '2026-10-21' }, end: { date: '2026-10-22' } })
    expect(patchBody(old, { title: ' Cinéma ' }, 'Europe/Paris')).toEqual({ summary: 'Cinéma' })
    expect(() => patchBody(old, {}, 'Europe/Paris')).toThrow(/Rien à modifier/)
    expect(() => patchBody(old, { title: '  ' }, 'Europe/Paris')).toThrow(/titre/)
    expect(() => patchBody(old, { start: '2026-10-21T20:30', end: '2026-10-21T19:00' }, 'Europe/Paris')).toThrow(/après le début/)
    expect(() => patchBody(old, { end: '2026-10-16T20:00' }, 'Europe/Paris')).toThrow(/après le début/)
    expect(() => patchBody(old, { start: 'mercredi prochain' }, 'Europe/Paris')).toThrow(/Date invalide/)
    expect(() => patchBody(old, { start: '2026-10-21', end: '2026-10-21T21:00' }, 'Europe/Paris')).toThrow(/journée entière/)
  })

  it('réfs courtes : stables, seulement pour Google, oubliées après suppression', () => {
    const g = {
      id: 'abc123def456ghi789jkl012mn',
      title: 'Cinéma',
      start: '2026-10-16T20:30:00',
      end: '2026-10-16T21:30:00',
      allDay: false,
      calendarId: 'alex@example.com'
    }
    const r1 = rememberEvent(g) as string
    expect(r1).toMatch(/^e\d+$/)
    expect(rememberEvent({ ...g, title: 'Cinéma (renommé)' })).toBe(r1)
    expect(eventByReference(`réf ${r1}`)).toMatchObject({ eventId: g.id, calendarId: 'alex@example.com', title: 'Cinéma (renommé)' })
    expect(eventByReference(r1.toUpperCase())?.ref).toBe(r1)
    expect(rememberEvent({ ...g, calendarId: 'famille@group.calendar.google.com' })).not.toBe(r1)
    expect(rememberEvent({ ...g, calendarId: undefined })).toBeUndefined()
    forgetEvent(eventByReference(r1)!)
    expect(eventByReference(r1)).toBeUndefined()
    expect(eventByReference('e999999')).toBeUndefined()
    expect(eventByReference(undefined)).toBeUndefined()
  })

  it('liste avec réfs : un événement d’une autre source dit où il se modifie', () => {
    const text = formatEvents(
      [
        { id: 'y', title: 'Piscine', start: '2026-10-16T18:00:00', end: '2026-10-16T19:00:00', allDay: false, calendar: 'Maison' },
        { id: 'x', title: 'Cinéma', start: '2026-10-16T20:30:00', end: '2026-10-16T21:30:00', allDay: false, calendarId: 'primary' }
      ],
      (e) => (e.calendarId ? 'e7' : undefined)
    )
    expect(text).toBe('vendredi 16 octobre\n- 18:00–19:00 · Piscine · agenda Maison · se modifie dans Maison, pas ici\n- 20:30–21:30 · Cinéma · réf e7')
  })

  it('cartes : l’événement réellement visé, avant et après', () => {
    const ref = rememberEvent({ id: 'k1', title: 'Cinéma avec Karthik', ...old, calendarId: 'primary' }) as string
    const move = approvalTitle('mcp__compi__calendar_update_event', { ref, start: '2026-10-21T20:30' })
    expect(move.title).toBe('Compi veut déplacer « Cinéma avec Karthik »')
    expect(move.detail).toContain('Avant : vendredi 16 octobre')
    expect(move.detail).toContain('Après : mercredi 21 octobre')
    expect(move.detail).toContain('21:30')
    expect(move.detail).toContain('sans doublon')
    expect(approvalTitle('mcp__compi__calendar_update_event', { ref, title: 'Cinéma' }).title).toBe('Compi veut modifier « Cinéma avec Karthik »')
    const del = approvalTitle('mcp__compi__calendar_delete_event', { ref })
    expect(del.title).toBe('Compi veut supprimer « Cinéma avec Karthik » de ton agenda')
    expect(del.detail).toContain('corbeille')
    expect(approvalTitle('mcp__compi__calendar_delete_event', { ref: 'e424242' }).detail).toMatch(/Réf inconnue/)
    expect(activityLabel('mcp__compi__calendar_update_event', { ref })).toBe('Agenda : modification de « Cinéma avec Karthik »')
  })
})
