# Troisième hôte Windows, en lecture seule : les notifications des autres
# applications, telles qu'elles sont dans le centre de notifications
# (UserNotificationListener). Sert aux rappels de messages en attente.
# Même règles que les autres hôtes : fonctions nommées, paramètres vérifiés.
# Rien n'est modifié ni fermé dans le centre de notifications.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$script:AsTaskOp = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$null = [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime]
$null = [Windows.UI.Notifications.KnownNotificationBindings, Windows.UI.Notifications, ContentType = WindowsRuntime]

function Await($op, [Type]$type, [int]$ms = 8000) {
  $task = $script:AsTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'Windows met trop de temps à répondre.' }
  $task.Result
}

function Listener { [Windows.UI.Notifications.Management.UserNotificationListener]::Current }

function Cut([string]$s, [int]$max) {
  if ($s.Length -gt $max) { $s.Substring(0, $max) } else { $s }
}

$Fns = @{}

$Fns.ping = { @{ pong = $true } }

# Accès aux notifications : Allowed, Denied ou Unspecified. Ne montre rien.
$Fns.access = { @{ status = [string](Listener).GetAccessStatus() } }

# Demande l'accès (Windows peut afficher une fenêtre) : seulement après un clic de l'utilisateur.
$Fns.request_access = {
  $s = Await ((Listener).RequestAccessAsync()) ([Windows.UI.Notifications.Management.UserNotificationListenerAccessStatus]) 60000
  @{ status = [string]$s }
}

# Réglages de notification de Windows (registre de l'utilisateur, lecture seule) :
# l'interrupteur général, et les applications dont les notifications sont coupées
# ou ne restent pas dans le centre de notifications. Seulement des identifiants.
$Fns.health = {
  $push = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -ErrorAction SilentlyContinue
  $toast = 1
  if ($null -ne $push -and $null -ne $push.ToastEnabled) { $toast = [int]$push.ToastEnabled }
  $apps = New-Object System.Collections.ArrayList
  foreach ($k in @(Get-ChildItem -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings' -ErrorAction SilentlyContinue)) {
    $p = Get-ItemProperty -Path $k.PSPath -ErrorAction SilentlyContinue
    if ($null -eq $p) { continue }
    if ($p.Enabled -eq 0 -or $p.ShowInActionCenter -eq 0) {
      [void]$apps.Add(@{ aumid = [string]$k.PSChildName; enabled = $p.Enabled; center = $p.ShowInActionCenter })
    }
  }
  @{ toastEnabled = $toast; apps = @($apps) }
}

# Notifications présentes. Le texte n'est lu que pour les applications demandées
# (apps) : la première ligne (l'expéditeur), et le reste seulement si text = vrai.
# Lignes vides ignorées (Mobile connecté entoure son texte de lignes faites de
# retours à la ligne et de tabulations). Une seule ligne : on ne sait pas si c'est
# un nom ou le message, donc pas d'expéditeur (title vide) et c'est du texte.
# Même règle que linesToNotification (shared/messages.ts).
$Fns.list = {
  param($a)
  $want = @{}
  foreach ($k in @($a.apps)) { if ($k) { $want[[string]$k] = $true } }
  $withText = [bool]$a.text
  $type = [System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]]
  $list = Await ((Listener).GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) $type
  $out = New-Object System.Collections.ArrayList
  foreach ($n in $list) {
    $aumid = ''
    $name = ''
    try { $aumid = [string]$n.AppInfo.AppUserModelId } catch { }
    try { $name = [string]$n.AppInfo.DisplayInfo.DisplayName } catch { }
    $item = @{ id = [int64]$n.Id; aumid = $aumid; app = (Cut $name 60); at = $n.CreationTime.ToUnixTimeMilliseconds() }
    if ($want.ContainsKey($aumid)) {
      $texts = @()
      try {
        $binding = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
        if ($null -ne $binding) { $texts = @($binding.GetTextElements() | ForEach-Object { ([string]$_.Text).Trim() } | Where-Object { $_ }) }
      } catch { }
      if ($texts.Count -ge 2) {
        $item.title = (Cut $texts[0] 120)
        if ($withText) { $item.body = (Cut (($texts[1..($texts.Count - 1)]) -join "`n") 600) }
      } elseif ($texts.Count -eq 1) {
        $item.title = ''
        if ($withText) { $item.body = (Cut $texts[0] 600) }
      }
    }
    [void]$out.Add($item)
  }
  @{ items = @($out) }
}

# ─── Boucle de commandes ─────────────────────────────────────────────────────

[Console]::Out.WriteLine('{"ready":true}')
[Console]::Out.Flush()

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $id = 0
  try {
    $req = ConvertFrom-Json $line
    $id = [int]$req.id
    $fn = $Fns[[string]$req.fn]
    if ($null -eq $fn) { throw 'Fonction inconnue.' }
    $out = @{ id = $id; ok = $true; result = (& $fn $req.args) }
  } catch {
    $out = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 6))
  [Console]::Out.Flush()
}
