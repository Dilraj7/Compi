// Capture d'un écran, l'îlot rendu invisible le temps de la prise pour ne pas s'y voir.
// Sert à l'outil de capture du cerveau et à la zone d'écran ; l'image reste en mémoire.

import { desktopCapturer, type Display, type NativeImage } from 'electron'
import { getNotchWindow } from '../notchWindow'

/** Cache l'îlot (opacité nulle) ; la fonction rendue le remontre. */
export async function hideIsland(): Promise<() => void> {
  const win = getNotchWindow()
  win?.setOpacity(0)
  await new Promise((r) => setTimeout(r, 140))
  return () => {
    if (win && !win.isDestroyed()) win.setOpacity(1)
  }
}

/**
 * Image d'un écran. `scale` 1 : pleine résolution (pixels réels, mise à l'échelle de
 * Windows comprise) ; moins pour une image plus légère. L'îlot doit déjà être caché.
 */
export async function grabDisplay(display: Display, scale = 1): Promise<NativeImage> {
  const k = display.scaleFactor * scale
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(display.size.width * k), height: Math.round(display.size.height * k) }
  })
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) throw new Error('Aucun écran trouvé.')
  return source.thumbnail
}
