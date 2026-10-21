import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowLeft, FileArchive, FolderInput, FolderOpen, Pencil, Plus, Trash2, Wand2 } from 'lucide-react'
import type { SkillDraft, SkillInfo } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, TextArea, TextInput, Toggle, cx } from '../components/ui'

const cleanError = (e: Error): string => e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** « compte-rendu-reunion » → « Compte rendu reunion ». */
const pretty = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1).replace(/-/g, ' ')

const EMPTY: SkillDraft = { name: '', description: '', body: '' }

function SkillForm({ initial, onDone }: { initial: SkillDraft; onDone: (list?: SkillInfo[]) => void }) {
  const [d, setD] = useState<SkillDraft>(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const valid = d.name.trim() && d.description.trim() && d.body.trim()

  const save = (): void => {
    setSaving(true)
    setError('')
    window.compi.saveSkill(d).then(onDone, (e: Error) => {
      setError(cleanError(e))
      setSaving(false)
    })
  }

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-[11.5px] text-fog-500">Nom</span>
        <TextInput placeholder="ex. Préparer un devis" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11.5px] text-fog-500">
          Quand l’utiliser <span className="text-fog-700">· c’est ce texte qui me fait choisir la compétence</span>
        </span>
        <TextArea
          rows={2}
          placeholder="ex. Rédige un devis à partir d’une demande client. À utiliser quand on parle de devis, de chiffrage ou de proposition commerciale."
          value={d.description}
          onChange={(e) => setD({ ...d, description: e.target.value })}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-[11.5px] text-fog-500">
          Instructions <span className="text-fog-700">· Markdown : étapes, format attendu, pièges à éviter</span>
        </span>
        <TextArea
          rows={11}
          className="font-mono text-[11.5px]"
          placeholder={'# Préparer un devis\n\n1. …\n2. …\n\nFormat de la réponse :\n- …'}
          value={d.body}
          onChange={(e) => setD({ ...d, body: e.target.value })}
        />
      </label>
      {error && <div className="text-[11.5px] text-led-red">{error}</div>}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" onClick={() => onDone()}>
          Annuler
        </Button>
        <Button variant="primary" disabled={!valid || saving} onClick={save}>
          Enregistrer
        </Button>
      </div>
    </motion.div>
  )
}

function SkillCard({ skill, enabled, onToggle, onEdit, onDelete }: { skill: SkillInfo; enabled: boolean; onToggle: (v: boolean) => void; onEdit: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-ink-850/90 p-3 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-start gap-3">
        <span className={cx('mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl', enabled && skill.valid ? 'bg-[var(--led)]/12 text-[var(--led)]' : 'bg-white/[0.05] text-fog-700')}>
          <Wand2 size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12.5px] font-semibold text-fog-100">{skill.title ?? pretty(skill.name)}</span>
            {skill.builtin && <Badge>De base</Badge>}
            {skill.hasFiles && (
              <span title="Contient des fichiers (modèles, scripts). Les scripts ne s’exécutent qu’en mode avancé.">
                <Badge>Fichiers joints</Badge>
              </span>
            )}
            {!skill.valid && <Badge color="#F87171">Invalide</Badge>}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-fog-500">{skill.description}</div>
        </div>
        <Toggle checked={enabled && skill.valid} label="Activer" onChange={onToggle} />
      </div>
      <div className="mt-2 flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={!skill.valid}>
          <Pencil size={12} /> Modifier
        </Button>
        <Button
          size="sm"
          variant={confirm ? 'danger' : 'ghost'}
          onBlur={() => setConfirm(false)}
          onClick={() => (confirm ? onDelete() : setConfirm(true))}
        >
          <Trash2 size={12} /> {confirm ? 'Confirmer' : ''}
        </Button>
      </div>
    </motion.div>
  )
}

export function SkillsPanel() {
  const settings = useCompi((s) => s.settings)
  const setSettings = useCompi((s) => s.setSettings)
  const [skills, setSkills] = useState<SkillInfo[] | null>(null)
  const [editing, setEditing] = useState<SkillDraft | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.compi.listSkills().then(setSkills)
  }, [])

  const disabled = settings?.disabledSkills ?? []
  const toggle = (name: string, on: boolean): void =>
    void window.compi
      .updateSettings({ disabledSkills: on ? disabled.filter((n) => n !== name) : [...new Set([...disabled, name])] })
      .then(setSettings)

  const importSkill = (kind: 'folder' | 'archive'): void => {
    setError('')
    window.compi.importSkill(kind).then(setSkills, (e: Error) => setError(cleanError(e)))
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {editing ? (
        <motion.div key="form" className="space-y-3">
          <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 text-[12px] text-fog-500 hover:text-fog-100">
            <ArrowLeft size={13} /> Retour
          </button>
          <SkillForm
            initial={editing}
            onDone={(list) => {
              if (list) setSkills(list)
              setEditing(null)
            }}
          />
        </motion.div>
      ) : (
        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
          <p className="px-0.5 text-[11.5px] leading-snug text-fog-500">
            Des savoir-faire que j’applique quand ta demande s’y prête : résumé, compte-rendu, analyse de tableur… Crée les tiens ou importe-en (dossier avec un SKILL.md).
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="primary" onClick={() => setEditing(EMPTY)}>
              <Plus size={13} /> Nouvelle
            </Button>
            <Button size="sm" variant="subtle" onClick={() => importSkill('folder')}>
              <FolderInput size={13} /> Importer un dossier
            </Button>
            <Button size="sm" variant="subtle" onClick={() => importSkill('archive')}>
              <FileArchive size={13} /> Importer un .zip
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void window.compi.openSkillsFolder()}>
              <FolderOpen size={13} /> Ouvrir le dossier
            </Button>
          </div>
          {error && <div className="px-0.5 text-[11.5px] text-led-red">{error}</div>}
          {skills?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-6 text-center text-[12.5px] text-fog-500">Aucune compétence. Crée la première !</div>
          )}
          {skills?.map((sk) => (
            <SkillCard
              key={sk.name}
              skill={sk}
              enabled={!disabled.includes(sk.name)}
              onToggle={(on) => toggle(sk.name, on)}
              onEdit={() =>
                void window.compi.getSkill(sk.name).then((d) => d && setEditing({ ...d, name: sk.name, previousName: sk.name }))
              }
              onDelete={() => void window.compi.deleteSkill(sk.name).then(setSkills)}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
