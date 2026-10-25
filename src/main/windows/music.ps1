# Musique en cours : contrôles multimédias de Windows (SMTC). Lecture de ce qui
# joue, pochette, et seulement lecture/pause, suivant, précédent.

$script:Manager = $null
function Session {
  if ($null -eq $script:Manager) {
    Use-AsTask
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $script:Manager = AwaitOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  }
  $script:Manager.GetCurrentSession()
}

# Ce qui joue en ce moment (titre, artiste, application, état).
$Fns.media_now = {
  $s = Session
  if ($null -eq $s) { return @{ status = 'none' } }
  $info = $s.GetPlaybackInfo()
  $status = switch ([int]$info.PlaybackStatus) { 4 { 'playing' } 5 { 'paused' } 3 { 'stopped' } default { 'other' } }
  $p = AwaitOp ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
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
  $p = AwaitOp ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  if ($null -eq $p.Thumbnail) { return @{ art = $null } }
  $stream = AwaitOp ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
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
  @{ done = [bool](AwaitOp $op ([bool])) }
}
