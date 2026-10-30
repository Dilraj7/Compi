// Zone d'écran → action : l'utilisateur encadre une partie de l'écran figé, le texte est
// lu sur le PC (OCR de Windows) puis proposé aux actions rapides. Fonctions pures,
// testées dans tests/zone.test.ts.

export interface ZoneRect {
  x: number
  y: number
  width: number
  height: number
}

/** En dessous (en points de l'écran), un clic sans glisser : pas une zone. */
export const ZONE_MIN = 8
/** Côté le plus long d'une image envoyée à un cerveau qui voit les images. */
export const ZONE_VISION_MAX = 1568

/** Rectangle entre deux coins, dans n'importe quel sens de glisser. */
export function rectBetween(a: { x: number; y: number }, b: { x: number; y: number }): ZoneRect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

export const isZoneTooSmall = (r: ZoneRect): boolean => !(r.width >= ZONE_MIN && r.height >= ZONE_MIN)

/**
 * Zone choisie sur la vue (taille `view`, en points) → pixels de la capture (taille `image`).
 * L'échelle vient des deux tailles : elle suit la mise à l'échelle de Windows (125 %, 150 %…).
 * Le résultat reste dans l'image ; `null` s'il est vide ou trop petit.
 */
export function zoneToImage(r: ZoneRect, view: { width: number; height: number }, image: { width: number; height: number }): ZoneRect | null {
  if (!(view.width > 0 && view.height > 0 && image.width > 0 && image.height > 0)) return null
  if (isZoneTooSmall(r)) return null
  const sx = image.width / view.width
  const sy = image.height / view.height
  const x = Math.max(0, Math.floor(r.x * sx))
  const y = Math.max(0, Math.floor(r.y * sy))
  const right = Math.min(image.width, Math.ceil((r.x + r.width) * sx))
  const bottom = Math.min(image.height, Math.ceil((r.y + r.height) * sy))
  if (right - x < 1 || bottom - y < 1) return null
  return { x, y, width: right - x, height: bottom - y }
}

/** Taille de l'image pour un cerveau : réduite si le côté le plus long dépasse `max`, jamais agrandie. */
export function visionSize(size: { width: number; height: number }, max = ZONE_VISION_MAX): { width: number; height: number } {
  const long = Math.max(size.width, size.height)
  if (long <= max) return size
  const k = max / long
  return { width: Math.max(1, Math.round(size.width * k)), height: Math.max(1, Math.round(size.height * k)) }
}

export interface ZonePick {
  rect: ZoneRect
  /** Taille de la vue où la zone a été tracée (points CSS). */
  view: { width: number; height: number }
}

/**
 * Ce que la fenêtre de sélection renvoie dans son titre : « zone:{x,y,width,height,vw,vh} »,
 * ou « zone:cancel ». `null` pour tout autre titre (rien de décidé encore).
 */
export function parseZoneTitle(title: string): ZonePick | 'cancel' | null {
  if (title === 'zone:cancel') return 'cancel'
  if (!title.startsWith('zone:{')) return null
  try {
    const o = JSON.parse(title.slice(5)) as Record<string, unknown>
    const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
    const [x, y, width, height, vw, vh] = [o.x, o.y, o.width, o.height, o.vw, o.vh].map(n)
    if (x === null || y === null || width === null || height === null || vw === null || vh === null) return null
    return { rect: { x, y, width, height }, view: { width: vw, height: vh } }
  } catch {
    return null
  }
}
