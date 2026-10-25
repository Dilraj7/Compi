# Début commun des hôtes Windows de Compi. Un hôte lit une commande JSON par
# ligne sur l'entrée standard ({ id, fn, args }) et répond par une ligne JSON
# ({ id, ok, result | error }). Seules les fonctions de la table $Fns existent, et
# chacune revérifie ses paramètres : aucune commande libre ne peut passer par ici.
# Un hôte réunit plusieurs scripts (host.ts, composeHost) : ce début, ses
# scripts de fonctions, puis la boucle de commandes (loop.ps1).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$Fns = @{}

$Fns.ping = { @{ pong = $true } }
