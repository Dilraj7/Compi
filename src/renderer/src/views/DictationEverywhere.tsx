// Réglages « Dictée partout » : maintenir une touche dans n'importe quelle
// application, parler, relâcher, et le texte s'écrit à l'endroit du curseur.
// Désactivée par défaut. Le modèle de reconnaissance n'est téléchargé
// qu'après un clic, avec sa taille affichée ; on peut le supprimer.

import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { Download, Keyboard, Lock, Plus, Trash2, X } from 'lucide-react'
import { brainLabel, defaultBrain } from '@shared/brains'
import { DICTATION_KEYS, DICTATION_STYLES } from '@shared/dictation'
import { isOnline } from '@shared/privacy'
import { SPEECH_MODELS } from '@shared/speechModels'
import { sizeLabel } from '@shared/voice'
import type {
  DictationEngine,
  DictationKey,
  DictationSettings,
  DictationStyle,
  PublicSettings,
  Settings,
  SpeechModelId,
  SpeechModelStatus
} from '@shared/types'
import { Badge, Button, Row, Section, Segmented, TextArea, TextInput, Toggle, prettyShortcut } from '../components/ui'

type Props = { s: PublicSettings; update: (patch: Partial<Settings>) => void }

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

const ENGINES: Array<{ value: DictationEngine; label: string; hint: string }> = [
  { value: 'parakeet', label: 'Français · anglais', hint: SPEECH_MODELS.parakeet.hint },
  { value: 'omnilingual', label: 'தமிழ் · tamoul', hint: SPEECH_MODELS.omnilingual.hint },
  { value: 'whisper', label: 'Whisper', hint: 'Le modèle de « Me parler », en français. Plus lent.' }
]

export function DictationEverywhereSection({ s, update }: Props) {
  const d = s.dictation
  const set = (patch: Partial<DictationSettings>): void => update({ dictation: { ...d, ...patch } })
  const model: SpeechModelId | null = d.engine === 'whisper' ? null : d.engine
  const [status, setStatus] = useState<SpeechModelStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!model) return
    void window.compi.speechModelStatus(model).then(setStatus)
    return window.compi.onSpeechModelProgress((st) => st.model === model && setStatus(st))
  }, [model])

  const dl = status?.downloading
  const ready = model ? Boolean(status?.installed) : true
  const keyLabel = DICTATION_KEYS.find((k) => k.id === d.key)?.label ?? 'la touche'
  const brain = defaultBrain(s)
  const online = isOnline(brain.provider)

  const download = (): void => {
    if (!model) return
    setError('')
    window.compi.speechModelDownload(model).then(setStatus, (e: Error) => {
      setError(cleanError(e))
      void window.compi.speechModelStatus(model).then(setStatus)
    })
  }

  return (
    <Section
      title="Dictée partout"
      hint={`Dans n’importe quelle application : maintiens ${keyLabel}, parle, relâche. Le texte s’écrit là où est ton curseur. Ta voix reste sur ton PC.`}
    >
      <Row label="Langue de la dictée" hint={ENGINES.find((e) => e.value === d.engine)?.hint}>
        <Segmented<DictationEngine> id="dictation-engine" value={d.engine} options={ENGINES} onChange={(engine) => set({ engine })} />
      </Row>

      {model && !status?.installed && !dl && (
        <div className="space-y-2 px-3.5 py-3 [&+&]:border-t">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" onClick={download}>
              <Download size={14} /> Télécharger {SPEECH_MODELS[model].label} ({sizeLabel(SPEECH_MODELS[model].approxMb, true)})
            </Button>
            <span className="text-[11px] text-fog-500">{SPEECH_MODELS[model].langs}</span>
          </div>
          <div className="text-[11px] text-fog-500">
            Depuis Hugging Face, une seule fois ; chaque fichier est vérifié. {SPEECH_MODELS[model].license}. Tu pourras le supprimer ici.
          </div>
          {error && <div className="text-[11.5px] text-led-amber">{error}</div>}
        </div>
      )}

      {model && dl && (
        <div className="space-y-2 px-3.5 py-3">
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-fog-100">Téléchargement de {SPEECH_MODELS[model].label}…</span>
            <span className="text-fog-500 tabular-nums">
              {sizeLabel(dl.received)} sur {dl.total ? sizeLabel(dl.total) : '…'}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <motion.div
                className="h-full rounded-full bg-[var(--led)] shadow-[0_0_8px_var(--led)]"
                animate={{ width: `${dl.total ? (dl.received / dl.total) * 100 : 2}%` }}
                transition={{ ease: 'linear', duration: 0.2 }}
              />
            </div>
            <Button size="sm" variant="ghost" onClick={() => void window.compi.speechModelCancel()}>
              <X size={13} /> Annuler
            </Button>
          </div>
        </div>
      )}

      {model && status?.installed && (
        <Row
          label={
            <span className="inline-flex items-center gap-2">
              Modèle prêt <Badge color="#4ADE80">{SPEECH_MODELS[model].label}</Badge>
            </span>
          }
          hint={
            <span className="inline-flex items-center gap-1">
              <Lock size={10} /> {status.sizeBytes ? sizeLabel(status.sizeBytes) : ''} sur ton PC · {SPEECH_MODELS[model].license}
            </span>
          }
        >
          <Button size="sm" variant="ghost" onClick={() => void window.compi.speechModelDelete(model).then(setStatus)} title="Supprimer le modèle du PC">
            <Trash2 size={13} /> Supprimer
          </Button>
        </Row>
      )}

      <Row
        label="Activer la dictée partout"
        hint={
          !ready ? (
            'Télécharge d’abord le modèle ci-dessus.'
          ) : !d.enabled ? (
            'Désactivée : aucune touche n’est observée.'
          ) : s.dictationKeyActive ? (
            `${keyLabel} maintenu : je t’écoute. Deux appuis rapides : mains libres. Échap : annuler.`
          ) : (
            <span className="text-led-amber">
              {keyLabel} n’a pas pu être observé sur ce PC. La dictée vers Compi reste là :{' '}
              {s.voice.shortcut ? prettyShortcut(s.voice.shortcut) : 'le micro du chat'}.
            </span>
          )
        }
      >
        <Toggle label="Activer la dictée partout" checked={d.enabled} onChange={(enabled) => (ready || !enabled) && set({ enabled })} />
      </Row>

      {d.enabled && (
        <>
          <Row
            label={
              <span className="inline-flex items-center gap-1.5">
                <Keyboard size={13} className="text-fog-500" /> Touche à maintenir
              </span>
            }
            hint={DICTATION_KEYS.find((k) => k.id === d.key)?.warning ?? 'Seule cette touche est observée : tes autres frappes ne sont ni lues ni gardées.'}
          >
            <Segmented<DictationKey>
              id="dictation-key"
              value={d.key}
              options={DICTATION_KEYS.map((k) => ({ value: k.id, label: k.label }))}
              onChange={(key) => set({ key })}
            />
          </Row>
          <Row label="Style du texte" hint={DICTATION_STYLES.find((x) => x.id === d.style)?.hint}>
            <Segmented<DictationStyle>
              id="dictation-style"
              value={d.style}
              options={DICTATION_STYLES.map((x) => ({ value: x.id, label: x.label, hint: x.hint }))}
              onChange={(style) => set({ style })}
            />
          </Row>
          {(d.style === 'polished' || d.appStyles.some((r) => r.style === 'polished')) && online && (
            <Row
              label={`Soigné avec ${brainLabel(brain, s)}`}
              hint={
                d.polishOnline
                  ? 'Le texte dicté (jamais ta voix) part à ce service pour être remis au propre.'
                  : 'Ton cerveau est en ligne : sans ton accord, le style Soigné reste Naturel et rien ne part.'
              }
            >
              <Toggle label="Envoyer le texte dicté pour le style Soigné" checked={d.polishOnline} onChange={(polishOnline) => set({ polishOnline })} />
            </Row>
          )}
          <AppStyles d={d} set={set} />
          <Dictionary d={d} set={set} />
          <Row label="« Compi, … » s’adresse à moi" hint="Une dictée qui commence par « Compi » devient une demande (rappel, minuteur…) au lieu d’être écrite.">
            <Toggle label="« Compi, … » s’adresse à moi" checked={d.compiPrefix} onChange={(compiPrefix) => set({ compiPrefix })} />
          </Row>
        </>
      )}
    </Section>
  )
}

/** Un style par application, choisi par l'utilisateur (aucune règle au départ). */
function AppStyles({ d, set }: { d: DictationSettings; set: (p: Partial<DictationSettings>) => void }) {
  const [app, setApp] = useState('')
  const [style, setStyle] = useState<DictationStyle>('polished')
  const add = (): void => {
    const name = app.trim().replace(/\.exe$/i, '')
    if (!name) return
    set({ appStyles: [...d.appStyles.filter((r) => r.app.toLowerCase() !== name.toLowerCase()), { app: name, style }] })
    setApp('')
  }
  return (
    <div className="space-y-2 px-3.5 py-3 [&+&]:border-t [&+&]:border-white/[0.05]">
      <div className="text-[12.5px] text-fog-100">Style par application</div>
      <div className="text-[11.5px] leading-snug text-fog-500">
        Par exemple Soigné dans ta messagerie, Brut dans ton éditeur de code. Nom du programme, sans « .exe ».
      </div>
      {d.appStyles.map((r) => (
        <div key={r.app} className="flex items-center gap-2 text-[12px]">
          <span className="min-w-0 flex-1 truncate text-fog-100">{r.app}</span>
          <Badge>{DICTATION_STYLES.find((x) => x.id === r.style)?.label}</Badge>
          <Button size="sm" variant="ghost" title={`Retirer ${r.app}`} onClick={() => set({ appStyles: d.appStyles.filter((x) => x !== r) })}>
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <TextInput
          className="w-40"
          placeholder="outlook, teams, code…"
          value={app}
          onChange={(e) => setApp(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <Segmented<DictationStyle> id="app-style" value={style} options={DICTATION_STYLES.map((x) => ({ value: x.id, label: x.label }))} onChange={setStyle} />
        <Button size="sm" onClick={add} disabled={!app.trim()}>
          <Plus size={13} /> Ajouter
        </Button>
      </div>
    </div>
  )
}

/** Remplacements (noms, termes) et raccourcis vocaux (« ma signature » → texte complet). */
function Dictionary({ d, set }: { d: DictationSettings; set: (p: Partial<DictationSettings>) => void }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const add = (): void => {
    if (!from.trim() || !to.trim()) return
    set({ dictionary: [...d.dictionary.filter((r) => r.from.toLowerCase() !== from.trim().toLowerCase()), { from: from.trim(), to }] })
    setFrom('')
    setTo('')
  }
  return (
    <div className="space-y-2 px-3.5 py-3 [&+&]:border-t [&+&]:border-white/[0.05]">
      <div className="text-[12.5px] text-fog-100">Remplacements et raccourcis vocaux</div>
      <div className="text-[11.5px] leading-snug text-fog-500">Corrige un nom mal compris, ou dis « ma signature » pour écrire un texte entier.</div>
      {d.dictionary.map((r) => (
        <div key={r.from} className="flex items-start gap-2 text-[12px]">
          <span className="w-32 shrink-0 truncate text-fog-300">« {r.from} »</span>
          <span className="min-w-0 flex-1 truncate whitespace-pre-line text-fog-100">{r.to}</span>
          <Button size="sm" variant="ghost" title={`Retirer « ${r.from} »`} onClick={() => set({ dictionary: d.dictionary.filter((x) => x !== r) })}>
            <Trash2 size={12} />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-start gap-2">
        <TextInput className="w-36" placeholder="Ce que tu dis" value={from} onChange={(e) => setFrom(e.target.value)} />
        <TextArea className="min-h-8.5 flex-1" rows={1} placeholder="Ce qui s’écrit" value={to} onChange={(e) => setTo(e.target.value)} />
        <Button size="sm" onClick={add} disabled={!from.trim() || !to.trim()}>
          <Plus size={13} /> Ajouter
        </Button>
      </div>
    </div>
  )
}
