// Autorisations du navigateur intégré : seulement le micro (pour la dictée,
// jamais la caméra), le son de l'ordinateur pendant un appel enregistré, et la
// copie dans le presse-papier, et seulement pour l'interface de Compi
// elle-même. Tout le reste est refusé.

import { desktopCapturer, session } from 'electron'

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

/**
 * Son de l'ordinateur pendant un appel enregistré, en secours (d'ordinaire,
 * Windows le capte pour Compi) : accordé une seule fois, juste après un
 * « Commencer » qui en a besoin (`armed`), et seulement à l'interface de Compi.
 * Chromium exige aussi une image de l'écran : l'îlot l'arrête aussitôt, elle
 * n'est jamais lue ni gardée.
 */
export function allowCallAudio(armed: () => boolean): void {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    if (!isOwnPage(request.frame?.url ?? request.securityOrigin) || !request.audioRequested || !armed()) return callback(null)
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then(
      (sources) => callback(sources[0] ? { video: sources[0], audio: 'loopback' } : null),
      () => callback(null)
    )
  })
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
