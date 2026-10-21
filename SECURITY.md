# Sécurité

## Signaler une faille

Merci de **ne pas ouvrir de ticket public** pour une faille de sécurité.

Utilise le signalement privé de GitHub : onglet **Security** du dépôt, puis **Report a vulnerability**. Décris :

- ce qui se passe, et ce qui devrait se passer ;
- comment le reproduire (version de Compi, de Windows, cerveau utilisé) ;
- l'effet possible (données lues, envoyées en ligne, action sans carte d'autorisation…).

N'y mets jamais une vraie clé API, un vrai jeton ou des données personnelles : des valeurs fictives suffisent.

## Ce qui compte comme une faille

- Une action sensible qui se fait **sans carte d'autorisation**, ou avec « Toujours » alors qu'il est interdit.
- Une donnée qui part vers un cerveau en ligne ou un service **malgré le réglage** de Réglages › Confidentialité.
- Un secret (clé API, jeton, lien `.ics`) écrit en clair sur le disque, dans `compi.log` ou dans un cache.
- Le serveur du pont Claude Code joignable depuis une page web ou sans son jeton.
- Une page web, un e-mail, un document ou un connecteur qui fait agir Compi hors des dossiers confiés, ou qui fait lancer un programme sans carte.

Les limites déjà connues sont décrites dans le [README](README.md#limites-connues).

## Versions suivies

Seule la dernière version du dépôt reçoit des correctifs.
