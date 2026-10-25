# Voix de Windows (synthèse vocale) : liste des voix et lecture d'un texte en WAV.
# Chargée au premier usage : l'hôte démarre sans elle.

function Use-Speech {
  Use-AsTask
  $null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
}

# Voix installées dans Windows (Julie, Paul, Hortense…).
$Fns.voices = {
  Use-Speech
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
  Use-Speech
  if ($null -eq $script:Synth) { $script:Synth = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::new() }
  $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq [string]$a.voice } | Select-Object -First 1
  if ($null -eq $voice) { $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'fr*' } | Select-Object -First 1 }
  if ($null -ne $voice) { $script:Synth.Voice = $voice }
  $rate = [double]$a.rate
  if ($rate -lt 0.5 -or $rate -gt 2.0) { $rate = 1.0 }
  $script:Synth.Options.SpeakingRate = $rate
  $stream = AwaitOp ($script:Synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]) 20000
  try { @{ audio = (Read-Base64 $stream 20000000) } } finally { Close-Quietly $stream }
}
