# Confidentialité

Compi n'a ni compte ni serveur. Ses auteurs ne reçoivent aucune donnée : pas de statistiques d'usage, pas de rapport de plantage, pas de mise à jour automatique.

## Ce qui reste sur ton PC

Tout est dans le dossier `%APPDATA%\Compi`.

| Quoi                                                                            | Où                                                                | À savoir                                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Réglages                                                                        | `settings.json`                                                   |                                                                                                                                                                                          |
| Discussions                                                                     | `conversations.json`                                              | avec le détail court de chaque étape (fichier changé, rangement, rendez-vous, sources trouvées) et les cartes du chat (météo, rendez-vous sans participants, tâches sans notes, rappels) |
| Ce que Compi sait de toi                                                        | `memory.json`                                                     | visible et modifiable dans « Ce que je sais de toi »                                                                                                                                     |
| Rappels, routines, minuteur, journée                                            | `reminders.json`, `routines.json`, `timer.json`, `day-state.json` |                                                                                                                                                                                          |
| Clés API, jetons Google et des connecteurs, secrets d'application, liens `.ics` | `secrets.json`                                                    | **chiffré par Windows** (DPAPI)                                                                                                                                                          |
| Historique du presse-papier                                                     | `clipboard-history.bin`                                           | désactivé par défaut ; **chiffré par Windows** ; texte seulement, 200 éléments et 30 jours                                                                                               |
| Journal technique                                                               | `logs\compi.log`                                                  | erreurs et sortie du moteur ; les clés Anthropic y sont masquées ; 1 Mo, plus l'ancien fichier                                                                                           |
| Journal des autorisations                                                       | `approvals-log.json`                                              | sans contenu ; 500 entrées et 90 jours au plus                                                                                                                                           |
| Journal « Envoyé en ligne »                                                     | `privacy-log.json`                                                | destination, types de données et titre de la discussion ; 100 entrées                                                                                                                    |
| Copies de travail du moteur                                                     | `agent\`                                                          | le moteur les garde 30 jours, **même après la suppression d'une discussion** (à corriger)                                                                                                |
| Index de la recherche par le sens                                               | `semantic\`                                                       | seulement si tu l'actives                                                                                                                                                                |
| Modèles de dictée et voix naturelle                                             | `models\`                                                         | seulement si tu les télécharges                                                                                                                                                          |
| Temps gagné (dictée partout)                                                    | `dictation-stats.json`                                            | par jour et par programme : dictées, mots, temps de parole ; **jamais le texte**                                                                                                         |
| Appels enregistrés                                                              | `meetings\`                                                       | transcriptions, noms des voix, résumés, rendez-vous relié ; le son, le temps de la transcription                                                                                         |
| Journal des rangements                                                          | `moves\`                                                          | noms des fichiers déplacés, pour pouvoir annuler ; les 20 derniers rangements                                                                                                            |
| Fichiers texte modifiés par Compi                                               | `edits\`                                                          | **l'ancienne version de chaque fichier**, pour pouvoir annuler ; les 30 dernières modifications                                                                                          |
| Utilisation                                                                     | `usage-claude-code.json`, `usage-compi.json`                      | des totaux seulement, aucun texte                                                                                                                                                        |
| Messages en attente                                                             | `messages-reminders.json`                                         | identifiants de notification et heures, **jamais le texte**                                                                                                                              |
| Compétences                                                                     | `skills\`                                                         |                                                                                                                                                                                          |
| Fiabilité des modèles locaux                                                    | `model-health.json`                                               | noms des modèles et nombres : essais d'outil, actions écrites en texte ; aucun texte                                                                                                     |
| Divers                                                                          | `warm-prompt.json`, `hardware.json`, caches de l'interface        | copie des consignes pour accélérer le modèle local (4 derniers modèles), description du matériel                                                                                         |

Sauf les deux lignes chiffrées, ces fichiers sont lisibles par ton compte Windows, comme tes documents. Le chiffrement de Windows ne protège pas contre un programme malveillant qui tourne déjà sous ton compte.

**Partage d'écran.** Par défaut, les fenêtres de Compi (encoche, plein écran, transcription flottante) n'apparaissent ni dans un partage d'écran (Teams, Meet, Zoom…), ni dans un enregistrement, ni dans une capture : Windows les exclut, et ce qu'il y a derrière reste visible. Tu les vois normalement sur ton écran. Si tu partages une seule fenêtre, Compi n'y est de toute façon jamais. Réglages › Confidentialité › « Cacher Compi quand je partage mon écran ». Il faut Windows 10 (version 2004) ou plus récent. Cela ne protège évidemment pas d'une photo de l'écran.

## Ce qui peut quitter ton PC, seulement si tu le choisis

**Le cerveau**

- **Claude (Anthropic)** : tes messages et les résultats des outils que tu autorises partent vers Anthropic, avec ta propre clé. Le moteur n'envoie aucune statistique d'usage. Quand Claude lit une page web, Anthropic vérifie le nom du site (pas l'adresse complète) dans sa liste de sites dangereux.
- **Autre service** (OpenRouter, DeepSeek, Kimi, GLM, ou une adresse de ton choix) : la même chose, vers ce service, avec sa clé. Ta clé Anthropic ne lui est jamais envoyée.
- **Sur ce PC** (Ollama, LM Studio) : rien ne part. Deux exceptions : pour une image ou un scan que le modèle ne sait pas lire, une carte te propose de l'envoyer à Claude, à chaque fois et sans « Toujours » ; et tes recherches web, si tu les actives (voir plus bas).

**Le garde-fou des cerveaux en ligne**

- Pour chaque type de donnée (écran, fichiers, e-mails, agenda, presse-papier, fenêtres, mémoire, réunions, recherches web), tu choisis **Me demander** (par défaut), **Toujours** ou **Jamais**, dans Réglages › Confidentialité. Pour tes messages reçus, une carte demande ton accord à chaque fois, sans « Toujours ».
- Les IBAN, cartes bancaires, n° de sécurité sociale, mots de passe, codes et clés d'API sont masqués avant l'envoi.
- Ta mémoire n'est pas envoyée, sauf si tu choisis « Toujours » pour elle.
- Sous chaque réponse, une puce dit ce qui est parti et vers qui.

**La recherche web (cerveau local et « Autre service »)**

Désactivée par défaut (Réglages › Cerveau › Recherche web). Avec Claude, c'est sa propre recherche web qui sert.

- **Le service est ton choix** : Ollama (avec la clé de ton compte, chiffrée par Windows) ou ta propre instance SearXNG. Rien n'est préréglé.
- **Seuls les mots cherchés partent** chez ce service, jamais ta question entière ni tes données. Compi lit ensuite les pages lui-même, sur ton PC.
- **Une carte avant chaque recherche** (Réglages › Confidentialité › Recherches web : Me demander par défaut, Toujours ou Jamais). Après la lecture d'un e-mail, une carte à chaque fois, sans « Toujours ». Dans une routine, seulement si tu as choisi « Toujours ».
- Sous la réponse, la puce dit « Recherche web envoyée à … » ; le journal « Envoyé en ligne » note le service, jamais les mots cherchés. Le journal technique ne les garde pas non plus.
- Ollama demande un compte (gratuit) et ne publie pas ses limites : en cas de refus, Compi le dit.

**Les services que tu branches**

- **Google** (agenda, e-mails, tâches), avec ton propre client Google.
- **Connecteurs** : chaque outil demande ton accord avant de servir. Les connecteurs « Local » lancent la commande que tu as choisie, souvent `npx`, qui télécharge le connecteur depuis npm. Une fois le connecteur téléchargé, Compi lance directement la copie gardée par npx, sans repasser par npm. Pour la connexion par compte à un service qui ne laisse pas Compi s'enregistrer tout seul, tu peux donner l'identifiant de l'application que tu y as créée : son secret est chiffré par Windows, ne revient jamais à l'interface et s'efface avec le connecteur. L'adresse de retour (http://127.0.0.1, un port fixe) ne sert que sur ton PC.
- **Liens d'agenda** `.ics` que tu ajoutes.

**À ta demande**

- Les pages web que tu demandes de lire ou d'ouvrir.
- La météo : seule ta ville part vers Open-Meteo.
- La recherche de connecteurs dans le registre MCP officiel.
- Les téléchargements de modèles, toujours après ton clic : Hugging Face pour la dictée, la séparation des voix et la voix naturelle, Ollama pour les modèles locaux.

Chaque service applique sa propre politique de confidentialité (Anthropic, Google, OpenRouter…).

## Zone d'écran

`Alt + Maj + Z` (réglable) fige l'écran sous ta souris pour que tu encadres une zone.

- **La capture reste en mémoire**, l'îlot caché pendant ce temps. Seule la zone encadrée est gardée, le temps du panneau ; rien n'est enregistré. Pour la lecture du texte, un fichier temporaire est créé puis effacé aussitôt.
- **Le texte est lu sur ton PC**, par la reconnaissance de texte de Windows. « Copier le texte » ne passe par aucun cerveau.
- **Rien ne part avant ton clic** sur une action (Traduire, Résumer, Expliquer…). Le panneau dit quel cerveau la reçoit, sur ton PC ou en ligne.
- **L'image de la zone** n'accompagne que « Expliquer », et seulement si ton cerveau voit les images (Claude, ou un modèle local comme gemma4). Les autres actions n'envoient que le texte lu.
- **Avec un cerveau en ligne**, chaque envoi est noté dans le journal « Envoyé en ligne » (catégorie Écran). Si l'écran est sur **Jamais** (Réglages › Confidentialité), rien de la zone ne part : seul « Copier le texte » reste possible.

## Ce PC et Ollama

- **Ce PC** mesure le processeur, la mémoire et la carte graphique sur ton PC. Pour la mémoire des discussions gardées par Ollama, Compi lit la fin du journal d'Ollama (`%LOCALAPPDATA%\Ollama\server.log`) : seulement des tailles, jamais le contenu.
- **« Limiter à 2 Go »** écrit la variable `LLAMA_ARG_CACHE_RAM` dans ton compte Windows, puis redémarre Ollama, toujours après ta confirmation. **« Rétablir »** l'efface. Rien d'autre n'est changé dans Ollama.
- **L'alerte de l'îlot** (mémoire presque pleine) se calcule sur ton PC ; elle se coupe dans Réglages › Îlot.
- **« Pourquoi ? »** (ce que le modèle local a dû relire) compare chaque requête à la précédente sur ton PC, par des empreintes gardées en mémoire le temps de la session. Seuls le nombre de jetons relus et la cause restent, avec la réponse ; rien de plus n'est lu dans le journal d'Ollama.

## Dictée partout

Désactivée par défaut (Réglages › Dictée partout).

- **La touche** : un petit processus séparé observe le clavier (module uiohook), sans jamais rien bloquer. Seule la touche choisie compte. Les autres frappes ne sont ni lues, ni gardées, ni transmises à Compi : ce processus ne lui envoie que « commencer », « arrêter » ou « annuler ». Une fenêtre lancée en administrateur ne lui transmet rien.
- **Le micro** ne s'ouvre que pendant que tu maintiens la touche (ou en mains libres, après un double appui). Ta voix est transcrite sur ton PC ; le son n'est jamais écrit sur le disque ni envoyé.
- **Le texte** est collé là où est ton curseur, par le presse-papier, marqué pour rester hors de l'historique Win+V et du presse-papier cloud. Ce que tu avais copié est remis juste après. Si la fenêtre a changé entre-temps, rien n'est collé : le texte reste copié pour un Ctrl+V.
- **Le style Soigné** fait réécrire le texte par ton cerveau. Sur ce PC, rien ne part. Avec un cerveau en ligne, seulement si tu l'autorises, et seulement le texte, jamais la voix.
- **« Compi, … »** : une dictée qui commence ainsi devient une demande à Compi, avec les règles habituelles.
- Compi retient le nom du programme (« outlook »), jamais le titre de la fenêtre.

## Conversation vocale

Désactivée par défaut (Réglages › Voix › Lecture à voix haute).

- **Le micro** se rouvre seulement après une question posée à la voix, à la fin de la lecture de la réponse, pendant 6 secondes au plus si personne ne parle. Avec « Couper ma lecture en parlant », il est aussi ouvert pendant la lecture. L'îlot le montre tout le temps où il écoute.
- **Le son** est découpé en phrases sur ton PC, gardé en mémoire le temps d'une phrase (30 secondes au plus), jamais écrit sur le disque ni envoyé. Seul le texte transcrit part, comme une question tapée.
- **Elle s'arrête** sur Échap, « Arrêter », dès que tu écris au clavier, quand une carte d'accord attend (jamais d'accord à la voix), pendant un appel enregistré, et quand le PC se verrouille ou se met en veille.

## Appels et réunions

Rien ne commence sans ton clic (Historique › Réunions › Enregistrer un appel), et Compi ne propose jamais d'enregistrer tout seul.

- **Prévenir les participants est obligatoire.** Compi te le rappelle avant chaque appel, avec une phrase à lire ou à envoyer. Un point rouge reste visible pendant tout l'enregistrement.
- **Le son** : ton micro et, si tu le choisis, le son de l'ordinateur (ce que tu entends des autres participants), capté par Windows sur ta sortie audio. En secours seulement, Chromium le fournit, mais il exige aussi une image de l'écran : elle est arrêtée aussitôt, jamais lue ni gardée.
- **Sur le disque** : le son est écrit dans `meetings\` le temps de l'appel et de sa mise au propre, puis effacé ; seul le texte reste. Par défaut, le son de l'appel (jamais ton micro) reste 24 h, pour que tu puisses refaire la séparation des voix ; il s'efface ensuite tout seul, ou tout de suite avec « Effacer le son » (réglage « Corriger les voix pendant 24 h »). Si tu coches « Garder le son », ou si l'enregistrement est interrompu, le son reste pour que tu puisses reprendre, jusqu'à ce que tu supprimes la réunion.
- **La transcription et la séparation des voix** se font sur ton PC, comme la seconde lecture des phrases douteuses (écrites dans l'autre langue, ou avec des mots manquants). Le son n'est jamais envoyé, et le journal ne garde que des nombres, jamais le texte.
- **Le résumé** est fait par ton cerveau. Sur ce PC, rien ne part. Avec un cerveau en ligne, la catégorie « Réunions » s'applique (Me demander par défaut) : seul le texte part, secrets masqués, et le résumé automatique n'a lieu qu'avec « Toujours ».
- **« Suite avec Compi »** ouvre une discussion à partir de la transcription. Elle est traitée comme un contenu venu d'ailleurs : toute action vers l'extérieur demande ton accord.
- **Compi lit tes réunions quand tu lui en parles** (« résume la dernière réunion ») : liste, résumé, puis la transcription seulement pour une question de détail. Sur ce PC, rien ne part. Avec un cerveau en ligne, la catégorie « Réunions » s'applique (une carte avec « Me demander », rien avec « Jamais »), secrets masqués. Les paroles lues viennent d'autres personnes : ensuite, toute action vers l'extérieur demande ton accord.
- **La transcription flottante** est une petite fenêtre qui reste devant ton appli de visio pendant l'appel. Elle affiche ce que l'îlot transcrit déjà, sans rien enregistrer de plus, et la fermer n'arrête pas l'enregistrement.
- **« Discuter »** ouvre une discussion avec la réunion jointe : son résumé accompagne ta première question. Ton clic vaut accord pour la confier au cerveau, sauf si tu as choisi « Jamais » pour les réunions avec un cerveau en ligne.
- **Notes de réunion** : le dossier que tu choisis (un coffre Obsidian, par exemple) devient un dossier confié. « Ajouter à mes notes » y écrit une note Markdown d'après ton modèle, toujours sous un nouveau nom : aucune note existante n'est remplacée. Quand Compi le fait à ta demande, une carte te montre la note avant. « Annuler » la retire. Rien n'est envoyé à Obsidian ni ailleurs : c'est un fichier sur ton PC.
- Aucune reconnaissance d'émotions.

## Préparer mes réunions

Désactivé par défaut (Réglages › Journée › Ta journée). Tout se calcule sur ton PC, sans cerveau.

- **Les participants** (noms et adresses, sans toi, sans les salles, sans ceux qui ont décliné) sont lus dans ton agenda, en même temps que tes rendez-vous. Ils ne sont jamais envoyés à un cerveau : quand tu demandes ton programme à Compi, il ne reçoit que l'heure, le titre, le lieu, la visio et le nom de l'agenda.
- **Tes derniers e-mails avec eux** : seulement quand tu ouvres la préparation, et seulement si tu as autorisé Gmail. Compi cherche dans Gmail (de, à ou en copie, 30 derniers jours, 5 au plus) et n'affiche que l'expéditeur, le sujet et la date. Rien n'est gardé.
- **La fois d'avant** : la réunion enregistrée la plus récente avec eux, et ses tâches, prises dans tes appels déjà enregistrés.
- **« Enregistrer »** depuis la préparation relie l'appel au rendez-vous : `meetings\` garde alors aussi son titre, son horaire, sa série et les adresses des participants (pas leurs noms), pour retrouver la fois d'avant.

## Ce que tu as manqué

Activé par défaut, et tu peux le couper (Réglages › Journée › Ta journée). À la fin d'un pomodoro (concentration de 15 min ou plus), d'une réunion de ton agenda ou d'une absence de 30 min ou plus, une carte résume ce qui est arrivé pendant ce temps. Une absence qui passe 5 h du matin est laissée au résumé du matin. Tout se calcule sur ton PC, sans cerveau.

- **Messages en attente** : ceux que Compi suit déjà (application, expéditeur, heure), seulement si Messages est activé. Ils comptent ensuite comme rappelés, pour ne pas te les signaler une deuxième fois.
- **E-mails non lus** : une seule recherche dans Gmail à la fin de la période, seulement si tu as autorisé Gmail, avec l'heure de début comme seul critère ajouté. La carte n'affiche que l'expéditeur et le sujet (5 au plus).
- **Rappels qui ont sonné** : gardés en mémoire 24 h, jamais écrits sur le disque.
- **L'îlot**, visible de tous, ne montre que des nombres (« Pendant ta réunion : 3 messages · 2 e-mails »). Les noms et les sujets ne sont que dans la carte, dans Aujourd'hui et le plein écran.
- La carte reste en mémoire jusqu'à ce que tu la fermes ou que Compi s'arrête. Rien n'est enregistré.

## Plein écran : recherche et récents

Tout est cherché et lu **sur le PC** ; rien n'est envoyé à un cerveau, ni ailleurs.

- **La recherche** (`Ctrl K`) lit la liste des applis du menu Démarrer (et l'icône de leur raccourci), tes réunions (titres et résumés, jamais la transcription), tes discussions, rappels, tâches déjà affichées et souvenirs. Les fichiers viennent de l'index de Windows Search, **limité à tes dossiers confiés** : un fichier ailleurs sur le PC n'apparaît jamais. La recherche par le sens, si tu l'as activée, passe par Ollama sur ton PC.
- **Ouvrir un résultat** est ton clic : une appli se lance, un fichier s'ouvre. Un programme trouvé dans un dossier confié n'est jamais lancé : Compi le montre dans l'Explorateur.
- **Récents** montre tes 3 dernières réunions (la première phrase du résumé) et les fichiers modifiés depuis 7 jours dans tes dossiers confiés.
- **Les 7 jours** relisent ton agenda, tes rappels, tes tâches et la météo seulement quand cette vue est affichée.
- La place des blocs et la vue de l'agenda sont gardées dans tes réglages ; rien d'autre n'est enregistré.

## Tâches Google

Désactivées tant que tu ne les ajoutes pas (Réglages › Journée › Comptes › « Ajouter les tâches »). Google demande alors ton accord pour l'accès à tes tâches.

- **Aujourd'hui et le plein écran** affichent tes tâches à faire, relues chez Google toutes les 5 minutes tant qu'elles sont à l'écran. Compi ne les enregistre pas : seule une discussion où le cerveau les a lues les garde, avec le reste de la discussion.
- **Cocher, décocher ou ajouter une tâche d'un clic** part tout de suite chez Google : c'est toi qui le fais.
- **Le cerveau** ne reçoit tes tâches que s'il les lit avec l'outil prévu. Avec un cerveau en ligne, c'est le réglage « Agenda » du garde-fou qui décide (Me demander par défaut). Ajouter, cocher ou modifier une tâche demande ton accord **à chaque fois**, sans « Toujours », quel que soit le cerveau.
- Une tâche peut venir d'une autre personne (tâche assignée) : elle est traitée comme un contenu venu d'ailleurs.

## Lecture à voix haute

- **La voix de Windows** (par défaut) ou **la voix naturelle** (Réglages › Voix), téléchargée seulement après ton clic. Les deux lisent sur ton PC : le texte n'est jamais envoyé, et le son n'est pas écrit sur le disque.
- La voix naturelle tourne dans un processus séparé, arrêté après 3 minutes sans lecture. Ce qu'elle ne sait pas lire (le tamoul) passe par la voix de Windows.

## Routines

Elles tournent sans toi, donc avec moins de droits que toi. Avec un cerveau en ligne, elles n'utilisent que les données réglées sur « Toujours ». Elles n'agissent jamais : pas de brouillon, de rendez-vous, de lien ouvert ni d'action sur Windows.

- **Droits par routine** (désactivés par défaut), donnés en créant ou en modifiant la routine, ou par ton OK sur la carte quand Compi la crée :
  - **Chercher sur le web et lire des pages** : recherches et pages permises même après la lecture de ton agenda, de tes e-mails ou de tes tâches, et même si les recherches web sont sur « Me demander » (jamais si elles sont sur « Jamais »). Les mots cherchés peuvent alors reprendre ce que la routine a lu : ils partent chez le service de recherche.
  - **Créer des notes dans tes dossiers confiés** : seulement de nouveaux fichiers .md ou .txt. Jamais modifier, compléter ni remplacer un fichier existant.
- Chaque refus est noté dans Activité › Journal, avec sa raison.
- **Sur un événement** plutôt qu'à une heure (désactivé tant que tu n'en crées pas) :
  - **premier allumage du jour** : une fois par jour, après 5 h, au démarrage, au déverrouillage ou au retour après 30 min d'absence (Compi regarde seulement depuis combien de temps le PC n'a pas servi) ;
  - **fin d'un rendez-vous** : l'agenda est relu toutes les 5 minutes, même sans alertes ; la routine reçoit le titre et les heures du rendez-vous, 8 fois par jour au plus ;
  - **nouveau message** : seulement si Messages est activé, pour les applications que tu suis ; la routine reçoit l'application et l'expéditeur, jamais le texte ; 30 min d'écart et 5 fois par jour au plus.
- Un titre de rendez-vous ou un nom d'expéditeur est écrit par d'autres : après lui, rien ne sort du PC (pages, recherches, connecteurs), sauf avec le droit « web » de la routine.

## Tout effacer

1. Si tu as connecté Claude Code : Réglages › Claude Code › **Déconnecter**. Compi retire ses hooks de `~/.claude/settings.json`.
2. Réglages › Comportement : désactive **Démarrer avec Windows**.
3. Si tu as limité la mémoire des discussions d'Ollama, clique sur **Rétablir** dans Activité › Ce PC (ou supprime la variable `LLAMA_ARG_CACHE_RAM` de ton compte).
4. Désinstalle Compi, puis supprime le dossier `%APPDATA%\Compi`.
5. Retire l'accès de Compi à Google sur [myaccount.google.com/permissions](https://myaccount.google.com/permissions), et chez chaque service que tu as connecté.
6. Si tu ne t'en sers plus ailleurs, révoque tes clés API dans la console de chaque service.

## Signaler un problème

Voir [SECURITY.md](SECURITY.md).
