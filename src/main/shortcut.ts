// Raccourcis globaux : ouvrir Compi, actions rapides sur la sélection, dictée.
// Windows réserve un raccourci à la première app qui le demande : s'il est
// déjà pris (1Password, Claude…), on le détecte au lieu d'échouer en silence.

import { globalShortcut } from 'electron'
import { log } from './log'
import { sendIslandCommand } from './notchWindow'

/** « Control+Shift+Space » → « Ctrl + Maj + Espace ». */
export function prettyShortcut(accelerator: string): string {
  const names: Record<string, string> = { Control: 'Ctrl', Shift: 'Maj', Super: 'Win', Space: 'Espace', Return: 'Entrée' }
  return accelerator
    .split('+')
    .map((k) => names[k] ?? k)
    .join(' + ')
}

class GlobalKey {
  current = ''
  active = false

  constructor(
    private readonly name: string,
    private readonly fallbacks: string[],
    private readonly onPress: () => void,
    private readonly others: () => Array<GlobalKey | undefined>
  ) {}

  private tryRegister(accelerator: string): boolean {
    // Les raccourcis de Compi ne doivent pas se marcher dessus.
    if (this.others().some((o) => o?.active && o.current === accelerator)) return false
    try {
      return globalShortcut.register(accelerator, this.onPress)
    } catch {
      return false // combinaison invalide
    }
  }

  /** Remplace le raccourci. Renvoie false s'il est déjà pris : l'ancien reste en place. */
  set(accelerator: string): boolean {
    if (accelerator === this.current && this.active) return true
    if (this.active) globalShortcut.unregister(this.current)
    if (!accelerator) {
      this.current = ''
      this.active = false
      return true
    }
    if (this.tryRegister(accelerator)) {
      this.current = accelerator
      this.active = true
      return true
    }
    this.active = Boolean(this.current) && this.tryRegister(this.current)
    return false
  }

  /** Au démarrage : le raccourci voulu ou, s'il est pris, la première alternative libre. */
  init(wanted: string): { accelerator: string; replaced: boolean } | null {
    if (!wanted) return { accelerator: '', replaced: false }
    if (this.set(wanted)) return { accelerator: wanted, replaced: false }
    log('warn', `raccourci ${this.name} ${wanted} déjà utilisé par une autre application`)
    for (const alt of this.fallbacks) {
      if (alt !== wanted && this.set(alt)) {
        log('info', `raccourci ${this.name} de remplacement : ${alt}`)
        return { accelerator: alt, replaced: true }
      }
    }
    this.current = wanted
    return null
  }
}

let onQuick: () => void = () => undefined

const openKey: GlobalKey = new GlobalKey(
  'd’ouverture',
  ['Alt+Shift+Space', 'Control+Alt+K', 'Alt+Shift+K'],
  () => sendIslandCommand('open-chat'),
  () => [quickKey, voiceKey]
)
const quickKey: GlobalKey = new GlobalKey(
  'des actions rapides',
  ['Alt+Shift+C', 'Alt+Shift+X', 'Control+Alt+Q'],
  () => onQuick(),
  () => [openKey, voiceKey]
)
const voiceKey: GlobalKey = new GlobalKey(
  'de la dictée',
  ['Alt+Shift+V', 'Alt+Shift+D', 'Control+Alt+D'],
  () => sendIslandCommand('voice'),
  () => [openKey, quickKey]
)

export const setShortcut = (accelerator: string): boolean => openKey.set(accelerator)
export const initShortcut = (wanted: string): { accelerator: string; replaced: boolean } | null => openKey.init(wanted)
export const shortcutActive = (): boolean => openKey.active

export const setQuickShortcut = (accelerator: string): boolean => quickKey.set(accelerator)
export const quickShortcutActive = (): boolean => quickKey.active

/** Branche le raccourci des actions rapides. */
export function initQuickShortcut(wanted: string, handler: () => void): { accelerator: string; replaced: boolean } | null {
  onQuick = handler
  return quickKey.init(wanted)
}

export const setVoiceShortcut = (accelerator: string): boolean => voiceKey.set(accelerator)
export const voiceShortcutActive = (): boolean => voiceKey.active
export const initVoiceShortcut = (wanted: string): { accelerator: string; replaced: boolean } | null => voiceKey.init(wanted)

// ─── Autorisations au clavier ────────────────────────────────────────────────
// Enregistrés seulement tant qu'une carte attend : ces combinaisons ne sont
// prises aux autres applications que le temps de répondre.

let onApprovalKey: (decision: 'allow' | 'deny') => void = () => undefined
const mainKeys = (): GlobalKey[] => [openKey, quickKey, voiceKey]
const allowKey: GlobalKey = new GlobalKey(
  'd’autorisation',
  [],
  () => onApprovalKey('allow'),
  () => [...mainKeys(), denyKey]
)
const denyKey: GlobalKey = new GlobalKey(
  'de refus',
  [],
  () => onApprovalKey('deny'),
  () => [...mainKeys(), allowKey]
)

export function onApprovalShortcut(handler: (decision: 'allow' | 'deny') => void): void {
  onApprovalKey = handler
}

/** Prend les deux raccourcis ; renvoie ceux qu'une autre application utilise déjà. */
export function armApprovalKeys(allow: string, deny: string): string[] {
  const taken: string[] = []
  if (allow && !allowKey.set(allow)) taken.push(allow)
  if (deny && !denyKey.set(deny)) taken.push(deny)
  return taken
}

export function disarmApprovalKeys(): void {
  allowKey.set('')
  denyKey.set('')
}

/** La combinaison est déjà un raccourci de Compi (ouvrir, actions rapides, dictée). */
export const isMainShortcut = (accelerator: string): boolean => mainKeys().some((k) => k.active && k.current === accelerator)

/** Libre pour les autorisations ? Essai éclair, rendu aussitôt (ou déjà pris par ces raccourcis-là). */
export function approvalKeyFree(accelerator: string): boolean {
  if ([allowKey, denyKey].some((k) => k.active && k.current === accelerator)) return true
  if (isMainShortcut(accelerator)) return false
  try {
    if (!globalShortcut.register(accelerator, () => undefined)) return false
    globalShortcut.unregister(accelerator)
    return true
  } catch {
    return false
  }
}
