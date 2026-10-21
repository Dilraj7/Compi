// Réglages « Îlot et voix » : musique en cours dans l'îlot, lecture des
// réponses à voix haute (voix de Windows, rien ne quitte le PC).

import { useEffect, useState } from 'react'
import { Play, Square, Volume2 } from 'lucide-react'
import type { SoundKind } from '@shared/sounds'
import type { PublicSettings, Settings, SoundSettings, SoundVolume, VoiceInfo, VoiceSettings } from '@shared/types'
import { useCompi } from '../store'
import { playSound } from '../lib/sounds'
import { Button, Row, Section, Segmented, TimeInput, Toggle } from '../components/ui'

type Props = { s: PublicSettings; update: (patch: Partial<Settings>) => void }

const SAMPLE = 'Bonjour ! Je suis Compi. Voici ma voix pour lire mes réponses.'

const RATES = [
  { value: '0.85', label: 'Calme' },
  { value: '1', label: 'Normale' },
  { value: '1.2', label: 'Rapide' }
]

const SOUND_ROWS: Array<{ key: 'approvals' | 'reminders' | 'messages' | 'routines'; kind: SoundKind; label: string; hint: string }> = [
  { key: 'approvals', kind: 'attention', label: 'Autorisations et questions', hint: 'Une carte attend ta réponse.' },
  { key: 'reminders', kind: 'reminder', label: 'Rappels', hint: 'Rappels, minuteur, réunions, résumé du matin.' },
  { key: 'messages', kind: 'message', label: 'Messages en attente', hint: 'Le rappel d’un message resté sans réponse.' },
  { key: 'routines', kind: 'done', label: 'Tâches terminées', hint: 'Une routine ou une session Claude Code a fini.' }
]

/** Sons discrets : créés par Compi, muets la nuit, en réunion, en pomodoro et en plein écran. */
function SoundRows({ s, update }: Props) {
  const snd = s.sounds
  const set = (patch: Partial<SoundSettings>): void => update({ sounds: { ...snd, ...patch } })
  return (
    <>
      <Row label="Sons discrets" hint="Muets la nuit, en réunion, pendant un pomodoro et quand une application est en plein écran.">
        <Toggle checked={snd.enabled} onChange={(enabled) => set({ enabled })} label="Sons discrets" />
      </Row>
      {snd.enabled && (
        <>
          <Row label="Volume">
            <Segmented<SoundVolume>
              id="sound-volume"
              value={snd.volume}
              options={[
                { value: 'very-low', label: 'Très bas' },
                { value: 'low', label: 'Bas' },
                { value: 'medium', label: 'Moyen' }
              ]}
              onChange={(volume) => {
                set({ volume })
                playSound('reminder', volume)
              }}
            />
          </Row>
          {SOUND_ROWS.map((r) => (
            <Row key={r.key} label={r.label} hint={r.hint}>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => playSound(r.kind, snd.volume)} title="Écouter ce son">
                  <Play size={11} /> Écouter
                </Button>
                <Toggle checked={snd[r.key]} onChange={(on) => set({ [r.key]: on })} label={r.label} />
              </div>
            </Row>
          ))}
          <Row label="Heures calmes" hint="Aucun son entre ces heures (la même heure deux fois : jamais calme).">
            <div className="flex items-center gap-1.5 text-[12px] text-fog-500">
              <TimeInput label="Début des heures calmes" value={snd.quietStart} onChange={(quietStart) => set({ quietStart })} />
              →
              <TimeInput label="Fin des heures calmes" value={snd.quietEnd} onChange={(quietEnd) => set({ quietEnd })} />
            </div>
          </Row>
        </>
      )}
    </>
  )
}

export function LiveSection({ s, update }: Props) {
  const v = s.voice
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null)
  const [voiceError, setVoiceError] = useState('')
  const speaking = useCompi((st) => st.speaking && st.speakingId === 'sample')
  const setVoice = (patch: Partial<VoiceSettings>): void => update({ voice: { ...v, ...patch } })

  useEffect(() => {
    window.compi.voices().then(setVoices, () => setVoiceError('Voix de Windows indisponibles.'))
  }, [])

  const french = voices?.filter((x) => x.lang.toLowerCase().startsWith('fr')) ?? []
  const others = voices?.filter((x) => !x.lang.toLowerCase().startsWith('fr')) ?? []
  const rate = RATES.reduce((best, r) => (Math.abs(Number(r.value) - v.rate) < Math.abs(Number(best.value) - v.rate) ? r : best), RATES[1])

  return (
    <Section title="Îlot et voix" hint="La musique et la voix passent par Windows : rien n’est envoyé en ligne.">
      <Row label="Musique en cours dans l’îlot" hint="Pochette et égaliseur dans l’îlot ; au survol : pause, suivant, précédent.">
        <Toggle checked={s.showMusic} onChange={(showMusic) => update({ showMusic })} label="Musique en cours dans l’îlot" />
      </Row>
      <div data-settings-focus="island" className="scroll-mt-2">
        <Row
          label="Moniteur du PC dans l’îlot"
          hint="Mini-jauges à côté de moi (processeur, mémoire, carte graphique, mémoire vidéo) ; les chiffres au survol."
        >
          <Toggle checked={s.monitor.island} onChange={(island) => update({ monitor: { island } })} label="Moniteur du PC dans l’îlot" />
        </Row>
      </div>
      <div data-settings-focus="sounds" className="scroll-mt-2">
        <SoundRows s={s} update={update} />
      </div>
      <Row label="Lire mes réponses à voix haute" hint="« Quand je parle » : après une question posée à la voix. Le bouton « Écouter » marche toujours.">
        <Segmented<VoiceSettings['speak']>
          id="voice-speak"
          value={v.speak}
          options={[
            { value: 'never', label: 'Jamais' },
            { value: 'voice', label: 'Quand je parle' },
            { value: 'always', label: 'Toujours' }
          ]}
          onChange={(speak) => setVoice({ speak })}
        />
      </Row>
      <Row
        label="Voix"
        hint={voiceError || (voices && !french.length ? 'Aucune voix française : ajoute-en une dans Paramètres › Heure et langue › Voix.' : undefined)}
      >
        <div className="flex items-center gap-2">
          <select
            aria-label="Voix"
            value={v.voice}
            onChange={(e) => setVoice({ voice: e.target.value })}
            className="h-8 max-w-48 rounded-lg bg-white/[0.05] px-2 text-[12px] text-fog-100 ring-1 ring-white/[0.08] outline-none ring-inset [color-scheme:dark] focus:ring-[var(--led)]/50"
          >
            <option value="">Automatique (française)</option>
            {french.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label="Autres langues">
                {others.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.lang})
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (speaking ? useCompi.getState().stopSpeaking() : useCompi.getState().speak(SAMPLE, 'sample'))}
            title="Écouter un exemple"
          >
            {speaking ? <Square size={11} fill="currentColor" /> : <Volume2 size={13} />}
            {speaking ? 'Arrêter' : 'Écouter'}
          </Button>
        </div>
      </Row>
      <Row label="Vitesse">
        <Segmented<string> id="voice-rate" value={rate.value} options={RATES} onChange={(r) => setVoice({ rate: Number(r) })} />
      </Row>
    </Section>
  )
}
