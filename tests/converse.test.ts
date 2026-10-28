import { describe, expect, it } from 'vitest'
import {
  CONVERSE,
  CONVERSE_OFF,
  CONVERSE_SEGMENT,
  converseStep,
  isOnset,
  micWanted,
  READING_SEGMENT,
  type ConverseEvent,
  type ConverseState,
  type MicMode
} from '../src/shared/converse'
import { newSegmenter, SAMPLE_RATE, segmentChunk, type SpeechSpan } from '../src/shared/meetings'

/** Rejoue des événements depuis l'arrêt ; renvoie l'état final et tous les effets. */
function run(events: ConverseEvent[], from: ConverseState = CONVERSE_OFF): { state: ConverseState; effects: string[] } {
  let state = from
  const effects: string[] = []
  for (const e of events) {
    const r = converseStep(state, e)
    state = r.state
    effects.push(...r.effects)
  }
  return { state, effects }
}

describe('conversation vocale : automate', () => {
  it('fin naturelle de la lecture → écoute 6 s → phrase → transcription → envoi', () => {
    const r = run([
      { type: 'ask' },
      { type: 'speech-end', reason: 'end', now: 1000 },
      { type: 'tick', now: 3000 },
      { type: 'onset', reading: false },
      { type: 'phrase' },
      { type: 'heard', text: 'et demain ?', busy: false, now: 9000 }
    ])
    expect(r.state.phase).toBe('answering')
    expect(r.effects).toEqual(['transcribe', 'send'])
  })

  it('personne ne parle : la conversation s’arrête au bout de la fenêtre d’écoute', () => {
    const listening = run([{ type: 'ask' }, { type: 'speech-end', reason: 'end', now: 1000 }]).state
    expect(listening.phase).toBe('listening')
    expect(listening.until).toBe(1000 + CONVERSE.listenMs)
    expect(converseStep(listening, { type: 'tick', now: 1000 + CONVERSE.listenMs - 1 }).state.phase).toBe('listening')
    expect(converseStep(listening, { type: 'tick', now: 1000 + CONVERSE.listenMs }).state).toEqual(CONVERSE_OFF)
  })

  it('lecture arrêtée par l’utilisateur : la conversation s’arrête', () => {
    expect(run([{ type: 'ask' }, { type: 'speech-end', reason: 'stopped', now: 1 }]).state.phase).toBe('off')
  })

  it('parler pendant la lecture la coupe, et l’arrêt qui suit ne finit pas la conversation', () => {
    const r = run([{ type: 'ask' }, { type: 'onset', reading: true }, { type: 'speech-end', reason: 'stopped', now: 5 }])
    expect(r.state.phase).toBe('hearing')
    expect(r.effects).toEqual(['cut-reading'])
  })

  it('avant que la lecture commence, la voix est ignorée', () => {
    const r = run([{ type: 'ask' }, { type: 'onset', reading: false }, { type: 'phrase' }])
    expect(r.state.phase).toBe('answering')
    expect(r.effects).toEqual([])
  })

  it('réponse sans rien à lire : arrêt', () => {
    expect(run([{ type: 'ask' }, { type: 'answer-silent' }]).state.phase).toBe('off')
  })

  it('phrase entendue pendant que la réponse s’écrit encore : envoyée à la fin de la réponse', () => {
    const r = run([{ type: 'ask' }, { type: 'onset', reading: true }, { type: 'phrase' }, { type: 'heard', text: 'stop, autre chose', busy: true, now: 10 }])
    expect(r.state.phase).toBe('queued')
    expect(r.effects).toEqual(['cut-reading', 'transcribe'])
    const sent = converseStep(r.state, { type: 'answer-end' })
    expect(sent.state.phase).toBe('answering')
    expect(sent.effects).toEqual(['send'])
  })

  it('phrases vides : on réécoute une fois, puis on s’arrête', () => {
    const heard = (now: number): ConverseEvent[] => [{ type: 'onset', reading: false }, { type: 'phrase' }, { type: 'heard', text: ' ', busy: false, now }]
    const once = run([{ type: 'ask' }, { type: 'speech-end', reason: 'end', now: 0 }, ...heard(100)])
    expect(once.state.phase).toBe('listening')
    expect(once.state.until).toBe(100 + CONVERSE.listenMs)
    expect(run(heard(200), once.state).state.phase).toBe('off')
  })

  it('une question réussie remet le compte des phrases vides à zéro', () => {
    const r = run([
      { type: 'ask' },
      { type: 'speech-end', reason: 'end', now: 0 },
      { type: 'phrase' },
      { type: 'heard', text: '', busy: false, now: 1 },
      { type: 'phrase' },
      { type: 'heard', text: 'oui', busy: false, now: 2 }
    ])
    expect(r.state).toEqual({ phase: 'answering', until: 0, misses: 0 })
  })

  it('Échap, saisie, carte d’accord… : stop depuis n’importe quelle phase', () => {
    for (const phase of ['answering', 'listening', 'hearing', 'transcribing', 'queued'] as const) {
      expect(converseStep({ phase, until: 5, misses: 1 }, { type: 'stop' }).state).toEqual(CONVERSE_OFF)
    }
  })

  it('arrêtée, elle ne repart que sur une nouvelle question à la voix', () => {
    const r = run([{ type: 'speech-end', reason: 'end', now: 0 }, { type: 'onset', reading: true }, { type: 'phrase' }, { type: 'answer-end' }])
    expect(r.state).toEqual(CONVERSE_OFF)
    expect(r.effects).toEqual([])
  })
})

describe('conversation vocale : micro', () => {
  const at = (phase: ConverseState['phase']): ConverseState => ({ phase, until: 0, misses: 0 })

  it('ouvert pour écouter, fermé pendant la transcription et à l’arrêt', () => {
    expect(micWanted(at('listening'), false, true)).toBe('listening')
    expect(micWanted(at('hearing'), true, true)).toBe('listening')
    expect(micWanted(at('transcribing'), false, true)).toBeNull()
    expect(micWanted(at('queued'), false, true)).toBeNull()
    expect(micWanted(CONVERSE_OFF, true, true)).toBeNull()
  })

  it('pendant la lecture, seulement si l’on peut la couper en parlant', () => {
    expect(micWanted(at('answering'), true, true)).toBe('reading')
    expect(micWanted(at('answering'), true, false)).toBeNull()
    expect(micWanted(at('answering'), false, true)).toBeNull()
  })
})

/** Son de test : `parts` = [secondes, amplitude] (0 = silence), avec un léger souffle. */
function sound(parts: [number, number][], noise = 0.002): Float32Array {
  const total = parts.reduce((n, [s]) => n + Math.round(s * SAMPLE_RATE), 0)
  const out = new Float32Array(total)
  let pos = 0
  let seed = 7
  for (const [seconds, amp] of parts) {
    const n = Math.round(seconds * SAMPLE_RATE)
    for (let i = 0; i < n; i++) {
      seed = (seed * 16807) % 2147483647
      out[pos + i] = amp * Math.sin((2 * Math.PI * 180 * (pos + i)) / SAMPLE_RATE) + ((seed / 2147483647) * 2 - 1) * noise
    }
    pos += n
  }
  return out
}

/** Comme l'îlot : morceaux de 0,1 s, premier instant où la voix suffit pour une phrase. */
function listen(samples: Float32Array, mode: MicMode): { spans: SpeechSpan[]; onsetAt: number | null } {
  let state = newSegmenter()
  const spans: SpeechSpan[] = []
  let onsetAt: number | null = null
  for (let i = 0; i < samples.length; i += 1600) {
    const r = segmentChunk(state, samples.subarray(i, i + 1600), mode === 'reading' ? READING_SEGMENT : CONVERSE_SEGMENT)
    state = r.state
    spans.push(...r.spans)
    if (onsetAt === null && state.speechStart !== null && isOnset(state.voiced, mode)) onsetAt = state.pos / SAMPLE_RATE
  }
  return { spans, onsetAt }
}

describe('conversation vocale : découpage', () => {
  it('une phrase : 0,3 s gardées avant, fin après 1,2 s de silence', () => {
    const { spans, onsetAt } = listen(
      sound([
        [1, 0],
        [1, 0.2],
        [2, 0]
      ]),
      'listening'
    )
    expect(spans).toHaveLength(1)
    expect(spans[0].from / SAMPLE_RATE).toBeCloseTo(0.7, 1)
    expect(onsetAt).not.toBeNull()
    // La phrase est repérée vite (moins de 0,4 s après le début de la voix).
    expect(onsetAt!).toBeLessThan(1.4)
  })

  it('pendant la lecture, l’écho faible de la voix de Compi ne compte pas ; une vraie voix, si', () => {
    const echo = sound([
      [1, 0],
      [2, 0.025],
      [1, 0]
    ])
    expect(listen(echo, 'listening').onsetAt).not.toBeNull()
    expect(listen(echo, 'reading').onsetAt).toBeNull()
    const voice = sound([
      [1, 0],
      [1, 0.25],
      [2, 0]
    ])
    expect(listen(voice, 'reading').onsetAt).not.toBeNull()
  })

  it('un clic ou une toux brève ne suffisent pas pour une phrase', () => {
    const click = sound([
      [1, 0],
      [0.09, 0.4],
      [2, 0]
    ])
    expect(listen(click, 'listening').onsetAt).toBeNull()
    expect(listen(click, 'reading').onsetAt).toBeNull()
  })

  it('une longue phrase est rendue au bout de 30 s', () => {
    const { spans } = listen(
      sound([
        [0.5, 0],
        [32, 0.2]
      ]),
      'listening'
    )
    expect(spans.length).toBeGreaterThan(0)
    expect(spans[0].to - spans[0].from).toBeLessThanOrEqual(CONVERSE_SEGMENT.max)
  })
})
