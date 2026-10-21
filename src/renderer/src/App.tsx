import { useEffect } from 'react'
import { attentionView } from '@shared/attention'
import { soundFor } from '@shared/sounds'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Island } from './components/Island'
import { maybePlay } from './lib/sounds'
import { setInteractive, TAB_ORDER, useCompi } from './store'

const pendingInput = (s: ReturnType<typeof useCompi.getState>): Parameters<typeof attentionView>[0] => ({
  approvals: s.approvals,
  questions: s.questions,
  mode: s.mode,
  view: s.view,
  hasConversation: s.conversationId !== null
})

// Raccourci de la dictée : maintenu, on parle puis on relâche ; tapé, l'écoute
// continue jusqu'à un silence ou un nouvel appui. Windows répète le raccourci
// tant qu'il est maintenu : ces répétitions sont ignorées.
let lastVoiceKey = 0
let voiceKeyDownAt = 0

function onVoiceKey(): void {
  const s = useCompi.getState()
  const now = Date.now()
  const repeat = now - lastVoiceKey < 700
  lastVoiceKey = now
  const phase = s.dictation.phase
  if (phase === 'recording' || phase === 'starting') {
    if (!repeat) s.stopDictation()
    return
  }
  if (phase !== 'idle' || repeat) return
  voiceKeyDownAt = now
  void s.startDictation()
}

/** Relâchement du raccourci maintenu (la fenêtre a le focus pendant la dictée). */
function useVoiceRelease(): void {
  useEffect(() => {
    const onUp = (e: KeyboardEvent): void => {
      const s = useCompi.getState()
      if (s.dictation.phase !== 'recording' && s.dictation.phase !== 'starting') return
      if (!voiceKeyDownAt || Date.now() - voiceKeyDownAt < 450) return
      const key = s.settings?.voice.shortcut.split('+').pop()?.toLowerCase()
      if (e.key.toLowerCase() === key || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Control') {
        voiceKeyDownAt = 0
        s.stopDictation()
      }
    }
    window.addEventListener('keyup', onUp)
    return () => window.removeEventListener('keyup', onUp)
  }, [])
}

/** Une carte ou une question attend : le panneau s'ouvre dessus, et la première prend le clavier. */
function focusPending(): void {
  const s = useCompi.getState()
  const view = attentionView({ ...pendingInput(s), mode: 'compact' }) ?? 'activity'
  s.open(view, { focus: true, attention: false })
  s.setView(view)
  s.focusPending()
}

/** Nouvelles demandes (pas celles déjà affichées) : un son discret. */
function newIds(before: Array<{ id: string }>, after: Array<{ id: string }>): boolean {
  const seen = new Set(before.map((x) => x.id))
  return after.some((x) => !seen.has(x.id))
}

/** Branche l'interface sur les événements du processus principal. */
function useBridge(): void {
  useEffect(() => {
    const api = window.compi
    const st = useCompi.getState
    void api.getSettings().then(st().setSettings)
    void api.media().then(st().setMedia)
    void api.timer().then(st().setTimer)

    const offs = [
      api.onMedia((m) => st().setMedia(m)),
      api.onTimer((t) => st().setTimer(t)),
      api.onSettings((s) => st().setSettings(s)),
      api.onAgentEvent((e) => st().onAgentEvent(e)),
      api.onApprovals((a) => {
        if (newIds(st().approvals, a)) void maybePlay('attention', st().settings, 'approval')
        st().setApprovals(a)
      }),
      api.onQuestions((q) => {
        if (newIds(st().questions, q)) void maybePlay('attention', st().settings, 'question')
        st().setQuestions(q)
      }),
      api.onSessions((s) => st().setSessions(s)),
      api.onPerf((p) => st().setPerf(p)),
      api.onIslandNotice((n) => {
        st().showNotice(n)
        const kind = n.sound === undefined ? soundFor(n.pill) : n.sound
        if (kind) void maybePlay(kind, st().settings, n.pill)
      }),
      api.onQuickOpen((sel) => st().openQuick(sel)),
      api.onQuickEvent((e) => st().onQuickEvent(e)),
      // Clic sur la notification d'une routine : sa discussion s'ouvre.
      api.onOpenConversation((id) => {
        void st()
          .loadConversation(id)
          .then(() => st().open('chat', { focus: true }))
      }),
      api.onIslandCommand((cmd) => {
        const s = st()
        switch (cmd) {
          case 'open-chat':
            if (s.mode === 'expanded' && s.focused && (s.view === 'chat' || s.approvals.length + s.questions.length > 0)) s.collapse()
            // Une demande attend : on arrive directement sur la carte, au clavier.
            else if (s.approvals.length + s.questions.length > 0) focusPending()
            else s.open('chat', { focus: true })
            break
          case 'focus-pending':
            focusPending()
            break
          case 'toggle':
            if (s.mode === 'expanded') s.collapse()
            else s.open('chat', { focus: true })
            break
          case 'open-settings':
            s.open('settings', { focus: true })
            break
          case 'open-activity':
            s.open('activity')
            break
          case 'open-quick':
            if (s.quick) s.open('quick', { focus: true })
            break
          case 'open-today':
            s.open('today')
            break
          case 'voice':
            onVoiceKey()
            break
          case 'attention': {
            // En discussion, la carte s'affiche au-dessus de la saisie ; sinon, on montre Activité.
            const view = attentionView(pendingInput(s))
            if (s.mode !== 'expanded') s.open(view ?? 'activity', { attention: true })
            else if (view) s.setView(view)
            break
          }
          case 'collapse':
            // Clic ailleurs : on referme, sauf si une validation attend encore. Le panneau
            // reste alors cliquable (activable), mais n'a plus le clavier.
            if (s.approvals.length + s.questions.length > 0) {
              useCompi.setState({ focused: false, attention: true, view: attentionView(pendingInput(s)) ?? s.view })
            } else {
              s.collapse()
            }
            break
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])
}

/**
 * Clic traversant : la fenêtre ignore la souris, sauf quand le curseur est
 * au-dessus de l'îlot. Les mouvements sont transmis même en mode « ignoré ».
 */
function useHitTest(): void {
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      const el = e.target as Element | null
      setInteractive(Boolean(el?.closest?.('[data-island]')))
    }
    const onLeave = (): void => setInteractive(false)
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('dragover', onMove as EventListener, { passive: true })
    document.documentElement.addEventListener('mouseleave', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('dragover', onMove as EventListener)
      document.documentElement.removeEventListener('mouseleave', onLeave)
    }
  }, [])
}

/** Clavier dans le panneau : Ctrl+1…7 (onglets), Ctrl+N (nouvelle discussion), Ctrl+K (recherche). */
function usePanelKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useCompi.getState()
      if (s.mode !== 'expanded' || !e.ctrlKey || e.altKey || e.metaKey) return
      const k = e.key.toLowerCase()
      // Par la position de la touche : sur un clavier AZERTY, Ctrl+1 donne « & ».
      const n = Number(/^(?:Digit|Numpad)(\d)$/.exec(e.code)?.[1] ?? NaN)
      if (n >= 1 && n <= TAB_ORDER.length && !e.shiftKey) {
        e.preventDefault()
        s.setPalette(false)
        s.setView(TAB_ORDER[n - 1])
      } else if (k === 'n' && !e.shiftKey) {
        e.preventDefault()
        s.setPalette(false)
        s.newConversation()
        s.open('chat', { focus: true })
        setTimeout(() => document.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus(), 80)
      } else if (k === 'k' && !e.shiftKey) {
        e.preventDefault()
        s.setPalette(!s.palette)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

/** Mini-jauges de l'îlot (option) : l'activité du PC est mesurée toutes les 3 s. */
function useIslandMonitor(): void {
  const on = useCompi((s) => Boolean(s.settings?.monitor.island))
  useEffect(() => {
    if (!on) return
    void window.compi.perfWatch('island', true, 3000).then((p) => p && useCompi.getState().setPerf(p))
    return () => void window.compi.perfWatch('island', false)
  }, [on])
}

export function App() {
  useBridge()
  useHitTest()
  useVoiceRelease()
  usePanelKeys()
  useIslandMonitor()
  return (
    <ErrorBoundary>
      <Island />
    </ErrorBoundary>
  )
}
