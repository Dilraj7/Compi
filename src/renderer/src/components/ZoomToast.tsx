// Taille du texte changée au clavier ou à la molette : une petite pastille la montre un instant.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AArrowUp } from 'lucide-react'

export function ZoomToast() {
  const [pct, setPct] = useState<number | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = window.compi.onZoomStepped((z) => {
      setPct(z.pct)
      clearTimeout(t)
      t = setTimeout(() => setPct(null), 1400)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [])
  return (
    <AnimatePresence>
      {pct !== null && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-none absolute bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-ink-850/95 px-3.5 py-1.5 text-[12px] text-fog-100 shadow-lg ring-1 ring-inset ring-white/[0.08]"
        >
          <AArrowUp size={14} className="text-fog-500" />
          Taille du texte · <span className="font-semibold tabular-nums">{pct} %</span>
          <span className="text-fog-500">Ctrl 0 : 100 %</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
