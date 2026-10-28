// Réglages de l'îlot (musique en cours, moniteur du PC, sons discrets) et de la
// lecture des réponses à voix haute (voix de Windows ou voix naturelle, rien ne
// quitte le PC).

import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import { Download, Lock, Play, Square, Trash2, Volume2, X } from 'lucide-react'
import { NATURAL_VOICES } from '@shared/naturalVoice'
import type { SoundKind } from '@shared/sounds'
import { SUPERTONIC_PACK } from '@shared/speechModels'
import { sizeLabel } from '@shared/voice'
import type { PublicSettings, Settings, SoundSettings, SoundVolume, SpeakEngine, SpeechModelStatus, VoiceInfo, VoiceSettings } from '@shared/types'
import { useCompi } from '../store'
import { playSound } from '../lib/sounds'
import { Badge, Button, Row, Section, Segmented, TimeInput, Toggle } from '../components/ui'

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

/** Îlot : musique en cours, moniteur du PC, sons discrets (Réglages › Îlot). */
export function IslandSection({ s, update }: Props) {
  return (
    <Section title="Îlot" hint="La musique et les sons passent par Windows : rien n’est envoyé en ligne.">
      <Row label="Musique en cours dans l’îlot" hint="Pochette et égaliseur dans l’îlot ; au survol : pause, suivant, précédent.">
        <Toggle checked={s.showMusic} onChange={(showMusic) => update({ showMusic })} label="Musique en cours dans l’îlot" />
      </Row>
      <div data-settings-focus="island" className="scroll-mt-2">
        <Row
          label="Moniteur du PC dans l’îlot"
          hint="Mini-jauges à côté de moi (processeur, mémoire, carte graphique, mémoire vidéo) ; les chiffres au survol."
        >
          <Toggle checked={s.monitor.island} onChange={(island) => update({ monitor: { ...s.monitor, island } })} label="Moniteur du PC dans l’îlot" />
        </Row>
        <Row
          label="Prévenir quand la mémoire est pleine"
          hint="Avec un modèle local chargé, je te préviens quand la mémoire du PC est presque pleine, et Ce PC dit quoi faire (au plus toutes les 2 h)."
        >
          <Toggle
            checked={s.monitor.memoryAlert}
            onChange={(memoryAlert) => update({ monitor: { ...s.monitor, memoryAlert } })}
            label="Prévenir quand la mémoire est pleine"
          />
        </Row>
      </div>
      <div data-settings-focus="sounds" className="scroll-mt-2">
        <SoundRows s={s} update={update} />
      </div>
    </Section>
  )
}

const SELECT =
  'h-8 max-w-48 rounded-lg bg-white/[0.05] px-2 text-[12px] text-fog-100 ring-1 ring-white/[0.08] outline-none ring-inset [color-scheme:dark] focus:ring-[var(--led)]/50'

const NATURAL_LICENSE_URL = 'https://huggingface.co/Supertone/supertonic-3/blob/main/LICENSE'

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Voix naturelle : téléchargée seulement sur un clic (taille et licence affichées, supprimable), puis une voix au choix. */
function NaturalVoiceRow({
  v,
  setVoice,
  status,
  setStatus,
  sample
}: {
  v: VoiceSettings
  setVoice: (patch: Partial<VoiceSettings>) => void
  status: SpeechModelStatus | null
  setStatus: (s: SpeechModelStatus) => void
  sample: ReactNode
}) {
  const [error, setError] = useState('')
  const dl = status?.downloading?.model === 'supertonic' ? status.downloading : undefined
  const download = (): void => {
    setError('')
    window.compi.speechModelDownload('supertonic').then(setStatus, (e: Error) => {
      setError(cleanError(e))
      void window.compi.speechModelStatus('supertonic').then(setStatus)
    })
  }
  const license = (
    <button className="underline decoration-white/20 underline-offset-2 hover:text-fog-300" onClick={() => void window.compi.openExternal(NATURAL_LICENSE_URL)}>
      licence OpenRAIL-M
    </button>
  )

  return (
    <>
      <Row
        label={<span className="inline-flex items-center gap-2">Voix naturelle {status?.installed && <Badge color="#4ADE80">prête</Badge>}</span>}
        hint={
          status?.installed ? (
            <span className="inline-flex items-center gap-1">
              <Lock size={10} /> {status.sizeBytes ? sizeLabel(status.sizeBytes) : ''} sur ton PC · Supertonic 3, {license}
            </span>
          ) : (
            <>
              Plus humaine, calculée sur ton PC. Supertonic 3 ({sizeLabel(SUPERTONIC_PACK.approxMb, true)}, depuis Hugging Face), {license} : usage responsable,
              pas d’imitation d’une vraie personne. En attendant, je lis avec la voix de Windows.
            </>
          )
        }
      >
        {status?.installed ? (
          <div className="flex items-center gap-2">
            <select aria-label="Voix naturelle" value={v.naturalVoice} onChange={(e) => setVoice({ naturalVoice: e.target.value })} className={SELECT}>
              {NATURAL_VOICES.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
            {sample}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void window.compi.speechModelDelete('supertonic').then(setStatus)}
              title="Supprimer la voix naturelle du PC"
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ) : dl ? (
          <div className="flex w-44 items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div
                className="h-full rounded-full bg-[var(--led)]"
                animate={{ width: `${dl.total ? (dl.received / dl.total) * 100 : 2}%` }}
                transition={{ ease: 'linear', duration: 0.2 }}
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => void window.compi.speechModelCancel()} title="Annuler">
              <X size={13} />
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="subtle" onClick={download} disabled={Boolean(status?.downloading)}>
            <Download size={13} /> Télécharger ({sizeLabel(SUPERTONIC_PACK.approxMb, true)})
          </Button>
        )}
      </Row>
      {error && <div className="px-3.5 pb-2 text-[11.5px] text-led-amber">{error}</div>}
    </>
  )
}

/** Lecture des réponses à voix haute (Réglages › Voix). */
export function SpeakSection({ s, update }: Props) {
  const v = s.voice
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null)
  const [voiceError, setVoiceError] = useState('')
  const [pack, setPack] = useState<SpeechModelStatus | null>(null)
  const speaking = useCompi((st) => st.speaking && st.speakingId === 'sample')
  const setVoice = (patch: Partial<VoiceSettings>): void => update({ voice: { ...v, ...patch } })
  const natural = v.engine === 'natural'

  useEffect(() => {
    window.compi.voices().then(setVoices, () => setVoiceError('Voix de Windows indisponibles.'))
    void window.compi.speechModelStatus('supertonic').then(setPack)
    return window.compi.onSpeechModelProgress((st) => st.model === 'supertonic' && setPack(st))
  }, [])

  const french = voices?.filter((x) => x.lang.toLowerCase().startsWith('fr')) ?? []
  const others = voices?.filter((x) => !x.lang.toLowerCase().startsWith('fr')) ?? []
  const rate = RATES.reduce((best, r) => (Math.abs(Number(r.value) - v.rate) < Math.abs(Number(best.value) - v.rate) ? r : best), RATES[1])
  // « Écouter » sur la voix qui lit vraiment : la naturelle une fois téléchargée, sinon celle de Windows.
  const sample = (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => (speaking ? useCompi.getState().stopSpeaking() : useCompi.getState().speak(SAMPLE, 'sample'))}
      title="Écouter un exemple"
    >
      {speaking ? <Square size={11} fill="currentColor" /> : <Volume2 size={13} />}
      {speaking ? 'Arrêter' : 'Écouter'}
    </Button>
  )

  return (
    <Section title="Lecture à voix haute" hint="Voix de Windows ou voix naturelle : tout se passe sur ton PC, rien n’est envoyé en ligne.">
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
      <Row label="Type de voix" hint={natural ? 'Le tamoul reste lu par la voix de Windows.' : 'Les voix installées dans Windows.'}>
        <Segmented<SpeakEngine>
          id="voice-engine"
          value={v.engine}
          options={[
            { value: 'windows', label: 'Windows' },
            { value: 'natural', label: 'Naturelle' }
          ]}
          onChange={(engine) => setVoice({ engine })}
        />
      </Row>
      {natural && <NaturalVoiceRow v={v} setVoice={setVoice} status={pack} setStatus={setPack} sample={sample} />}
      <Row
        label={natural ? 'Voix de Windows' : 'Voix'}
        hint={
          voiceError ||
          (voices && !french.length
            ? 'Aucune voix française : ajoute-en une dans Paramètres › Heure et langue › Voix.'
            : natural
              ? 'Pour le tamoul, et en secours si la voix naturelle ne peut pas lire.'
              : undefined)
        }
      >
        <div className="flex items-center gap-2">
          <select aria-label="Voix" value={v.voice} onChange={(e) => setVoice({ voice: e.target.value })} className={SELECT}>
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
          {!(natural && pack?.installed) && sample}
        </div>
      </Row>
      <Row label="Vitesse">
        <Segmented<string> id="voice-rate" value={rate.value} options={RATES} onChange={(r) => setVoice({ rate: Number(r) })} />
      </Row>
      <div data-settings-focus="converse" className="scroll-mt-2">
        <Row
          label="Conversation vocale"
          hint={
            v.speak === 'never'
              ? 'Après une question posée à la voix, je t’écoute à la fin de ma réponse. L’activer lit aussi mes réponses « Quand je parle ».'
              : 'Après une question posée à la voix, je t’écoute 6 s à la fin de ma réponse : tu continues sans touche. Échap ou « Arrêter » pour finir.'
          }
        >
          <Toggle
            checked={v.conversation && v.speak !== 'never'}
            onChange={(conversation) => setVoice(conversation && v.speak === 'never' ? { conversation, speak: 'voice' } : { conversation })}
            label="Conversation vocale"
          />
        </Row>
        {v.conversation && v.speak !== 'never' && (
          <Row
            label="Couper ma lecture en parlant"
            hint="Le micro reste ouvert pendant que je lis. Avec des haut-parleurs, je peux m’entendre moi-même : un casque marche mieux."
          >
            <Toggle checked={v.bargeIn} onChange={(bargeIn) => setVoice({ bargeIn })} label="Couper ma lecture en parlant" />
          </Row>
        )}
      </div>
    </Section>
  )
}
