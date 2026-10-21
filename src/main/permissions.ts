// Autorisations du navigateur intégré : seulement le micro (pour la dictée,
// jamais la caméra) et la copie dans le presse-papier, et seulement pour
// l'interface de Compi elle-même. Tout le reste est refusé.

import { session } from 'electron'

const ALLOWED = new Set(['clipboard-sanitized-write'])

/** L'adresse est-elle celle de l'interface de Compi ? */
export function isOwnPage(url: string, devUrl = process.env.ELECTRON_RENDERER_URL): boolean {
  if (!url) return false
  if (devUrl) {
    try {
      return new URL(url).origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return url.startsWith('file://')
}

export function restrictPermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media') {
      const types = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      callback(isOwnPage(details.requestingUrl) && types.length > 0 && types.every((t) => t === 'audio'))
      return
    }
    callback(ALLOWED.has(permission) && isOwnPage(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, origin, details) => {
    if (permission === 'media') return isOwnPage(origin) && details.mediaType !== 'video'
    return ALLOWED.has(permission) && isOwnPage(origin)
  })
}
