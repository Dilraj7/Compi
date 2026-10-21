// « Toujours » sur une carte Claude Code : Compi renvoie les règles proposées par
// Claude Code (permission_suggestions), que Claude Code enregistre lui-même.
// Cette phrase dit en clair ce qui sera enregistré et où. Fonction pure, testée
// dans tests/hookServer.test.ts.

type Rule = { toolName?: unknown; ruleContent?: unknown }
type Suggestion = {
  type?: unknown
  rules?: unknown
  behavior?: unknown
  mode?: unknown
  directories?: unknown
  destination?: unknown
}

const WHERE: Record<string, string> = {
  session: 'pour cette session',
  cliArg: 'pour cette session',
  localSettings: 'dans ce projet, sur ce PC',
  projectSettings: 'dans ce projet (réglage partagé)',
  userSettings: 'dans tous tes projets'
}

const MODES: Record<string, string> = {
  acceptEdits: 'accepter les modifications de fichiers sans demander',
  bypassPermissions: 'ne plus rien demander',
  plan: 'passer en mode plan',
  default: 'revenir au mode normal',
  dontAsk: 'refuser ce qui n’est pas déjà autorisé',
  auto: 'laisser Claude Code décider seul'
}

const ruleText = (r: Rule): string => {
  const tool = typeof r.toolName === 'string' ? r.toolName : 'outil'
  return typeof r.ruleContent === 'string' && r.ruleContent ? `${tool}(${r.ruleContent})` : tool
}

/** « Autoriser Bash(npm test:*) dans ce projet, sur ce PC », ou `undefined` si rien de lisible. */
export function describeSuggestions(suggestions: unknown): string | undefined {
  if (!Array.isArray(suggestions)) return undefined
  const parts: string[] = []
  for (const raw of suggestions as Suggestion[]) {
    if (!raw || typeof raw !== 'object') continue
    const where = WHERE[String(raw.destination)] ?? ''
    const rules = Array.isArray(raw.rules) ? (raw.rules as Rule[]).map(ruleText).join(', ') : ''
    let what = ''
    switch (raw.type) {
      case 'addRules':
      case 'replaceRules':
        if (rules) what = `${raw.behavior === 'deny' ? 'Refuser' : raw.behavior === 'ask' ? 'Toujours demander pour' : 'Autoriser'} ${rules}`
        break
      case 'removeRules':
        if (rules) what = `Retirer la règle ${rules}`
        break
      case 'setMode':
        what = MODES[String(raw.mode)] ? MODES[String(raw.mode)][0].toUpperCase() + MODES[String(raw.mode)].slice(1) : ''
        break
      case 'addDirectories':
        if (Array.isArray(raw.directories) && raw.directories.length) what = `Donner accès à ${raw.directories.map(String).join(', ')}`
        break
    }
    if (what) parts.push(where ? `${what} ${where}` : what)
  }
  return parts.length ? parts.join(' ; ').slice(0, 300) : undefined
}
