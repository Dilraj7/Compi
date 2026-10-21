// Réponses qui annoncent une action sans l'avoir faite. Un petit modèle local
// écrivait « C'est fait, j'ai déplacé les dossiers » ou « Je lance l'analyse… »
// sans appeler aucun outil : l'utilisateur doit le voir. Fonctions pures,
// testées dans tests/claims.test.ts.

/**
 * `no-action` : action annoncée comme faite ; `stopped` : action annoncée, puis plus
 * rien ; `not-saved` : « c'est noté, je m'en souviendrai », ou une demande de retenir,
 * sans rien enregistré dans la mémoire (memory_save).
 */
export type MessageNotice = 'no-action' | 'stopped' | 'not-saved'

/** Outils qui ne font que lire : ils ne rendent pas vraie une phrase « j'ai déplacé… ». */
const READ_ONLY = new Set([
  'WebSearch',
  'WebFetch',
  'Read',
  'Glob',
  'Grep',
  'Skill',
  'TodoWrite',
  'get_datetime',
  'screen_capture',
  'read_screen_text',
  'clipboard_read',
  'clipboard_history',
  'read_document',
  'search_documents',
  'search_files',
  'folder_inventory',
  'list_windows',
  'windows_status',
  'memory_search',
  'now_playing',
  'timer_status',
  'reminder_list',
  'routine_list',
  'calendar_events',
  'mail_search',
  'mail_read',
  'weather_forecast',
  'fetch_page',
  'messages_recent',
  'use_extension',
  'ListMcpResourcesTool',
  'ReadMcpResourceTool'
])

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’`]/g, "'")

const DONE = [
  /\bc'est fait\b/,
  /\bj'ai (bien |deja |maintenant |aussi )?(cree|deplace|ouvert|range|lance|envoye|ajoute|supprime|renomme|copie|enregistre|programme|regle|organise|classe|archive|mis en place)e?s?\b/,
  /\b(dossiers?|fichiers?|elements?) (ont ete|a ete|sont) (deplace|cree|range|archive|renomme|classe)e?s?\b/,
  // En titre de liste : « Dossiers déplacés vers CompiDocs : »
  /^[\W\d]*(dossiers?|fichiers?|elements?) (deplace|cree|range|archive|renomme|classe)e?s?\b/m,
  /\b(c'est|voila,?) (ouvert|cree|range|deplace|lance)e?s?\b/
]
const PROMISED = [
  /\bje lance\b/,
  /\ben attente de\b/,
  /\bje (procede|commence|m'en occupe|m'occupe)\b/,
  /\bje (vais|m'apprete a) (maintenant |tout de suite |immediatement )?(lancer|creer|deplacer|ranger|lister|analyser|ouvrir|executer)\b/
]

/** « Je m'en souviendrai » : la réponse dit retenir une information. */
const REMEMBERED = [
  /\bc'est (bien )?note\b(?!\s+(sur|\d))/,
  /(^|[.!?…]\s+)(bien |ok,? |d'accord,? |parfait,? |super,? )?note\s*[!.]/m,
  /\bj'ai (bien )?note\b/,
  /\bje (le |l')?(note|retiens|memorise)\b/,
  /\bje m'en (souviens|souviendrai|rappellerai)\b/,
  /\bje (le |l'|la )?garde(rai)? (ca |cela |cette info(rmation)? |l'info )?(bien )?(en tete|en memoire)\b/,
  /\bc'est (bien )?(enregistre|memorise|retenu)e?\b/,
  /\bje l'ai (bien )?(retenu|memorise|note|enregistre)e?\b/
]
/** L'utilisateur demande de retenir quelque chose (pas « souviens-toi de… », qui demande de se rappeler). */
const ASKED_TO_REMEMBER = [
  /(?<!je )\bretiens(-le|-la|-les)?\s+(que|bien|ca|cela|cette|mon|ma|mes|le|la|les)\b/,
  /(?<!je )\bretiens\s*:/,
  /\bn'oublie pas que\b/,
  /\bmemorise\b/,
  /\bnote (bien )?que\b/,
  /\bgarde (bien )?(ca |cela |l'info |cette info(rmation)? )?en (tete|memoire)\b/,
  /\b(dans|a) ta memoire\b/,
  /\ba retenir\b/
]

/** Ce que l'outil a fait d'utile : une action réussie (pas une simple lecture). */
const acted = (tools: Array<{ name: string; status: string }>): boolean =>
  tools.some((t) => t.status === 'done' && !READ_ONLY.has(t.name.replace(/^mcp__compi__/, '')))

/**
 * La réponse annonce une action alors qu'aucun outil d'action n'a réussi pendant
 * cette réponse (memory_save en est un). Une réponse qui finit par une question
 * (« On commence ? ») ne compte pas comme une promesse non tenue. `asked` (message
 * de l'utilisateur) : une demande de retenir sans rien fait compte aussi. `memory`
 * faux (routine, où la mémoire est fermée) : pas de vérification de la mémoire.
 */
export function unverifiedClaim(
  text: string,
  tools: Array<{ name: string; status: string }>,
  o: { asked?: string; memory?: boolean } = {}
): MessageNotice | null {
  // Une vraie action (rappel, agenda, souvenir…) : « c'est noté » parle d'elle.
  if (acted(tools)) return null
  const t = fold(text.replace(/```[\s\S]*?```/g, ' '))
  if (o.memory !== false && (REMEMBERED.some((r) => r.test(t)) || ASKED_TO_REMEMBER.some((r) => r.test(fold(o.asked ?? ''))))) return 'not-saved'
  if (DONE.some((r) => r.test(t))) return 'no-action'
  const last =
    t
      .trim()
      .split('\n')
      .filter((l) => l.trim())
      .at(-1)
      ?.trim() ?? ''
  if (PROMISED.some((r) => r.test(t)) && !last.endsWith('?')) return 'stopped'
  return null
}

/**
 * Relance envoyée automatiquement, une fois, au moteur seul (elle ne s'affiche pas
 * dans la discussion). Une action déjà faite à un tour précédent ne doit pas être
 * refaite : on le dit au modèle.
 */
export function autoFollowUp(notice: MessageNotice): string {
  const end = 'Ne répète pas ce que tu as déjà écrit : continue directement.'
  if (notice === 'not-saved')
    return `<verification>Vérification automatique de Compi : rien n’a été enregistré dans ta mémoire pendant cette réponse, alors que l’utilisateur t’a demandé de retenir une information ou que tu as dit la retenir. Sans memory_save, tu l’oublieras dès la prochaine discussion. Appelle maintenant memory_save avec le fait à retenir, formulé de façon autonome, puis confirme en une phrase. Si rien ne mérite d’être retenu, dis-le simplement. ${end}</verification>`
  return notice === 'stopped'
    ? `<verification>Vérification automatique de Compi : ta réponse annonce une action mais s’arrête avant de la faire. Fais-la maintenant avec l’outil adapté, ou dis en une phrase pourquoi tu ne peux pas. ${end}</verification>`
    : `<verification>Vérification automatique de Compi : ta réponse dit que c’est fait, mais aucun outil n’a agi dans cette réponse. Si l’action a déjà été faite plus tôt dans la discussion, dis-le simplement, sans la refaire. Sinon, fais-la maintenant avec l’outil adapté, ou dis en une phrase que tu ne peux pas. ${end}</verification>`
}

/** Relance envoyée par le bouton « Le faire vraiment ». */
export function followUpFor(notice: MessageNotice): string {
  if (notice === 'not-saved')
    return 'Tu as dit que tu t’en souviendrais, mais rien n’a été enregistré dans ta mémoire. Enregistre-le maintenant avec memory_save.'
  return notice === 'stopped'
    ? 'Tu as annoncé une action sans la faire. Fais-la maintenant avec tes outils, ou dis-moi clairement que tu ne peux pas.'
    : 'Tu as dit que c’était fait, mais aucun outil n’a été utilisé : rien n’a changé. Fais-le maintenant avec tes outils, ou dis-moi clairement que tu ne peux pas.'
}
