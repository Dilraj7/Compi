// Capture d'un appel enregistré : le micro et, en secours seulement, le son de
// l'ordinateur (d'ordinaire capté par Windows, côté Compi). Pistes en 16 kHz,
// envoyées à Compi par morceaux de 0,25 s. L'image de l'écran, que Chromium
// exige pour donner le son de l'ordinateur, est arrêtée aussitôt, jamais lue.

// Fichier à part (jamais en data: dans le code) : la politique de sécurité de la page n'accepte que ses propres fichiers.
import tapUrl from './pcmTap.worklet.js?url&no-inline'
import type { MeetingTrack } from '@shared/types'

export interface CallCapture {
  /** Le son de l'appel a bien été obtenu (sinon : le micro seul). */
  others: boolean
  /** Niveau récent d'une piste, de 0 à 1. */
  level(track: MeetingTrack): number
  stop(): void
}

/** Son de l'ordinateur ; `null` s'il est refusé ou indisponible (on garde le micro). */
async function systemAudio(): Promise<MediaStream | null> {
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    for (const t of s.getVideoTracks()) {
      t.stop()
      s.removeTrack(t)
    }
    if (s.getAudioTracks().length) return s
    for (const t of s.getTracks()) t.stop()
    return null
  } catch {
    return null
  }
}

export async function startCallCapture(id: string, wantOthers: boolean, onEnded: (message: string) => void): Promise<CallCapture> {
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const sys = wantOthers ? await systemAudio() : null
  const streams = [mic, ...(sys ? [sys] : [])]
  const stopTracks = (): void => streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
  const ctx = new AudioContext({ sampleRate: 16_000 })
  try {
    await ctx.audioWorklet.addModule(tapUrl)
    await ctx.resume()
  } catch (e) {
    stopTracks()
    void ctx.close()
    throw e
  }
  const levels: Record<MeetingTrack, number> = { me: 0, others: 0 }
  // Le processeur doit être relié à la sortie pour tourner : un volume à zéro, rien n'est joué.
  const mute = ctx.createGain()
  mute.gain.value = 0
  mute.connect(ctx.destination)
  const nodes: AudioNode[] = []
  const tap = (stream: MediaStream, track: MeetingTrack): void => {
    const node = new AudioWorkletNode(ctx, 'pcm-tap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const f = e.data
      const pcm = new Int16Array(f.length)
      let sum = 0
      for (let i = 0; i < f.length; i++) {
        const v = Math.max(-1, Math.min(1, f[i]))
        pcm[i] = v < 0 ? v * 32768 : v * 32767
        sum += v * v
      }
      levels[track] = Math.min(1, Math.sqrt(sum / f.length) * 4)
      window.compi.meetingAudio(id, track, pcm)
    }
    const source = ctx.createMediaStreamSource(stream)
    source.connect(node)
    node.connect(mute)
    nodes.push(source, node)
  }
  // Les deux pistes démarrent au même instant : elles restent alignées.
  tap(mic, 'me')
  if (sys) tap(sys, 'others')
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    nodes.forEach((n) => n.disconnect())
    stopTracks()
    void ctx.close()
  }
  for (const t of mic.getAudioTracks()) t.addEventListener('ended', () => !stopped && onEnded('Le micro a été coupé : enregistrement arrêté.'))
  for (const t of sys?.getAudioTracks() ?? [])
    t.addEventListener('ended', () => !stopped && onEnded('Le son de l’ordinateur a été coupé : enregistrement arrêté.'))
  return { others: Boolean(sys), level: (t) => levels[t], stop }
}
