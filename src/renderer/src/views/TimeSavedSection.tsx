// « Temps gagné » (Activité) : ce que la dictée partout t'a fait gagner, calculé
// et gardé sur le PC. La formule est affichée ; la vitesse de frappe vaut 40
// mots par minute, ou celle mesurée par un petit test de 30 secondes.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Gauge, Trash2 } from 'lucide-react'
import { summarizeDictation } from '@shared/dictation'
import type { DictationStatRow } from '@shared/types'
import { useCompi } from '../store'
import { Button, TextArea } from '../components/ui'

const COLOR = '#4ADE80'

const minutesLabel = (m: number): string => {
  if (m < 1) return m > 0 ? '< 1 min' : '0 min'
  if (m < 60) return `${Math.round(m)} min`
  const h = Math.floor(m / 60)
  const rest = Math.round(m % 60)
  return rest ? `${h} h ${String(rest).padStart(2, '0')}` : `${h} h`
}

const dayLabel = (day: string): string => new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div
        className="truncate text-[17px] leading-tight font-semibold tabular-nums text-fog-100"
        style={color ? { color, textShadow: `0 0 14px ${color}55` } : undefined}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[11px] text-fog-500">{label}</div>
    </div>
  )
}

export function TimeSavedSection() {
  const settings = useCompi((s) => s.settings)
  const [rows, setRows] = useState<DictationStatRow[] | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    void window.compi.dictationStats().then(setRows)
    return window.compi.onDictationStats(setRows)
  }, [])

  const wpm = settings?.dictation.typingWpm ?? 40
  const summary = useMemo(() => (rows ? summarizeDictation(rows, wpm, Date.now()) : null), [rows, wpm])

  // Rien à montrer tant que la dictée partout n'a jamais servi ni été activée.
  if (!settings || !summary || (!summary.dictations && !settings.dictation.enabled)) return null

  const setWpm = (typingWpm: number): void => void window.compi.updateSettings({ dictation: { ...settings.dictation, typingWpm } })
  const maxDay = Math.max(1, ...summary.days.map((d) => d.words))
  const topApp = summary.apps[0]?.words ?? 1
  const ROWS = 7

  return (
    <section className="space-y-2.5">
      <h3 className="led-text px-0.5 text-[11px] text-fog-500">Temps gagné · 30 jours</h3>
      <div className="space-y-3 rounded-2xl bg-ink-850/80 p-3.5 ring-1 ring-inset ring-white/[0.06]">
        {!summary.dictations ? (
          <div className="py-2 text-center text-[12px] text-fog-500">Pas encore de dictée. Maintiens la touche dans une application, parle, relâche.</div>
        ) : (
          <>
            <div className="flex items-start gap-3">
              <Stat value={minutesLabel(summary.minutesSaved)} label="gagnées" color={COLOR} />
              <Stat value={summary.words.toLocaleString('fr-FR')} label="mots dictés" />
              <Stat value={`${summary.wpm}`} label="mots/min à l’oral" />
              <Stat value={`${summary.streak} j`} label="de suite" />
            </div>
            <div className="flex h-[58px] items-end gap-[3px]">
              {summary.days.map((d) => {
                const lit = d.words ? Math.max(1, Math.ceil((d.words / maxDay) * ROWS)) : 0
                return (
                  <div
                    key={d.day}
                    className="flex flex-1 flex-col-reverse items-center gap-[3px]"
                    title={`${dayLabel(d.day)} · ${d.words} mots · ${minutesLabel(d.minutesSaved)}`}
                  >
                    {Array.from({ length: ROWS }, (_, i) => (
                      <span
                        key={i}
                        className="aspect-square w-full max-w-[7px] rounded-full"
                        style={i < lit ? { background: COLOR, boxShadow: `0 0 5px ${COLOR}` } : { background: 'rgb(255 255 255 / 0.06)' }}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
            <div className="space-y-1.5">
              {summary.apps.slice(0, 5).map((a) => (
                <div key={a.app} className="flex items-center gap-2.5 text-[11.5px]">
                  <span className="w-28 shrink-0 truncate text-fog-300 capitalize" title={a.app}>
                    {a.app}
                  </span>
                  <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, (a.words / topApp) * 100)}%`, background: COLOR }} />
                  </div>
                  <span className="w-16 shrink-0 text-right tabular-nums text-fog-500">{a.words} mots</span>
                  <span className="w-14 shrink-0 text-right tabular-nums text-fog-300">{minutesLabel(a.minutesSaved)}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="border-t border-white/[0.05] pt-2.5 text-[11px] leading-snug text-fog-500">
          Temps gagné = mots ÷ ta vitesse de frappe ({wpm} mots/min) − temps passé à parler. Calculé et gardé sur ton PC, sans le texte dicté.
        </div>
        {testing ? (
          <TypingTest
            onDone={(v) => {
              setTesting(false)
              if (v) setWpm(v)
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="subtle" onClick={() => setTesting(true)}>
              <Gauge size={13} /> Mesurer ma vitesse de frappe (30 s)
            </Button>
            {summary.dictations > 0 && (
              <Button size="sm" variant="ghost" onClick={() => void window.compi.clearDictationStats().then(setRows)}>
                <Trash2 size={13} /> Effacer ces chiffres
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

const SAMPLE =
  'Bonjour à tous, je vous envoie le compte rendu de la réunion de ce matin. Nous avons validé le planning du projet et réparti les prochaines tâches. ' +
  'Merci de relire le document avant vendredi et de me faire part de vos remarques. Je reste disponible si vous avez des questions sur le budget ou les délais.'

/** Test de 30 s : seuls les mots tapés correctement comptent. */
function TypingTest({ onDone }: { onDone: (wpm: number | null) => void }) {
  const [text, setText] = useState('')
  const [left, setLeft] = useState(30)
  const started = useRef<number | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const expected = useMemo(() => SAMPLE.split(/\s+/), [])

  useEffect(() => ref.current?.focus(), [])
  useEffect(() => {
    const t = setInterval(() => {
      if (started.current === null) return
      const remaining = Math.max(0, 30 - Math.floor((Date.now() - started.current) / 1000))
      setLeft(remaining)
    }, 250)
    return () => clearInterval(t)
  }, [])

  const correct = text
    .trim()
    .split(/\s+/)
    .filter((w, i) => w && w === expected[i]).length
  const result = Math.max(5, Math.round(correct * 2))

  return (
    <div className="space-y-2">
      <div className="rounded-xl bg-white/[0.03] px-3 py-2 text-[12px] leading-relaxed text-fog-300 select-none">{SAMPLE}</div>
      <TextArea
        ref={ref}
        rows={3}
        disabled={left === 0}
        placeholder="Recopie le texte ci-dessus, le chrono part à la première touche."
        value={text}
        onChange={(e) => {
          if (started.current === null) started.current = Date.now()
          setText(e.target.value)
        }}
      />
      <div className="flex items-center gap-2 text-[11.5px] text-fog-500">
        {left > 0 ? (
          <span className="tabular-nums">{started.current === null ? '30 s' : `${left} s`}</span>
        ) : (
          <span className="text-fog-100">
            {correct} mots justes en 30 s : <b>{result} mots/min</b>
          </span>
        )}
        <div className="flex-1" />
        {left === 0 && (
          <Button size="sm" variant="primary" onClick={() => onDone(result)}>
            Garder {result} mots/min
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          {left === 0 ? 'Annuler' : 'Arrêter'}
        </Button>
      </div>
    </div>
  )
}
