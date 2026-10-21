// Compétences de départ, écrites pour Compi. Installées une fois ; l'utilisateur
// peut ensuite les modifier, les désactiver ou les supprimer.

import type { SkillDoc } from './format'

/** À incrémenter quand on ajoute ou améliore une compétence de départ. */
export const BUILTIN_VERSION = 4

/**
 * Texte exact d'une ancienne version : si le fichier de l'utilisateur est resté
 * tel quel, il passe à la nouvelle ; s'il l'a modifié, on n'y touche pas.
 */
export const PREVIOUS_BODIES: Record<string, (body: string) => string> = {
  // v2 : la recherche par le sens.
  'recherche-documents': (body) => body.replace(SEMANTIC_HINT, '')
}

const SEMANTIC_HINT =
  " Quand la recherche par le sens est active (l'outil renvoie alors des « passages proches par le sens »), décris plutôt en une phrase ce que tu cherches : « le passage sur la résiliation du bail »."

export const BUILTIN_SKILLS: SkillDoc[] = [
  {
    name: 'resume-document',
    description:
      "Résume un document (PDF, Word, PowerPoint, page web…) en une synthèse claire et fidèle. À utiliser quand l'utilisateur demande un résumé, une synthèse, les points clés ou « de quoi parle ce document ».",
    body: `# Résumer un document

1. Lis le document en entier avec \`mcp__compi__read_document\`, toutes les parties s'il est découpé. Pour une page web, utilise WebFetch.
2. Repère le sujet et le but, les idées principales, les chiffres et dates clés, les décisions ou demandes, et ce qui est attendu du lecteur.
3. Présente la synthèse ainsi :
   - **En une phrase** : l'essentiel.
   - **Points clés** : 3 à 7 puces, de la plus importante à la moins importante.
   - **Chiffres et dates** : seulement s'il y en a.
   - **À faire / échéances** : seulement si le document en contient.
4. Reste fidèle au texte : n'ajoute rien qui n'y figure pas. Indique la page ou la diapositive des points importants (« p. 4 »). Signale les passages ambigus ou illisibles. Si l'utilisateur précise une longueur, respecte-la.`
  },
  {
    name: 'recherche-documents',
    description:
      "Retrouve une information dans les dossiers de documents confiés à Compi (contrats, factures, notes, rapports…). À utiliser quand l'utilisateur demande « retrouve », « où est », « dans mes documents », ou pose une question dont la réponse est dans ses fichiers.",
    body: `# Chercher dans les documents de l'utilisateur

1. Lance \`mcp__compi__search_documents\` avec les mots les plus distinctifs : noms propres, numéros, montants, mots rares.${SEMANTIC_HINT} Si rien ne sort, réessaie avec des variantes (synonymes, singulier ou pluriel, abréviations, autre langue).
2. Ouvre les 1 à 3 documents les plus prometteurs avec \`mcp__compi__read_document\` pour vérifier dans le texte complet.
3. Réponds directement, puis cite la source : nom du fichier et page ou feuille (« Contrat-2025.pdf, p. 3 »).
4. Si l'information n'existe pas dans les documents, dis-le clairement, indique les mots-clés essayés et propose une piste. N'invente jamais une réponse.`
  },
  {
    name: 'redaction-email',
    description:
      "Rédige ou reformule un e-mail professionnel : réponse, relance, demande, refus poli, annonce. À utiliser quand l'utilisateur veut écrire, répondre à ou améliorer un e-mail ou un message.",
    body: `# Rédiger un e-mail

1. Identifie le destinataire, l'objectif, le ton (formel, cordial ou direct) et les éléments à inclure. S'il manque une information indispensable, pose une seule question courte. Sinon, fais une hypothèse raisonnable et signale-la en une ligne.
2. Structure :
   - **Objet** : court et explicite.
   - Première phrase : le message principal, sans préambule.
   - Les détails utiles, puis l'action attendue avec une échéance si c'est pertinent.
   - Une formule de politesse adaptée. En français professionnel, vouvoie par défaut.
3. Phrases courtes, sans jargon, 150 mots au plus sauf demande contraire. Propose une variante plus courte si elle peut servir.
4. Si l'utilisateur le demande, copie le texte avec \`mcp__compi__clipboard_write\`. N'envoie jamais d'e-mail toi-même.`
  },
  {
    name: 'compte-rendu-reunion',
    description:
      'Transforme des notes ou une transcription de réunion en compte-rendu structuré, avec les décisions et les actions. À utiliser pour « fais le CR », « résume la réunion », « liste les actions ».',
    body: `# Compte-rendu de réunion

Présente le compte-rendu ainsi :

- **Réunion** : objet, date et participants, s'ils sont connus.
- **Contexte** : une ou deux lignes.
- **Décisions** : ce qui a été tranché.
- **Actions** : un tableau Qui | Quoi | Échéance.
- **Points ouverts** : questions sans réponse, sujets reportés.
- **Prochaine étape** : la prochaine réunion ou le prochain jalon.

Règles :
- Distingue ce qui a été décidé de ce qui a seulement été discuté.
- N'invente ni participant ni échéance : écris « à définir ».
- Attribue une action à une personne seulement si c'est clair dans les notes.`
  },
  {
    name: 'analyse-tableur',
    description:
      "Analyse un fichier Excel ou CSV : structure, chiffres clés, tendances, anomalies et pistes. À utiliser quand l'utilisateur partage un tableur ou veut analyser des données : budget, ventes, export, suivi.",
    body: `# Analyser un tableur

1. Lis le fichier avec \`mcp__compi__read_document\`, toutes les parties s'il est découpé.
2. Décris la structure en deux lignes : feuilles, colonnes importantes, nombre de lignes, période couverte.
3. Réponds d'abord à la question de l'utilisateur. Sans question précise, donne :
   - **Chiffres clés** : un petit tableau (totaux, moyennes, minimum et maximum, évolution), avec la base de calcul.
   - **À surveiller** : doublons, cellules vides, valeurs aberrantes, totaux incohérents.
   - **Pistes** : 2 ou 3 actions concrètes.
4. N'invente jamais un chiffre. Précise les unités et la devise. Si le fichier a été tronqué (plus de 5 000 lignes par feuille), dis que l'analyse porte sur la partie lue. Signale les calculs approximatifs.`
  },
  {
    name: 'recherche-web-sourcee',
    description:
      "Mène une recherche approfondie sur le web et rend une synthèse sourcée et datée. À utiliser pour comparer des produits ou des offres, faire une veille, vérifier une information ou répondre à une question d'actualité.",
    body: `# Recherche web sourcée

1. Découpe la question en 2 à 4 angles de recherche et lance une recherche WebSearch pour chacun.
2. Ouvre avec WebFetch les 3 à 6 meilleures sources : sources officielles d'abord, puis les plus récentes.
3. Recoupe chaque fait important avec deux sources, et note leur date.
4. Présente :
   - **Réponse** : 2 ou 3 phrases.
   - **Détails** : des puces, et un tableau si tu compares.
   - **Sources** : titre, site et date de chaque source.
5. Signale les contradictions et les incertitudes. Pour les prix et l'actualité, préfère les sources de moins d'un an. Ne présente jamais une supposition comme un fait.`
  },
  {
    // v3 : rangement réel avec les outils de dossiers.
    name: 'ranger-dossier',
    description:
      "Range un dossier confié à Compi (le Bureau, Téléchargements…) : inventaire réel, plan validé par l'utilisateur, déplacements, vérification. À utiliser pour « range mon bureau », « fais le tri », « organise ce dossier ».",
    body: `# Ranger un dossier

1. Fais l'inventaire avec \`mcp__compi__folder_inventory\` (le Bureau par défaut). Ne te fie jamais à une capture d'écran ni à des noms supposés. Si le dossier n'est pas confié, dis à l'utilisateur de l'ajouter dans Extensions › Dossiers.
2. Présente un plan court tiré uniquement du résultat : un tableau Élément | Vers, puis ce qui reste en place et pourquoi. Pars du plan suggéré par l'outil ; l'utilisateur peut le modifier.
3. Laisse en place les raccourcis, les fichiers d'application (.exe, .pak, .dll…), les scripts (.ahk, .bat…) et les raccourcis partagés (Bureau public), sauf demande explicite. Ne propose jamais de supprimer quoi que ce soit.
4. Demande son accord, puis appelle \`mcp__compi__move_items\` avec toute la liste en une fois : une seule carte de validation. Les dossiers de destination manquants sont créés.
5. Vérifie avec un nouvel inventaire et dis exactement ce qui a été déplacé et ce qui a été refusé (avec la raison donnée par l'outil).
6. Rappelle qu'on peut tout annuler avec \`mcp__compi__undo_moves\`, et propose d'ouvrir le dossier avec \`mcp__compi__open_folder\`.

N'annonce jamais un déplacement que \`move_items\` n'a pas confirmé, et ne propose jamais à l'utilisateur de lancer un script lui-même.`
  },
  {
    // v4 : déplacer un rendez-vous sans créer de doublon.
    name: 'modifier-agenda',
    description:
      "Déplace, renomme ou supprime un rendez-vous existant de l'agenda Google, sans créer de doublon. À utiliser quand l'utilisateur dit « déplace », « décale », « reporte », « avance », « annule », « change l'heure » ou « supprime ce rendez-vous ».",
    body: `# Modifier un rendez-vous existant

1. Retrouve l'événement avec \`mcp__compi__calendar_events\` : sa date d'origine dans \`from\`, un mot du titre dans \`query\`. Chaque événement Google y porte une réf (ex. « réf e12 »).
2. Un seul résultat : c'est lui. Plusieurs : demande lequel, en citant date et heure. Aucun : cherche sur 7 jours avant de dire que tu ne le trouves pas. Sans réf, l'événement vient d'une autre source (connecteur, lien .ics) : dis qu'il se modifie dans cette application et ne fais rien d'autre.
3. Calcule la nouvelle date à partir d'aujourd'hui et redis-la en clair : « mercredi 22 octobre, 20:30 – 21:30 ». Sans heure précisée, garde la même.
4. Déplacer ou renommer : \`mcp__compi__calendar_update_event\` avec la réf. Ne crée jamais un nouvel événement à la place de l'ancien. Annuler : \`mcp__compi__calendar_delete_event\` avec la réf.
5. Une carte demande l'accord de l'utilisateur. N'écris « c'est fait » qu'après la réponse réussie de l'outil ; s'il échoue, donne son message.
6. Relis le jour d'arrivée avec \`calendar_events\` pour vérifier, puis confirme en une phrase.`
  }
]
