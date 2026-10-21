// Processus annexe de la touche de dictée (utilityProcess) : observe le clavier
// avec uiohook, sans jamais rien bloquer ni enregistrer, et n'envoie à Compi
// que des ordres (commencer, arrêter, annuler). Aucune frappe ne sort de ce
// processus : seule compte la touche choisie, les autres disent juste « une
// autre touche » à l'automate (tests/dictation.test.ts).

import { uIOhook, UiohookKey } from 'uiohook-napi'
import { KEY_IDLE, keyStep, type KeyEvent, type KeyState } from '../../shared/dictation'
import type { KeyWorkerRequest, KeyWorkerResponse } from './protocol'

let target = 0
let state: KeyState = KEY_IDLE
let ticker: NodeJS.Timeout | undefined
let started = false

const post = (r: KeyWorkerResponse): void => process.parentPort.postMessage(r)

function feed(ev: KeyEvent): void {
  const r = keyStep(state, ev, Date.now())
  state = r.state
  if (r.action) post({ type: 'action', action: r.action })
  // L'horloge ne tourne que lorsque la touche est en jeu : rien au repos.
  if (state.s === 'idle') {
    clearInterval(ticker)
    ticker = undefined
  } else if (!ticker) ticker = setInterval(() => feed({ type: 'tick' }), 40)
}

const which = (keycode: number): 'target' | 'esc' | 'other' => (keycode === target ? 'target' : keycode === UiohookKey.Escape ? 'esc' : 'other')

uIOhook.on('keydown', (e) => feed({ type: 'down', key: which(e.keycode) }))
uIOhook.on('keyup', (e) => feed({ type: 'up', key: which(e.keycode) }))
// Ctrl + clic ou Ctrl + molette : un geste, pas une dictée.
uIOhook.on('mousedown', () => state.s !== 'idle' && feed({ type: 'down', key: 'other' }))
uIOhook.on('wheel', () => state.s !== 'idle' && feed({ type: 'down', key: 'other' }))

process.parentPort.on('message', (e: Electron.MessageEvent) => {
  const req = e.data as KeyWorkerRequest
  if (req.type === 'reset') {
    // Touche peut-être encore enfoncée : on attend qu'elle remonte avant d'écouter à nouveau.
    state = state.s === 'holding' || state.s === 'pressed' ? { s: 'wait-up', since: Date.now() } : KEY_IDLE
    feed({ type: 'tick' })
    return
  }
  target = req.keycode
  state = KEY_IDLE
  if (started) return post({ type: 'ready' })
  try {
    uIOhook.start()
    started = true
    post({ type: 'ready' })
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) })
  }
})
