import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Power, ShieldCheck, TerminalSquare, TriangleAlert, X } from 'lucide-react'
import { PRIVACY_CATEGORIES, type PrivacyChoice } from '@shared/privacy'
import type { HooksPreview, PublicSettings, Settings } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, Row, Section, Segmented, ShortcutInput, TextInput, Toggle, prettyShortcut } from '../components/ui'
import { BrainSection } from './BrainSection'
import { DaySection, GoogleSection } from './AccountsSection'
import { AgendaSourcesSection } from './AgendaSourcesSection'
import { LiveSection } from './LiveSection'
import { DictationSection } from './DictationSection'
import { MessagesSection } from './MessagesSection'

const TOOL_NAMES: Record<string, string> = {
  mcp__compi__clipboard_read: 'Lire le presse-papier',
  mcp__compi__clipboard_write: 'Écrire dans le presse-papier',
  mcp__compi__screen_capture: 'Regarder l’écran',
  mcp__compi__open_url: 'Ouvrir des liens',
  mcp__compi__open_path: 'Ouvrir des fichiers',
  mcp__compi__read_screen_text: 'Lire le texte de l’écran',
  mcp__compi__read_document: 'Lire des documents',
  Read: 'Lire des fichiers',
  Bash: 'Exécuter des commandes',
  Write: 'Créer des fichiers',
  Edit: 'Modifier des fichiers'
}

function ClaudeCodeSection({ s, apply }: { s: PublicSettings; apply: (p: Promise<PublicSettings>) => void }) {
  const [preview, setPreview] = useState<HooksPreview | null>(null)
  const [error, setError] = useState('')
  const connected = s.claudeCode.connected

  const run = (p: Promise<PublicSettings>): void => {
    setError('')
    p.then(
      (next) => {
        useCompi.getState().setSettings(next)
        setPreview(null)
      },
      (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
  }

  return (
    <Section title="Claude Code" hint="Statut de tes sessions et validation des permissions depuis l’îlot.">
      <div className="px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-xl bg-[#F59E7B]/12 text-[#F59E7B]">
              <TerminalSquare size={15} />
            </span>
            <div>
              <div className="flex items-center gap-2 text-[12.5px] text-fog-100">
                Pont Claude Code
                {connected ? <Badge color="#4ADE80">Connecté</Badge> : <Badge>Non connecté</Badge>}
              </div>
              <div className="text-[11.5px] text-fog-500">
                {connected
                  ? `À l’écoute sur 127.0.0.1:${s.claudeCode.port} — si Compi est fermé, Claude Code fonctionne normalement.`
                  : 'Ajoute des hooks à ~/.claude/settings.json (une sauvegarde est faite avant).'}
              </div>
            </div>
          </div>
          {connected ? (
            <Button size="sm" variant="danger" onClick={() => run(window.compi.disconnectClaudeCode())}>
              Déconnecter
            </Button>
          ) : (
            <Button
              size="sm"
              variant="subtle"
              onClick={() => window.compi.previewHooks().then(setPreview, (e: Error) => setError(`Lecture impossible de settings.json : ${e.message}`))}
            >
              Connecter…
            </Button>
          )}
        </div>

        <AnimatePresence>
          {preview && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="mt-3 rounded-xl bg-black/50 p-3 ring-1 ring-inset ring-white/[0.06]">
                <div className="text-[11.5px] text-fog-300">
                  Je vais modifier <span className="font-mono text-fog-100">{preview.settingsPath}</span>
                  {preview.exists ? ' (sauvegarde automatique avant écriture)' : ' (le fichier sera créé)'} :
                </div>
                <pre className="scroll-y mt-2 max-h-36 rounded-lg bg-black/60 p-2.5 font-mono text-[10.5px] leading-relaxed text-led-green/90 select-text">
                  {preview.after}
                </pre>
                <div className="mt-2.5 flex justify-end gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                    Annuler
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => run(window.compi.connectClaudeCode())}>
                    Confirmer
                  </Button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {error && <div className="mt-2 text-[11.5px] text-led-red">{error}</div>}
      </div>
      {connected && (
        <Row label="Délai de validation" hint="Passé ce délai, Claude Code reprend la main dans le terminal.">
          <Segmented
            value={String(s.claudeCode.permissionTimeoutSec)}
            options={[
              { value: '45', label: '45 s' },
              { value: '90', label: '90 s' },
              { value: '180', label: '3 min' }
            ]}
            onChange={(v) =>
              apply(
                window.compi.updateSettings({
                  claudeCode: {
                    ...s.claudeCode,
                    permissionTimeoutSec: Number(v)
                  }
                })
              )
            }
          />
        </Row>
      )}
    </Section>
  )
}

export function SettingsView() {
  const s = useCompi((st) => st.settings)
  const setSettings = useCompi((st) => st.setSettings)
  const [name, setName] = useState(s?.userName ?? '')
  const [error, setError] = useState('')
  const focus = useCompi((st) => st.settingsFocus)
  const focusSettings = useCompi((st) => st.focusSettings)
  const rootRef = useRef<HTMLDivElement>(null)

  // Ouvert sur une section (« Gérer » les règles « Toujours », palette Ctrl+K…) : on y descend.
  // Le questionnaire, la dictée et les messages ont leur propre défilement.
  useEffect(() => {
    if (!focus || focus === 'quiz' || focus === 'voice' || focus === 'messages') return
    // On efface la demande après le défilement : l'effacer avant annulerait le minuteur.
    const t = setTimeout(() => {
      rootRef.current?.querySelector(`[data-settings-focus="${focus}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      focusSettings(null)
    }, 120)
    return () => clearTimeout(t)
  }, [focus, focusSettings])

  if (!s) return null
  const apply = (p: Promise<PublicSettings>): void => {
    setError('')
    p.then(setSettings, (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')))
  }
  const update = (patch: Partial<Settings>): void => apply(window.compi.updateSettings(patch))

  return (
    <div ref={rootRef} className="scroll-y flex-1 space-y-5 px-5 pt-1 pb-5">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-[#F87171]/10 px-3 py-2 text-[11.5px] text-[#FCA5A5] ring-1 ring-inset ring-[#F87171]/25"
        >
          <TriangleAlert size={13} className="mt-px shrink-0" /> {error}
        </div>
      )}
      <div data-settings-focus="brain" className="scroll-mt-2">
        <BrainSection s={s} apply={apply} update={update} />
      </div>
      <GoogleSection s={s} apply={apply} update={update} />
      <DaySection s={s} apply={apply} update={update} />
      <div data-settings-focus="agenda" className="scroll-mt-2">
        <AgendaSourcesSection s={s} apply={apply} />
      </div>
      <DictationSection s={s} update={update} />
      <LiveSection s={s} update={update} />
      <MessagesSection s={s} update={update} />

      <Section title="Comportement">
        <Row label="Comment dois-je t’appeler ?">
          <TextInput
            className="w-44"
            placeholder="Ton prénom"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== s.userName && update({ userName: name.trim() })}
          />
        </Row>
        <Row
          label="Raccourci pour me parler"
          hint={
            s.shortcutActive ? (
              'Fonctionne partout dans Windows.'
            ) : (
              <span className="text-led-amber">Inactif : une autre app (1Password, Claude…) l’utilise déjà. Choisis-en un autre.</span>
            )
          }
        >
          <ShortcutInput value={s.shortcut} onChange={(shortcut) => update({ shortcut })} />
        </Row>
        <Row
          label="Actions rapides sur un texte"
          hint={
            s.quickShortcutActive ? (
              'Sélectionne un texte n’importe où, puis ce raccourci : Corriger, Traduire, Résumer…'
            ) : (
              <span className="text-led-amber">Inactif : combinaison déjà utilisée. Choisis-en une autre.</span>
            )
          }
        >
          <ShortcutInput value={s.quickShortcut} onChange={(quickShortcut) => update({ quickShortcut })} />
        </Row>
        <div data-settings-focus="keys" className="scroll-mt-2">
          <Row
            label="Répondre aux autorisations au clavier"
            hint={
              s.approvalKeys.enabled ? (
                <>
                  Depuis n’importe quelle application, seulement quand une carte attend (jamais « Toujours »). Dans le panneau : Entrée, Échap.
                  {s.approvalKeysTaken.length > 0 && (
                    <span className="block text-led-amber">
                      Déjà utilisé par une autre application : {s.approvalKeysTaken.map(prettyShortcut).join(', ')}. Choisis une autre combinaison.
                    </span>
                  )}
                </>
              ) : (
                'Désactivé : réponds aux cartes à la souris, ou au clavier dans le panneau.'
              )
            }
          >
            <Toggle
              checked={s.approvalKeys.enabled}
              onChange={(enabled) => update({ approvalKeys: { ...s.approvalKeys, enabled } })}
              label="Répondre aux autorisations au clavier"
            />
          </Row>
          {s.approvalKeys.enabled && (
            <>
              <Row label="Autoriser">
                <ShortcutInput value={s.approvalKeys.allow} onChange={(allow) => update({ approvalKeys: { ...s.approvalKeys, allow } })} />
              </Row>
              <Row label="Refuser">
                <ShortcutInput value={s.approvalKeys.deny} onChange={(deny) => update({ approvalKeys: { ...s.approvalKeys, deny } })} />
              </Row>
            </>
          )}
        </div>
        <Row label="Démarrer avec Windows">
          <Toggle checked={s.launchAtLogin} onChange={(launchAtLogin) => update({ launchAtLogin })} label="Démarrer avec Windows" />
        </Row>
        <Row label="Me faire discret" hint="Au repos, l’îlot devient une fine ligne lumineuse.">
          <Toggle checked={s.autoHide} onChange={(autoHide) => update({ autoHide })} label="Me faire discret" />
        </Row>
        <Row label="Mode avancé" hint="Compi peut exécuter des commandes et modifier des fichiers — toujours avec ta validation.">
          <Toggle checked={s.advancedMode} onChange={(advancedMode) => update({ advancedMode })} label="Mode avancé" />
        </Row>
      </Section>

      <ClaudeCodeSection s={s} apply={apply} />

      <div data-settings-focus="privacy" className="scroll-mt-2">
        <Section title="Confidentialité" hint="Aucune télémétrie, aucun compte. Tes secrets sont chiffrés par Windows.">
          <div className="px-3.5 pt-3 pb-1 text-[11.5px] leading-snug text-fog-500">
            Avec un cerveau local, rien ne quitte ton PC. Avec Claude ou un autre service en ligne, choisis ce que je peux lui envoyer. Les IBAN, cartes
            bancaires, mots de passe et clés sont masqués automatiquement.
          </div>
          {PRIVACY_CATEGORIES.map((c) => (
            <Row key={c.id} label={c.label} hint={c.id === 'memory' ? `${c.what} (« Toujours » : je m’en sers à chaque message)` : c.what}>
              <Segmented<PrivacyChoice>
                id={`privacy-${c.id}`}
                value={s.privacy[c.id]}
                options={[
                  { value: 'ask', label: 'Me demander' },
                  // Messages : une carte à chaque fois, jamais « Toujours ».
                  ...(c.noAlways ? [] : [{ value: 'always' as const, label: 'Toujours' }]),
                  { value: 'never', label: 'Jamais' }
                ]}
                onChange={(v) => update({ privacy: { ...s.privacy, [c.id]: v } })}
              />
            </Row>
          ))}
          <div className="px-3.5 py-3">
            <div className="flex items-center gap-2 text-[12.5px] text-fog-100">
              <ShieldCheck size={15} className="text-fog-500" /> Actions autorisées sans demander
            </div>
            {s.alwaysAllow.length === 0 ? (
              <div className="mt-1.5 text-[11.5px] text-fog-500">Aucune pour l’instant : je te demande à chaque fois.</div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {s.alwaysAllow.map((t) => (
                  <span key={t} className="inline-flex items-center gap-1 rounded-lg bg-white/[0.06] py-1 pr-1 pl-2 text-[11.5px] text-fog-300">
                    {TOOL_NAMES[t] ?? t.replace(/^mcp__/, '').replace(/__/g, ' · ')}
                    <button
                      className="grid size-4 place-items-center rounded text-fog-500 hover:bg-white/10 hover:text-fog-100"
                      onClick={() =>
                        update({
                          alwaysAllow: s.alwaysAllow.filter((x) => x !== t)
                        })
                      }
                      aria-label="Retirer l’autorisation"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </Section>
      </div>

      <div className="flex items-center justify-between px-1 pt-1 text-[11.5px] text-fog-700">
        <span>
          <span className="led-text text-fog-500">Compi</span> v0.1.0 · fait avec Claude
        </span>
        <Button size="sm" variant="ghost" onClick={() => window.compi.quit()}>
          <Power size={13} /> Quitter
        </Button>
      </div>
    </div>
  )
}
