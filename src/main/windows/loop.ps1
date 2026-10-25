# ─── Boucle de commandes (fin commune des hôtes) ─────────────────────────────

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
  [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 8))
  [Console]::Out.Flush()
}
