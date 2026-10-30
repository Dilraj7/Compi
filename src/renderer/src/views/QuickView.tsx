import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'motion/react'
import {
  ArrowRightLeft,
  Check,
  Cloud,
  Copy,
  Image,
  Languages,
  Lightbulb,
  ListCollapse,
  Lock,
  MessageSquareText,
  Reply,
  ScanText,
  SpellCheck,
  TriangleAlert,
  WandSparkles
} from 'lucide-react'
import { canReplaceWith, QUICK_ACTIONS } from '@shared/quick'
import type { QuickActionId, QuickSelection } from '@shared/types'
import { useCompi } from '../store'
import { Markdown } from '../components/Markdown'
import { Button, LedDots, cx } from '../components/ui'

const ICONS: Record<QuickActionId, ReactNode> = {
  fix: <SpellCheck size={15} />,
  rephrase: <WandSparkles size={15} />,
  translate: <Languages size={15} />,
  summarize: <ListCollapse size={15} />,
  explain: <Lightbulb size={15} />,
  reply: <Reply size={15} />
}

/** Résultat mis en forme (résumé, explication) plutôt que texte à recoller tel quel. */
const FORMATTED: QuickActionId[] = ['summarize', 'explain']

/** Zone d'écran : rien ne part si l'écran est sur « Jamais » ; sans texte lu, seul « Expliquer » (l'image). */
function actionOff(selection: QuickSelection, id: QuickActionId): boolean {
  const zone = selection.zone
  if (!zone) return false
  return zone.blocked || (!selection.text && !(zone.vision && id === 'explain'))
}

/**
 * Actions rapides sur le texte sélectionné dans une autre application
 * (raccourci Alt+Maj+C) : Corriger, Reformuler, Traduire… puis Remplacer ou Copier.
 * Aussi sur une zone d'écran (Alt+Maj+Z) : texte lu sur le PC, image pour « Expliquer ».
 */
export function QuickView() {
  const quick = useCompi((s) => s.quick)
  const runQuick = useCompi((s) => s.runQuick)
  const continueQuick = useCompi((s) => s.continueQuick)
  const setQuickNotice = useCompi((s) => s.setQuickNotice)
  const setView = useCompi((s) => s.setView)
  const [busy, setBusy] = useState(false)
  // Zone d'écran : texte lu déjà copié (pour cette sélection).
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Chiffres 1 à 6 : lancer une action au clavier.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.altKey || e.metaKey || (e.target as HTMLElement | null)?.closest('input, textarea')) return
      const n = Number(e.key)
      const sel = useCompi.getState().quick?.selection
      if (n >= 1 && n <= QUICK_ACTIONS.length && !(sel && actionOff(sel, QUICK_ACTIONS[n - 1].id))) runQuick(QUICK_ACTIONS[n - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runQuick])

  if (!quick) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center text-[13px] text-fog-500">
        Sélectionne un texte dans n’importe quelle application, ou encadre une zone de l’écran, puis appuie sur le raccourci des actions rapides.
        <Button size="sm" variant="subtle" onClick={() => setView('chat')}>
          Revenir à la discussion
        </Button>
      </div>
    )
  }

  const { selection, action, result, status } = quick
  const replaceable = Boolean(action && selection.canReplace && canReplaceWith(action))
  const finished = status === 'done' && result.trim().length > 0

  const replace = async (): Promise<void> => {
    setBusy(true)
    const r = await window.compi.quickReplace(selection.id)
    setBusy(false)
    if (!r.ok) setQuickNotice(r.message)
  }
  const copy = async (): Promise<void> => {
    if (await window.compi.quickCopy(selection.id)) setQuickNotice('Copié : colle-le où tu veux avec Ctrl+V.')
  }
  const textCopied = copiedId === selection.id
  const copyText = async (): Promise<void> => {
    if (await window.compi.quickCopyText(selection.id)) setCopiedId(selection.id)
  }
  const zone = selection.zone

  return (
    <div className="scroll-y flex flex-1 flex-col gap-3 px-5 pt-1 pb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-fog-500">
        {zone ? (
          <span className="inline-flex items-center gap-1">
            <ScanText size={11} /> <span className="text-fog-300">Zone d’écran</span> · texte lu sur ton PC
          </span>
        ) : (
          selection.source && (
            <span className="min-w-0 truncate">
              Dans : <span className="text-fog-300">{selection.source}</span>
            </span>
          )
        )}
        <span
          className="inline-flex items-center gap-1"
          title={selection.online ? 'Le texte sélectionné partira vers ce service en ligne.' : 'Le texte reste sur ton PC.'}
        >
          {selection.online ? <Cloud size={11} /> : <Lock size={11} />}
          {selection.brainLabel} · {selection.online ? 'en ligne' : 'sur ton PC'}
        </span>
      </div>

      <div className="relative max-h-24 overflow-auto rounded-2xl bg-black/40 px-3.5 py-2.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fog-300 ring-1 ring-inset ring-white/[0.06] select-text">
        {selection.text || <span className="text-fog-500 italic">Aucun texte lisible dans cette zone.</span>}
      </div>
      {zone && (
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2 px-1 text-[11.5px]" data-zone-note>
          <span className={cx('min-w-0', zone.blocked ? 'text-led-amber' : 'text-fog-500')}>
            {zone.blocked ? (
              `L’écran est sur « Jamais » (Réglages › Confidentialité) : rien de cette zone ne part vers ${selection.brainLabel}.`
            ) : zone.vision ? (
              <span className="inline-flex items-center gap-1">
                <Image size={11} /> « Expliquer » montre aussi l’image de la zone à {selection.brainLabel}.
              </span>
            ) : (
              'Ce cerveau ne voit pas les images : seul le texte lu sert.'
            )}
          </span>
          {selection.text && (
            <Button size="sm" variant="ghost" onClick={copyText}>
              {textCopied ? <Check size={12} /> : <Copy size={12} />} {textCopied ? 'Texte copié' : 'Copier le texte'}
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1.5">
        {QUICK_ACTIONS.map((a, i) => (
          <button
            key={a.id}
            onClick={() => runQuick(a.id)}
            disabled={(status === 'running' && action === a.id) || actionOff(selection, a.id)}
            className={cx(
              'group flex items-center gap-2 rounded-xl px-3 py-2 text-left text-[12.5px] transition-colors ring-1 ring-inset disabled:pointer-events-none disabled:opacity-40',
              action === a.id
                ? 'bg-[color-mix(in_oklab,var(--led)_14%,transparent)] text-fog-100 ring-[color-mix(in_oklab,var(--led)_40%,transparent)]'
                : 'bg-white/[0.04] text-fog-300 ring-white/[0.06] hover:bg-white/[0.08] hover:text-fog-100'
            )}
            title={`${a.label} (touche ${i + 1})`}
          >
            <span className={cx(action === a.id ? 'text-[var(--led)]' : 'text-fog-500 group-hover:text-fog-300')}>{ICONS[a.id]}</span>
            <span className="flex-1">{a.label}</span>
            <kbd className="font-mono text-[10px] text-fog-700">{i + 1}</kbd>
          </button>
        ))}
      </div>

      {action && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2.5">
          {status === 'error' ? (
            <div className="flex items-start gap-2.5 rounded-2xl bg-led-red/[0.08] px-3.5 py-2.5 text-[12.5px] text-led-red ring-1 ring-inset ring-led-red/20">
              <TriangleAlert size={15} className="mt-0.5 shrink-0" />
              {quick.error}
            </div>
          ) : !result ? (
            <div className="flex items-center gap-2 px-1 text-[12px] text-fog-500">
              <LedDots /> Je m’en occupe…
            </div>
          ) : FORMATTED.includes(action) ? (
            <div className={cx('prose-compi rounded-2xl bg-ink-850 px-3.5 py-2.5 ring-1 ring-inset ring-white/[0.08]', status === 'running' && 'caret')}>
              <Markdown text={result} />
            </div>
          ) : (
            <div
              className={cx(
                'rounded-2xl bg-ink-850 px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-fog-100 ring-1 ring-inset ring-white/[0.08] select-text',
                status === 'running' && 'caret'
              )}
            >
              {result}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={continueQuick} title="Ouvrir une discussion avec ce texte">
              <MessageSquareText size={13} /> Continuer dans la discussion
            </Button>
            <Button size="sm" variant={replaceable ? 'subtle' : 'primary'} disabled={!finished || busy} onClick={copy}>
              <Copy size={13} /> Copier
            </Button>
            {replaceable && (
              <Button
                size="sm"
                variant="primary"
                disabled={!finished || busy}
                onClick={replace}
                title={`Remplacer la sélection dans « ${selection.source ?? 'la fenêtre d’origine'} »`}
              >
                {busy ? <Check size={13} /> : <ArrowRightLeft size={13} />} Remplacer
              </Button>
            )}
          </div>
          {quick.notice && <div className="px-1 text-right text-[11.5px] text-fog-500">{quick.notice}</div>}
        </motion.div>
      )}
    </div>
  )
}
