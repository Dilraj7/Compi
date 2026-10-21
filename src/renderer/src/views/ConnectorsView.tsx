import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowLeft,
  BookOpen,
  Box,
  Brain,
  Bug,
  CalendarRange,
  CheckSquare,
  CreditCard,
  FolderOpen,
  GitBranch,
  Globe,
  Kanban,
  KeyRound,
  LayoutGrid,
  ListChecks,
  LogIn,
  MonitorPlay,
  NotebookPen,
  Palette,
  Pencil,
  PenTool,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  SquareKanban,
  StickyNote,
  TerminalSquare,
  Trash2,
  Triangle,
  Workflow,
  Zap
} from 'lucide-react'
import type { ConnectorConfig, ConnectorTestResult, RegistryEntry } from '@shared/types'
import { useCompi } from '../store'
import { Badge, Button, LedDots, TextInput, Toggle, cx } from '../components/ui'

interface Template {
  id: string
  name: string
  description: string
  category: string
  Icon: typeof Globe
  transport: 'stdio' | 'http'
  command?: string
  args?: string
  url?: string
  secretKeys?: string[]
  secretHint?: string
  /** Gardé pour l'icône des connecteurs existants, mais absent du catalogue. */
  hidden?: boolean
  /** Connexion par compte en un clic (OAuth, enregistrement automatique du client). */
  auth?: 'oauth'
}

/** Connecteur « par compte » : on se connecte sur la page du service, sans clé à copier. */
const account = (id: string, name: string, description: string, category: string, Icon: typeof Globe, url: string): Template => ({
  id,
  name,
  description,
  category,
  Icon,
  transport: 'http',
  url,
  auth: 'oauth'
})

// Serveurs officiels des services, vérifiés en octobre 2026 : connexion par compte
// avec enregistrement automatique (Slack ne le permet pas : passer par Zapier).
// Les anciens modèles à clé restent pour les connecteurs déjà ajoutés.
const TEMPLATES: Template[] = [
  account('notion-account', 'Notion', 'Pages, bases de données et notes de ton espace Notion', 'Productivité', NotebookPen, 'https://mcp.notion.com/mcp'),
  account('todoist-account', 'Todoist', 'Tes tâches et projets : lire, ajouter, cocher', 'Productivité', CheckSquare, 'https://ai.todoist.net/mcp'),
  account('linear-account', 'Linear', 'Tickets, projets et cycles de ton équipe', 'Productivité', SquareKanban, 'https://mcp.linear.app/mcp'),
  account('atlassian-account', 'Jira et Confluence', 'Tickets Jira et pages Confluence (Atlassian)', 'Productivité', Kanban, 'https://mcp.atlassian.com/v1/mcp'),
  account('monday-account', 'monday.com', 'Tableaux, éléments et mises à jour', 'Productivité', CalendarRange, 'https://mcp.monday.com/mcp'),
  account('clickup-account', 'ClickUp', 'Tâches, listes et documents', 'Productivité', ListChecks, 'https://mcp.clickup.com/mcp'),
  account('airtable-account', 'Airtable', 'Lire et mettre à jour tes bases Airtable', 'Productivité', LayoutGrid, 'https://mcp.airtable.com/mcp'),
  account('zapier-account', 'Zapier', 'Slack, Outlook, Teams… plus de 8 000 apps, selon ce que tu autorises dans Zapier', 'Productivité', Workflow, 'https://mcp.zapier.com/api/mcp/mcp'),
  account('dropbox-account', 'Dropbox', 'Chercher et lire tes fichiers Dropbox', 'Fichiers et création', Box, 'https://mcp.dropbox.com/mcp'),
  account('canva-account', 'Canva', 'Tes designs : chercher, créer, exporter', 'Fichiers et création', Palette, 'https://mcp.canva.com/mcp'),
  account('figma-account', 'Figma', 'Lire tes fichiers et maquettes Figma', 'Fichiers et création', PenTool, 'https://mcp.figma.com/mcp'),
  account('miro-account', 'Miro', 'Tableaux blancs, post-it et schémas', 'Fichiers et création', StickyNote, 'https://mcp.miro.com/'),
  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Recherche web, actualités et images, indépendante',
    category: 'Recherche',
    Icon: Search,
    transport: 'stdio',
    command: 'npx',
    args: '-y @brave/brave-search-mcp-server',
    secretKeys: ['BRAVE_API_KEY'],
    secretHint: 'clé sur brave.com/search/api'
  },
  {
    id: 'playwright',
    name: 'Navigateur',
    description: 'Pilote un vrai navigateur : pages dynamiques, formulaires, captures',
    category: 'Recherche',
    Icon: MonitorPlay,
    transport: 'stdio',
    command: 'npx',
    args: '-y @playwright/mcp@latest'
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Documentation à jour des bibliothèques de code',
    category: 'Recherche',
    Icon: BookOpen,
    transport: 'http',
    url: 'https://mcp.context7.com/mcp'
  },
  {
    id: 'microsoft-learn',
    name: 'Microsoft Learn',
    description: 'Documentation officielle Microsoft, Windows et Azure',
    category: 'Recherche',
    Icon: BookOpen,
    transport: 'http',
    url: 'https://learn.microsoft.com/api/mcp'
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Dépôts, issues et pull requests',
    category: 'Développement',
    Icon: GitBranch,
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    secretKeys: ['Authorization'],
    secretHint: 'Bearer ghp_… (jeton d’accès personnel)'
  },
  account('sentry-account', 'Sentry', 'Erreurs et incidents de tes applications', 'Développement', Bug, 'https://mcp.sentry.dev/mcp'),
  account('vercel-account', 'Vercel', 'Projets, déploiements et journaux', 'Développement', Triangle, 'https://mcp.vercel.com'),
  account('stripe-account', 'Stripe', 'Paiements, clients et factures de ton compte Stripe', 'Développement', CreditCard, 'https://mcp.stripe.com'),
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Modèles, jeux de données et Spaces',
    category: 'Développement',
    Icon: Sparkles,
    transport: 'http',
    url: 'https://huggingface.co/mcp',
    secretKeys: ['Authorization'],
    secretHint: 'Bearer hf_… (facultatif)'
  },
  {
    id: 'memory',
    name: 'Graphe de mémoire',
    description: 'Une base de connaissances qui grandit avec toi',
    category: 'Autres',
    Icon: Brain,
    transport: 'stdio',
    command: 'npx',
    args: '-y @modelcontextprotocol/server-memory'
  },
  {
    id: 'custom-http',
    name: 'Serveur distant',
    description: 'Tout serveur MCP accessible par une URL, avec une clé ou un compte',
    category: 'Autres',
    Icon: Globe,
    transport: 'http',
    secretKeys: ['Authorization'],
    secretHint: 'Bearer … (si le serveur le demande)'
  },
  {
    id: 'custom-stdio',
    name: 'Commande locale',
    description: 'Un serveur MCP lancé sur ton PC',
    category: 'Autres',
    Icon: TerminalSquare,
    transport: 'stdio'
  },
  // Anciens modèles (clé à copier), gardés pour les connecteurs déjà ajoutés.
  {
    id: 'notion',
    name: 'Notion (clé)',
    description: '',
    category: 'Autres',
    Icon: NotebookPen,
    transport: 'stdio',
    command: 'npx',
    args: '-y @notionhq/notion-mcp-server',
    secretKeys: ['NOTION_TOKEN'],
    secretHint: 'ntn_… (notion.so/my-integrations)',
    hidden: true
  },
  {
    id: 'todoist',
    name: 'Todoist (clé)',
    description: '',
    category: 'Autres',
    Icon: CheckSquare,
    transport: 'stdio',
    command: 'npx',
    args: '-y @doist/todoist-mcp',
    secretKeys: ['TODOIST_API_KEY'],
    secretHint: 'Réglages › Intégrations › Développeur',
    hidden: true
  },
  {
    id: 'airtable',
    name: 'Airtable (clé)',
    description: '',
    category: 'Autres',
    Icon: LayoutGrid,
    transport: 'stdio',
    command: 'npx',
    args: '-y airtable-mcp-server',
    secretKeys: ['AIRTABLE_API_KEY'],
    secretHint: 'pat… (airtable.com/create/tokens)',
    hidden: true
  },
  {
    id: 'zapier',
    name: 'Zapier (clé)',
    description: '',
    category: 'Autres',
    Icon: Workflow,
    transport: 'http',
    secretKeys: ['Authorization'],
    secretHint: 'Bearer … (si ton URL Zapier n’inclut pas déjà la clé)',
    hidden: true
  },
  {
    id: 'stripe',
    name: 'Stripe (clé)',
    description: '',
    category: 'Autres',
    Icon: CreditCard,
    transport: 'http',
    url: 'https://mcp.stripe.com',
    secretKeys: ['Authorization'],
    secretHint: 'Bearer rk_… (clé restreinte conseillée)',
    hidden: true
  },
  {
    id: 'filesystem',
    name: 'Fichiers',
    description: 'Remplacé par l’onglet Dossiers',
    category: 'Autres',
    Icon: FolderOpen,
    transport: 'stdio',
    hidden: true
  }
]

const CATEGORIES = ['Productivité', 'Fichiers et création', 'Recherche', 'Développement', 'Autres']

function parseArgs(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2])
}

function joinArgs(args: string[] = []): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')
}

interface Draft {
  config: ConnectorConfig
  argsLine: string
  secrets: Array<{ name: string; value: string }>
  hint?: string
  /** Aide par secret (résultats du registre). */
  hints?: Record<string, string>
  /** Message affiché en haut du formulaire (prérequis, avertissement). */
  note?: string
}

function draftFrom(t: Template): Draft {
  return {
    config: { id: '', name: t.name, enabled: true, transport: t.transport, command: t.command, url: t.url, templateId: t.id },
    argsLine: t.args ?? '',
    secrets: (t.secretKeys ?? []).map((name) => ({ name, value: '' })),
    hint: t.secretHint,
    note: t.transport === 'stdio' && t.command === 'npx' ? 'Ce connecteur tourne sur ton PC et demande Node.js (nodejs.org).' : undefined
  }
}

function draftFromRegistry(e: RegistryEntry): Draft {
  return {
    config: e.config,
    argsLine: joinArgs(e.config.args),
    secrets: e.secrets.map((name) => ({ name, value: '' })),
    hints: e.hints,
    note: [
      'Serveur publié par un tiers dans le registre MCP : ajoute-le seulement si tu lui fais confiance.',
      e.requirement,
      e.kind === 'remote' ? 'S’il demande un compte plutôt qu’une clé, choisis « Se connecter avec un compte ».' : undefined
    ]
      .filter(Boolean)
      .join(' ')
  }
}

const cleanError = (e: unknown): string => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/**
 * Connexion par compte : la page du service s'ouvre dans le navigateur, l'utilisateur
 * accepte, Compi reçoit un accès (chiffré sur le PC) qu'il peut retirer à tout moment.
 */
function OAuthConnect({ config, template, onDone }: { config: ConnectorConfig; template?: Template; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'waiting' | { error: string }>('idle')
  const Icon = template?.Icon ?? Globe
  const name = config.name || template?.name || 'ce service'
  const reconnect = Boolean(config.id)

  const connect = async (): Promise<void> => {
    setState('waiting')
    try {
      const r = await window.compi.connectorOAuth(config)
      useCompi.getState().setSettings(r.settings)
      if (r.ok) onDone()
      else setState({ error: r.message ?? 'Connexion impossible.' })
    } catch (e) {
      setState({ error: cleanError(e) })
    }
  }

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl bg-ink-850/90 p-3.5 ring-1 ring-inset ring-white/[0.06]">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--led)]/12 text-[var(--led)]">
          <Icon size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-fog-100">{name}</div>
          <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">{template?.description || config.url}</div>
        </div>
      </div>

      <div className="space-y-1.5 px-0.5 text-[11.5px] leading-snug text-fog-500">
        {[
          `J’ouvre la page de ${name} dans ton navigateur : connecte-toi et accepte. Aucun mot de passe ni clé ne passe par moi.`,
          'L’accès reçu reste chiffré sur ton PC. Tu peux le retirer ici (supprimer le connecteur) ou dans ton compte, à tout moment.',
          `Je te demande ton accord la première fois que j’utilise chaque action de ${name}. Avec un cerveau en ligne, ce que ${name} me renvoie part vers lui.`
        ].map((t) => (
          <div key={t} className="flex gap-2">
            <KeyRound size={12} className="mt-[2px] shrink-0 text-[var(--led)]" />
            <span>{t}</span>
          </div>
        ))}
      </div>

      {state === 'waiting' ? (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-inset ring-white/[0.06]">
          <span className="flex items-center gap-2 text-[12px] text-fog-300">
            <LedDots /> En attente de ton accord dans le navigateur…
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void window.compi.connectorOAuthCancel()
              setState('idle')
            }}
          >
            Annuler
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {typeof state === 'object' && <div className="px-0.5 text-[11.5px] leading-snug text-led-red">{state.error}</div>}
          <div className="flex justify-end gap-1.5">
            <Button variant="ghost" onClick={onDone}>
              Annuler
            </Button>
            <Button variant="primary" onClick={() => void connect()}>
              <LogIn size={13} /> {reconnect ? `Se reconnecter à ${name}` : `Se connecter à ${name}`}
            </Button>
          </div>
        </div>
      )}
    </motion.div>
  )
}

function ConnectorForm({
  initial,
  existingSecrets,
  onDone,
  onAccount
}: {
  initial: Draft
  existingSecrets: string[]
  onDone: () => void
  /** Serveur distant : se connecter avec un compte plutôt qu'une clé. */
  onAccount: (config: ConnectorConfig) => void
}) {
  const [d, setD] = useState<Draft>(initial)
  const [saving, setSaving] = useState(false)
  const setConfig = (patch: Partial<ConnectorConfig>): void => setD((x) => ({ ...x, config: { ...x.config, ...patch } }))
  const stdio = d.config.transport === 'stdio'
  const valid = d.config.name.trim() && (stdio ? d.config.command?.trim() : /^https?:\/\//.test(d.config.url ?? ''))

  const save = async (): Promise<void> => {
    setSaving(true)
    const secretNames = [...new Set([...existingSecrets, ...d.secrets.map((s) => s.name.trim()).filter(Boolean)])]
    const config: ConnectorConfig = {
      ...d.config,
      name: d.config.name.trim(),
      args: stdio ? parseArgs(d.argsLine) : undefined,
      command: stdio ? d.config.command?.trim() : undefined,
      url: stdio ? undefined : d.config.url?.trim(),
      envKeys: stdio ? secretNames : undefined,
      headerKeys: stdio ? undefined : secretNames
    }
    const values = Object.fromEntries(d.secrets.filter((s) => s.name.trim()).map((s) => [s.name.trim(), s.value]))
    useCompi.getState().setSettings(await window.compi.saveConnector(config, values))
    onDone()
  }

  return (
    <motion.div initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} className="space-y-3">
      {d.note && (
        <div className="flex items-start gap-2 rounded-xl bg-led-amber/[0.07] px-3 py-2 text-[11.5px] leading-snug text-fog-300 ring-1 ring-inset ring-led-amber/20">
          <ShieldAlert size={13} className="mt-px shrink-0 text-led-amber" /> {d.note}
        </div>
      )}
      <label className="block">
        <span className="mb-1 block text-[11.5px] text-fog-500">Nom</span>
        <TextInput value={d.config.name} onChange={(e) => setConfig({ name: e.target.value })} />
      </label>
      {stdio ? (
        <div className="grid grid-cols-[140px_1fr] gap-2">
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-fog-500">Commande</span>
            <TextInput className="font-mono" value={d.config.command ?? ''} placeholder="npx" onChange={(e) => setConfig({ command: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] text-fog-500">Arguments</span>
            <TextInput className="font-mono" value={d.argsLine} placeholder="-y @scope/serveur-mcp" onChange={(e) => setD((x) => ({ ...x, argsLine: e.target.value }))} />
          </label>
        </div>
      ) : (
        <label className="block">
          <span className="mb-1 block text-[11.5px] text-fog-500">URL du serveur MCP</span>
          <TextInput className="font-mono" value={d.config.url ?? ''} placeholder="https://…/mcp" onChange={(e) => setConfig({ url: e.target.value })} />
        </label>
      )}

      <div>
        <span className="mb-1 block text-[11.5px] text-fog-500">
          {stdio ? 'Variables d’environnement secrètes' : 'En-têtes HTTP secrets'} <span className="text-fog-700">· chiffrés par Windows</span>
        </span>
        <div className="space-y-1.5">
          {d.secrets.map((s, i) => {
            const hint = d.hints?.[s.name] ?? d.hint
            return (
              <div key={i}>
                <div className="grid grid-cols-[150px_1fr_auto] gap-2">
                  <TextInput
                    className="font-mono"
                    placeholder={stdio ? 'API_KEY' : 'Authorization'}
                    value={s.name}
                    onChange={(e) => setD((x) => ({ ...x, secrets: x.secrets.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))}
                  />
                  <TextInput
                    type="password"
                    placeholder={existingSecrets.includes(s.name) ? '•••••••• (inchangé)' : 'valeur'}
                    value={s.value}
                    onChange={(e) => setD((x) => ({ ...x, secrets: x.secrets.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) }))}
                  />
                  <button
                    className="grid size-8.5 place-items-center rounded-xl text-fog-700 hover:bg-white/[0.06] hover:text-fog-300"
                    onClick={() => setD((x) => ({ ...x, secrets: x.secrets.filter((_, j) => j !== i) }))}
                    aria-label="Retirer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {hint && <div className="mt-1 pl-[158px] text-[11px] leading-snug text-fog-700">{hint}</div>}
              </div>
            )
          })}
          <Button size="sm" variant="ghost" onClick={() => setD((x) => ({ ...x, secrets: [...x.secrets, { name: '', value: '' }] }))}>
            <Plus size={13} /> Ajouter un secret
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-end gap-1.5 pt-1">
        {!stdio && (
          <Button
            variant="subtle"
            className="mr-auto"
            disabled={!valid}
            title="Pour un serveur qui demande de se connecter (OAuth) plutôt qu’une clé"
            onClick={() => onAccount({ ...d.config, name: d.config.name.trim(), url: d.config.url?.trim(), headerKeys: undefined })}
          >
            <LogIn size={13} /> Se connecter avec un compte
          </Button>
        )}
        <Button variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button variant="primary" disabled={!valid || saving} onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>
    </motion.div>
  )
}

function ConnectorCard({ c, onEdit, onLogin }: { c: ConnectorConfig; onEdit: () => void; onLogin: () => void }) {
  const [test, setTest] = useState<ConnectorTestResult | 'running' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const authState = useCompi((s) => s.settings?.connectorAuth?.[c.id])
  const template = TEMPLATES.find((t) => t.id === c.templateId)
  const Icon = template?.Icon ?? (c.transport === 'http' ? Globe : TerminalSquare)
  const oauth = c.auth === 'oauth'
  const needsLogin = (oauth && (!authState?.connected || authState.expired)) || (test !== 'running' && test?.needsLogin)

  return (
    <motion.div layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-ink-850/90 p-3.5 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-center gap-3">
        <span className={cx('grid size-9 place-items-center rounded-xl', c.enabled ? 'bg-[var(--led)]/12 text-[var(--led)]' : 'bg-white/[0.05] text-fog-700')}>
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold text-fog-100">{c.name}</span>
            {oauth ? (
              needsLogin ? (
                <Badge color="#FBBF24">À reconnecter</Badge>
              ) : (
                <Badge color="#4ADE80">Compte</Badge>
              )
            ) : (
              <Badge>{c.transport === 'http' ? 'Distant' : 'Local'}</Badge>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[10.5px] text-fog-700">
            {c.transport === 'http' ? c.url : `${c.command} ${joinArgs(c.args)}`}
          </div>
        </div>
        <Toggle
          checked={c.enabled}
          label="Activer"
          onChange={(enabled) => void window.compi.saveConnector({ ...c, enabled }, {}).then(useCompi.getState().setSettings)}
        />
      </div>
      <div className="mt-3 flex items-center gap-1.5">
        <Button
          size="sm"
          variant="subtle"
          disabled={test === 'running'}
          onClick={() => {
            setTest('running')
            void window.compi.testConnector(c.id).then(setTest)
          }}
        >
          <Zap size={12} /> Tester
        </Button>
        {needsLogin ? (
          <Button size="sm" variant="primary" onClick={onLogin}>
            <LogIn size={12} /> {oauth ? 'Se reconnecter' : 'Se connecter'}
          </Button>
        ) : oauth ? (
          <Button size="sm" variant="ghost" onClick={onLogin} title="Changer de compte ou renouveler l’accès">
            <LogIn size={12} /> Reconnecter
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <Pencil size={12} /> Modifier
          </Button>
        )}
        <div className="min-w-0 flex-1 truncate px-1 text-[11.5px]">
          {test === 'running' && (
            <span className="inline-flex items-center gap-2 text-fog-500">
              <LedDots /> Connexion…
            </span>
          )}
          {test && test !== 'running' && (
            <span className={test.ok ? 'text-led-green' : 'text-led-red'} title={test.tools?.join(', ') ?? test.message}>
              {test.message}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant={confirmDelete ? 'danger' : 'ghost'}
          onBlur={() => setConfirmDelete(false)}
          onClick={() => {
            if (!confirmDelete) return setConfirmDelete(true)
            void window.compi.deleteConnector(c.id).then(useCompi.getState().setSettings)
          }}
        >
          <Trash2 size={12} /> {confirmDelete ? 'Confirmer' : ''}
        </Button>
      </div>
    </motion.div>
  )
}

/** Recherche dans le registre officiel des serveurs MCP. */
function RegistrySearch({ onPick }: { onPick: (e: RegistryEntry) => void }) {
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | { results: RegistryEntry[] } | { error: string }>('idle')

  const run = (): void => {
    if (!query.trim()) return
    setState('loading')
    window.compi.searchRegistry(query).then(
      (results) => setState({ results }),
      (e: Error) => setState({ error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <TextInput
          placeholder="Chercher dans le registre MCP officiel (ex. Slack, Jira, Spotify)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <Button variant="subtle" disabled={!query.trim() || state === 'loading'} onClick={run}>
          <Search size={13} /> Chercher
        </Button>
      </div>
      {state === 'loading' && (
        <div className="flex items-center gap-2 px-1 text-[11.5px] text-fog-500">
          <LedDots /> Recherche dans le registre…
        </div>
      )}
      {typeof state === 'object' && 'error' in state && <div className="px-1 text-[11.5px] text-led-red">{state.error}</div>}
      {typeof state === 'object' && 'results' in state && (
        <div className="space-y-1.5">
          {state.results.length === 0 && <div className="px-1 text-[11.5px] text-fog-500">Aucun serveur compatible trouvé.</div>}
          {state.results.map((r) => (
            <button
              key={r.id}
              onClick={() => onPick(r)}
              className="flex w-full items-start gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5 text-left ring-1 ring-inset ring-white/[0.05] transition-colors hover:bg-white/[0.06]"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[12.5px] font-medium text-fog-100">{r.title}</span>
                  <Badge>{r.kind === 'remote' ? 'Distant' : r.kind === 'npm' ? 'Local · Node.js' : 'Local · Python'}</Badge>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-fog-500">{r.description || r.id}</span>
                <span className="mt-0.5 block truncate font-mono text-[10px] text-fog-700">{r.id}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type Mode = 'list' | 'pick' | { draft: Draft; existing: string[] } | { oauth: ConnectorConfig; template?: Template }

/** Configuration d'un nouveau connecteur par compte, à partir de son modèle. */
const oauthConfig = (t: Template): ConnectorConfig => ({ id: '', name: t.name, enabled: true, transport: 'http', url: t.url, templateId: t.id, auth: 'oauth' })

export function ConnectorsPanel() {
  const settings = useCompi((s) => s.settings)
  const [mode, setMode] = useState<Mode>('list')
  const connectors = settings?.connectors ?? []

  return (
    <AnimatePresence mode="wait" initial={false}>
      {mode === 'list' && (
        <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-0.5">
            <p className="text-[11.5px] leading-snug text-fog-500">Branche des services pour que je puisse agir dessus : Notion, Todoist, Linear, Zapier… La plupart se connectent en un clic avec ton compte.</p>
            <Button size="sm" variant="primary" onClick={() => setMode('pick')}>
              <Plus size={13} /> Ajouter
            </Button>
          </div>
          {connectors.length === 0 ? (
            <button
              onClick={() => setMode('pick')}
              className="w-full rounded-2xl border border-dashed border-white/[0.1] px-4 py-8 text-center text-[12.5px] text-fog-500 transition-colors hover:border-[var(--led)]/40 hover:text-fog-300"
            >
              Aucun connecteur pour l’instant.
              <br />
              Ajoute Notion, Todoist, Linear, Dropbox, ou n’importe quel serveur MCP.
            </button>
          ) : (
            connectors.map((c) => (
              <ConnectorCard
                key={c.id}
                c={c}
                onEdit={() =>
                  setMode({
                    draft: {
                      config: c,
                      argsLine: joinArgs(c.args),
                      secrets: (settings?.connectorSecrets[c.id] ?? []).map((name) => ({ name, value: '' })),
                      hint: TEMPLATES.find((t) => t.id === c.templateId)?.secretHint
                    },
                    existing: settings?.connectorSecrets[c.id] ?? []
                  })
                }
                onLogin={() => setMode({ oauth: c, template: TEMPLATES.find((t) => t.id === c.templateId) })}
              />
            ))
          )}
        </motion.div>
      )}

      {mode === 'pick' && (
        <motion.div key="pick" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="space-y-4">
          <button onClick={() => setMode('list')} className="inline-flex items-center gap-1.5 text-[12px] text-fog-500 hover:text-fog-100">
            <ArrowLeft size={13} /> Retour
          </button>
          <RegistrySearch onPick={(e) => setMode({ draft: draftFromRegistry(e), existing: [] })} />
          {CATEGORIES.map((cat) => (
            <section key={cat} className="space-y-2">
              <h4 className="led-text px-0.5 text-[10.5px] text-fog-700">{cat}</h4>
              <div className="grid grid-cols-2 gap-2">
                {TEMPLATES.filter((t) => t.category === cat && !t.hidden).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setMode(t.auth === 'oauth' ? { oauth: oauthConfig(t), template: t } : { draft: draftFrom(t), existing: [] })}
                    className="group flex items-start gap-3 rounded-2xl bg-ink-850/90 p-3 text-left ring-1 ring-inset ring-white/[0.06] transition-all hover:-translate-y-px hover:ring-[var(--led)]/40"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-fog-300 transition-colors group-hover:bg-[var(--led)]/12 group-hover:text-[var(--led)]">
                      <t.Icon size={15} />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="text-[12.5px] font-semibold text-fog-100">{t.name}</span>
                        {t.transport === 'stdio' && t.command === 'npx' && <span className="text-[10px] text-fog-700">Node.js</span>}
                        {t.auth === 'oauth' && <span className="text-[10px] text-fog-700">en un clic</span>}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-fog-500">{t.description}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </motion.div>
      )}

      {typeof mode === 'object' && 'draft' in mode && (
        <motion.div key="form" className="space-y-3">
          <button onClick={() => setMode('list')} className="inline-flex items-center gap-1.5 text-[12px] text-fog-500 hover:text-fog-100">
            <ArrowLeft size={13} /> Retour
          </button>
          <ConnectorForm
            initial={mode.draft}
            existingSecrets={mode.existing}
            onDone={() => setMode('list')}
            onAccount={(config) => setMode({ oauth: { ...config, auth: 'oauth' }, template: TEMPLATES.find((t) => t.id === config.templateId) })}
          />
        </motion.div>
      )}

      {typeof mode === 'object' && 'oauth' in mode && (
        <motion.div key="oauth" className="space-y-3">
          <button onClick={() => setMode('list')} className="inline-flex items-center gap-1.5 text-[12px] text-fog-500 hover:text-fog-100">
            <ArrowLeft size={13} /> Retour
          </button>
          <OAuthConnect config={mode.oauth} template={mode.template} onDone={() => setMode('list')} />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
