// Messages entre Compi et le processus annexe de la touche de dictée (dictation/keyWorker.ts).

import type { KeyAction } from '../../shared/dictation'
import type { DictationKey } from '../../shared/types'

/** Codes des touches pour uiohook (libuiohook). */
export const KEYCODES: Record<DictationKey, number> = { ControlRight: 3613, ShiftRight: 54, AltRight: 3640 }

/** `reset` : la dictée s'est terminée côté Compi (bouton, erreur, écran verrouillé). */
export type KeyWorkerRequest = { type: 'watch'; keycode: number } | { type: 'reset' }

export type KeyWorkerResponse = { type: 'ready' } | { type: 'error'; message: string } | { type: 'action'; action: Exclude<KeyAction, null> }
