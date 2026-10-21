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
| Modèle de dictée                                         | `models\`                                                         | seulement si tu le télécharges                                                                 |
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
- **Sur ce PC** (Ollama, LM Studio) : rien ne part. Une seule exception : pour une image ou un scan que le modèle ne sait pas lire, une carte te propose de l'envoyer à Claude, à chaque fois et sans « Toujours ».

**Le garde-fou des cerveaux en ligne**

- Pour chaque type de donnée (écran, fichiers, e-mails, agenda, presse-papier, fenêtres, mémoire), tu choisis **Me demander** (par défaut), **Toujours** ou **Jamais**, dans Réglages › Confidentialité. Pour tes messages reçus, une carte demande ton accord à chaque fois, sans « Toujours ».
- Les IBAN, cartes bancaires, n° de sécurité sociale, mots de passe, codes et clés d'API sont masqués avant l'envoi.
- Ta mémoire n'est pas envoyée, sauf si tu choisis « Toujours » pour elle.
- Sous chaque réponse, une puce dit ce qui est parti et vers qui.

**Les services que tu branches**

- **Google** (agenda, e-mails), avec ton propre client Google.
- **Connecteurs** : chaque outil demande ton accord avant de servir. Les connecteurs « Local » lancent la commande que tu as choisie, souvent `npx`, qui télécharge le connecteur depuis npm.
- **Liens d'agenda** `.ics` que tu ajoutes.

**À ta demande**

- Les pages web que tu demandes de lire ou d'ouvrir.
- La météo : seule ta ville part vers Open-Meteo.
- La recherche de connecteurs dans le registre MCP officiel.
- Les téléchargements de modèles, toujours après ton clic : Hugging Face pour la dictée, Ollama pour les modèles locaux.

Chaque service applique sa propre politique de confidentialité (Anthropic, Google, OpenRouter…).

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
