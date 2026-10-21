# Compi

**Ton compagnon IA, toujours là en haut de l'écran Windows.**

Compi est un assistant personnel qui vit dans un « îlot » noir collé en haut de l'écran, à la manière du Dynamic Island. Il a le visage d'un petit robot aux yeux LED.

- Au repos, c'est une simple pastille.
- Au survol, il affiche ce qu'il fait.
- D'un clic ou d'un raccourci clavier, il s'ouvre pour discuter.

## Ce qu'il sait faire

- **Discuter et chercher** avec le cerveau de ton choix : Claude (Opus 5.5 par défaut, Sonnet 5.5 ou Haiku 5.5), un **modèle open source sur ton PC** (privé, gratuit, hors ligne), ou un autre service compatible. Recherche web, lecture de pages, réponses affichées au fil de l'eau.
- **Actions rapides sur ta sélection** : sélectionne un texte n'importe où (e-mail, Word, navigateur…) et appuie sur `Alt + Maj + C`.
  - Choix : **Corriger**, **Reformuler**, **Traduire**, **Résumer**, **Expliquer**, **Répondre** (touches 1 à 6).
  - Ensuite : **Remplacer** remet le résultat à la place de ta sélection, **Copier** le met dans le presse-papier, ou **Continuer dans la discussion**.
  - Ton presse-papier est toujours remis comme avant.
- **Windows au quotidien** :
  - Compi connaît l'état du PC : batterie, son, Wi-Fi, espace disque, mémoire, fenêtres ouvertes.
  - Il cherche un fichier sur tout le PC, avec l'index de la recherche Windows (noms et contenu).
  - **Avec ton OK à chaque fois**, il peut ouvrir une application, passer à une fenêtre, régler le son, mettre la musique en pause ou passer au morceau suivant, basculer en thème clair ou sombre, ou ouvrir une page des Paramètres.
- **Ranger un dossier** (le Bureau, Téléchargements…) : « range mon bureau ». Le dossier doit être confié dans **Extensions › Dossiers**.
  - Compi fait le vrai inventaire (dossiers, fichiers, raccourcis, raccourcis cassés, doublons) et propose un plan.
  - Une seule carte valide tout le lot. Il crée les dossiers et déplace, sans jamais rien supprimer ni écraser (un nom pris devient « nom (2) »).
  - « Annule le rangement » remet tout en place.
  - Restent en place : les raccourcis, les fichiers d'application et les scripts, `desktop.ini`, les raccourcis partagés par Windows.
- **Pas d'action imaginaire** : si une réponse dit « c'est fait » sans qu'aucun outil n'ait agi, une ligne ambre le signale (« Aucune action n'a été faite pendant cette réponse »). Le bouton **Le faire vraiment** relance Compi, seulement si tu cliques.
- **Lecture de texte sur ton PC** : l'écran, les images et les PDF scannés sont lus par la reconnaissance de texte intégrée à Windows. Rien n'est envoyé en ligne pour ça.
- **Ta journée** (icône soleil) :
  - ton **agenda**, depuis les sources que tu choisis : tes agendas Google, l'agenda d'un de tes connecteurs, un lien `.ics` (Outlook, iCloud, Proton, école, club…). Voir [Sources de l'agenda](#sources-de-lagenda) ;
  - tes **e-mails Gmail**, quel que soit ton logiciel (Mailbird, nouvel Outlook…) : « qu'est-ce que j'ai aujourd'hui ? », « résume mes e-mails non lus » ;
  - Compi prépare des **brouillons** de réponse dans Gmail. Il n'envoie **jamais** d'e-mail : tu relis et tu envoies toi-même ;
  - il peut ajouter, déplacer ou supprimer un rendez-vous de ton agenda Google, sans prévenir personne, avec ton OK à chaque fois. Pour un déplacement, il modifie l'événement existant : pas de doublon ;
  - un **résumé du matin** (rendez-vous, e-mails non lus, rappels, météo), et une **alerte avant chaque réunion** avec un bouton « Rejoindre » (Meet, Zoom, Teams) ;
  - des **rappels qui se répètent** (chaque jour, du lundi au vendredi, chaque lundi et jeudi, chaque mois), que tu peux reporter ou annuler ;
  - la **météo** de ta ville.
- **Un îlot vivant** :
  - la **musique en cours** (Spotify, navigateur, lecteur Windows…) s'affiche dans la pastille, avec sa pochette et un petit égaliseur en points LED ; au survol : pause, suivant, précédent, temps restant ;
  - un **minuteur** et un **pomodoro** (25 min de concentration, 5 min de pause, 4 fois), dans l'îlot et dans **Aujourd'hui** ; « minuteur 12 minutes » suffit ;
  - Compi peut **lire ses réponses à voix haute** avec les voix françaises de Windows (Julie, Paul, Hortense) : bouton **Écouter** sous chaque réponse, ou automatiquement.
- **Parle à Compi** : maintiens `Alt + Maj + V`, parle, relâche. La transcription se fait **sur ton PC** avec Whisper : ta voix n'est jamais envoyée. Le modèle (413 Mo, ou 209 Mo en version légère) se télécharge une seule fois, quand tu le décides.
- **Outils du bureau** : lire ou écrire le presse-papier, regarder l'écran, ouvrir un lien ou un fichier, envoyer des notifications, programmer des rappels.
- **Ce que je sais de toi** (icône cerveau) : tout ce que Compi a retenu sur toi, que tu peux lire, corriger, compléter ou effacer. Voir [Mémoire, routines et presse-papier](#mémoire-routines-et-presse-papier).
- **Routines** (dans Aujourd'hui) : « chaque lundi à 9 h, résume mes e-mails non lus ». Compi fait le travail seul, à l'heure dite, puis te prévient.
- **Historique du presse-papier**, seulement si tu l'actives : il reste sur le PC, chiffré, et ignore les mots de passe.
- **Messages en attente**, seulement si tu l'actives : un SMS reçu via Mobile connecté, un WhatsApp ou un Telegram resté sans réponse déclenche un petit rappel. Calculé sur le PC, sans cerveau. Voir [Messages en attente](#messages-en-attente).
- **Documents** : PDF (même scannés), Word, Excel, PowerPoint, OpenDocument, CSV, images et texte, sans rien installer sur le PC. Glisse un fichier sur l'îlot, ou confie-lui des dossiers qu'il peut fouiller (recherche à l'intérieur des documents).
  - **Recherche par le sens**, si tu l'actives : « le passage de mon contrat sur la résiliation » retrouve le bon paragraphe, même sans les mots exacts. Calculée sur ton PC.
- **Extensions** (icône prise) :
  - **Dossiers** : les dossiers que Compi lit sans demander, et range avec ton accord ;
  - **Connecteurs en un clic** : Notion, Todoist, Linear, Jira et Confluence, monday.com, ClickUp, Airtable, Zapier (Slack, Outlook, Teams…), Dropbox, Canva, Figma, Miro, Sentry, Vercel, Stripe. Tu te connectes avec ton compte, sans clé à copier. S'y ajoutent Brave Search, le navigateur, GitHub… et la recherche dans le registre MCP officiel ;
  - **Compétences** (Skills) : des savoir-faire que Compi applique au bon moment (résumé, compte-rendu, analyse de tableur, e-mail…). Crée les tiens ou importe un dossier avec un `SKILL.md`.
- **Pont Claude Code** :
  - tes sessions apparaissent en direct (outil en cours, fichiers modifiés avec les lignes `+N −M`) ;
  - tu autorises ou refuses les permissions, et tu réponds aux questions de Claude, depuis l'îlot.
- **Activité** (icône pouls) : ce qui t'attend, **Ce PC** (processeur, mémoire, carte graphique, mémoire vidéo et modèle local, avec des conseils), tes sessions Claude Code, l'**utilisation** (jetons et coût de Claude Code et de Compi) et le **journal** de toutes tes autorisations. Voir [Activité](#activité--ce-pc-utilisation-et-journal).
- **Au clavier** : `Alt + Maj + O` autorise et `Alt + Maj + N` refuse une demande depuis n'importe quelle application ; `Ctrl + K` cherche une discussion, un réglage ou une action. Voir [Clavier et sons](#clavier-et-sons).
- **Sons discrets**, créés par Compi : une demande qui attend, un rappel, un message. Muets la nuit, en réunion, en pomodoro et en plein écran.
- **Validation systématique** : toute action sensible affiche une carte Autoriser / Refuser / Toujours. Les actions sur Windows, le rangement des dossiers, le lancement d'un programme, les brouillons et les rendez-vous n'ont pas de « Toujours » : tu valides à chaque fois.
- **Garde-fou de confidentialité** : tu choisis ce qui peut partir vers un cerveau en ligne, les numéros sensibles sont masqués, et chaque réponse dit ce qui est parti et vers qui. Voir [Sécurité et confidentialité](#sécurité-et-confidentialité).

## Installation

Compi fonctionne sur **Windows 10 ou 11, 64 bits**. Il n'y a pas encore d'installateur à télécharger : tu construis le tien depuis le code. Il faut [Git](https://git-scm.com) et [Node.js](https://nodejs.org) 22 ou plus récent :

```bash
git clone https://github.com/Dilraj7/Compi.git
cd Compi
npm install
npm run build:win
```

Lance ensuite `dist/Compi-Setup-0.1.0.exe`. L'installateur n'est pas signé, donc Windows SmartScreen affichera un avertissement : clique sur **Informations complémentaires**, puis **Exécuter quand même**.

Compi n'a ni compte ni serveur : chacun apporte sa propre clé (Anthropic ou autre service), son propre client Google, et ses connecteurs.

Au premier lancement :

1. Clique sur l'îlot : l'accueil te propose de **choisir ton cerveau** (Claude, Sur ce PC, Autre service), ou de te laisser conseiller en 4 questions. Tout se règle ensuite dans **Réglages › Cerveau** (icône curseurs). Voir [Choisir son cerveau](#choisir-son-cerveau-claude-local-autre).
2. Avec Claude : colle ta **clé API Anthropic**, à créer sur [console.anthropic.com](https://console.anthropic.com/settings/keys). Elle est chiffrée par Windows (DPAPI).
   - Si ta clé couvre plusieurs workspaces (clé personnelle ou de compte de service), renseigne aussi le champ **Workspace** avec l'ID `wrkspc_…`. Tu le trouves dans la Console, sous [Settings › Workspaces](https://platform.claude.com/settings/workspaces).
3. Indique ton prénom dans **Comportement**.
4. _(Facultatif)_ Dans **Claude Code**, clique sur **Connecter…**. Compi te montre exactement ce qu'il va ajouter à `~/.claude/settings.json` et fait une sauvegarde avant d'écrire.

**Raccourcis par défaut :**

- `Alt + Maj + Espace` ouvre Compi ;
- `Alt + Maj + C` lance les actions rapides sur le texte sélectionné ;
- `Alt + Maj + V` (maintenu) pour parler à Compi, une fois la dictée installée.

Ils se changent dans **Réglages › Comportement** et **Réglages › Me parler**. Si une autre application utilise déjà l'un d'eux, Compi le signale et bascule sur une combinaison libre.

## Choisir son cerveau (Claude, local, autre)

Le cerveau est le modèle qui réfléchit pour Compi. Tu en changes quand tu veux : dans **Réglages › Cerveau**, ou avec la pastille à gauche de la zone de saisie.

|                 | Claude                       | Sur ce PC                      | Autre service                 |
| --------------- | ---------------------------- | ------------------------------ | ----------------------------- |
| Qualité         | la meilleure                 | bonne à très bonne selon le PC | selon le service              |
| Prix            | payant à l'usage (clé API)   | gratuit                        | selon le service              |
| Confidentialité | messages envoyés à Anthropic | **rien ne quitte le PC**       | messages envoyés à ce service |
| Hors ligne      | non                          | oui                            | non                           |

**Aide-moi à choisir.** Quatre questions : ce qui compte le plus (confidentialité, qualité, les deux), l'usage (écrire, documents, images, raisonner, coder), la langue, et rapide ou soigné. Compi détecte lui-même la mémoire, la carte graphique et l'espace disque, puis conseille **un seul modèle**, en expliquant pourquoi. Les autres options restent sous « Autres choix ». Il ne conseille que des modèles stables et reconnus, qui savent utiliser ses outils : Qwen 3.5, Gemma 4, Ministral 3, Qwen 3, gpt-oss, Qwen 3.6.

**Style de réponse.** Le même réglage pour tous les cerveaux : **Vif**, **Réfléchi**, **Approfondi**, **Expert**.

- **Vif** coupe la réflexion du modèle : la réponse commence presque tout de suite. C'est le choix par défaut sur ce PC.
- Les autres styles laissent le modèle réfléchir de plus en plus longtemps avant de répondre.
- Si le modèle ne sait pas réfléchir, seul « Vif » est proposé.

**Sur ce PC (Ollama ou LM Studio).**

1. **Moteur** : si rien n'est installé, « Installer Ollama » le fait en un clic via winget (sans droits administrateur ; Ollama est sous licence MIT). LM Studio est détecté s'il est lancé avec son serveur.
2. **Modèle** : « Installer et utiliser » télécharge le modèle conseillé (une seule fois) et le sélectionne. Le mode expert accepte n'importe quel nom de modèle Ollama.
3. **Tester** vérifie la réponse, l'appel d'outil et la vitesse.

Compi crée une variante `nom-compi` du modèle avec une fenêtre de contexte de 32 000 à 64 000 jetons (Ollama se limite sinon à 4 000, trop peu pour un assistant). Elle réutilise les mêmes fichiers : rien n'est retéléchargé.

**Où sont les modèles.** Compi ne les télécharge pas lui-même : il demande à Ollama, qui les range dans son dossier des modèles. **Réglages › Cerveau › Sur ce PC** affiche ce dossier, sa taille et la place libre sur le disque, avec un bouton **Ouvrir**.

- Par défaut : `%USERPROFILE%\.ollama\models` (environ 5 à 10 Go par modèle).
- Pour le changer : dans Ollama, **Settings › Model location** (ou la variable d'environnement `OLLAMA_MODELS`), puis redémarre Ollama. Déplace les dossiers `blobs` et `manifests` dans le nouveau dossier pour ne rien retélécharger.
- LM Studio a son propre dossier, réglé dans LM Studio (Mes modèles).
- Les modèles de la dictée (Whisper) sont à part, dans `%APPDATA%\Compi\models`.

**Vitesse en local.** Le premier message d'une session est le plus lent, car le modèle doit relire ses consignes. Compi limite cette attente :

- le modèle reste chargé en mémoire 30 minutes ;
- les consignes sont placées pour que le moteur les garde en cache d'une discussion à l'autre ;
- à l'ouverture du panneau, si le modèle vient d'être rechargé, Compi les lui fait relire en avance.

Ordre de grandeur, avec Gemma 4 12B sur une carte graphique de 16 Go : environ 25 s pour le tout premier mot à froid, puis environ 1 s pour une nouvelle discussion.

Ce qui change en local :

- **Pages web** : Compi les lit lui-même. Pour **chercher** sur le web, branche le connecteur gratuit Brave Search (Extensions › Connecteurs).
- **PDF scanné, ou image avec un modèle qui ne voit pas** : Compi lit d'abord le texte avec la reconnaissance de Windows, sur ton PC. Si elle ne trouve presque rien, et seulement si tu as une clé Claude et que l'option « Me proposer Claude » est active, une carte te demande « Envoyer … à Claude ? ». Rien ne part sans ton accord. Choisis « que tout reste sur mon PC » dans le questionnaire pour ne jamais le proposer.
- **Coût** : aucun, il n'est donc pas affiché.
- **Connecteurs** : un modèle local ne lit que 32 000 à 64 000 jetons à la fois, et certains connecteurs dépassent cette taille à eux seuls (Notion : environ 64 000 jetons d'outils). Compi envoie donc toujours ses propres outils, puis les connecteurs qui tiennent, en version courte : environ 40 % de la fenêtre, les plus petits d'abord. Un gros connecteur se charge quand tu le **nommes** (« dans Notion, … ») ou quand la discussion l'a déjà utilisé. Le journal note ce qui n'a pas été chargé, et le modèle sait qu'il doit te le dire.

**Autre service.** Tout service qui parle le format de Claude (`/v1/messages`). Préréglages : OpenRouter, DeepSeek, Kimi (Moonshot), GLM (Z.ai) et le serveur llama.cpp local. Renseigne l'adresse, le modèle et la clé du service (chiffrée par Windows). Avec OpenRouter, l'option **« N'utiliser que des fournisseurs qui ne gardent pas mes messages »** est active par défaut.

Changer de modèle chez le même fournisseur continue la discussion. Changer de fournisseur ouvre une nouvelle discussion, car la réflexion d'un modèle ne se relit pas chez un autre. L'historique indique le cerveau de chaque discussion.

## Connecter Google (agenda et e-mails)

Compi se connecte directement à ton compte Google, avec l'écran de connexion officiel de Google : il ne voit jamais ton mot de passe. Il lui faut d'abord sa propre « identité » chez Google. Tu la crées une seule fois, en 10 minutes environ.

1. Sur [console.cloud.google.com](https://console.cloud.google.com), crée un projet « Compi ».
2. **API et services › Bibliothèque** : active **Gmail API** et **Google Calendar API**.
3. **Google Auth Platform › Commencer** : nom « Compi », ton e-mail, audience **Externe**. Accepte le règlement, puis **Créer**.
4. **Audience › Publier l'application**, pour passer « En production ». En mode « Test », Google coupe la connexion tous les 7 jours.
5. **Clients › Créer un client** : type **Application de bureau**, nom « Compi ». Télécharge le fichier **JSON**.
6. Dans Compi, ouvre **Réglages › Comptes** :
   - clique sur **Importer le fichier JSON…** ;
   - choisis ce que Compi peut lire (Agenda, E-mails), puis **Se connecter à Google** ;
   - termine dans le navigateur.

Bon à savoir :

- **« Google n'a pas validé cette application »** : c'est normal pour une application personnelle. Clique sur **Paramètres avancés › Accéder à Compi**. La validation officielle n'est utile que pour plus de 100 utilisateurs.
- **Ce que Compi demande à Google** :
  - agenda : lire, créer, déplacer et supprimer des événements, voir la liste de tes agendas ;
  - e-mails : lire, et créer des brouillons.

  Google n'a pas d'autorisation « brouillons seulement » : celle des brouillons permettrait aussi d'envoyer. Compi n'a pourtant **aucune fonction d'envoi**, et un test automatique le vérifie.

- **Déconnecter** (Réglages › Comptes) retire l'accès chez Google et efface la connexion du PC.

## Sources de l'agenda

Dans **Réglages › Sources de l'agenda**, ou avec le lien **Sources** au-dessus de l'Agenda dans Aujourd'hui. Rien n'est prévu d'avance : tu choisis ce qui s'affiche.

Ces sources servent partout : l'Agenda d'Aujourd'hui, le résumé du matin, les alertes avant une réunion, et quand tu demandes « qu'est-ce que j'ai aujourd'hui ? ».

- **Agendas Google** : par défaut, ceux que tu as cochés dans Google Agenda. Coche ou décoche-les ici ; **Comme dans Google** revient au choix de Google.
- **Depuis un connecteur** (agenda familial, CRM, outil de réservation…) :
  - choisis un de tes connecteurs. Compi regarde ses outils et propose celui qui ressemble le plus à une lecture d'agenda ;
  - certains connecteurs (des CRM, par exemple) rangent leurs outils dans un **catalogue** : ils ne montrent que trois outils (« catalogue », « schémas », « exécuter »). Compi le repère, cherche dans le catalogue les outils qui parlent d'agenda ou de tâches, et les propose (« par execute_tool ») ;
  - les tâches avec une échéance s'affichent aussi (« échéance 14:00 »), sans alerte de réunion. Les tâches terminées sont écartées ;
  - les outils qui pourraient modifier des données sont signalés et ne peuvent pas être choisis : Compi appelle l'outil tout seul à chaque actualisation, donc seulement en lecture ;
  - **Aperçu** essaie l'outil sur aujourd'hui et les 7 jours suivants, et montre ce qu'il a trouvé. Tu ajoutes la source seulement si l'aperçu est juste.
- **Lien .ics** : colle le lien d'un agenda publié (`https://…` ou `webcal://…`).
  - Outlook : **Calendriers partagés › Publier un calendrier**.
  - iCloud : partage du calendrier › **Calendrier public**.
  - Proton, une école, un club : leur lien « ICS » ou « iCal ».

  Fuseaux horaires, événements répétés, séances déplacées ou annulées sont pris en compte.

- Chaque source peut être **renommée**, **masquée** (interrupteur) ou **retirée**. 8 sources au plus, en plus de Google.

**Limites** : un outil de connecteur doit répondre avec des données structurées (JSON). S'il répond en texte libre, l'aperçu le dit : essaie un autre outil du connecteur, ou un lien `.ics`. Compi relit chaque source au plus toutes les 5 minutes. Créer, déplacer ou supprimer un rendez-vous reste réservé à Google Agenda : un événement d'une autre source se modifie dans son application.

## Parler à Compi, l'écouter

**Installer la dictée.** Dans **Réglages › Me parler**, choisis **Précise** (Whisper small, comprend bien le français) ou **Légère** (Whisper base, plus petite), puis **Télécharger**. La taille est affichée avant, et rien ne se télécharge sans ce clic. Chaque fichier est vérifié (empreinte publiée par Hugging Face, à une version figée). Tu peux annuler, puis supprimer le modèle au même endroit.

- Avec une carte graphique compatible (WebGPU), Compi prend la version pour carte graphique : la transcription est quasi instantanée. Sinon, il prend la version pour processeur, plus petite mais plus lente.

**Dicter.**

- Maintiens `Alt + Maj + V` en parlant, puis relâche : Compi transcrit et envoie.
- Ou appuie une fois : il écoute jusqu'à ce que tu fasses une pause.
- Ou clique sur le micro à droite de la zone de saisie.
- `Échap` annule. Si personne ne parle pendant 7 secondes, Compi abandonne ; une dictée dure au plus 1 minute.

**L'écouter.** Dans **Réglages › Îlot et voix**, « Lire mes réponses à voix haute » : **Jamais**, **Quand je parle** (par défaut : après une question dictée) ou **Toujours**. Choisis la voix et la vitesse, puis **Écouter** pour un essai. Le Markdown, le code et les liens ne sont pas lus. Un clic sur l'îlot (**Arrêter**) coupe la voix.

**Musique.** « Musique en cours dans l'îlot » se coupe dans **Réglages › Îlot et voix**. Compi lit ce que Windows sait de la musique en cours (contrôles multimédias) ; il ne relève rien quand le PC est verrouillé ou en veille.

## Mémoire, routines et presse-papier

**Ce que je sais de toi** (icône cerveau, onglet du même nom).

- Compi retient ce que tu lui demandes (« retiens que je préfère les réunions le matin ») et les préférences durables que tu exprimes. L'îlot affiche alors « Retenu : … ».
- Tu vois tous les souvenirs, du plus récent au plus ancien. Un clic sur l'un d'eux permet de le corriger (`Entrée` enregistre, `Échap` annule). Tu peux aussi en ajouter, en effacer un, ou **tout effacer**.
- En haut de la page, Compi dit si sa mémoire est partagée avec ton cerveau du moment : toujours en local ; pour un cerveau en ligne, seulement si tu as choisi « Toujours » pour la mémoire dans **Réglages › Confidentialité**.
- Effacer, c'est vraiment effacer : la copie gardée pour accélérer le modèle local part aussi.

**Routines** (Aujourd'hui › Routines).

- Écris ce que Compi doit faire, puis quand : chaque jour, les jours ouvrés, certains jours de la semaine ou un jour du mois, à l'heure de ton choix. Tu peux aussi le demander dans la discussion : une carte te montre la routine avant de la créer.
- À l'heure dite, Compi travaille **seul**, sans rien te demander. Pour que ce soit sans risque :
  - il n'agit pas : pas de rendez-vous, de brouillon, de lien ouvert, de souvenir ajouté, d'action sur Windows ;
  - avec un cerveau en ligne, il n'utilise que les données réglées sur **« Toujours »** dans **Réglages › Confidentialité**. La section Routines indique celles qui manquent (e-mails, agenda, fichiers, mémoire) ;
  - une routine dure au plus 10 minutes, et une seule tourne à la fois.
- Quand c'est fini, une notification Windows et l'îlot te préviennent. Un clic ouvre la discussion avec le résultat.
- **Lancer** l'exécute tout de suite, **Arrêter** l'interrompt. Si le PC était éteint à l'heure prévue, Compi la rattrape au démarrage, à condition que le retard ne dépasse pas 12 heures.
- Avec Claude ou un autre service en ligne, chaque exécution coûte comme une discussion.

**Historique du presse-papier** (icône cerveau › Presse-papier). Désactivé par défaut.

- Une fois activé, Compi garde le texte que tu copies : tu le retrouves, le recopies ou l'épingles, ou tu demandes « qu'est-ce que j'avais copié ce matin ? ».
- Il reste sur le PC, chiffré par Windows. Texte seulement, 30 jours et 200 éléments au plus ; les éléments épinglés restent.
- Jamais gardé :
  - ce que les gestionnaires de mots de passe (1Password, Bitwarden, KeePass…) marquent comme à ne pas garder, comme le fait l'historique de Windows ;
  - ce qui est copié depuis une application de mots de passe ;
  - ce qui ressemble à un mot de passe, un IBAN, une carte ou une clé ;
  - les copies que Compi fait lui-même.
- **Désactiver efface tout.**

**Recherche par le sens** (Extensions › Dossiers).

- La recherche habituelle trouve les mots exacts. Celle-ci comprend le sens : « le passage sur la résiliation » trouve « fin du contrat avec un préavis de trois mois ».
- Compi découpe tes documents en passages et calcule pour chacun une « empreinte de sens », sur ton PC, avec Ollama. Rien ne part en ligne.
- **Activer** télécharge une seule fois le modèle `qwen3-embedding:0.6b` (environ 640 Mo), puis lit les dossiers confiés. Rien ne se télécharge sans ce clic, et tu peux annuler pendant le téléchargement.
- Ensuite, Compi ne relit que les fichiers ajoutés ou modifiés. **Mettre à jour** force une relecture.
- **Désactiver** efface l'index ; **Désactiver et supprimer le modèle** libère aussi les 640 Mo.

Comment t'en servir :

- **Dans la discussion**, demande simplement : « dans mes documents, qu'est-ce qui est dit sur la résiliation ? ». La ligne d'activité indique « Recherche dans tes documents (par le sens) » quand elle sert. Compi combine les deux recherches : les mots exacts et le sens.
- **Pour voir ce qu'elle trouve**, sans rien envoyer à un cerveau : tape une phrase dans la case **Essayer** de la carte. Les passages les plus proches s'affichent avec le fichier, la page et quatre points de proximité. Un clic ouvre le document.
- Elle marche mieux avec une idée qu'avec un mot isolé : « ce que je dois payer si je pars avant la fin » plutôt que « pénalité ».

## Connecteurs en un clic

Dans **Extensions › Connecteurs**, les services marqués **Compte** se branchent sans clé à copier :

1. clique sur le service, puis **Se connecter** ;
2. ton navigateur ouvre la page officielle du service : connecte-toi et choisis ce que Compi peut voir ;
3. reviens dans Compi : le connecteur est prêt.

| Catégorie            | Services                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| Productivité         | Notion, Todoist, Linear, Jira et Confluence, monday.com, ClickUp, Airtable, Zapier |
| Fichiers et création | Dropbox, Canva, Figma, Miro                                                        |
| Développement        | Sentry, Vercel, Stripe                                                             |

Bon à savoir :

- Compi ne voit jamais ton mot de passe. Le jeton de connexion est chiffré par Windows et renouvelé automatiquement.
- **Slack** ne permet pas encore cette connexion en un clic à une application comme Compi. Passe par **Zapier** : connecte Slack dans Zapier, puis branche Zapier dans Compi.
- Si un service te déconnecte, la carte affiche **« À reconnecter »** : un clic sur **Se reconnecter** suffit.
- Retirer un connecteur efface sa connexion du PC. Pour révoquer aussi l'accès chez le service, passe par les réglages de ton compte chez lui.
- Comme pour les autres connecteurs, Compi demande ton OK avant d'utiliser un outil du service (carte Autoriser / Refuser / Toujours).
- Une adresse de serveur MCP distant qui demande une connexion par compte peut aussi s'ajouter à la main : **Ajouter un connecteur**, puis **Se connecter avec un compte**.

## Activité : Ce PC, utilisation et journal

L'onglet **Activité** réunit tout ce qui se passe autour de toi, dans cet ordre :

1. **En attente de toi** : les cartes d'autorisation et les questions, de Compi comme de Claude Code.
2. **Ce PC**, en direct (mesuré seulement quand tu regardes, sur le PC) :
   - **processeur**, **mémoire**, **carte graphique** et **mémoire vidéo**, avec les applications qui prennent le plus de mémoire ;
   - qui occupe la **mémoire vidéo** : le modèle local, Windows, Steam, ton navigateur… ;
   - le **modèle local** : chargé ou non, entièrement sur la carte graphique ou en partie sur le processeur, et dans combien de temps il se libère. **Libérer la mémoire vidéo** le décharge tout de suite ; **Garder le modèle prêt** (30 min, 2 h ou 8 h) évite de le recharger à chaque retour ;
   - les **dernières réponses locales** (premier mot, vitesse, et la cause d'une lenteur : « modèle rechargé », « 38 % sur le processeur ») ;
   - des **conseils** quand quelque chose ralentit le modèle : mémoire du PC presque pleine (le chargement passe alors par le disque, parfois plusieurs minutes), modèle qui déborde de la carte graphique, modèle de la recherche par le sens chargé en même temps, longue discussion à relire, jeu qui occupe la carte. Chaque conseil a son bouton : **Modèle plus léger**, **Libérer**, **Garder prêt 2 h**, **Nouvelle discussion**.
   - Pendant une réponse locale, la discussion dit ce qui se passe avant le premier mot (« Je charge le modèle en mémoire… », « Je relis ta demande… »), et **Pourquoi ?** sous une réponse lente mène ici.
   - En option (**Réglages › Îlot et voix › Moniteur du PC dans l'îlot**), des mini-jauges LED s'affichent à côté du robot, et les chiffres au survol.
3. **Claude Code** : tes sessions en direct.
4. **Utilisation**, sur aujourd'hui, 7 jours ou 30 jours :
   - **Claude Code** : jetons, coût au tarif de l'API, sessions, bloc de 5 heures en cours, jours, projets et modèles. Compi lit les fichiers que Claude Code écrit sur ton PC (`~/.claude/projects`), en lecture seule. Rien n'est envoyé.
   - Le coût est **réel si tu utilises une clé API**, et **indicatif avec l'abonnement Pro ou Max** : les fichiers ne disent pas lequel a servi. Le bloc de 5 heures est une estimation : Anthropic ne publie pas les seuils exacts.
   - **Compi** : réponses et coût par cerveau. Le coût est celui facturé par Claude ; un cerveau local est gratuit.
5. **Journal** :
   - **Autorisations** : chaque carte, avec qui demandait (Compi, Claude Code ou une routine), quoi (fichier, site, début de commande), quand, et ta réponse (Autorisé, Toujours, Refusé, Sans réponse, Annulé). Les refus automatiques des routines y figurent aussi. Jamais le contenu lui-même : 500 entrées et 90 jours au plus, sur le PC. **Effacer le journal** vide tout.
   - **Envoyé en ligne** : ce qui est parti vers un cerveau en ligne, et vers qui.
6. **Règles « Toujours »** : **Gérer** ouvre Réglages › Confidentialité pour les retirer. Celles de Claude Code se gèrent dans Claude Code, avec `/permissions` ; l'infobulle du bouton « Toujours » dit exactement la règle qui sera enregistrée.

## Clavier et sons

**Répondre aux demandes au clavier** (Réglages › Comportement) :

- `Alt + Maj + O` **autorise** et `Alt + Maj + N` **refuse** la plus ancienne demande, depuis n'importe quelle application. Ces raccourcis ne sont pris à Windows que tant qu'une carte attend.
- Jamais « Toujours » par raccourci, et une carte arrivée il y a moins d'une seconde ne se valide pas : le temps de la lire. Une question de Claude Code ouvre le panneau dessus.
- L'îlot confirme : « Autorisé : … » ou « Refusé : … ».
- `Alt + Maj + Espace` amène directement sur la carte. Là : `Entrée` autorise, `Échap` refuse, `Maj + Entrée` = Toujours (si c'est permis). Pour une question : `1` à `9` choisit, `Entrée` envoie. Si tu commences à taper un texte, il part dans la saisie de la discussion, jamais sur la carte.

**Dans le panneau** :

- `Ctrl + 1` à `Ctrl + 7` : Discussion, Aujourd'hui, Activité, Historique, Ce que je sais de toi, Extensions, Réglages ;
- `Ctrl + N` : nouvelle discussion ;
- `Ctrl + K` : chercher une discussion, une vue, un réglage ou une action (minuteur, libérer la mémoire vidéo, couper les sons…), sans tenir compte des accents.

**Sons** (Réglages › Îlot et voix), activés par défaut, volume bas :

- un son pour une demande qui attend, un pour les rappels (minuteur, réunion, résumé du matin), un pour les messages en attente, et un, désactivé par défaut, pour les tâches terminées (routine, Claude Code) ;
- créés par Compi, sans fichier ; **Écouter** à côté de chaque son ;
- muets pendant les **heures calmes** (22 h → 8 h par défaut), en réunion (sauf l'alerte de la réunion), pendant un pomodoro et quand une application est en plein écran (jeu, vidéo, présentation) ;
- les notifications Windows de Compi restent alors muettes : pas de double son.

## Messages en attente

Dans **Réglages › Messages**. Désactivé par défaut.

**L'idée** : un message reçu sur ton téléphone ou dans une messagerie de bureau, resté sans réponse, ne doit pas se perdre. Compi regarde les notifications de Windows et te le rappelle.

- **Activer** vérifie que Windows autorise l'accès aux notifications, puis tu coches les messageries à suivre : Mobile connecté (SMS et applications du téléphone), WhatsApp, Telegram, Signal, Discord, Teams, ou une autre application vue dans tes notifications.
- **En attente** veut dire : la notification est toujours dans le centre de notifications. Quand tu l'ouvres ou la fermes, Windows la retire, et Compi aussi.
- Après le délai choisi (30 min, 1 h ou 2 h), un petit rappel apparaît dans l'îlot : « 2 messages en attente depuis 1 h · WhatsApp, Mobile connecté ». Une seule fois par message.
- Rien pendant les **heures calmes** (22 h → 8 h par défaut), une réunion ou un pomodoro.
- **Aujourd'hui** liste les messages en attente, avec **Ouvrir** (lance l'application), **Plus tard** (rappel dans 1 h) et **Ignorer**. Plusieurs messages de la même personne tiennent sur une ligne (« Julien · 3 messages »). Quand l'application ne donne pas l'expéditeur (souvent Mobile connecté), la ligne dit « Nouveau message » ou « 2 messages ». Le résumé du matin donne seulement leur nombre.

**Confidentialité** :

- **Rappels** : Compi garde l'application, l'expéditeur et l'heure, en mémoire. Sur le disque, seulement des identifiants de notification et des heures. **Jamais le texte**, et aucun cerveau n'est utilisé.
- **L'îlot est visible de tous** : par défaut, il ne montre que le nom de l'application. **Noms dans l'îlot** affiche aussi les expéditeurs.
- **« Compi peut lire mes messages »** (option à part, désactivée par défaut) permet de demander « qu'est-ce que j'ai reçu cet après-midi ? ». Le texte reste **en mémoire 24 h, jamais sur le disque**, et les codes reçus par SMS sont masqués dès l'arrivée. Avec un cerveau en ligne, une carte te demande ton accord **à chaque lecture, sans « Toujours »**. Jamais dans une routine.
- Compi ne peut **ni répondre, ni marquer comme lu** : Windows ne le permet pas aux autres applications.

**Limites** :

- Compi ne voit que ce qui arrive en notification, PC allumé et déverrouillé.
- L'aperçu dépend de chaque application (une application réglée pour masquer le contenu ne montre que « Nouveau message »).
- **iPhone** : active « Afficher les notifications » pour le PC dans les réglages Bluetooth du téléphone. **Telegram** : active les notifications Windows dans Telegram.

## Dépannage

- **Le raccourci ouvre une autre application** (1Password utilise `Ctrl + Maj + Espace`, Claude `Ctrl + Alt + Espace`) : choisis une autre combinaison dans **Réglages › Comportement**. Compi refuse les combinaisons déjà prises.
- **Un connecteur « Local » ne démarre pas** : il demande Node.js ([nodejs.org](https://nodejs.org), version LTS). Les connecteurs « Distant » n'ont besoin de rien.
- **« Ta clé API couvre plusieurs workspaces »** : renseigne l'ID du workspace dans **Réglages › Cerveau › Workspace**, ou crée une clé rattachée à un seul workspace.
- **« Le moteur local ne répond pas »** : lance Ollama (menu Démarrer) ou le serveur de LM Studio, ou clique sur **Démarrer** dans **Réglages › Cerveau › Sur ce PC**.
- **Ollama ne voit plus mes modèles après un changement de dossier** : l'ancien serveur d'Ollama tourne encore sur l'ancien dossier. **Réglages › Cerveau** le signale : clique sur **Redémarrer Ollama** (rien n'est supprimé). Sinon, quitte Ollama depuis son icône près de l'horloge et relance-le.
- **Le modèle local répond en anglais ou à côté** (« je ne peux pas régler de minuteur ») : sa requête a sans doute dépassé sa fenêtre, et Ollama en a coupé le début, consignes de Compi comprises. Compi n'envoie que les outils qui tiennent (voir [Choisir son cerveau](#choisir-son-cerveau-claude-local-autre)) ; pour utiliser un gros connecteur avec un modèle local, nomme-le dans ta demande, ou ouvre une nouvelle discussion.
- **Compi dit « c'est fait » mais rien n'a changé** : la ligne ambre sous la réponse le confirme. Aucun outil n'a agi, souvent parce qu'un petit modèle local a répondu de mémoire. Clique sur **Le faire vraiment** : Compi doit alors utiliser ses outils, ou dire qu'il ne peut pas. Pour ranger un dossier, il faut l'avoir confié dans **Extensions › Dossiers**.
- **Un élément n'a pas été déplacé** : le résultat donne la raison.
  - Le fichier était ouvert dans une application : ferme-le et redemande.
  - Raccourci partagé par Windows : il faut des droits d'administrateur.
  - L'élément est hors des dossiers confiés, ou sur un autre disque : Compi ne copie pas puis supprime.
  - C'est un lien vers un autre dossier.
  - Les dossiers créés pour le rangement restent après une annulation, vides : supprime-les toi-même si tu veux, Compi ne supprime rien.
- **Le modèle local est lent** : ouvre **Activité › Ce PC**, qui dit pourquoi. Le plus souvent : la mémoire du PC est presque pleine (le chargement passe alors par le disque) ou le modèle déborde de la carte graphique. Ferme les applications gourmandes, choisis un modèle plus petit (le conseiller en tient compte) ou garde le modèle prêt plus longtemps. Sans carte NVIDIA ou AMD d'au moins 4 Go, le modèle tourne sur le processeur, nettement plus lentement.
- **`Alt + Maj + O` ou `N` ne fait rien** : une autre application utilise peut-être déjà la combinaison ; Réglages › Comportement le signale. Choisis-en une autre. Ces raccourcis ne marchent que lorsqu'une carte attend.
- **Pas de son** : vérifie **Réglages › Îlot et voix › Sons discrets**, tes heures calmes, et qu'aucune application n'est en plein écran.
- **Un modèle est grisé** (« ne sait pas utiliser mes outils ») : il ne gère pas les appels d'outils, donc Compi ne pourrait ni lire tes documents ni créer de rappels. Prends un modèle marqué **outils**.
- **Le modèle perd le fil dans une longue discussion** : Compi résume automatiquement la conversation pour rester dans sa fenêtre de contexte. Ouvre une nouvelle discussion pour repartir de zéro.
- **`Alt + Maj + C` ne trouve pas de texte** : vérifie que du texte est bien sélectionné, puis réessaie. Certaines fenêtres ne se laissent pas copier, comme celles lancées en administrateur ou les champs de mot de passe. Dans ce cas, copie le texte toi-même et colle-le dans la discussion.
- **« Remplacer » n'a pas marché** : la fenêtre d'origine a été fermée ou a refusé le collage. Le résultat reste affiché : utilise **Copier**.
- **La recherche de fichiers ne trouve rien** : Compi utilise l'index de la recherche Windows. Les dossiers non indexés (disques externes, par exemple) n'y sont pas. Ajoute-les dans **Paramètres › Confidentialité et sécurité › Recherche dans Windows**.
- **« Gmail API n'est pas activée dans ton projet »** (ou Google Calendar API) : active-la dans la console Google (API et services › Bibliothèque), puis réessaie.
- **Google me déconnecte chaque semaine** : ton application est restée en mode « Test ». Dans la console Google, Audience › **Publier l'application**, puis reconnecte-toi.
- **Pas d'alerte avant une réunion** : il faut au moins une source d'agenda (**Réglages › Sources de l'agenda**) et l'option activée dans **Réglages › Ta journée**. Compi relit l'agenda toutes les 5 minutes. Une échéance sans durée (« rendre le dossier à 16 h ») ou un événement d'une journée entière ne déclenche pas d'alerte.
- **Une source d'agenda n'affiche rien** : Aujourd'hui indique en orange ce qui n'a pas pu être lu (« Maison : le connecteur est désactivé dans Extensions »). Rouvre la source dans **Réglages › Sources de l'agenda** et clique sur **Aperçu** pour la tester.
- **Le connecteur ne montre que `get_tool_catalog`, `execute_tool`…** (certains CRM, par exemple) : c'est un connecteur à catalogue. Compi cherche lui-même dans le catalogue les outils d'agenda et de tâches (voir [Sources de l'agenda](#sources-de-lagenda)). Si l'aperçu dit « Rien aujourd'hui ni dans les 7 prochains jours » pour les événements, vérifie que ton agenda est bien synchronisé dans ce service ; ses tâches peuvent être ajoutées comme une deuxième source.
- **« Cet outil répond en texte libre »** : Compi ne sait lire que des réponses structurées. Essaie un autre outil du même connecteur, ou un lien `.ics` si le service en propose un.
- **La musique ne s'affiche pas** : l'application doit publier ses informations à Windows (Spotify, Chrome, Edge, Firefox, le lecteur Windows le font). Vérifie l'option dans **Réglages › Îlot et voix**.
- **« Micro refusé »** : dans les Paramètres Windows, **Confidentialité et sécurité › Microphone**, active « Autoriser les applications de bureau à accéder au microphone ».
- **La dictée comprend mal** : parle plus près du micro, ou passe au modèle **Précise** si tu as pris **Légère**.
- **Aucune voix française** : ajoute-en une dans **Paramètres › Heure et langue › Voix** (Julie et Paul sont gratuites).
- **Une routine n'a pas trouvé mes e-mails (ou mon agenda, mes fichiers)** : avec un cerveau en ligne, elle n'utilise que les données réglées sur « Toujours ». Change le réglage dans **Réglages › Confidentialité**, ou passe sur un cerveau local.
- **Une routine ne s'est pas lancée** : Compi doit être ouvert (il démarre avec Windows si l'option est active). Une routine manquée de plus de 12 heures est sautée ; elle reprend à la date suivante.
- **Un texte copié n'apparaît pas dans l'historique** : il venait d'un gestionnaire de mots de passe, ressemblait à un secret, ou dépassait 20 000 caractères. C'est voulu.
- **« Recherche par le sens » demande Ollama** : clique sur **Installer Ollama** dans la carte, ou lance-le depuis le menu Démarrer.
- **« Windows bloque l'accès aux notifications »** (Réglages › Messages) : clique sur **Ouvrir les paramètres de Windows** et autorise l'accès aux notifications pour les applications, puis **Activer** à nouveau.
- **Compi ne voit aucun message** alors que WhatsApp ou Mobile connecté les affichent : les notifications de Windows sont sans doute coupées (interrupteur **Notifications** dans **Paramètres › Système › Notifications**). Les applications ne montrent alors les messages que dans leur propre fenêtre, et rien n'arrive au centre de notifications. Réglages › Messages le signale, avec un bouton vers le bon réglage. Pour éviter les fenêtres qui surgissent, active **Ne pas déranger** plutôt que de tout couper : les messages arrivent quand même dans le centre de notifications, et Compi les voit.
- **Un message n'est pas rappelé** : le rappel n'arrive qu'après le délai choisi (30 min, 1 h ou 2 h) ; Aujourd'hui le liste tout de suite. Vérifie aussi que la messagerie est cochée, que sa notification est bien dans le centre de notifications de Windows (pas seulement sur le téléphone), et que tu n'es pas dans tes heures calmes. Un message ouvert ou fermé n'est plus en attente.
- **L'utilisation de Claude Code reste vide** : Compi lit `~/.claude/projects` (ou le dossier de `CLAUDE_CONFIG_DIR`). Lance au moins une session de Claude Code, puis clique sur l'heure de mise à jour pour relire.
- **La connexion à un service n'aboutit pas** : termine la connexion dans le navigateur, puis reviens dans Compi. Si la page a été fermée, clique sur **Annuler** puis réessaie. Après 5 minutes sans réponse, Compi abandonne de lui-même.
- **Journal** : `%APPDATA%\Compi\logs\compi.log` contient les erreurs de l'agent et la sortie de son moteur. Les clés API y sont masquées.

## Développement

```bash
npm install
npm run dev          # lance l'app Electron (rechargement à chaud)
npm run dev:web      # aperçu de l'interface dans un navigateur, avec une API simulée
npm test             # tests (vitest)
npm run typecheck    # vérification des types
npm run lint         # ESLint
npm run build:win    # installateur Windows dans dist/
npm run icons        # régénère les icônes du robot (resources/)
npx electron marketing/promo/render.cjs   # film promo de 55 s → marketing/compi-promo.mp4
```

Dans l'aperçu navigateur, la console expose des déclencheurs de démo : `__compiDemo.approval()`, `__compiDemo.question()`, `__compiDemo.cloudHelp()`, `__compiDemo.quick()` (actions rapides sur une sélection fictive), `__compiDemo.morning()` (résumé du matin), `__compiDemo.meeting()` (alerte de réunion), `__compiDemo.music()` / `__compiDemo.noMusic()`, `__compiDemo.timer(90)` et `__compiDemo.notice({ pill: 'reminder', text: 'Pause !' })`. Scénarios d'URL : `?brain=none` (aucun cerveau prêt), `?local=running` (Ollama lancé avec deux modèles), `?google=none` (Google pas configuré), `?google=client` (fichier client importé, compte pas connecté), `?music=playing|paused`, `?timer=on`, `?voice=installed` (dictée installée ; le téléchargement est simulé, rien n'est téléchargé), `?clip=on` (historique du presse-papier activé, avec des exemples), `?semantic=ready` (recherche par le sens prête ; sinon, « Activer » simule le téléchargement et la lecture des documents), `?perf=ok|spill|nogpu` (Ce PC simulé : tout va bien, modèle qui déborde avec mémoire presque pleine, ou sans carte graphique), `&monitor=on` (mini-jauges de l'îlot), `&cc=idle` (aucune session Claude Code au travail, pour laisser la place aux jauges), `?sounds=off`, `?keys=taken` (raccourci d'autorisation déjà pris) et `?messages=on` (messages en attente activés, avec des exemples ; ajoute `&winnotif=off` pour des notifications Windows coupées, ou `&winnotif=app` pour WhatsApp hors du centre de notifications).

Tests de bout en bout avec un faux Google : `COMPI_GOOGLE_TEST_BASE=http://127.0.0.1:<port>` redirige toutes les adresses de Google vers ce serveur. Il n'est accepté que sur 127.0.0.1 ou localhost. `COMPI_GOOGLE_TEST_CLIENT=<chemin>` donne alors le fichier client sans passer par le sélecteur. De même, `COMPI_HF_TEST_BASE=http://127.0.0.1:<port>` remplace Hugging Face par un faux serveur pour tester le téléchargement de la dictée. Pour les connecteurs en un clic, `COMPI_OAUTH_TEST=1` fait suivre la page de connexion par Compi lui-même au lieu d'ouvrir le navigateur : à utiliser avec un faux service OAuth local (voir `tests/helpers/fakeOAuthServer.ts`).

Pour l'utilisation et les messages : `COMPI_CLAUDE_DIR=<dossier>` remplace `~/.claude` par un faux dossier Claude Code (lu en lecture seule), et `COMPI_NOTIF_TEST_FILE=<fichier.json>` remplace les notifications de Windows par une liste simulée (`[{ id, aumid, app, at, title, body }]`), avec le même filtrage que le vrai relevé ; `COMPI_NOTIF_TEST_TOASTS=0` y simule des notifications Windows coupées. `COMPI_TEST_OFFSET_X=<pixels>` décale la fenêtre d'une instance de test pour qu'elle ne recouvre pas l'îlot de Compi installé.

## Architecture

```
src/
  main/                 processus principal Electron
    notchWindow.ts      fenêtre transparente, toujours devant, clic traversant hors de l'îlot
    agent/              Claude Agent SDK : boucle de l'agent, outils internes (MCP en mémoire), lecture et recherche de documents
    brains/             cerveaux : variables du moteur par fournisseur, passerelle locale (style de réponse, cache), Ollama, LM Studio, matériel, dossier des modèles, test
    windows/            ponts PowerShell (fonctions nommées seulement) : état du PC, recherche Windows, OCR, sélection ; un deuxième pour la musique et les voix, un troisième pour les notifications, un quatrième pour l'activité de la carte graphique
    voice/              dictée : téléchargement vérifié du modèle Whisper, protocole local compi-model://
    quick/              actions rapides sur la sélection : consignes et exécution
    privacy/            masquage des secrets, journal local de ce qui part en ligne, journal des autorisations
    google/             connexion Google (OAuth de bureau, PKCE), Agenda, Gmail (lecture, brouillons), construction MIME
    day/                ta journée : sources de l'agenda (connecteurs, liens .ics), rappels répétés, météo (Open-Meteo), résumé du matin, alertes de réunion, minuteur et pomodoro
    skills/             compétences : plugin local chargé par le SDK, compétences de départ, import
    memory/             « Ce que je sais de toi » : souvenirs, correction et effacement
    routines/           routines : planification, file d'exécution sans interface, notification de fin
    clipboard/          historique du presse-papier (désactivé par défaut, chiffré, exclusions)
    semantic/           recherche par le sens : découpage en passages, vecteurs Ollama, index incrémental
    usage/              utilisation : lecture incrémentale des fichiers de Claude Code, réponses et coût de Compi
    system/             Ce PC : processeur, mémoire, carte graphique par application, modèle local, mesure de chaque réponse locale
    messages/           messages en attente : relevé des notifications Windows (hôte PowerShell dédié), rappels
    approvals.ts        file d'approbations et de questions (agent Compi + Claude Code)
    connectors/         connecteurs MCP de l'utilisateur, connexion par compte (OAuth 2.1, PKCE), test de connexion
    bridge/             pont Claude Code : serveur de hooks, installation des hooks, suivi des sessions
    store/              réglages, secrets chiffrés, historique des discussions
  preload/              API typée exposée à l'interface (window.compi)
  renderer/             interface React + Tailwind v4 + Motion
    mascot/             le robot : yeux LED 5×5, tête complète, humeurs
    components/         îlot (musique, minuteur, voix), panneau, cartes, primitives
    lib/                lecture à voix haute, dictée (micro, silence), fil de transcription Whisper, sons (Web Audio)
    views/              Discussion, Aujourd'hui (routines), Ce que je sais de toi, Activité, Historique, Connecteurs, Réglages
  shared/               types, canaux IPC, « pastilles », expressions LED, modèles et conseiller, règles de confidentialité, actions rapides
tests/                  tests unitaires (vitest) : pont, cerveaux, passerelle, Windows, actions rapides, confidentialité…
```

## Sécurité et confidentialité

- **Aucune télémétrie, aucun compte.** Compi n'envoie rien à ses auteurs, et le moteur de l'agent est réglé pour ne rien envoyer d'autre que la conversation (ni statistiques d'usage, ni rapports d'erreur), quel que soit le cerveau. Les secrets (clé API, jetons des connecteurs) sont chiffrés par Windows et ne sortent jamais du processus principal. Le détail de ce qui reste sur le PC et de ce qui peut en sortir est dans [PRIVACY.md](PRIVACY.md).
- **Isolation de l'agent** : il tourne avec son propre dossier de configuration et ignore tes réglages Claude Code (`settingSources: []`). Par défaut, pas de commandes shell ni de modification de fichiers ; le « mode avancé » les autorise, toujours avec validation.
- **Serveur du pont** : il écoute uniquement sur `127.0.0.1`, avec un jeton secret dans l'URL, et refuse les requêtes venant d'une page web (en-tête `Origin`).
- **Cerveau local** : le moteur de l'agent ne parle qu'à `127.0.0.1`. Aucune clé Anthropic ne lui est transmise, et le trafic annexe (télémétrie, mises à jour) est coupé. Ne sortent du PC que les pages web que tu demandes de lire, les connecteurs en ligne que tu as ajoutés, et une lecture par Claude acceptée sur la carte « Envoyer … à Claude ? ».
- **Autre service** : la clé Anthropic ne lui est jamais envoyée ; seule la clé de ce service l'est.
- **Garde-fou pour les cerveaux en ligne** (Claude ou autre service ; il ne s'applique pas en local, où rien ne sort) :
  - dans **Réglages › Confidentialité**, pour chaque type de donnée (écran, fichiers, e-mails, agenda, presse-papier, fenêtres, mémoire), tu choisis **Me demander** (par défaut), **Toujours** ou **Jamais** ;
  - « Me demander » affiche une carte qui nomme la destination (« Le contenu partira vers OpenRouter. ») ;
  - les IBAN, cartes bancaires, n° de sécurité sociale, mots de passe, codes et clés d'API sont **masqués avant l'envoi**. Chaque numéro est vérifié (clé de l'IBAN, algorithme de Luhn…), pour ne pas masquer un SIRET ou un numéro de commande ;
  - ta mémoire n'est pas ajoutée aux messages d'un cerveau en ligne, sauf si tu choisis « Toujours » pour la mémoire ;
  - sous chaque réponse, une puce indique « 100 % sur ton PC » ou ce qui est parti et vers qui (« Envoyé à Claude (Anthropic) : ta question · fichiers · 1 secret masqué »). Le même journal, sans aucun contenu, est dans **Activité**.
- **Compte Google** :
  - la connexion se fait dans ton navigateur, sur l'écran de Google. Le retour passe par un petit serveur sur 127.0.0.1, vérifié par un code à usage unique (PKCE) ;
  - le jeton de connexion est chiffré par Windows ;
  - **E-mails** et **Agenda** sont deux types de donnée du garde-fou ci-dessus ;
  - jamais d'envoi d'e-mail, jamais d'invité dans un rendez-vous ;
  - « Ta journée » (écran Aujourd'hui, résumé du matin, alertes) est calculé sur le PC, sans cerveau.
- **Sources de l'agenda** :
  - lues sur le PC, sans cerveau, pour Aujourd'hui, le résumé du matin et les alertes ;
  - un lien `.ics` est un secret (quiconque l'a peut lire l'agenda) : il est chiffré par Windows, jamais écrit dans `settings.json` ni dans le cache du navigateur intégré. Seules les adresses `https` sont acceptées (ou `http` sur 127.0.0.1) ;
  - seul un outil de connecteur en lecture peut devenir une source, et seulement après ton aperçu ;
  - quand Compi lit ton agenda dans une discussion, c'est la catégorie agenda du garde-fou qui décide, comme pour Google.
- **E-mails piégés** : un e-mail ou une invitation peut contenir des consignes écrites par un inconnu (« ouvre ce lien… »). Une fois qu'un e-mail ou un rendez-vous a été lu dans une discussion, tout ce qui pourrait faire sortir des données du PC (page web, lien, recherche, connecteur) demande ton OK, sans « Toujours ».
- **Météo** : seule la ville que tu as choisie est envoyée à Open-Meteo (gratuit, sans compte).
- **Voix** : la dictée est transcrite sur le PC (Whisper) et la lecture à voix haute utilise les voix de Windows. Le son ne quitte jamais l'ordinateur : seul le texte transcrit part au cerveau, comme si tu l'avais tapé. Le modèle n'est téléchargé qu'après ton clic ; ensuite, Compi le lit sur le disque, sans Internet.
- **Mémoire** : enregistrée sur le PC. Tu la vois en entier dans « Ce que je sais de toi », et effacer supprime aussi les copies de travail.
- **Routines** : elles tournent sans toi, donc avec moins de droits que toi.
  - Avec un cerveau en ligne, seules les données réglées sur « Toujours » sont utilisables : une routine n'affiche jamais de carte de partage.
  - Aucune action : pas de brouillon, de rendez-vous, de lien ouvert, de souvenir modifié, de commande Windows, de connecteur non autorisé d'avance.
  - 10 minutes au plus, et un bouton **Arrêter**.
- **Presse-papier** : historique désactivé par défaut, chiffré par Windows, effacé quand tu le désactives. Les contenus des gestionnaires de mots de passe et tout ce qui ressemble à un secret ne sont jamais gardés. Avec un cerveau en ligne, l'historique est une donnée du garde-fou (catégorie presse-papier).
- **Recherche par le sens** : les empreintes sont calculées par Ollama sur le PC et l'index reste dans le dossier de Compi. Le modèle n'est téléchargé qu'après ton clic. Les passages trouvés vont au cerveau comme résultat de recherche ; avec un cerveau en ligne, c'est la catégorie fichiers du garde-fou qui décide.
- **Messages en attente** : désactivé par défaut, activé seulement par ton clic (accès de Windows vérifié). Compi ne lit que les notifications des applications cochées et ne fait que les lire : il ne ferme, ne modifie et n'envoie rien. Pour les rappels, ni texte ni nom sur le disque, et aucun cerveau. La lecture du texte par Compi est une option à part : en mémoire 24 h, codes masqués, carte à chaque fois avec un cerveau en ligne (catégorie messages du garde-fou, sans « Toujours »), jamais dans une routine. Désactiver efface tout. Le relevé s'arrête quand le PC est verrouillé ou en veille.
- **Journal des autorisations** : sur le PC, sans contenu (titre, outil, cible courte, ta réponse), 500 entrées et 90 jours au plus.
- **Utilisation de Claude Code** : lue sur le PC, en lecture seule, dans les fichiers que Claude Code écrit. Compi n'en garde que des totaux par heure, projet et modèle (et des identifiants, pour ne rien compter deux fois), 40 jours. Aucun texte des sessions.
- **Connecteurs en un clic** : la connexion se fait sur la page du service, dans ton navigateur ; le retour passe par 127.0.0.1, vérifié par PKCE et un code `state`. Les jetons sont chiffrés par Windows et ne sortent jamais du processus principal. Seules les adresses `https` sont acceptées (ou `http` sur 127.0.0.1).
- **Ce PC** : mesuré seulement quand tu regardes (Activité ouverte, jauges de l'îlot, réponse locale en cours), jamais quand le PC est verrouillé. Les compteurs de performances de Windows sont lus, rien n'est modifié ; seul **Libérer** décharge un modèle d'Ollama, à ta demande. Rien ne part en ligne.
- **Raccourcis d'autorisation** : pris à Windows seulement tant qu'une carte attend, jamais « Toujours », et pas sur une carte arrivée il y a moins d'une seconde.
- **Autorisations du navigateur intégré** : seulement le micro (jamais la caméra), et seulement pour l'interface de Compi. Le reste (localisation, notifications web…) est refusé.
- **Pilotage de Windows** : regarder est libre, agir demande ton OK à chaque fois.
  - Rien d'irréversible : Compi ne peut ni éteindre, ni verrouiller, ni mettre en veille le PC, ni supprimer de fichier.
  - Il ne touche au clavier qu'au moment où tu appuies sur `Alt + Maj + C` (un seul Ctrl+C) et quand tu cliques sur « Remplacer » (un seul Ctrl+V). Il attend que tu aies relâché les touches, et ne prend jamais la souris.
  - Chaque commande Windows a un délai maximal de quelques secondes : si Windows ne répond pas, Compi abandonne et te le dit.
  - Ouvrir un programme ou un script (`.exe`, `.bat`, `.ps1`, `.vbs`, `.js`, `.ahk`, `.msi`…, ou un raccourci qui y mène) demande une carte à chaque fois, sans « Toujours », même si tu avais choisi « Toujours » pour ouvrir des fichiers. Les dossiers réseau ne s'ouvrent pas depuis Compi.
- **Rangement des dossiers** :
  - seulement dans les dossiers que tu as confiés, chemins réels vérifiés (un lien ne permet pas d'en sortir) ;
  - jamais de suppression ni d'écrasement, jamais vers un autre disque ;
  - une carte par lot, sans « Toujours » ; jamais dans une routine ;
  - l'inventaire ne lit que les noms, tailles et dates, jamais le contenu. Avec un cerveau en ligne, c'est la catégorie fichiers du garde-fou ;
  - `compi.log` ne note que le nombre d'éléments déplacés. Les noms sont seulement dans le journal d'annulation (`%APPDATA%\Compi\moves`, les 20 derniers rangements).
- **Claude Code n'est jamais bloqué** : si Compi est fermé ou ne répond pas dans le délai choisi, Claude Code reprend sa demande habituelle dans le terminal.

### Limites connues

- **Ce que Compi protège, et contre qui** : tes données restent sur ton PC, à l'abri du web et des autres comptes Windows. Le chiffrement de Windows (DPAPI) ne protège pas contre un programme malveillant qui tourne déjà sous ton propre compte.
- **Consignes cachées** : une page web, un document ou la réponse d'un connecteur peut contenir des consignes écrites par quelqu'un d'autre, comme un e-mail piégé. Les garde-fous ci-dessus limitent les dégâts (carte avant chaque action, pas de « Toujours » pour ce qui fait sortir des données après un e-mail lu), mais aucun modèle n'y est totalement insensible : relis les cartes avant d'autoriser.
- **Connecteurs « Local »** : ils lancent sur ton PC la commande que tu as saisie ou choisie (souvent `npx …`). N'ajoute que des connecteurs de sources en qui tu as confiance.
- **Mode avancé** : il donne à l'agent les commandes shell et la modification de fichiers, toujours avec ta validation. Laisse-le désactivé si tu n'en as pas besoin.
- **Installateur non signé**, et pas de mise à jour automatique : reconstruis depuis le code pour avoir la dernière version.

**Signaler une faille** : voir [SECURITY.md](SECURITY.md). Merci de ne pas la publier avant qu'elle soit corrigée.

## Contribuer

Les propositions sont les bienvenues.

- Avant d'envoyer une modification : `npm test`, `npm run typecheck` et `npm run lint` doivent passer.
- Format du code : Prettier, avec `--no-semi --single-quote --print-width 160 --trailing-comma none`.
- **Aucun service n'est codé en dur** : chaque source (agenda, connecteur, cerveau) se choisit dans l'interface. Les tests utilisent des données fictives et de faux serveurs locaux (voir [Développement](#développement)) ; jamais de vraie clé, de vrai compte ni de vraies données personnelles dans le dépôt.

## Licence

Le code de Compi est sous licence **MIT** (voir [LICENSE](LICENSE)).

Certaines dépendances ont leur propre licence (détail et textes complets dans [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)) :

- **Moteur de l'agent** : `@anthropic-ai/claude-agent-sdk` et le `claude.exe` qu'il contient appartiennent à Anthropic (« All rights reserved ») et relèvent de [ses conditions](https://code.claude.com/docs/en/legal-and-compliance), dont les [conditions commerciales](https://www.anthropic.com/legal/commercial-terms). Ils ne sont pas sous licence MIT. `npm install` les télécharge, et l'installateur construit les inclut.
- **ical.js** : MPL-2.0. **Polices** Doto, JetBrains Mono et Onest : SIL Open Font License 1.1. **Transformers.js** : Apache-2.0. **JSZip** : MIT (double licence MIT ou GPL-3.0).
- Les autres dépendances sont sous licence MIT, ISC ou BSD.
- Les modèles (Whisper, modèles locaux d'Ollama ou de LM Studio, modèle de la recherche par le sens) ne font pas partie du dépôt : ils sont téléchargés à ta demande, chacun avec sa licence.

## Crédits

Le concept de compagnon d'agents dans l'encoche est inspiré de projets comme [Coucou](https://github.com/Louis-CFM/coucou) (MIT). Compi est écrit de zéro : nom, mascotte, icônes et code sont originaux, aucun élément de Coucou n'est repris.
