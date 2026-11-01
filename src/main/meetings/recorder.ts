// Enregistreur d'appels. L'îlot capte le micro ; le son de l'ordinateur vient
// de Windows (systemAudio.ts), ou de l'îlot en secours. Les deux pistes
// arrivent ici en morceaux de 16 bits à 16 kHz. Chaque piste est
// écrite dans le dossier de la réunion et découpée en phrases, transcrites au
// fil de l'eau (sur le PC). À l'arrêt : dernières phrases, séparation des voix
// des autres (pack des voix), phrases douteuses reprises (autre langue, mots perdus),
// doublons du micro retirés, puis le son est effacé (sauf si l'utilisateur veut
// le garder ; par défaut, le son de l'appel reste 24 h pour pouvoir refaire la
// séparation des voix). Jamais lancé sans un clic.

import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync, writeSync } from 'node:fs'
import { powerMonitor } from 'electron'
import { IPC } from '../../shared/ipc'
import { expectedLanguage, lineLanguage, sparseLines, wrongLanguageLines } from '../../shared/meetingLanguage'
import {
  byTime,
  countVoices,
  cutAtPauses,
  defaultMeetingTitle,
  dropEchoes,
  flushSegmenter,
  frameLevels,
  MEETING_MAX_MS,
  mergeVoices,
  newSegmenter,
  oneVoice,
  peopleChoice,
  quietestAt,
  SAMPLE_RATE,
  SEGMENT,
  segmentChunk,
  type SegmenterState,
  type SpeechSpan
} from '../../shared/meetings'
import { SPEECH_MODELS } from '../../shared/speechModels'
import type { Meeting, MeetingEvent, MeetingLine, MeetingMeta, MeetingStart, MeetingStartOptions, MeetingTrack, SpeechModelId } from '../../shared/types'
import { emit } from '../bus'
import { log } from '../log'
import { diarizeTrack, prepareSpeech, transcribeSpeech } from '../speech/engine'
import { speechModelFiles, voicesFiles } from '../speech/models'
import { settings } from '../store/settings'
import { audioPath, deleteAudio, deleteMeeting, getMeeting, hasAudio, listMeetings, meetingDir, metaOf, saveMeeting } from './store'
import { canAutoSummarize, summarizeMeeting } from './summary'
import { startSystemAudio, type SystemAudio } from './systemAudio'

/** Plus aucun son reçu (îlot rechargé, micro débranché) : l'enregistrement s'arrête. */
const SILENT_STOP_MS = 30_000
const SAVE_EVERY_MS = 15_000
/** Morceau envoyé par l'îlot : 2 s au plus. */
const MAX_CHUNK = SAMPLE_RATE * 2
/** Sans « garder le son » : le son de l'appel reste ce temps, pour refaire la séparation des voix. */
export const REDO_AUDIO_MS = 24 * 3600_000
/** Phrases reprises au plus (une réunion entière dans l'autre langue n'est pas un accident). */
const MAX_LINE_FIXES = 120

interface Track {
  fd: number
  /** Échantillons écrits. */
  samples: number
  seg: SegmenterState
}

interface Active {
  meeting: Meeting
  tracks: Partial<Record<MeetingTrack, Track>>
  queue: Promise<void>
  lastAudioAt: number
  savedAt: number
  stopping: boolean
  watchdog: NodeJS.Timeout
  failed: boolean
  /** Son de l'ordinateur capté par Windows (sinon : par l'îlot, ou pas du tout). */
  system: SystemAudio | null
}

let active: Active | null = null
/** getDisplayMedia autorisé une fois, juste après un « Commencer » (son de l'ordinateur). */
let displayArmedUntil = 0

const event = (e: MeetingEvent): void => emit(IPC.meetingEvent, e)

export const recordingId = (): string | null => active?.meeting.id ?? null

/** Le son de l'ordinateur ne peut être demandé que dans les secondes qui suivent un « Commencer ». */
export function takeDisplayCapture(): boolean {
  const ok = Date.now() < displayArmedUntil
  displayArmedUntil = 0
  return ok
}

export async function startMeeting(opts: MeetingStartOptions): Promise<MeetingStart> {
  if (active) throw new Error('Un enregistrement est déjà en cours.')
  const engine: SpeechModelId = opts.engine === 'omnilingual' ? 'omnilingual' : 'parakeet'
  if (!speechModelFiles(engine)) throw new Error(`Télécharge d’abord le modèle ${SPEECH_MODELS[engine].label} : Réglages › Me parler.`)
  const id = randomUUID()
  const now = Date.now()
  const meeting: Meeting = {
    id,
    // Lancé depuis la préparation d'une réunion : son titre, et le lien pour retrouver la suivante.
    title: opts.event?.title ?? defaultMeetingTitle(now),
    startedAt: now,
    durationMs: 0,
    status: 'recording',
    engine,
    others: Boolean(opts.others),
    hasSummary: false,
    audio: true,
    lines: [],
    names: {},
    people: opts.others ? peopleChoice(opts.people) : undefined,
    ...(opts.event ? { event: opts.event } : {})
  }
  mkdirSync(meetingDir(id), { recursive: true })
  const tracks: Active['tracks'] = {}
  for (const t of meeting.others ? (['me', 'others'] as const) : (['me'] as const)) {
    tracks[t] = { fd: openSync(audioPath(id, t), 'w+'), samples: 0, seg: newSegmenter() }
  }
  saveMeeting(meeting)
  const a: Active = (active = {
    meeting,
    tracks,
    queue: Promise.resolve(),
    lastAudioAt: now,
    savedAt: now,
    stopping: false,
    failed: false,
    system: null,
    watchdog: setInterval(() => {
      const a = active
      if (!a || a.stopping) return
      if (Date.now() - a.lastAudioAt > SILENT_STOP_MS) void stopMeeting('Plus de son reçu : enregistrement arrêté.')
      else if (Date.now() - a.meeting.startedAt > MEETING_MAX_MS) void stopMeeting('4 heures atteintes : enregistrement arrêté.')
    }, 5000)
  })
  // Le modèle se charge pendant les premières secondes de l'appel.
  prepareSpeech(engine).catch(() => undefined)
  let systemAudio: MeetingStart['systemAudio'] = 'none'
  if (meeting.others) {
    try {
      const system = await startSystemAudio(
        (pcm) => writeTrack(a, 'others', pcm),
        (message) => {
          a.system = null
          if (active === a && !a.stopping) event({ type: 'notice', id, message })
        }
      )
      if (active !== a || a.stopping) system.stop()
      else a.system = system
      systemAudio = 'windows'
    } catch (e) {
      // Secours : l'îlot demande le son de l'ordinateur à Chromium (sorties stéréo seulement).
      log('warn', `réunions : son de l’ordinateur par Windows impossible (${(e as Error).message}), essai par l’îlot`)
      displayArmedUntil = Date.now() + 15_000
      systemAudio = 'browser'
    }
  }
  log(
    'info',
    `réunions : enregistrement commencé (${meeting.others ? `micro et son de l’appel par ${systemAudio === 'windows' ? 'Windows' : 'l’îlot'}` : 'micro seul'})`
  )
  return { id, startedAt: now, systemAudio }
}

function readSamples(fd: number, span: SpeechSpan): Float32Array {
  const n = Math.max(0, span.to - span.from)
  const buf = Buffer.alloc(n * 2)
  const got = readSync(fd, buf, 0, buf.length, span.from * 2)
  const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(got / 2))
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768
  return out
}

/** Une phrase → une ligne (le texte n'est jamais journalisé). */
async function transcribeSpan(engine: SpeechModelId, fd: number, span: SpeechSpan, who: string): Promise<MeetingLine | null> {
  const text = (await transcribeSpeech(engine, readSamples(fd, span), true)).replace(/\s+/g, ' ').trim()
  return text ? { start: span.from / SAMPLE_RATE, end: span.to / SAMPLE_RATE, who, text } : null
}

function enqueue(a: Active, track: MeetingTrack, span: SpeechSpan): void {
  const t = a.tracks[track]
  if (!t) return
  a.queue = a.queue.then(async () => {
    if (a.failed) return
    try {
      const line = await transcribeSpan(a.meeting.engine, t.fd, span, track)
      if (!line) return
      const lines = dropEchoes([...a.meeting.lines, line].sort(byTime))
      const kept = lines.includes(line)
      a.meeting = { ...a.meeting, lines }
      if (kept) event({ type: 'line', id: a.meeting.id, line })
      if (Date.now() - a.savedAt > SAVE_EVERY_MS) {
        a.savedAt = Date.now()
        saveMeeting({ ...a.meeting, durationMs: Date.now() - a.meeting.startedAt })
      }
    } catch (e) {
      // Modèle introuvable ou moteur arrêté : on le dit une fois, l'enregistrement du son continue.
      if (!a.failed) log('warn', `réunions : transcription impossible (${(e as Error).message})`)
      a.failed = true
      event({ type: 'notice', id: a.meeting.id, message: 'La transcription en direct s’est arrêtée ; le son continue d’être enregistré.' })
    }
  })
}

/** Personnes en face, changées pendant l'appel (jusqu'à l'arrêt) ; `undefined` : automatique. */
export function setMeetingPeople(id: string, people: unknown): boolean {
  const a = active
  if (!a || a.meeting.id !== id || a.stopping || !a.meeting.others) return false
  a.meeting = { ...a.meeting, people: peopleChoice(people) }
  return true
}

/** Morceau de son d'une piste (16 bits, 16 kHz), envoyé par l'îlot. */
export function meetingAudio(id: string, track: MeetingTrack, data: Int16Array): void {
  const a = active
  if (!a || a.meeting.id !== id || !(data instanceof Int16Array) || data.length > MAX_CHUNK) return
  // Le son de l'ordinateur arrive déjà par Windows : l'îlot n'a pas à l'envoyer.
  if (track === 'others' && a.system) return
  writeTrack(a, track, data)
}

function writeTrack(a: Active, track: MeetingTrack, data: Int16Array): void {
  const t = a.tracks[track]
  if (active !== a || a.stopping || !t) return
  if (!t.samples) {
    // Chaque piste part du début de l'appel : celle qui démarre plus tard commence par du silence,
    // et les phrases des deux pistes restent à la bonne heure l'une par rapport à l'autre.
    const lead = Math.round(((Date.now() - a.meeting.startedAt) * SAMPLE_RATE) / 1000) - data.length
    if (lead > 0) {
      t.samples = lead
      t.seg = { ...t.seg, pos: lead }
    }
  }
  writeSync(t.fd, Buffer.from(data.buffer, data.byteOffset, data.byteLength), 0, data.byteLength, t.samples * 2)
  t.samples += data.length
  a.lastAudioAt = Date.now()
  const chunk = new Float32Array(data.length)
  for (let i = 0; i < data.length; i++) chunk[i] = data[i] / 32768
  const r = segmentChunk(t.seg, chunk)
  t.seg = r.state
  for (const span of r.spans) enqueue(a, track, span)
}

/**
 * Fin de l'appel (bouton Arrêter, ou arrêt automatique) : dernières phrases,
 * puis la mise au propre. Renvoie la réunion telle qu'enregistrée.
 */
export async function stopMeeting(message?: string): Promise<MeetingMeta | null> {
  const a = active
  if (!a || a.stopping) return null
  a.stopping = true
  clearInterval(a.watchdog)
  a.system?.stop()
  const id = a.meeting.id
  if (message) event({ type: 'stopped', id, message })
  for (const [track, t] of Object.entries(a.tracks) as [MeetingTrack, Track][]) for (const span of flushSegmenter(t.seg)) enqueue(a, track, span)
  const seconds = Math.max(...Object.values(a.tracks).map((t) => t!.samples), 0) / SAMPLE_RATE
  a.meeting = { ...a.meeting, status: 'processing', durationMs: Math.round(seconds * 1000) || Date.now() - a.meeting.startedAt }
  saveMeeting(a.meeting)
  event({ type: 'processing', id, step: 'Je termine la transcription…' })
  await a.queue
  for (const t of Object.values(a.tracks)) closeSync(t!.fd)
  const meeting = a.meeting
  active = null
  log('info', `réunions : enregistrement arrêté (${Math.round(seconds / 60)} min)`)
  if (a.failed) {
    // Transcription en panne pendant l'appel : le son est gardé pour la reprendre plus tard.
    const kept: Meeting = { ...meeting, status: 'interrupted', audio: true }
    saveMeeting(kept)
    event({ type: 'done', id, meta: metaOf(kept) })
    return metaOf(kept)
  }
  return finalize(meeting)
}

/** PC mis en veille : le son s'arrêterait de toute façon ; on termine proprement. */
export function hookMeetingsPower(): void {
  powerMonitor.on('suspend', () => void stopMeeting('PC en veille : enregistrement arrêté.'))
}

/** Annuler : rien n'est gardé (ni son ni texte). */
export async function discardMeeting(): Promise<void> {
  const a = active
  if (!a) return
  a.stopping = true
  a.failed = true
  clearInterval(a.watchdog)
  a.system?.stop()
  await a.queue.catch(() => undefined)
  for (const t of Object.values(a.tracks)) closeSync(t!.fd)
  active = null
  deleteMeeting(a.meeting.id)
  event({ type: 'stopped', id: a.meeting.id, message: 'Enregistrement annulé : rien n’a été gardé.' })
  log('info', 'réunions : enregistrement annulé et effacé')
}

/** Toutes les phrases d'une piste enregistrée (reprise après interruption, ou voix séparées). */
async function transcribeTrack(m: Meeting, track: MeetingTrack, spans: { from: number; to: number; who: string }[], step: string): Promise<MeetingLine[]> {
  const fd = openSync(audioPath(m.id, track), 'r')
  try {
    const out: MeetingLine[] = []
    for (const [i, s] of spans.entries()) {
      if (i % 5 === 0) event({ type: 'processing', id: m.id, step: `${step} (${Math.round((i / spans.length) * 100)} %)` })
      const line = await transcribeSpan(m.engine, fd, s, s.who)
      if (line) out.push(line)
    }
    return out
  } finally {
    closeSync(fd)
  }
}

const trackSamples = (id: string, track: MeetingTrack): number => (existsSync(audioPath(id, track)) ? Math.floor(statSync(audioPath(id, track)).size / 2) : 0)

/** Phrases d'une piste entière, avec le même découpage qu'en direct. */
function spansOfTrack(id: string, track: MeetingTrack): SpeechSpan[] {
  const total = trackSamples(id, track)
  if (!total) return []
  const fd = openSync(audioPath(id, track), 'r')
  try {
    let seg = newSegmenter()
    const spans: SpeechSpan[] = []
    for (let pos = 0; pos < total; pos += SAMPLE_RATE * 10) {
      const r = segmentChunk(seg, readSamples(fd, { from: pos, to: Math.min(total, pos + SAMPLE_RATE * 10) }))
      seg = r.state
      spans.push(...r.spans)
    }
    return [...spans, ...flushSegmenter(seg)]
  } finally {
    closeSync(fd)
  }
}

/**
 * Voix des autres séparées, si le pack est là et l'option active ; sinon `null` (on garde
 * « Les autres »). Le nombre de personnes indiqué par l'utilisateur est imposé à la séparation ;
 * une seule personne : rien à séparer.
 */
async function separateVoices(m: Meeting): Promise<MeetingLine[] | null> {
  if (!m.others || m.people === 1 || !settings.get().meetings.voices || !voicesFiles() || !trackSamples(m.id, 'others')) return null
  try {
    const voices = await voicesOf(m, m.people)
    return voices.length ? voices : null
  } catch (e) {
    log('warn', `réunions : voix non séparées (${(e as Error).message})`)
    return null
  }
}

/** Sépare les voix du son de l'appel (`people` : nombre imposé, sinon automatique), puis réécrit chaque morceau. */
async function voicesOf(m: Meeting, people?: number): Promise<MeetingLine[]> {
  event({ type: 'processing', id: m.id, step: 'Je sépare les voix…' })
  const seconds = trackSamples(m.id, 'others') / SAMPLE_RATE
  // Les morceaux de chaque voix sont coupés aux pauses, jamais toutes les N secondes.
  const pieces = cutAtPauses(mergeVoices(await diarizeTrack(audioPath(m.id, 'others'), seconds, people), !people), trackLevels(m.id, 'others'))
  const spans = pieces.map((p) => ({ from: Math.floor(p.start * SAMPLE_RATE), to: Math.ceil(p.end * SAMPLE_RATE), who: p.who }))
  return spans.length ? transcribeTrack(m, 'others', spans, 'Je réécris chaque voix') : []
}

/** Niveau de chaque tranche de 30 ms d'une piste enregistrée (lue par morceaux d'environ 10 s). */
function trackLevels(id: string, track: MeetingTrack): Float32Array {
  const total = trackSamples(id, track)
  const out = new Float32Array(Math.floor(total / SEGMENT.frame))
  if (!out.length) return out
  const step = SEGMENT.frame * 333
  const fd = openSync(audioPath(id, track), 'r')
  try {
    for (let pos = 0; pos < total; pos += step) out.set(frameLevels(readSamples(fd, { from: pos, to: Math.min(total, pos + step) })), pos / SEGMENT.frame)
  } finally {
    closeSync(fd)
  }
  return out
}

/**
 * Phrases à reprendre : écrites dans l'autre langue (Parakeet la choisit seul, phrase par
 * phrase), ou presque vides (la fin d'un long morceau perdue). Chacune est retranscrite en
 * deux moitiés coupées au moment le plus calme (une courte, avec un peu plus de marge).
 * Gardée si elle revient dans la langue attendue et ne perd pas de mots ; sinon marquée
 * « à vérifier ». Seulement pour les pistes encore sur le PC (`tracks`).
 */
async function fixLines(m: Meeting, tracks: MeetingTrack[]): Promise<Meeting> {
  const expected = expectedLanguage(m.lines, settings.get().meetings.language)
  const other = expected === 'fr' ? 'en' : expected === 'en' ? 'fr' : null
  const onTrack = (i: number): boolean => tracks.includes(m.lines[i].who === 'me' ? 'me' : 'others')
  const todo = [...new Set([...wrongLanguageLines(m.lines, expected), ...sparseLines(m.lines)])].filter(onTrack).sort((a, b) => a - b)
  if (!todo.length) return m
  const lines = [...m.lines]
  const levels: Partial<Record<MeetingTrack, Float32Array>> = {}
  const fds: Partial<Record<MeetingTrack, number>> = {}
  const count = (text: string): number => text.split(/\s+/).filter(Boolean).length
  let fixed = 0
  try {
    for (const [n, i] of todo.entries()) {
      const l = lines[i]
      const track: MeetingTrack = l.who === 'me' ? 'me' : 'others'
      if (n >= MAX_LINE_FIXES || !trackSamples(m.id, track)) {
        lines[i] = { ...l, doubt: true }
        continue
      }
      if (n % 5 === 0) event({ type: 'processing', id: m.id, step: `Je relis les phrases douteuses (${Math.round((n / todo.length) * 100)} %)` })
      const trackLevel = (levels[track] ??= trackLevels(m.id, track))
      const fd = (fds[track] ??= openSync(audioPath(m.id, track), 'r'))
      const length = l.end - l.start
      const cut = length >= 4 ? quietestAt(trackLevel, l.start + length * 0.35, l.start + length * 0.65) : null
      const windows = cut
        ? [
            [l.start, cut],
            [cut, l.end]
          ]
        : [[Math.max(0, l.start - 0.4), l.end + 0.3]]
      const parts: string[] = []
      for (const [a, b] of windows) {
        const samples = readSamples(fd, { from: Math.floor(a * SAMPLE_RATE), to: Math.ceil(b * SAMPLE_RATE) })
        parts.push((await transcribeSpeech(m.engine, samples, true)).replace(/\s+/g, ' ').trim())
      }
      const text = parts.filter(Boolean).join(' ')
      const language = lineLanguage(text)
      const wasWrong = Boolean(other) && lineLanguage(l.text) === other
      const better = text && language !== other && (wasWrong ? language === expected : count(text) >= count(l.text) * 2) && count(text) >= count(l.text) * 0.7
      if (better) {
        lines[i] = { ...l, text }
        fixed++
      } else lines[i] = { ...l, doubt: true }
    }
  } finally {
    for (const fd of Object.values(fds)) closeSync(fd)
  }
  // Jamais le texte dans le journal : seulement les nombres.
  log('info', `réunions : ${todo.length} phrase(s) douteuse(s) (autre langue ou mots manquants), ${fixed} reprise(s), ${todo.length - fixed} à vérifier`)
  return { ...m, lines }
}

/** `separated` : les voix ont déjà été traitées (reprise d'un enregistrement interrompu). */
async function finalize(meeting: Meeting, separated = false): Promise<MeetingMeta> {
  let m = meeting
  const voices = separated ? null : await separateVoices(m)
  if (voices) m = { ...m, lines: [...m.lines.filter((l) => l.who === 'me'), ...voices], speakers: countVoices(voices) }
  else if (m.people === 1 && m.lines.some((l) => l.who === 'others')) m = { ...m, lines: oneVoice(m.lines), speakers: 1 }
  m = await fixLines({ ...m, lines: [...m.lines].sort(byTime) }, ['me', 'others'])
  const { keepAudio: keep, redoAudio } = settings.get().meetings
  // Son gardé 24 h pour refaire la séparation : seulement celui de l'appel (le micro est effacé).
  const redo = !keep && redoAudio && m.others && trackSamples(m.id, 'others') > 0
  m = { ...m, lines: dropEchoes(m.lines), status: 'done', audio: keep || redo, audioUntil: redo ? Date.now() + REDO_AUDIO_MS : undefined }
  if (!keep) deleteAudio(m.id, redo ? ['me'] : undefined)
  saveMeeting(m)
  const meta = metaOf(m)
  event({ type: 'done', id: m.id, meta })
  // Résumé tout seul seulement s'il reste sur le PC (ou si l'utilisateur l'a permis en ligne).
  if (m.lines.length && canAutoSummarize()) {
    void summarizeMeeting(m.id, false).catch((e: Error) => log('info', `réunions : pas de résumé automatique (${e.message})`))
  }
  return meta
}

/**
 * Refait la séparation des voix d'un appel dont le son est encore là, avec le nombre de
 * personnes choisi (`undefined` : automatique ; 1 : une seule voix, sans tout réécrire).
 * Les noms donnés aux voix sont retirés : les voix sont renumérotées.
 */
export async function redoVoices(id: string, people: unknown): Promise<MeetingMeta> {
  const m = getMeeting(id)
  if (!m || active?.meeting.id === id || redoing.has(id)) throw new Error('Cette réunion est déjà en cours de traitement.')
  if (m.status !== 'done' || !m.others || !trackSamples(id, 'others'))
    throw new Error('Le son de cet appel n’est plus sur ton PC : la séparation ne peut plus être refaite.')
  const n = typeof people === 'number' && Number.isInteger(people) && people >= 1 && people <= 8 ? people : undefined
  if (n !== 1 && !voicesFiles()) throw new Error('Télécharge d’abord le pack des voix : Réglages › Réunions.')
  if (!speechModelFiles(m.engine)) throw new Error(`Télécharge d’abord le modèle ${SPEECH_MODELS[m.engine].label} : Réglages › Me parler.`)
  redoing.add(id)
  saveMeeting({ ...m, status: 'processing' })
  try {
    const others = n === 1 ? m.lines.filter((l) => l.who !== 'me').map((l) => ({ ...l, who: 's1' })) : await voicesOf(m, n)
    if (!others.length) throw new Error('Aucune voix trouvée dans le son de l’appel.')
    let next: Meeting = {
      ...m,
      status: 'done',
      names: {},
      lines: [...m.lines.filter((l) => l.who === 'me'), ...others].sort(byTime),
      speakers: countVoices(others)
    }
    if (n !== 1) next = await fixLines(next, ['others'])
    next = { ...next, lines: dropEchoes(next.lines) }
    saveMeeting(next)
    log('info', `réunions : séparation refaite (${n ? `${n} personne(s) imposée(s)` : 'automatique'}, ${next.speakers} voix)`)
    const meta = metaOf(next)
    event({ type: 'done', id, meta })
    return meta
  } catch (e) {
    saveMeeting(m)
    throw e
  } finally {
    redoing.delete(id)
  }
}

const redoing = new Set<string>()

/** Efface tout de suite le son d'une réunion terminée (la transcription reste). */
export function deleteMeetingAudio(id: string): Meeting | null {
  const m = getMeeting(id)
  if (!m || active?.meeting.id === id || redoing.has(id) || m.status !== 'done') return m
  deleteAudio(id)
  const next: Meeting = { ...m, audio: false, audioUntil: undefined }
  saveMeeting(next)
  return next
}

/** Son gardé pour corriger les voix : effacé tout seul à l'heure dite (au démarrage, puis toutes les heures). */
export function purgeExpiredAudio(now = Date.now()): void {
  for (const meta of listMeetings()) {
    if (!meta.audioUntil || meta.audioUntil > now || meta.status !== 'done' || redoing.has(meta.id)) continue
    deleteMeetingAudio(meta.id)
    log('info', 'réunions : son gardé 24 h effacé')
  }
}

/** Au démarrage : un enregistrement coupé net (Compi fermé, PC éteint) devient « interrompu ». */
export function recoverMeetings(): void {
  for (const meta of listMeetings()) {
    if (meta.status !== 'recording' && meta.status !== 'processing') continue
    const m = getMeeting(meta.id)
    if (!m) continue
    const samples = Math.max(trackSamples(m.id, 'me'), trackSamples(m.id, 'others'))
    saveMeeting({ ...m, status: 'interrupted', audio: hasAudio(m.id), durationMs: Math.round((samples / SAMPLE_RATE) * 1000) || m.durationMs })
    log('info', 'réunions : un enregistrement interrompu a été retrouvé')
  }
}

/** Reprend la transcription d'un enregistrement interrompu, depuis le son gardé. */
export async function resumeMeeting(id: string): Promise<MeetingMeta | null> {
  const m = getMeeting(id)
  if (!m || m.status !== 'interrupted' || !hasAudio(id)) return null
  if (!speechModelFiles(m.engine)) throw new Error(`Télécharge d’abord le modèle ${SPEECH_MODELS[m.engine].label} : Réglages › Me parler.`)
  saveMeeting({ ...m, status: 'processing' })
  try {
    const track = async (t: MeetingTrack, step: string): Promise<MeetingLine[]> => {
      const spans = spansOfTrack(id, t).map((s) => ({ ...s, who: t }))
      return spans.length ? transcribeTrack(m, t, spans, step) : []
    }
    const me = await track('me', 'Je transcris ton micro')
    // Avec le pack des voix, le son de l'appel n'est transcrit qu'une fois, voix par voix.
    const voices = await separateVoices(m)
    const others = voices ?? (await track('others', 'Je transcris le son de l’appel'))
    return await finalize({ ...m, lines: [...me, ...others], speakers: voices ? countVoices(voices) : undefined, status: 'processing' }, true)
  } catch (e) {
    saveMeeting({ ...m, status: 'interrupted' })
    throw e
  }
}
