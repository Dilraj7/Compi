// Lecture à voix haute : chaque morceau est dit par une voix de Windows
// (fichier WAV préparé par le processus principal), et le morceau suivant se
// prépare pendant que le précédent est lu. Un seul texte à la fois ; stop()
// coupe tout de suite. Une réponse en cours d'écriture se lit au fil de l'eau :
// chaque phrase terminée rejoint la file (speakStream).

import { capSpeech, cleanSpeech, SPEECH_CHUNK, SPEECH_MAX, speakableEnd, speechChunks, speechText } from '@shared/speech'

type Listener = (speaking: boolean) => void

let session = 0
let current: { audio: HTMLAudioElement; finish: () => void } | null = null
let listener: Listener = () => undefined
/** Lecture au fil de l'eau en attente de la suite : à réveiller si on l'arrête. */
let wakeStream: (() => void) | null = null

export function onSpeaking(cb: Listener): void {
  listener = cb
}

function play(wav: Uint8Array): Promise<void> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([wav as BlobPart], { type: 'audio/wav' }))
    const audio = new Audio(url)
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      URL.revokeObjectURL(url)
      if (current?.audio === audio) current = null
      resolve()
    }
    current = { audio, finish }
    audio.onended = finish
    audio.onerror = finish
    audio.play().catch(finish)
  })
}

const fetchChunk = (text: string): Promise<Uint8Array | null> => window.compi.speak(text).catch(() => null)

/** Lit un texte (Markdown accepté) ; remplace la lecture en cours. */
export async function speak(markdown: string): Promise<void> {
  stopSpeaking()
  const chunks = speechChunks(speechText(markdown))
  if (!chunks.length) return
  const mine = ++session
  listener(true)
  let next = fetchChunk(chunks[0])
  for (let i = 0; i < chunks.length; i++) {
    const wav = await next
    if (mine !== session) return
    if (!wav?.length) break
    if (i + 1 < chunks.length) next = fetchChunk(chunks[i + 1])
    await play(wav)
    if (mine !== session) return
  }
  if (mine === session) listener(false)
}

/** Lecture d'une réponse pendant qu'elle s'écrit. */
export interface SpeechStream {
  /** Texte de la réponse jusqu'ici (Markdown) : les phrases terminées partent à la voix. */
  push(markdown: string): void
  /** Réponse terminée : le reste est lu. Sans texte (erreur), on finit seulement ce qui est en file. */
  end(markdown?: string): void
}

/** Démarre une lecture au fil de l'eau ; remplace la lecture en cours. */
export function speakStream(): SpeechStream {
  stopSpeaking()
  const mine = ++session
  // Un morceau se prépare (synthèse) une seule fois ; tant qu'il ne l'est pas, la suite peut s'y ajouter.
  const queue: Array<{ text: string; wav?: Promise<Uint8Array | null> }> = []
  let consumed = 0
  let spoken = 0
  let playing = -1
  let finished = false
  let running = false

  const notify = (): void => {
    const wake = wakeStream
    wakeStream = null
    wake?.()
  }

  const enqueue = (markdown: string): void => {
    if (mine !== session || spoken >= SPEECH_MAX) return
    let text = cleanSpeech(markdown)
    if (!text) return
    if (spoken + text.length > SPEECH_MAX) text = capSpeech(text, SPEECH_MAX - spoken)
    spoken += text.length
    // Le tout premier morceau est court : la voix démarre pendant que la suite se prépare.
    const chunks = speechChunks(text, SPEECH_CHUNK, queue.length ? SPEECH_CHUNK : 160)
    for (const chunk of chunks) {
      const last = queue.at(-1)
      if (last && !last.wav && queue.length > 1 && last.text.length + 1 + chunk.length <= SPEECH_CHUNK) last.text = `${last.text} ${chunk}`
      else queue.push({ text: chunk })
    }
    // Le morceau qui suit celui en cours se prépare tout de suite.
    const next = queue[playing + 1]
    if (playing >= 0 && next && !next.wav) next.wav = fetchChunk(next.text)
    if (!running) void run()
    notify()
  }

  const run = async (): Promise<void> => {
    running = true
    listener(true)
    let i = 0
    while (mine === session) {
      if (i >= queue.length) {
        if (finished) break
        await new Promise<void>((resolve) => (wakeStream = resolve))
        continue
      }
      const item = queue[i]
      item.wav ??= fetchChunk(item.text)
      const wav = await item.wav
      if (mine !== session) return
      if (!wav?.length) break
      playing = i
      const next = queue[i + 1]
      if (next) next.wav ??= fetchChunk(next.text)
      await play(wav)
      playing = -1
      i++
    }
    if (mine === session) listener(false)
  }

  return {
    push(markdown) {
      if (mine !== session || finished) return
      const end = speakableEnd(markdown, consumed)
      if (end <= consumed) return
      const part = markdown.slice(consumed, end)
      consumed = end
      enqueue(part)
    },
    end(markdown) {
      if (mine !== session || finished) return
      if (markdown !== undefined && markdown.length > consumed) {
        const rest = markdown.slice(consumed)
        consumed = markdown.length
        enqueue(rest)
      }
      finished = true
      // Rien n'a été lu (réponse vide ou arrêtée) : la lecture se termine tout de suite.
      if (!running) {
        if (queue.length) void run()
      } else notify()
    }
  }
}

export function stopSpeaking(): void {
  session++
  if (current) {
    current.audio.pause()
    current.finish()
  }
  // Une lecture au fil de l'eau en attente de texte se termine.
  const wake = wakeStream
  wakeStream = null
  wake?.()
  listener(false)
}
