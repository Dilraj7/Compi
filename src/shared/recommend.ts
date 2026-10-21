// Le conseiller : à partir des réponses au questionnaire et du matériel du PC,
// choisit le cerveau et le modèle local le plus adapté, et explique pourquoi.
// Fonctions pures, testées dans tests/brains.test.ts.

import { CATALOG } from './catalog'
import type { BrainQuizAnswers, BrainRecommendation, CatalogModel, HardwareInfo } from './types'

export type Fit = 'gpu' | 'mixed' | 'cpu'

/** Mémoire laissée à Windows et aux autres applications. */
const RESERVED_RAM_GB = 3

/** VRAM utilisable par Ollama : cartes NVIDIA ou AMD d'au moins 4 Go. */
export function usableVram(hw: HardwareInfo): number {
  const gpu = hw.gpu
  if (!gpu || (gpu.vendor !== 'nvidia' && gpu.vendor !== 'amd') || gpu.vramGb < 4) return 0
  return gpu.vramGb
}

/** Comment ce modèle tournerait sur ce PC (`null` : il ne tient pas). */
export function fitFor(m: CatalogModel, hw: HardwareInfo): Fit | null {
  const vram = usableVram(hw)
  const ram = Math.max(0, hw.ramGb - RESERVED_RAM_GB)
  if (vram >= m.needGb) return 'gpu'
  if (vram >= m.sizeGb * 0.5 && vram + ram * 0.7 >= m.needGb) return 'mixed'
  if (ram >= m.needGb) return 'cpu'
  return null
}

function score(m: CatalogModel, fit: Fit, a: BrainQuizAnswers): number {
  const s = m.scores
  const uses = a.uses.filter((u) => u !== 'images')
  let total = (uses.length ? uses : (['write', 'docs'] as const)).reduce((sum, u) => sum + s[u], 0)
  total += s.tools * 1.5 // Compi s'appuie sur ses outils : rappels, documents, presse-papier…
  if (a.language === 'fr') total += s.fr * 1.5
  else if (a.language === 'multi') total += s.multi * 1.2
  const fast = a.pace === 'fast'
  total += s.speed * (fast ? 1.5 : 0.4)
  if (!fast) total += 0.3 * (s.write + s.docs + s.reason + s.code)
  if (m.vision) total += 1
  if (fit === 'mixed') total -= 4 + (fast ? 0.5 : 0.3) * m.sizeGb
  // Sur le processeur, la vitesse baisse avec la taille du modèle : très pénalisant si on veut du rapide.
  if (fit === 'cpu') total -= (fast ? 1.6 : 0.6) * m.sizeGb + 2
  return total
}

function reasonsFor(m: CatalogModel, fit: Fit, a: BrainQuizAnswers, hw: HardwareInfo): string[] {
  const out = [m.why]
  if (a.language === 'fr' && m.scores.fr >= 5) out.push('Très à l’aise en français.')
  else if (a.language === 'multi' && m.scores.multi >= 5) out.push('Excellent dans plusieurs langues.')
  if (a.uses.includes('images') && m.vision) out.push('Voit les images, les scans et ton écran.')
  if (fit === 'gpu') out.push(`Tient entièrement dans ta carte graphique${hw.gpu ? ` (${hw.gpu.name})` : ''} : réponses rapides.`)
  else if (fit === 'mixed') out.push('Déborde un peu de ta carte graphique : correct, mais plus lent.')
  else out.push('Tournera sur le processeur : ça marche, mais les réponses seront lentes.')
  out.push(`Téléchargement : ${m.sizeGb.toLocaleString('fr-FR')} Go, une seule fois.`)
  return out
}

export function recommend(a: BrainQuizAnswers, hw: HardwareInfo, catalog: CatalogModel[] = CATALOG): BrainRecommendation {
  const needVision = a.uses.includes('images')
  const ranked = catalog
    .map((m) => ({ m, fit: fitFor(m, hw) }))
    .filter((x): x is { m: CatalogModel; fit: Fit } => x.fit !== null)
    .filter(({ m }) => !needVision || m.vision)
    .filter(({ m }) => hw.freeDiskGb === undefined || m.sizeGb + 2 <= hw.freeDiskGb)
    .map((x) => ({ ...x, score: score(x.m, x.fit, a) }))
    .sort((x, y) => y.score - x.score)

  const cloudHelp = a.priority !== 'privacy'
  const effort = a.pace === 'careful' ? 'medium' : 'low'
  const best = ranked[0]
  const alternatives = ranked.slice(1, 3).map((x) => x.m)

  if (a.priority === 'quality') {
    return {
      provider: 'anthropic',
      alternatives: best ? [best.m, ...alternatives] : [],
      fit: best?.fit,
      reasons: [
        'Pour la meilleure qualité, Claude reste nettement au-dessus de tout ce qui tourne sur un PC.',
        'Il est payant à l’usage (clé API Anthropic) et tes messages passent par ses serveurs.',
        best ? `Si tu préfères rester en local, ${best.m.label} est le meilleur choix pour ton PC.` : 'Ton PC est trop juste pour un modèle local fiable.'
      ],
      cloudHelp,
      effort
    }
  }

  if (!best) {
    return {
      provider: 'local',
      alternatives: [],
      reasons: [
        needVision
          ? 'Aucun modèle local qui voit les images ne tient dans la mémoire de ce PC.'
          : 'Aucun modèle local fiable ne tient dans la mémoire ou sur le disque de ce PC (8 Go de RAM et 10 Go libres conseillés).',
        'Claude ou un autre service en ligne fonctionneront, eux, sur n’importe quel PC.'
      ],
      cloudHelp,
      effort
    }
  }

  const reasons = reasonsFor(best.m, best.fit, a, hw)
  if (a.priority === 'both') reasons.push('Quand il ne saura pas faire (scan, image…), je te proposerai Claude : rien ne part sans ton accord.')
  else reasons.push('Rien ne quitte ton PC : je ne proposerai jamais de service en ligne.')
  return { provider: 'local', pick: best.m, alternatives, fit: best.fit, reasons, cloudHelp, effort }
}

/**
 * Taille de contexte à demander au moteur local (en jetons). 32 000 par défaut : assez
 * pour discuter, lire un document par parties et charger une extension, avec moins de
 * mémoire vidéo réservée (le PC reste fluide). 64 000 seulement si l'utilisateur le
 * demande (`long`) et que la carte graphique garde 6 Go de marge.
 */
export function contextFor(modelSizeGb: number, hw: HardwareInfo, long = false): number {
  return long && usableVram(hw) - modelSizeGb >= 6 ? 65_536 : 32_768
}
