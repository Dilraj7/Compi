import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { FileSpreadsheet, FileText, Folder, FolderPlus, Image, Presentation, X } from 'lucide-react'
import { useCompi } from '../store'
import { Button, Segmented } from '../components/ui'
import { ConnectorsPanel } from './ConnectorsView'
import { SemanticCard } from './SemanticCard'
import { SkillsPanel } from './SkillsPanel'

type Tab = 'folders' | 'connectors' | 'skills'

const FORMATS = [
  { Icon: FileText, label: 'PDF, Word, texte' },
  { Icon: FileSpreadsheet, label: 'Excel, CSV' },
  { Icon: Presentation, label: 'PowerPoint' },
  { Icon: Image, label: 'Images' }
]

function FoldersPanel() {
  const folders = useCompi((s) => s.settings?.folders ?? [])
  const setSettings = useCompi((s) => s.setSettings)

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3 px-0.5">
        <p className="text-[11.5px] leading-snug text-fog-500">
          Je lis et fouille ces dossiers sans te demander, y compris l’intérieur des documents. Ce que j’y trouve ne part qu’au cerveau choisi, quand je te réponds, et nulle part avec un cerveau local.
        </p>
        <Button size="sm" variant="primary" onClick={() => void window.compi.pickFolders().then(setSettings)}>
          <FolderPlus size={13} /> Ajouter
        </Button>
      </div>

      {folders.length === 0 ? (
        <button
          onClick={() => void window.compi.pickFolders().then(setSettings)}
          className="w-full rounded-2xl border border-dashed border-white/[0.1] px-4 py-7 text-center text-[12.5px] text-fog-500 transition-colors hover:border-[var(--led)]/40 hover:text-fog-300"
        >
          Aucun dossier pour l’instant.
          <br />
          Ajoute par exemple tes contrats, tes factures ou tes notes de cours.
        </button>
      ) : (
        <div className="space-y-1.5">
          <AnimatePresence initial={false}>
            {folders.map((f) => (
              <motion.div
                key={f}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -8 }}
                className="flex items-center gap-3 rounded-xl bg-ink-850/90 px-3 py-2.5 ring-1 ring-inset ring-white/[0.06]"
              >
                <Folder size={15} className="shrink-0 text-[var(--led)]" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fog-300" title={f}>
                  {f}
                </span>
                <button
                  className="grid size-6 place-items-center rounded-lg text-fog-700 hover:bg-white/[0.06] hover:text-fog-100"
                  aria-label="Retirer ce dossier"
                  title="Retirer (les fichiers ne sont pas supprimés)"
                  onClick={() => void window.compi.updateSettings({ folders: folders.filter((x) => x !== f) }).then(setSettings)}
                >
                  <X size={13} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <SemanticCard />

      <div className="rounded-2xl bg-white/[0.02] p-3 ring-1 ring-inset ring-white/[0.05]">
        <div className="text-[11.5px] text-fog-500">Formats que je sais lire, sans rien installer :</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {FORMATS.map(({ Icon, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2 py-1 text-[11px] text-fog-300">
              <Icon size={12} className="text-fog-500" /> {label}
            </span>
          ))}
        </div>
        <div className="mt-2 text-[11px] leading-snug text-fog-700">
          Les PDF scannés et les images sont lus sur ton PC par la lecture de texte de Windows. Les anciens formats .doc, .xls et .ppt doivent être réenregistrés en .docx, .xlsx ou .pptx.
        </div>
      </div>
    </div>
  )
}

export function ExtensionsView() {
  const [tab, setTab] = useState<Tab>('folders')
  const counts = {
    folders: useCompi((s) => s.settings?.folders.length ?? 0),
    connectors: useCompi((s) => s.settings?.connectors.length ?? 0)
  }

  return (
    <div className="scroll-y flex-1 space-y-4 px-5 pt-1 pb-5">
      <Segmented<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: 'folders', label: counts.folders ? `Dossiers · ${counts.folders}` : 'Dossiers' },
          { value: 'connectors', label: counts.connectors ? `Connecteurs · ${counts.connectors}` : 'Connecteurs' },
          { value: 'skills', label: 'Compétences' }
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}>
          {tab === 'folders' ? <FoldersPanel /> : tab === 'connectors' ? <ConnectorsPanel /> : <SkillsPanel />}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
