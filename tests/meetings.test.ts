import { describe, expect, it } from 'vitest'
import {
  cutAtPauses,
  frameLevels,
  quietestAt,
  voiceFloor,
  clockAt,
  dropEchoes,
  flushSegmenter,
  formatDuration,
  meetingMarkdown,
  mergeVoices,
  moveLine,
  nameVoice,
  nextVoice,
  newSegmenter,
  oneVoice,
  parseSummary,
  peopleChoice,
  SAMPLE_RATE,
  segmentChunk,
  similarity,
  speakerLabel,
  SUMMARY_MAX_CHARS,
  summaryInput,
  type SpeechSpan
} from '../src/shared/meetings'
import { LEGACY_VOICES_PACK, packRevision, VOICES_FILES, VOICES_PACK } from '../src/shared/speechModels'
import type { Meeting, MeetingLine } from '../src/shared/types'

/** Son de test : `parts` = [secondes, amplitude] (0 = silence, sinon une voyelle tenue). */
function sound(parts: [number, number][], noise = 0): Float32Array {
  const total = parts.reduce((n, [s]) => n + Math.round(s * SAMPLE_RATE), 0)
  const out = new Float32Array(total)
  let pos = 0
  let seed = 1
  for (const [seconds, amp] of parts) {
    const n = Math.round(seconds * SAMPLE_RATE)
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647
      const hiss = noise ? ((seed / 2147483647) * 2 - 1) * noise : 0
      out[pos + i] = amp * Math.sin((2 * Math.PI * 220 * (pos + i)) / SAMPLE_RATE) + hiss
    }
    pos += n
  }
  return out
}

/** Découpe un son par morceaux de 0,25 s, comme l'îlot les envoie. */
function segment(samples: Float32Array): SpeechSpan[] {
  let state = newSegmenter()
  const spans: SpeechSpan[] = []
  for (let i = 0; i < samples.length; i += 4000) {
    const r = segmentChunk(state, samples.subarray(i, i + 4000))
    state = r.state
    spans.push(...r.spans)
  }
  return [...spans, ...flushSegmenter(state)]
}

const secs = (s: SpeechSpan): [number, number] => [s.from / SAMPLE_RATE, s.to / SAMPLE_RATE]

describe('découpage de la parole', () => {
  it('une phrase entre deux silences donne un seul morceau, avec un peu de marge', () => {
    const spans = segment(
      sound([
        [1, 0],
        [1.5, 0.2],
        [1.5, 0]
      ])
    )
    expect(spans).toHaveLength(1)
    const [from, to] = secs(spans[0])
    expect(from).toBeGreaterThan(0.7)
    expect(from).toBeLessThan(1)
    expect(to).toBeGreaterThan(2.5)
    expect(to).toBeLessThan(2.8)
  })

  it('deux phrases séparées par une pause donnent deux morceaux', () => {
    expect(
      segment(
        sound([
          [0.5, 0],
          [1, 0.2],
          [1.2, 0],
          [1, 0.2],
          [1, 0]
        ])
      )
    ).toHaveLength(2)
  })

  it('une courte respiration (0,3 s) ne coupe pas la phrase', () => {
    expect(
      segment(
        sound([
          [0.5, 0],
          [1, 0.2],
          [0.3, 0],
          [1, 0.2],
          [1, 0]
        ])
      )
    ).toHaveLength(1)
  })

  it('un bruit bref (moins de 0,3 s) est ignoré', () => {
    expect(
      segment(
        sound([
          [1, 0],
          [0.1, 0.3],
          [1.5, 0]
        ])
      )
    ).toHaveLength(0)
  })

  it('un long monologue est coupé toutes les 15 s', () => {
    const spans = segment(
      sound([
        [0.5, 0],
        [40, 0.2],
        [1, 0]
      ])
    )
    expect(spans.length).toBeGreaterThanOrEqual(3)
    for (const s of spans) expect((s.to - s.from) / SAMPLE_RATE).toBeLessThanOrEqual(15.3)
  })

  it('une phrase trop longue est coupée au moment le plus calme, pas au milieu d’un mot', () => {
    // 9 s de voix, un souffle de 0,15 s (pas une vraie pause), puis 9 s : coupé au souffle (~10 s), pas à 15 s.
    const spans = segment(
      sound([
        [1, 0],
        [9, 0.2],
        [0.15, 0.005],
        [9, 0.2],
        [1, 0]
      ])
    )
    expect(spans).toHaveLength(2)
    expect(spans[0].to / SAMPLE_RATE).toBeGreaterThan(9.9)
    expect(spans[0].to / SAMPLE_RATE).toBeLessThan(10.2)
    expect(spans[1].from).toBe(spans[0].to)
  })

  it('un micro avec du souffle ne parle pas en continu', () => {
    const spans = segment(
      sound(
        [
          [2, 0],
          [1.5, 0.2],
          [2, 0]
        ],
        0.01
      )
    )
    expect(spans).toHaveLength(1)
  })

  it('la phrase en cours à l’arrêt est rendue', () => {
    let state = newSegmenter()
    const r = segmentChunk(
      state,
      sound([
        [0.5, 0],
        [1, 0.2]
      ])
    )
    state = r.state
    expect(r.spans).toHaveLength(0)
    expect(flushSegmenter(state)).toHaveLength(1)
  })
})

const line = (who: string, start: number, text: string): MeetingLine => ({ who, start, end: start + 3, text })

describe('doublons du micro', () => {
  it('reconnaît une même phrase, accents et ponctuation mis à part', () => {
    expect(similarity('Tu peux les envoyer à Léa avant jeudi ?', 'tu peux les envoyer a lea avant jeudi')).toBe(1)
    expect(similarity('On garde la date', 'Je m’en occupe demain')).toBeLessThan(0.3)
  })

  it('retire la phrase du micro qui répète le son de l’appel au même moment', () => {
    const lines = [line('others', 10, 'Tu peux les envoyer à Léa avant jeudi ?'), line('me', 10.4, 'peux les envoyer à Léa avant jeudi')]
    expect(dropEchoes(lines)).toEqual([lines[0]])
  })

  it('garde ce que je dis vraiment, et une phrase répétée plus tard', () => {
    const lines = [
      line('others', 10, 'Tu peux les envoyer à Léa avant jeudi ?'),
      line('me', 14, 'Je m’en occupe demain matin.'),
      line('me', 60, 'Tu peux les envoyer à Léa avant jeudi ?')
    ]
    expect(dropEchoes(lines)).toHaveLength(3)
  })
})

describe('voix des autres', () => {
  it('réunit les morceaux voisins d’une même voix et numérote dans l’ordre de parole', () => {
    const out = mergeVoices([
      { start: 5, end: 7, speaker: 3 },
      { start: 0, end: 2, speaker: 7 },
      { start: 2.3, end: 4, speaker: 7 },
      { start: 8, end: 8.1, speaker: 7 }
    ])
    expect(out).toEqual([
      { start: 0, end: 4, who: 's1' },
      { start: 5, end: 7, who: 's2' }
    ])
  })

  it('garde un long tour de parole entier (il est coupé ensuite, aux pauses)', () => {
    expect(mergeVoices([{ start: 0, end: 45, speaker: 0 }])).toEqual([{ start: 0, end: 45, who: 's1' }])
  })

  it('automatique : une miette prise entre deux morceaux d’une autre voix lui revient', () => {
    // Cas réel du 01/11 : « Personne 3 » pour deux mots au milieu de la phrase de quelqu'un d'autre.
    const segs = [
      { start: 0, end: 5, speaker: 0 },
      { start: 5.2, end: 6, speaker: 1 },
      { start: 6.3, end: 12, speaker: 0 },
      { start: 13, end: 20, speaker: 1 }
    ]
    expect(mergeVoices(segs)).toEqual([
      { start: 0, end: 12, who: 's1' },
      { start: 13, end: 20, who: 's2' }
    ])
    // Une vraie réponse courte entre deux voix différentes reste à sa place.
    expect(
      mergeVoices([
        { start: 0, end: 5, speaker: 0 },
        { start: 5.2, end: 6, speaker: 1 },
        { start: 6.3, end: 12, speaker: 2 },
        { start: 13, end: 20, speaker: 1 }
      ]).map((p) => p.who)
    ).toEqual(['s1', 's2', 's3', 's2'])
    // Nombre de personnes choisi : rien n'est déplacé.
    expect(mergeVoices(segs, false).map((p) => p.who)).toEqual(['s1', 's2', 's1', 's2'])
  })

  it('un moment où deux voix se chevauchent n’est transcrit qu’une fois', () => {
    // Cas réel du 25/10 : « What's on your mind? » écrit deux fois, sous deux noms.
    expect(
      mergeVoices([
        { start: 16, end: 18.4, speaker: 3 },
        { start: 17.8, end: 18.4, speaker: 2 }
      ])
    ).toEqual([{ start: 16, end: 18.4, who: 's1' }])
    expect(
      mergeVoices([
        { start: 11.3, end: 12, speaker: 1 },
        { start: 11.3, end: 16, speaker: 2 }
      ])
    ).toEqual([{ start: 11.3, end: 16, who: 's1' }])
    expect(
      mergeVoices([
        { start: 0, end: 3, speaker: 0 },
        { start: 2.5, end: 6, speaker: 1 }
      ])
    ).toEqual([
      { start: 0, end: 3, who: 's1' },
      { start: 3, end: 6, who: 's2' }
    ])
  })

  it('automatique : une voix faite seulement de bouts de moins d’une seconde rejoint la plus proche', () => {
    const segs = [
      { start: 0, end: 4, speaker: 0 },
      { start: 4.5, end: 5.2, speaker: 1 },
      { start: 5.5, end: 9, speaker: 0 },
      { start: 12, end: 14, speaker: 2 }
    ]
    expect(mergeVoices(segs)).toEqual([
      { start: 0, end: 9, who: 's1' },
      { start: 12, end: 14, who: 's2' }
    ])
    // Nombre de personnes choisi : chaque voix trouvée est gardée.
    expect(mergeVoices(segs, false).map((p) => p.who)).toEqual(['s1', 's2', 's1', 's3'])
    // Une vraie phrase (1 s ou plus) garde sa voix ; si toutes les voix sont courtes, rien n'est réuni.
    const longer = mergeVoices([
      { start: 0, end: 4, speaker: 0 },
      { start: 5, end: 6.2, speaker: 1 }
    ])
    expect(longer.map((p) => p.who)).toEqual(['s1', 's2'])
    const short = mergeVoices([
      { start: 0, end: 0.6, speaker: 0 },
      { start: 2, end: 2.7, speaker: 1 }
    ])
    expect(short.map((p) => p.who)).toEqual(['s1', 's2'])
  })

  it('cas réel du 25/10 : un seul agent vocal coupé en 5 voix', () => {
    const real = [
      [11.3, 12, 1],
      [11.3, 16, 2],
      [16, 18.4, 3],
      [17.8, 18.4, 2],
      [31.5, 34.5, 4],
      [43.3, 59.8, 4],
      [64.7, 77.1, 4],
      [81, 82, 4],
      [90, 103.3, 4],
      [103, 103.3, 2],
      [117.6, 118.3, 5],
      [118.3, 124, 2],
      [124, 127, 4],
      [127, 128, 2],
      [128, 130.1, 4],
      [130, 131, 2],
      [131, 133, 4],
      [133, 134.4, 1],
      [135.8, 140.2, 2],
      [150.3, 151, 5],
      [153, 170, 4],
      [170, 171.7, 2],
      [179, 182.7, 1],
      [182, 196, 4],
      [196, 202, 2],
      [202, 205.3, 4],
      [228.5, 228.9, 5],
      [231, 231.8, 5],
      [232, 233, 2],
      [233, 234, 4],
      [234, 242, 2],
      [242, 247.8, 4],
      [257, 260.9, 3]
    ].map(([start, end, speaker]) => ({ start, end, speaker }))
    const auto = mergeVoices(real)
    // Plus aucun moment transcrit deux fois ; les « Yeah » (voix 5) rejoignent leur voisine.
    expect(auto.every((p, i) => i === 0 || p.start >= auto[i - 1].end)).toBe(true)
    expect(new Set(auto.map((p) => p.who)).size).toBe(4)
    // Seul le nombre de personnes indiqué ramène l'appel à une voix (pas de séparation).
    expect(new Set(mergeVoices(real, false).map((p) => p.who)).size).toBe(5)
  })

  it('une seule personne en face : toutes ses phrases à la même voix', () => {
    const lines = oneVoice([
      { start: 0, end: 1, who: 'me', text: 'Bonjour' },
      { start: 1, end: 2, who: 'others', text: 'Bonjour Alex' }
    ])
    expect(lines.map((l) => l.who)).toEqual(['me', 's1'])
    expect(peopleChoice(1)).toBe(1)
    for (const bad of [0, 2, 3, 4, 5, 1.5, '1', null, undefined]) expect(peopleChoice(bad)).toBeUndefined()
  })

  it('nomme les voix', () => {
    expect(speakerLabel('me')).toBe('Moi')
    expect(speakerLabel('others')).toBe('Les autres')
    expect(speakerLabel('s2')).toBe('Personne 2')
    expect(speakerLabel('s1', { s1: 'Léa' })).toBe('Léa')
  })

  it('réunit deux voix qui reçoivent le même nom', () => {
    const m = {
      names: { s1: 'Léa' },
      speakers: 3,
      lines: [
        { start: 0, end: 2, who: 's1', text: 'a' },
        { start: 3, end: 4, who: 's2', text: 'b' },
        { start: 5, end: 6, who: 's3', text: 'c' },
        { start: 7, end: 8, who: 'me', text: 'd' }
      ]
    } as unknown as Meeting
    const named = nameVoice(m, 's2', 'Paul')
    expect(named.names).toEqual({ s1: 'Léa', s2: 'Paul' })
    expect(named.speakers).toBe(3)
    const merged = nameVoice(named, 's3', 'léa')
    expect(merged.names).toEqual({ s1: 'Léa', s2: 'Paul' })
    expect(merged.lines.map((l) => l.who)).toEqual(['s1', 's2', 's1', 'me'])
    expect(merged.speakers).toBe(2)
    expect(nameVoice(merged, 's2', '').names).toEqual({ s1: 'Léa' })
  })

  it('rattache une phrase à une autre voix, ou à une nouvelle personne', () => {
    const m = {
      names: {},
      speakers: 2,
      lines: [
        { start: 0, end: 2, who: 's1', text: 'a' },
        { start: 3, end: 4, who: 's2', text: 'b' },
        { start: 5, end: 6, who: 's1', text: 'c' },
        { start: 7, end: 8, who: 'me', text: 'd' }
      ]
    } as unknown as Meeting
    expect(nextVoice(m.lines)).toBe('s3')
    const moved = moveLine(m, 2, 's2')
    expect(moved.lines.map((l) => l.who)).toEqual(['s1', 's2', 's2', 'me'])
    const added = moveLine(moved, 0, 's3')
    expect(added.lines.map((l) => l.who)).toEqual(['s3', 's2', 's2', 'me'])
    expect(added.speakers).toBe(2)
    // Le micro, une voix inventée ou une ligne absente : rien ne change.
    expect(moveLine(m, 3, 's1')).toBe(m)
    expect(moveLine(m, 0, 's9')).toBe(m)
    expect(moveLine(m, 0, 'me')).toBe(m)
    expect(moveLine(m, 12, 's2')).toBe(m)
  })
})

describe('coupe aux pauses', () => {
  /** Niveaux de tranches de 30 ms : `parts` = [secondes, niveau]. */
  const levelsOf = (parts: [number, number][]): Float32Array => {
    const out: number[] = []
    for (const [seconds, level] of parts) for (let i = 0; i < Math.round(seconds / 0.03); i++) out.push(level)
    return Float32Array.from(out)
  }

  it('coupe un tour de parole à une vraie pause', () => {
    const levels = levelsOf([
      [10, 0.2],
      [1, 0.001],
      [8, 0.2]
    ])
    const out = cutAtPauses([{ start: 0, end: 19, who: 's1' }], levels)
    expect(out).toHaveLength(2)
    expect(out[0].end).toBeCloseTo(10.15, 1)
    expect(out[1].start).toBeCloseTo(10.8, 1)
    expect(out.every((p) => p.who === 's1')).toBe(true)
  })

  it('une courte respiration ne coupe pas', () => {
    const levels = levelsOf([
      [5, 0.2],
      [0.3, 0.001],
      [5, 0.2]
    ])
    expect(cutAtPauses([{ start: 0, end: 10.3, who: 's1' }], levels)).toHaveLength(1)
  })

  it('un long tour sans pause est coupé au plus calme, en morceaux de 6 à 15 s', () => {
    // 38 s de parole, avec deux creux (fins de phrase sans vraie pause) à 12 s et 24 s.
    const levels = levelsOf([
      [12, 0.2],
      [0.15, 0.05],
      [12, 0.2],
      [0.15, 0.05],
      [14, 0.2]
    ])
    const out = cutAtPauses([{ start: 0, end: 38.3, who: 's2' }], levels)
    expect(out.map((p) => Math.round(p.end))).toEqual([12, 24, 38])
    for (const p of out) {
      expect(p.end - p.start).toBeLessThanOrEqual(15)
      expect(p.end - p.start).toBeGreaterThanOrEqual(6)
    }
  })

  it('sans niveaux (son illisible), coupe toutes les 15 s', () => {
    expect(cutAtPauses([{ start: 0, end: 40, who: 's1' }], new Float32Array(0)).map((p) => [p.start, p.end])).toEqual([
      [0, 15],
      [15, 30],
      [30, 40]
    ])
  })

  it('niveaux et seuil d’une piste', () => {
    const levels = frameLevels(
      sound([
        [1, 0],
        [1, 0.2]
      ])
    )
    expect(levels.length).toBe(Math.floor((2 * SAMPLE_RATE) / 480))
    expect(levels[0]).toBe(0)
    expect(levels.at(-1)).toBeGreaterThan(0.1)
    expect(voiceFloor(levels)).toBe(0.012)
    // Souffle du micro : 3 fois le bruit ; parole presque continue : 30 % du niveau habituel au plus.
    expect(
      voiceFloor(
        levelsOf([
          [2, 0.01],
          [8, 0.2]
        ])
      )
    ).toBeCloseTo(0.03)
    expect(
      voiceFloor(
        levelsOf([
          [0.2, 0.05],
          [10, 0.1]
        ])
      )
    ).toBeCloseTo(0.03)
    expect(quietestAt(new Float32Array(0), 0, 10)).toBeNull()
  })
})

describe('durées', () => {
  it('formate une durée et une position', () => {
    expect(formatDuration(45_000)).toBe('45 s')
    expect(formatDuration(12 * 60_000)).toBe('12 min')
    expect(formatDuration(65 * 60_000)).toBe('1 h 05')
    expect(clockAt(187)).toBe('03:07')
    expect(clockAt(3787)).toBe('1:03:07')
  })
})

describe('résumé', () => {
  it('lit la réponse du modèle, même entourée de texte ou de balises', () => {
    const raw =
      'Voici :\n```json\n{"title":"Point lancement","summary":"La page est prête.","points":["Captures à faire"],"tasks":[{"text":"Envoyer les captures","owner":"Alex","due":"jeudi"},"Relire le texte"]}\n```'
    const s = parseSummary(raw, 'Gemma 4', 1)
    expect(s).toEqual({
      title: 'Point lancement',
      summary: 'La page est prête.',
      points: ['Captures à faire'],
      tasks: [{ text: 'Envoyer les captures', owner: 'Alex', due: 'jeudi' }, { text: 'Relire le texte' }],
      brain: 'Gemma 4',
      at: 1
    })
  })

  it('refuse une réponse inexploitable', () => {
    expect(parseSummary('Je ne peux pas.', 'x')).toBeNull()
    expect(parseSummary('{"title": "sans résumé"}', 'x')).toBeNull()
    expect(parseSummary('{cassé', 'x')).toBeNull()
  })

  it('n’envoie que le début et la fin d’un très long appel', () => {
    const lines = Array.from({ length: 4000 }, (_, i) => line('me', i * 3, `Phrase numéro ${i} assez longue pour remplir.`))
    const input = summaryInput({ lines, names: {} })
    expect(input.length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS + 60)
    expect(input).toContain('Phrase numéro 0 ')
    expect(input).toContain('Phrase numéro 3999 ')
    expect(input).toContain('milieu de l’appel coupé'.replace('’', "'"))
  })
})

describe('export', () => {
  it('met le résumé, les tâches et la transcription en Markdown', () => {
    const m: Meeting = {
      id: '6f1c2a10-0000-4000-8000-000000000001',
      title: 'Point lancement',
      startedAt: Date.UTC(2026, 9, 21, 9, 0),
      durationMs: 23 * 60_000,
      status: 'done',
      engine: 'parakeet',
      others: true,
      hasSummary: true,
      audio: false,
      names: { s1: 'Léa' },
      lines: [line('s1', 2, 'Bonjour à tous.'), line('me', 7, 'La page est prête.')],
      summary: {
        title: 'Point lancement',
        summary: 'La page est prête.',
        points: ['Captures à faire'],
        tasks: [{ text: 'Envoyer les captures', due: 'jeudi' }],
        brain: 'Gemma 4',
        at: 1
      }
    }
    const md = meetingMarkdown(m)
    expect(md).toContain('# Point lancement')
    expect(md).toContain('23 min')
    expect(md).toContain('- [ ] Envoyer les captures (jeudi)')
    expect(md).toContain('**Léa** [00:02] : Bonjour à tous.')
    expect(md).toContain('**Moi** [00:07] : La page est prête.')
  })
})

describe('pack des voix', () => {
  it('WeSpeaker dans un nouveau dossier, l’ancien pack CAM++ toujours reconnu', () => {
    expect(VOICES_PACK.dir).not.toBe(LEGACY_VOICES_PACK.dir)
    expect(VOICES_PACK.sources.flatMap((s) => s.files)).toEqual([VOICES_FILES.segmentation, VOICES_FILES.embedding])
    expect(LEGACY_VOICES_PACK.dir).toBe('voices-pyannote-campplus')
    // Révision écrite à l'installation par Compi 0.2 à 0.4 : la changer rendrait l'ancien pack invisible.
    expect(packRevision(LEGACY_VOICES_PACK)).toBe('9403a6902bb58e3d5ae8c7e77c3422de279db2e0+0743f301363dec56491a490f6d6cbc9d67f9a3bf')
    expect(LEGACY_VOICES_PACK.sources[1].files).toEqual(['3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx'])
  })
})
