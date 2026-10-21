// « Aide-moi à choisir » : quatre questions, une à la fois, pour que Compi
// conseille le cerveau et le modèle les plus adaptés (le matériel est détecté
// tout seul, on ne le demande jamais).

import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, Brain, Code2, FileText, Gem, Globe, Image as ImageIcon, Languages, Lock, PenLine, Scale, Sparkles, Zap } from 'lucide-react'
import type { BrainQuizAnswers, BrainRecommendation, QuizUse } from '@shared/types'
import { Button, cx } from '../components/ui'

const DEFAULTS: BrainQuizAnswers = { priority: 'both', uses: ['write', 'docs'], language: 'fr', pace: 'fast' }

interface Choice<T> {
  value: T
  label: string
  hint: string
  icon: ReactNode
}

const PRIORITIES: Choice<BrainQuizAnswers['priority']>[] = [
  { value: 'privacy', label: 'Que tout reste sur mon PC', hint: 'Privé et gratuit, rien ne part sur Internet.', icon: <Lock size={16} /> },
  { value: 'quality', label: 'La meilleure qualité', hint: 'Les réponses les plus intelligentes, payant à l’usage.', icon: <Sparkles size={16} /> },
  { value: 'both', label: 'Les deux', hint: 'Local d’abord, Claude seulement si besoin et avec mon accord.', icon: <Scale size={16} /> }
]

const USES: Choice<QuizUse>[] = [
  { value: 'write', label: 'Écrire et discuter', hint: 'E-mails, textes, idées', icon: <PenLine size={16} /> },
  { value: 'docs', label: 'Comprendre des documents', hint: 'PDF, Excel, Word', icon: <FileText size={16} /> },
  { value: 'images', label: 'Regarder des images', hint: 'Photos, scans, mon écran', icon: <ImageIcon size={16} /> },
  { value: 'reason', label: 'Raisonner', hint: 'Calculs, analyses, planning', icon: <Brain size={16} /> },
  { value: 'code', label: 'Coder', hint: 'Scripts, formules, programmes', icon: <Code2 size={16} /> }
]

const LANGUAGES: Choice<BrainQuizAnswers['language']>[] = [
  { value: 'fr', label: 'Français', hint: 'Surtout en français', icon: <span className="text-[12px] font-bold">FR</span> },
  { value: 'en', label: 'Anglais', hint: 'Surtout en anglais', icon: <span className="text-[12px] font-bold">EN</span> },
  { value: 'multi', label: 'Plusieurs langues', hint: 'Je jongle entre les langues', icon: <Languages size={16} /> }
]

const PACES: Choice<BrainQuizAnswers['pace']>[] = [
  { value: 'fast', label: 'Des réponses rapides', hint: 'Je veux que ça fuse.', icon: <Zap size={16} /> },
  { value: 'careful', label: 'Des réponses soignées', hint: 'Je peux attendre quelques secondes de plus.', icon: <Gem size={16} /> }
]

function ChoiceCard<T>({ c, selected, onClick }: { c: Choice<T>; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left ring-1 ring-inset transition-all hover:-translate-y-px',
        selected ? 'bg-[var(--led)]/10 ring-[var(--led)]/45' : 'bg-white/[0.04] ring-white/[0.06] hover:bg-white/[0.07]'
      )}
    >
      <span className={cx('grid size-8 shrink-0 place-items-center rounded-xl', selected ? 'bg-[var(--led)]/15 text-[var(--led)]' : 'bg-white/[0.05] text-fog-500')}>{c.icon}</span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-fog-100">{c.label}</span>
        <span className="block text-[11.5px] leading-snug text-fog-500">{c.hint}</span>
      </span>
    </button>
  )
}

export function BrainQuiz({ initial, onResult, onCancel }: { initial?: BrainQuizAnswers; onResult: (rec: BrainRecommendation) => void; onCancel: () => void }) {
  const [step, setStep] = useState(0)
  const [a, setA] = useState<BrainQuizAnswers>(initial ?? DEFAULTS)
  const [busy, setBusy] = useState(false)

  const finish = (answers: BrainQuizAnswers): void => {
    setBusy(true)
    void window.compi.recommendBrain(answers).then(onResult, () => setBusy(false))
  }
  const next = (patch: Partial<BrainQuizAnswers>): void => {
    const answers = { ...a, ...patch }
    setA(answers)
    if (step === 3) finish(answers)
    else setStep(step + 1)
  }

  const titles = ['Qu’est-ce qui compte le plus pour toi ?', 'Tu vas surtout me demander…', 'Dans quelle langue ?', 'Tu préfères…']

  return (
    <div className="rounded-2xl bg-ink-850/80 p-3.5 ring-1 ring-inset ring-white/[0.06]">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => (step ? setStep(step - 1) : onCancel())}
          className="inline-flex items-center gap-1 text-[11.5px] text-fog-500 hover:text-fog-100"
        >
          <ArrowLeft size={12} /> {step ? 'Retour' : 'Annuler'}
        </button>
        <div className="flex gap-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cx('h-1 rounded-full transition-all', i === step ? 'w-5 bg-[var(--led)]' : i < step ? 'w-2 bg-[var(--led)]/50' : 'w-2 bg-white/[0.1]')} />
          ))}
        </div>
        <button onClick={() => (step === 3 ? finish(a) : setStep(step + 1))} className="text-[11.5px] text-fog-500 hover:text-fog-100">
          Passer
        </button>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step} initial={{ opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -14 }} transition={{ duration: 0.18 }}>
          <div className="mb-2.5 flex items-center gap-2 text-[13.5px] font-semibold text-fog-100">
            {step === 2 ? <Globe size={14} className="text-[var(--led)]" /> : null}
            {titles[step]}
          </div>
          <div className="space-y-1.5">
            {step === 0 && PRIORITIES.map((c) => <ChoiceCard key={c.value} c={c} selected={a.priority === c.value} onClick={() => next({ priority: c.value })} />)}
            {step === 1 && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {USES.map((c) => (
                    <ChoiceCard
                      key={c.value}
                      c={c}
                      selected={a.uses.includes(c.value)}
                      onClick={() => setA({ ...a, uses: a.uses.includes(c.value) ? a.uses.filter((u) => u !== c.value) : [...a.uses, c.value] })}
                    />
                  ))}
                </div>
                <div className="flex items-center justify-between pt-1.5">
                  <span className="text-[11.5px] text-fog-700">Plusieurs réponses possibles</span>
                  <Button size="sm" variant="primary" onClick={() => next({})}>
                    Continuer
                  </Button>
                </div>
              </>
            )}
            {step === 2 && LANGUAGES.map((c) => <ChoiceCard key={c.value} c={c} selected={a.language === c.value} onClick={() => next({ language: c.value })} />)}
            {step === 3 && PACES.map((c) => <ChoiceCard key={c.value} c={c} selected={a.pace === c.value} onClick={() => next({ pace: c.value })} />)}
          </div>
        </motion.div>
      </AnimatePresence>
      {busy && <div className="mt-2.5 text-center text-[11.5px] text-fog-500">Je regarde ce qui te conviendrait le mieux…</div>}
    </div>
  )
}
