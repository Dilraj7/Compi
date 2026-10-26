// Jauges de « Ce PC » : processeur, mémoire, carte graphique, mémoire vidéo.
// Mini-jauges LED dans l'îlot, barres dans le dock du plein écran.

import { gaugeLevel, gbText, type PerfSnapshot } from '@shared/perf'

/** Les quatre mesures : processeur, mémoire, carte graphique, mémoire vidéo (0 à 1). */
export function perfLevels(p: PerfSnapshot): Array<{ key: string; label: string; short: string; value: number; text: string }> {
  const out = [
    { key: 'cpu', label: 'Processeur', short: 'Processeur', value: p.cpu / 100, text: `${Math.round(p.cpu)} %` },
    {
      key: 'ram',
      label: 'Mémoire',
      short: 'Mémoire',
      value: p.ram.usedGb / p.ram.totalGb,
      text: `${gbText(p.ram.usedGb).replace(' Go', '')}/${gbText(p.ram.totalGb)}`
    }
  ]
  if (p.gpu) {
    out.push(
      { key: 'gpu', label: 'Carte graphique', short: 'Graphique', value: p.gpu.util / 100, text: `${Math.round(p.gpu.util)} %` },
      {
        key: 'vram',
        label: 'Mémoire vidéo',
        short: 'Mém. vidéo',
        value: p.gpu.vramUsedGb / p.gpu.vramTotalGb,
        text: `${gbText(p.gpu.vramUsedGb).replace(' Go', '')}/${gbText(p.gpu.vramTotalGb)}`
      }
    )
  }
  return out
}

export const GAUGE_COLOR = { ok: 'var(--led)', high: '#FBBF24', full: '#F87171' } as const

/** Mini-jauges LED à côté du robot : une colonne de 4 points par mesure. */
export function MiniGauges({ perf }: { perf: PerfSnapshot }) {
  return (
    <div className="flex items-end gap-[3px] pl-0.5" title="Processeur · mémoire · carte graphique · mémoire vidéo">
      {perfLevels(perf).map((g) => {
        const lit = g.value > 0.02 ? Math.max(1, Math.round(Math.min(1, g.value) * 4)) : 0
        const color = GAUGE_COLOR[gaugeLevel(g.value)]
        return (
          <span key={g.key} className="flex flex-col-reverse gap-[2px]">
            {[0, 1, 2, 3].map((d) => (
              <span
                key={d}
                className="size-[3px] rounded-[0.5px] transition-colors duration-500"
                style={d < lit ? { background: color, boxShadow: `0 0 4px ${color}` } : { background: 'rgb(255 255 255 / 0.09)' }}
              />
            ))}
          </span>
        )
      })}
    </div>
  )
}
