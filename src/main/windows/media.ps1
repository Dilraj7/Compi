# Deuxième hôte Windows, léger : musique en cours (contrôles multimédias de
# Windows, SMTC) et voix (synthèse vocale de Windows). Séparé de l'hôte
# principal pour qu'une longue lecture de texte ne fige jamais l'îlot.
# Même règles : fonctions nommées seulement, paramètres vérifiés.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$script:AsTaskOp = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType = WindowsRuntime]

function Await($op, [Type]$type, [int]$ms = 8000) {
  $task = $script:AsTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'Windows met trop de temps à répondre.' }
  $task.Result
}

# Flux WinRT → base 64. PowerShell ne voit pas les membres d'un objet WinRT
# connu seulement par une interface (pochette) : on passe par la réflexion,
# où la conversion vers l'interface est faite par .NET lui-même.
function Read-Base64($stream, [int]$max) {
  $size = [uint64][Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size').GetValue($stream)
  if ($size -gt $max) { throw 'Trop volumineux.' }
  if ($size -eq 0) { return '' }
  $reader = [Windows.Storage.Streams.DataReader].GetConstructor([Type[]]@([Windows.Storage.Streams.IInputStream])).Invoke(@($stream))
  try {
    $null = Await ($reader.LoadAsync([uint32]$size)) ([uint32])
    $buf = $reader.ReadBuffer([uint32]$size)
    [string][Windows.Security.Cryptography.CryptographicBuffer].GetMethod('EncodeToBase64String').Invoke($null, @($buf))
  } finally { Close-Quietly $reader }
}

function Content-Type($stream) {
  [string][Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType').GetValue($stream)
}

function Close-Quietly($o) {
  try { $o.Dispose() } catch { }
}

$script:Manager = $null
function Session {
  if ($null -eq $script:Manager) {
    $script:Manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  $script:Manager.GetCurrentSession()
}

$Fns = @{}

$Fns.ping = { @{ pong = $true } }

# Ce qui joue en ce moment (titre, artiste, application, état).
$Fns.media_now = {
  $s = Session
  if ($null -eq $s) { return @{ status = 'none' } }
  $info = $s.GetPlaybackInfo()
  $status = switch ([int]$info.PlaybackStatus) { 4 { 'playing' } 5 { 'paused' } 3 { 'stopped' } default { 'other' } }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  # Position dans le morceau, quand l'application la publie (0 sinon).
  $t = $s.GetTimelineProperties()
  $length = ($t.EndTime - $t.StartTime).TotalSeconds
  @{
    status = $status
    position = [Math]::Round($t.Position.TotalSeconds, 1)
    duration = [Math]::Round($length, 1)
    updated = $t.LastUpdatedTime.ToUnixTimeMilliseconds()
    title = [string]$p.Title
    artist = [string]$p.Artist
    album = [string]$p.AlbumTitle
    app = [string]$s.SourceAppUserModelId
    hasArt = ($null -ne $p.Thumbnail)
    canNext = [bool]$info.Controls.IsNextEnabled
    canPrevious = [bool]$info.Controls.IsPreviousEnabled
  }
}

# Pochette du morceau en cours (300 Ko au plus).
$Fns.media_art = {
  $s = Session
  if ($null -eq $s) { return @{ art = $null } }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($null -eq $p.Thumbnail) { return @{ art = $null } }
  $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
  try {
    $art = Read-Base64 $stream 300000
    $type = Content-Type $stream
    if ($type -notmatch '^image/(png|jpeg|jpg|bmp|gif|webp)$') { $type = 'image/png' }
    @{ art = $art; type = $type }
  } finally { Close-Quietly $stream }
}

# Lecture/pause, suivant, précédent : sur la session en cours seulement.
$Fns.media_control = {
  param($a)
  $s = Session
  if ($null -eq $s) { return @{ done = $false } }
  $op = switch ([string]$a.action) {
    'play_pause' { $s.TryTogglePlayPauseAsync() }
    'next' { $s.TrySkipNextAsync() }
    'previous' { $s.TrySkipPreviousAsync() }
    default { throw 'Action inconnue.' }
  }
  @{ done = [bool](Await $op ([bool])) }
}

# Voix installées dans Windows (Julie, Paul, Hortense…).
$Fns.voices = {
  @{
    voices = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object {
        @{ id = [string]$_.Id; name = ([string]$_.DisplayName -replace '^Microsoft ', ''); lang = [string]$_.Language; gender = [string]$_.Gender }
      })
  }
}

$script:Synth = $null
# Lit un texte avec la voix choisie : renvoie un WAV en base 64.
$Fns.speak = {
  param($a)
  $text = [string]$a.text
  if ($text.Length -eq 0) { throw 'Rien à lire.' }
  if ($text.Length -gt 3000) { $text = $text.Substring(0, 3000) }
  if ($null -eq $script:Synth) { $script:Synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new() }
  $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq [string]$a.voice } | Select-Object -First 1
  if ($null -eq $voice) { $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'fr*' } | Select-Object -First 1 }
  if ($null -ne $voice) { $script:Synth.Voice = $voice }
  $rate = [double]$a.rate
  if ($rate -lt 0.5 -or $rate -gt 2.0) { $rate = 1.0 }
  $script:Synth.Options.SpeakingRate = $rate
  $stream = Await ($script:Synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]) 20000
  try { @{ audio = (Read-Base64 $stream 20000000) } } finally { Close-Quietly $stream }
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
