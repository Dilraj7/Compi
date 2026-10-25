# Outils WinRT communs (musique, voix, notifications), chargés au premier usage :
# un hôte qui ne s'en sert pas ne paie rien.

# Drapeau à part : la lecture de texte de host.ps1 (Use-WinRt) remplit aussi
# $script:AsTaskOp, sans charger les types utilisés ici.
$script:AsTaskReady = $false
function Use-AsTask {
  if ($script:AsTaskReady) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
  $null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Security.Cryptography.CryptographicBuffer, Windows.Security.Cryptography, ContentType = WindowsRuntime]
  $script:AsTaskOp = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $script:AsTaskReady = $true
}

function AwaitOp($op, [Type]$type, [int]$ms = 8000) {
  Use-AsTask
  $task = $script:AsTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait($ms)) { throw 'Windows met trop de temps à répondre.' }
  $task.Result
}

function Close-Quietly($o) {
  try { $o.Dispose() } catch { }
}

# Flux WinRT → base 64. PowerShell ne voit pas les membres d'un objet WinRT
# connu seulement par une interface (pochette) : on passe par la réflexion,
# où la conversion vers l'interface est faite par .NET lui-même.
function Read-Base64($stream, [int]$max) {
  Use-AsTask
  $size = [uint64][Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size').GetValue($stream)
  if ($size -gt $max) { throw 'Trop volumineux.' }
  if ($size -eq 0) { return '' }
  $reader = [Windows.Storage.Streams.DataReader].GetConstructor([Type[]]@([Windows.Storage.Streams.IInputStream])).Invoke(@($stream))
  try {
    $null = AwaitOp ($reader.LoadAsync([uint32]$size)) ([uint32])
    $buf = $reader.ReadBuffer([uint32]$size)
    [string][Windows.Security.Cryptography.CryptographicBuffer].GetMethod('EncodeToBase64String').Invoke($null, @($buf))
  } finally { Close-Quietly $reader }
}

function Content-Type($stream) {
  [string][Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType').GetValue($stream)
}
