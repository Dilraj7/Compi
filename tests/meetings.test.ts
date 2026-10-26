import { describe, expect, it } from 'vitest'
import {
  clockAt,
  dropEchoes,
  flushSegmenter,
  formatDuration,
  meetingMarkdown,
  mergeVoices,
  nameVoice,
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

  it('coupe un long tour de parole en morceaux de 20 s', () => {
    const out = mergeVoices([{ start: 0, end: 45, speaker: 0 }])
    expect(out.map((p) => [p.start, p.end])).toEqual([
      [0, 20],
      [20, 40],
      [40, 45]
    ])
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
    expect(peopleChoice(2)).toBe(2)
    for (const bad of [0, 5, 1.5, '2', null, undefined]) expect(peopleChoice(bad)).toBeUndefined()
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
