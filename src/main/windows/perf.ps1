# Quatrième hôte Windows, en lecture seule : activité de la carte graphique
# (mémoire vidéo et utilisation, par application) lue dans les compteurs de
# performances de Windows, applications les plus gourmandes en mémoire, et état
# « plein écran » (pour couper les sons). Rien n'est modifié.
# Même règles que les autres hôtes : fonctions nommées, paramètres vérifiés.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -Namespace CompiPerf -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'

# Échantillons précédents des moteurs (l'utilisation se calcule entre deux relevés).
$script:prevEngines = @{}
# Noms des processus, par pid.
$script:names = @{}

function ProcName([int]$id) {
  if ($script:names.Count -gt 500) { $script:names.Clear() }
  if (-not $script:names.ContainsKey($id)) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    $script:names[$id] = if ($null -ne $p) { [string]$p.ProcessName } else { '' }
  }
  $script:names[$id]
}

function ReadCat([string]$name) {
  try { ([Diagnostics.PerformanceCounterCategory]::new($name)).ReadCategory() } catch { $null }
}

function Proc($table, [int]$id) {
  if (-not $table.ContainsKey($id)) { $table[$id] = @{ pid = $id; dedicated = 0.0; util = 0.0 } }
  $table[$id]
}

$Fns = @{}

$Fns.ping = { @{ pong = $true } }

# Mémoire vidéo par carte et par application, utilisation des moteurs (3D, calcul…).
$Fns.sample = {
  $adapters = @{}
  $procs = @{}
  $cat = ReadCat 'GPU Adapter Memory'
  if ($null -ne $cat -and $cat.Contains('Dedicated Usage')) {
    foreach ($d in $cat['Dedicated Usage'].Values) {
      $luid = $d.InstanceName -replace '_phys_\d+$', ''
      $adapters[$luid] = @{ luid = $luid; dedicated = [double]$d.RawValue; util = 0.0 }
    }
  }
  $cat = ReadCat 'GPU Process Memory'
  if ($null -ne $cat -and $cat.Contains('Dedicated Usage')) {
    foreach ($d in $cat['Dedicated Usage'].Values) {
      if ($d.InstanceName -match '^pid_(\d+)_') { (Proc $procs ([int]$Matches[1])).dedicated += [double]$d.RawValue }
    }
  }
  $cat = ReadCat 'GPU Engine'
  $engines = @{}
  $seen = @{}
  if ($null -ne $cat -and $cat.Contains('Utilization Percentage')) {
    foreach ($d in $cat['Utilization Percentage'].Values) {
      $n = $d.InstanceName
      if ($n -notmatch '^pid_(\d+)_(luid_0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)_phys_\d+_eng_(\d+)_') { continue }
      $id = [int]$Matches[1]
      $key = $Matches[2] + '|' + $Matches[3]
      $seen[$n] = $true
      $prev = $script:prevEngines[$n]
      $script:prevEngines[$n] = $d.Sample
      if ($null -eq $prev) { continue }
      $v = [Diagnostics.CounterSample]::Calculate($prev, $d.Sample)
      if ($v -le 0) { continue }
      $engines[$key] = [double]$engines[$key] + $v
      $p = Proc $procs $id
      if ($v -gt $p.util) { $p.util = $v }
    }
    foreach ($k in @($script:prevEngines.Keys)) { if (-not $seen.ContainsKey($k)) { $script:prevEngines.Remove($k) } }
  }
  foreach ($k in $engines.Keys) {
    $luid = $k.Split('|')[0]
    if ($adapters.ContainsKey($luid) -and $engines[$k] -gt $adapters[$luid].util) { $adapters[$luid].util = [math]::Min(100, $engines[$k]) }
  }
  $plist = New-Object System.Collections.ArrayList
  foreach ($p in $procs.Values) {
    if ($p.dedicated -gt 50MB -or $p.util -gt 5) {
      [void]$plist.Add(@{ pid = $p.pid; name = (ProcName $p.pid); dedicatedBytes = $p.dedicated; util = [math]::Round([math]::Min(100, $p.util), 1) })
    }
  }
  $alist = New-Object System.Collections.ArrayList
  foreach ($a in $adapters.Values) { [void]$alist.Add(@{ luid = $a.luid; dedicatedBytes = $a.dedicated; util = [math]::Round($a.util, 1) }) }
  @{ adapters = @($alist); processes = @($plist) }
}

# Applications qui occupent le plus de mémoire (regroupées par nom).
$Fns.ram_top = {
  $top = Get-Process | Group-Object ProcessName | ForEach-Object {
    @{ name = [string]$_.Name; bytes = [double](($_.Group | Measure-Object WorkingSet64 -Sum).Sum) }
  } | Sort-Object { $_.bytes } -Descending | Select-Object -First 4
  @{ top = @($top) }
}

# Application en plein écran, jeu ou présentation : 2, 3 ou 4 (SHQueryUserNotificationState).
$Fns.quns = {
  $q = 0
  [void][CompiPerf.Shell]::SHQueryUserNotificationState([ref]$q)
  @{ state = $q }
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
