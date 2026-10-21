// Réglages « Me parler » : la dictée avec Whisper, sur le PC. Le modèle n'est
// téléchargé qu'après un clic explicite, avec sa taille affichée ; on peut
// annuler, puis le supprimer.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Cpu, Download, Lock, Mic, Trash2, X, Zap } from 'lucide-react'
import { sizeLabel, VOICE_MODELS } from '@shared/voice'
import type { PublicSettings, Settings, VoiceModelId, VoiceModelStatus, VoiceVariant } from '@shared/types'
import { useCompi } from '../store'
import { detectVariant, unloadModel } from '../lib/voice'
import { Badge, Button, Row, Section, Segmented, ShortcutInput, prettyShortcut } from '../components/ui'

type Props = { s: PublicSettings; update: (patch: Partial<Settings>) => void }

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function DictationSection({ s, update }: Props) {
  const v = s.voice
  const [status, setStatus] = useState<VoiceModelStatus | null>(null)
  const [variant, setVariant] = useState<VoiceVariant | null>(null)
  const [error, setError] = useState('')
  const focus = useCompi((st) => st.settingsFocus)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void detectVariant().then(setVariant)
    const off = window.compi.onVoiceModelProgress((st) => st.model === v.model && setStatus(st))
    return off
  }, [v.model])

  useEffect(() => {
    void window.compi.voiceModelStatus(v.model).then(setStatus)
  }, [v.model])

  // Arrivée depuis le raccourci alors que la dictée n'est pas installée.
  useEffect(() => {
    if (focus !== 'voice') return
    setTimeout(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250)
    useCompi.getState().focusSettings(null)
  }, [focus])

  const dl = status?.downloading
  const installed = status?.installed
  const chosen = installed && status?.variant ? status.variant : variant ?? 'gpu'
  const def = VOICE_MODELS[v.model]
  const approx = def.variants[chosen].approxMb

  const download = (): void => {
    setError('')
    window.compi.voiceModelDownload(v.model, chosen).then(setStatus, (e: Error) => {
      setError(cleanError(e))
      void window.compi.voiceModelStatus(v.model).then(setStatus)
    })
  }
  const remove = (): void => {
    unloadModel()
    void window.compi.voiceModelDelete(v.model).then(setStatus)
  }

  return (
    <div ref={ref} className="scroll-mt-2">
      <Section title="Me parler" hint="Ta voix est transcrite sur ton PC : elle n’est jamais envoyée, seul le texte part à Compi.">
        {!installed && !dl && (
          <div className="space-y-3 px-3.5 py-3.5">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--led)]/10 text-[var(--led)]">
                <Mic size={17} />
              </span>
              <div className="min-w-0 text-[12.5px] leading-snug text-fog-300">
                Maintiens <b className="text-fog-100">{prettyShortcut(v.shortcut || 'Alt+Shift+V')}</b>, parle, puis relâche : Compi écrit ce que tu dis et te répond. Il faut d’abord
                télécharger le modèle de reconnaissance vocale (Whisper), une seule fois.
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<VoiceModelId>
                id="voice-model"
                value={v.model}
                options={(Object.keys(VOICE_MODELS) as VoiceModelId[]).map((id) => ({
                  value: id,
                  label: `${VOICE_MODELS[id].label} · ${sizeLabel(VOICE_MODELS[id].variants[chosen].approxMb, true)}`,
                  hint: VOICE_MODELS[id].hint
                }))}
                onChange={(model) => update({ voice: { ...v, model } })}
              />
              <Button variant="primary" onClick={download} disabled={!variant}>
                <Download size={14} /> Télécharger ({sizeLabel(approx, true)})
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fog-500">
              <span className="inline-flex items-center gap-1">
                {chosen === 'gpu' ? <Zap size={11} /> : <Cpu size={11} />}
                {variant ? (chosen === 'gpu' ? 'Sur ta carte graphique : rapide' : 'Sur ton processeur (pas de carte graphique compatible)') : 'Détection de ta carte graphique…'}
              </span>
              <span>{def.hint}</span>
              <span>Depuis Hugging Face ; tu pourras le supprimer ici.</span>
            </div>
            {error && <div className="text-[11.5px] text-led-amber">{error}</div>}
          </div>
        )}

        {dl && (
          <div className="space-y-2 px-3.5 py-3.5">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-fog-100">Téléchargement de la dictée…</span>
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
              <Button size="sm" variant="ghost" onClick={() => void window.compi.voiceModelCancel()}>
                <X size={13} /> Annuler
              </Button>
            </div>
            <div className="text-[11px] text-fog-500">Chaque fichier est vérifié avant d’être utilisé.</div>
          </div>
        )}

        {installed && (
          <>
            <Row
              label={
                <span className="inline-flex items-center gap-2">
                  Dictée prête <Badge color="#4ADE80">{def.label}</Badge>
                </span>
              }
              hint={
                <span className="inline-flex items-center gap-1">
                  <Lock size={10} /> {status?.sizeBytes ? sizeLabel(status.sizeBytes) : ''} sur ton PC · {status?.variant === 'gpu' ? 'carte graphique' : 'processeur'}
                </span>
              }
            >
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => void useCompi.getState().startDictation()}>
                  <Mic size={13} /> Essayer
                </Button>
                <Button size="sm" variant="ghost" onClick={remove} title="Supprimer le modèle du PC">
                  <Trash2 size={13} /> Supprimer
                </Button>
              </div>
            </Row>
            <Row
              label="Raccourci de la dictée"
              hint={
                s.voiceShortcutActive ? (
                  'Maintiens-le en parlant, ou appuie une fois : je m’arrête quand tu fais une pause.'
                ) : (
                  <span className="text-led-amber">Inactif : combinaison déjà utilisée. Choisis-en une autre.</span>
                )
              }
            >
              <ShortcutInput value={v.shortcut} onChange={(shortcut) => update({ voice: { ...v, shortcut } })} />
            </Row>
          </>
        )}
        {installed && error && <div className="px-3.5 pb-3 text-[11.5px] text-led-amber">{error}</div>}
      </Section>
    </div>
  )
}
