# Ce qui a changé

Chaque version de Compi, la plus récente en haut. « Nouveautés » liste ce que tu peux faire de plus,
« Corrections » ce qui marche mieux qu'avant. Une version sans correction n'a pas cette partie.

Les versions 0.2 et 0.3 sont des étapes de travail : le numéro de l'application est resté 0.1.0
jusqu'à la 0.4.0.

## 0.7.1 — 2 novembre 2026

### Nouveautés

- Nouvelles cartes sous la réponse :
  - e-mails trouvés (avec le nom de l'expéditeur, jamais son adresse) ;
  - fichiers et contenu d'un dossier ;
  - sources d'une recherche web ;
  - réunions (résumé, points et tâches, jamais la transcription) ;
  - minuteur et pomodoro qui défilent en direct.
- « Montrer dans l'Explorateur » sur un fichier d'une carte. « Ouvrir » reste limité aux dossiers
  que tu as confiés.
- Météo de demain : Compi peut demander directement les prévisions du lendemain.

### Corrections

- 3 novembre : « Annuler » une modification de fichier marche aussi quand Windows donne le chemin
  sous une autre forme (nom court, autre casse ou lien). Avant, Compi répondait « rien à annuler ».

## 0.7.0 — 2 novembre 2026

### Nouveautés

- Cartes visuelles dans le chat : météo (heures clés, pluie en couleur), agenda (avec
  « Rejoindre »), tâches Google et rappels (cases à cocher).
- Les cartes sont faites avec les données reçues, jamais écrites par le modèle. Elles restent avec
  la discussion, sans les participants des rendez-vous ni les notes des tâches.
- Le modèle ne répète plus dans sa réponse ce que la carte montre déjà.

### Corrections

- Le bas des Réglages affiche la vraie version de Compi (il indiquait toujours 0.4.0).

## 0.6.3 — 1er novembre 2026

### Nouveautés

- Langue des réunions au choix : Auto, français ou anglais.
- Le son de l'appel est gardé 24 h (le micro est effacé tout de suite) pour pouvoir refaire la
  séparation des voix, puis il s'efface tout seul. « Effacer le son » le supprime tout de suite.
- Rattacher une phrase à une autre voix.

### Corrections

- Transcriptions plus justes : chaque voix est coupée aux pauses, et non plus en tranches de 20 s
  qui coupaient les phrases au milieu.
- Les phrases douteuses (écrites dans l'autre langue, ou avec des mots manquants) sont relues, sinon
  marquées « à vérifier ».

## 0.6.2 — 1er novembre 2026

### Nouveautés

- Transcription flottante : une petite fenêtre de transcription en direct devant ton appli de visio,
  compacte ou non, qui garde sa place.
- Compi est masqué des partages d'écran (activé par défaut).

## 0.6.1 — 1er novembre 2026

### Nouveautés

- Notes de réunion : Compi lit tes réunions et écrit une note d'après ton modèle Markdown, avec une
  carte d'accord et « Annuler ».
- Dossier de notes au choix, coffre Obsidian reconnu.
- « Discuter de cette réunion » ouvre une discussion avec la réunion jointe.

## 0.6.0 — 1er novembre 2026

### Nouveautés

- Plein écran au maximum :
  - agenda sur 7 jours glissants, avec la météo de chaque jour ;
  - récents : dernières réunions et fichiers de la semaine dans tes dossiers confiés ;
  - recherche universelle Ctrl+K : applis, fichiers confiés, réunions, discussions, rappels, tâches,
    souvenirs et réglages, tout sur le PC ;
  - blocs à ta main : les glisser, les masquer, revenir à la disposition par défaut ;
  - appel en cours en grand, puis son résumé et ses tâches ;
  - scène de conversation vocale ;
  - accueil qui propose selon le moment ;
  - tâches des connecteurs dans le bloc Tâches.
- Le plein écran ne se charge qu'à sa première ouverture.

## 0.5.0 — 30 octobre 2026

### Nouveautés

- Zone d'écran (Alt+Maj+Z) : tu encadres une partie de l'écran, le texte est lu sur le PC, puis
  Copier, Traduire, Résumer ou Expliquer. Seul « Expliquer » joint l'image, et seulement si le
  cerveau voit les images. Rien ne part avant ton clic.

## 0.4.9 — 30 octobre 2026

### Nouveautés

- « Ce que tu as manqué » : après un pomodoro, une réunion ou une absence, une carte résume les
  messages en attente, les e-mails non lus et les rappels qui ont sonné. Calculé sur le PC, sans
  cerveau.

### Corrections

- Pas de double alerte : ce qu'une carte a déjà montré n'est pas repris par la suivante.

## 0.4.8 — 30 octobre 2026

### Nouveautés

- Connecteurs avec les identifiants de ta propre application (Client ID et secret) pour les
  services qui n'acceptent pas l'enregistrement automatique (Salesforce, Slack, GitHub…). Le secret
  est chiffré par Windows.

## 0.4.7 — 30 octobre 2026

### Nouveautés

- Routines sur événement : premier allumage du jour, fin d'un rendez-vous, nouveau message en
  attente. Avec des limites de fréquence.

### Corrections

- Sécurité : les outils qui envoient quelque chose dehors passent toujours par le garde-fou, même
  sans compte Google connecté.

## 0.4.6 — 30 octobre 2026

### Nouveautés

- Droits choisis pour chaque routine : chercher sur le web, créer des notes dans tes dossiers
  confiés. Désactivés par défaut.
- Le journal dit pourquoi une action a été refusée.

### Corrections

- Message « contenu écrit par d'autres » corrigé.

## 0.4.5 — 29 octobre 2026

### Nouveautés

- Taille du texte réglable, dans l'encoche (jusqu'à 150 %) et en plein écran (jusqu'à 200 %) :
  Ctrl + / Ctrl − / Ctrl 0, Ctrl + molette, ou A− / A+.

### Corrections

- Dock du plein écran : la valeur d'une jauge ne passe plus à la ligne.

## 0.4.4 — 28 octobre 2026

### Nouveautés

- Tâches Google dans Aujourd'hui et en plein écran : en retard, aujourd'hui, bientôt ; cocher et
  ajouter d'un clic. Compi peut aussi les lire et les créer, avec une carte à chaque action.
- Le résumé du matin inclut les tâches du jour et en retard.

## 0.4.3 — 28 octobre 2026

### Nouveautés

- Préparer mes réunions : avant une réunion à plusieurs, qui sera là, vos derniers e-mails et les
  tâches de la fois d'avant. Les participants ne sont jamais envoyés à un cerveau.
- « Enregistrer » relie l'appel au rendez-vous.

## 0.4.2 — 28 octobre 2026

### Nouveautés

- Conversation vocale : après une question posée à la voix, Compi rouvre le micro à la fin de sa
  réponse. Tu peux aussi lui couper la parole. Le son n'est jamais écrit ni envoyé.

## 0.4.1 — 27 octobre 2026

### Nouveautés

- « Pourquoi ? » sous la vitesse du modèle local : Compi explique ce qui l'a ralenti et donne un
  conseil quand la même cause revient.
- Nouveau pack pour reconnaître les voix des appels, plus fiable. « Mettre à jour » remplace
  l'ancien.

### Corrections

- Personnes en face : seulement Auto ou 1. Imposer 2 à 4 voix donnait plus d'erreurs que le
  réglage automatique.

## 0.4.0 — 26 octobre 2026

### Nouveautés

- Le plein écran « Poste de pilotage » (Alt+Maj+Entrée) : la journée à gauche, la discussion au
  centre, « À toi » à droite, un dock en bas. Échap pour revenir à l'encoche.
- En plein écran, chaque étape d'une réponse montre ce qu'elle a changé (fichier, rendez-vous,
  rappel, sources web…).

## 0.3 — 25 et 26 octobre 2026

### Nouveautés

- Compi te prévient quand la mémoire du PC est presque pleine, avec les causes en clair.
- Écrire dans un fichier texte d'un dossier confié, avec une carte qui montre les lignes changées et
  « Annuler ».
- Réunions : « Personnes en face » (Auto ou un nombre).
- Plus léger : 2 processus PowerShell au lieu de 4, index de recherche gardé sur le disque,
  installateur plus petit.

### Corrections

- Le modèle local ne résume plus la conversation presque à chaque tour.
- Le modèle local relit beaucoup moins à chaque réponse.
- Quand le modèle local écrit un appel d'outil en texte au lieu de le faire, Compi le rattrape.
- Quand tu demandes d'écrire dans un fichier et que le texte est seulement affiché, Compi relance le
  modèle pour qu'il l'écrive vraiment.
- Réunions : un moment où deux voix se chevauchent n'est plus transcrit deux fois.

## 0.2 — 21 et 22 octobre 2026

### Nouveautés

- Modèle local plus rapide.
- Dictée partout : maintenir Ctrl droit dans n'importe quelle application, parler, relâcher. La
  reconnaissance se fait sur le PC. Temps gagné dans Activité.
- Enregistreur d'appels, avec transcription en direct, séparation des voix et résumé.
- Voix naturelle pour la lecture à voix haute.
- Recherche web pour le cerveau local (Ollama ou ton propre SearXNG), désactivée par défaut.
- Réglages en 6 rubriques, Activité en onglets.

### Corrections

- Extensions ne tourne plus en boucle si on l'ouvre avant le chargement des réglages.

## 0.1.0 — 21 octobre 2026

Premier envoi public du code de Compi.
