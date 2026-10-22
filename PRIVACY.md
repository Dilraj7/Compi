# Confidentialité

Compi n'a ni compte ni serveur. Ses auteurs ne reçoivent aucune donnée : pas de statistiques d'usage, pas de rapport de plantage, pas de mise à jour automatique.

## Ce qui reste sur ton PC

Tout est dans le dossier `%APPDATA%\Compi`.

| Quoi                                                     | Où                                                                | À savoir                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Réglages                                                 | `settings.json`                                                   |                                                                                                |
| Discussions                                              | `conversations.json`                                              |                                                                                                |
| Ce que Compi sait de toi                                 | `memory.json`                                                     | visible et modifiable dans « Ce que je sais de toi »                                           |
| Rappels, routines, minuteur, journée                     | `reminders.json`, `routines.json`, `timer.json`, `day-state.json` |                                                                                                |
| Clés API, jetons Google et des connecteurs, liens `.ics` | `secrets.json`                                                    | **chiffré par Windows** (DPAPI)                                                                |
| Historique du presse-papier                              | `clipboard-history.bin`                                           | désactivé par défaut ; **chiffré par Windows** ; texte seulement, 200 éléments et 30 jours     |
| Journal technique                                        | `logs\compi.log`                                                  | erreurs et sortie du moteur ; les clés Anthropic y sont masquées ; 1 Mo, plus l'ancien fichier |
| Journal des autorisations                                | `approvals-log.json`                                              | sans contenu ; 500 entrées et 90 jours au plus                                                 |
| Journal « Envoyé en ligne »                              | `privacy-log.json`                                                | destination, types de données et titre de la discussion ; 100 entrées                          |
| Copies de travail du moteur                              | `agent\`                                                          | le moteur les garde 30 jours, **même après la suppression d'une discussion** (à corriger)      |
| Index de la recherche par le sens                        | `semantic\`                                                       | seulement si tu l'actives                                                                      |
| Modèles de dictée et voix naturelle                      | `models\`                                                         | seulement si tu les télécharges                                                                |
| Temps gagné (dictée partout)                             | `dictation-stats.json`                                            | par jour et par programme : dictées, mots, temps de parole ; **jamais le texte**               |
| Appels enregistrés                                       | `meetings\`                                                       | transcriptions, noms des voix, résumés ; le son, le temps de la transcription                  |
| Journal des rangements                                   | `moves\`                                                          | noms des fichiers déplacés, pour pouvoir annuler ; les 20 derniers rangements                  |
| Utilisation                                              | `usage-claude-code.json`, `usage-compi.json`                      | des totaux seulement, aucun texte                                                              |
| Messages en attente                                      | `messages-reminders.json`                                         | identifiants de notification et heures, **jamais le texte**                                    |
| Compétences                                              | `skills\`                                                         |                                                                                                |
| Divers                                                   | `warm-prompt.json`, `hardware.json`, caches de l'interface        | copie des consignes pour accélérer le modèle local, description du matériel                    |

Sauf les deux lignes chiffrées, ces fichiers sont lisibles par ton compte Windows, comme tes documents. Le chiffrement de Windows ne protège pas contre un programme malveillant qui tourne déjà sous ton compte.

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

- **Google** (agenda, e-mails), avec ton propre client Google.
- **Connecteurs** : chaque outil demande ton accord avant de servir. Les connecteurs « Local » lancent la commande que tu as choisie, souvent `npx`, qui télécharge le connecteur depuis npm.
- **Liens d'agenda** `.ics` que tu ajoutes.

**À ta demande**

- Les pages web que tu demandes de lire ou d'ouvrir.
- La météo : seule ta ville part vers Open-Meteo.
- La recherche de connecteurs dans le registre MCP officiel.
- Les téléchargements de modèles, toujours après ton clic : Hugging Face pour la dictée, la séparation des voix et la voix naturelle, Ollama pour les modèles locaux.

Chaque service applique sa propre politique de confidentialité (Anthropic, Google, OpenRouter…).

## Dictée partout

Désactivée par défaut (Réglages › Dictée partout).

- **La touche** : un petit processus séparé observe le clavier (module uiohook), sans jamais rien bloquer. Seule la touche choisie compte. Les autres frappes ne sont ni lues, ni gardées, ni transmises à Compi : ce processus ne lui envoie que « commencer », « arrêter » ou « annuler ». Une fenêtre lancée en administrateur ne lui transmet rien.
- **Le micro** ne s'ouvre que pendant que tu maintiens la touche (ou en mains libres, après un double appui). Ta voix est transcrite sur ton PC ; le son n'est jamais écrit sur le disque ni envoyé.
- **Le texte** est collé là où est ton curseur, par le presse-papier, marqué pour rester hors de l'historique Win+V et du presse-papier cloud. Ce que tu avais copié est remis juste après. Si la fenêtre a changé entre-temps, rien n'est collé : le texte reste copié pour un Ctrl+V.
- **Le style Soigné** fait réécrire le texte par ton cerveau. Sur ce PC, rien ne part. Avec un cerveau en ligne, seulement si tu l'autorises, et seulement le texte, jamais la voix.
- **« Compi, … »** : une dictée qui commence ainsi devient une demande à Compi, avec les règles habituelles.
- Compi retient le nom du programme (« outlook »), jamais le titre de la fenêtre.

## Appels et réunions

Rien ne commence sans ton clic (Historique › Réunions › Enregistrer un appel), et Compi ne propose jamais d'enregistrer tout seul.

- **Prévenir les participants est obligatoire.** Compi te le rappelle avant chaque appel, avec une phrase à lire ou à envoyer. Un point rouge reste visible pendant tout l'enregistrement.
- **Le son** : ton micro et, si tu le choisis, le son de l'ordinateur (ce que tu entends des autres participants), capté par Windows sur ta sortie audio. En secours seulement, Chromium le fournit, mais il exige aussi une image de l'écran : elle est arrêtée aussitôt, jamais lue ni gardée.
- **Sur le disque** : le son est écrit dans `meetings\` le temps de l'appel et de sa mise au propre, puis effacé ; seul le texte reste. Sauf si tu coches « Garder le son », ou si l'enregistrement est interrompu : le son reste alors pour que tu puisses reprendre, jusqu'à ce que tu supprimes la réunion.
- **La transcription et la séparation des voix** se font sur ton PC. Le son n'est jamais envoyé.
- **Le résumé** est fait par ton cerveau. Sur ce PC, rien ne part. Avec un cerveau en ligne, la catégorie « Réunions » s'applique (Me demander par défaut) : seul le texte part, secrets masqués, et le résumé automatique n'a lieu qu'avec « Toujours ».
- **« Suite avec Compi »** ouvre une discussion à partir de la transcription. Elle est traitée comme un contenu venu d'ailleurs : toute action vers l'extérieur demande ton accord.
- Aucune reconnaissance d'émotions.

## Lecture à voix haute

- **La voix de Windows** (par défaut) ou **la voix naturelle** (Réglages › Voix), téléchargée seulement après ton clic. Les deux lisent sur ton PC : le texte n'est jamais envoyé, et le son n'est pas écrit sur le disque.
- La voix naturelle tourne dans un processus séparé, arrêté après 3 minutes sans lecture. Ce qu'elle ne sait pas lire (le tamoul) passe par la voix de Windows.

## Routines

Elles tournent sans toi, donc avec moins de droits que toi. Avec un cerveau en ligne, elles n'utilisent que les données réglées sur « Toujours ». Elles n'agissent jamais : pas de brouillon, de rendez-vous, de lien ouvert ni d'action sur Windows.

## Tout effacer

1. Si tu as connecté Claude Code : Réglages › Claude Code › **Déconnecter**. Compi retire ses hooks de `~/.claude/settings.json`.
2. Réglages › Comportement : désactive **Démarrer avec Windows**.
3. Désinstalle Compi, puis supprime le dossier `%APPDATA%\Compi`.
4. Retire l'accès de Compi à Google sur [myaccount.google.com/permissions](https://myaccount.google.com/permissions), et chez chaque service que tu as connecté.
5. Si tu ne t'en sers plus ailleurs, révoque tes clés API dans la console de chaque service.

## Signaler un problème

Voir [SECURITY.md](SECURITY.md).
