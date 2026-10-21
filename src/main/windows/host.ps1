# Hôte Windows de Compi. Lit une commande JSON par ligne sur l'entrée standard
# ({ id, fn, args }) et répond par une ligne JSON ({ id, ok, result | error }).
# Seules les fonctions de la table $Fns existent, et chacune revérifie ses
# paramètres : aucune commande libre ne peut passer par ici.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Compi {
  public class WindowInfo {
    public long Handle; public string Title; public string Process; public int Pid; public bool Minimized;
  }

  public static class Win {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int val, int size);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

    static string Title(IntPtr h) {
      int n = GetWindowTextLength(h);
      if (n <= 0) return "";
      var sb = new StringBuilder(n + 1);
      GetWindowText(h, sb, sb.Capacity);
      return sb.ToString();
    }

    static string ProcessName(uint pid) {
      try { return Process.GetProcessById((int)pid).ProcessName; } catch { return ""; }
    }

    public static WindowInfo Info(IntPtr h) {
      if (h == IntPtr.Zero || !IsWindow(h)) return null;
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      return new WindowInfo { Handle = h.ToInt64(), Title = Title(h), Process = ProcessName(pid), Pid = (int)pid, Minimized = IsIconic(h) };
    }

    public static WindowInfo Foreground() { return Info(GetForegroundWindow()); }

    // Fenêtres principales visibles : ni fenêtres d'outils, ni fenêtres possédées, ni masquées.
    public static List<WindowInfo> List() {
      var list = new List<WindowInfo>();
      EnumWindows((h, l) => {
        if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
        if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
        int cloaked;
        if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
        var info = Info(h);
        if (info != null && info.Title.Length > 0) list.Add(info);
        return true;
      }, IntPtr.Zero);
      return list;
    }

    // Met une fenêtre au premier plan. Renvoie faux si Windows ne l'a pas permis.
    public static bool Focus(long handle) {
      var h = new IntPtr(handle);
      if (!IsWindow(h) || !IsWindowVisible(h)) return false;
      if (IsIconic(h)) ShowWindow(h, 9);
      uint pid;
      uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
      uint me = GetCurrentThreadId();
      bool attached = fg != 0 && fg != me && AttachThreadInput(me, fg, true);
      try { BringWindowToTop(h); SetForegroundWindow(h); }
      finally { if (attached) AttachThreadInput(me, fg, false); }
      Thread.Sleep(60);
      return GetForegroundWindow() == h;
    }
  }

  public static class Keys {
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
    [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();

    static INPUT Key(ushort vk, bool up) {
      var i = new INPUT { type = 1 };
      i.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? 2u : 0u };
      return i;
    }

    static bool Send(INPUT[] seq) { return SendInput((uint)seq.Length, seq, Marshal.SizeOf(typeof(INPUT))) == seq.Length; }

    // Ctrl, Maj, Alt ou Windows encore enfoncée par l'utilisateur.
    public static bool ModifiersDown() {
      foreach (int vk in new[] { 0x10, 0x11, 0x12, 0x5B, 0x5C })
        if ((GetAsyncKeyState(vk) & 0x8000) != 0) return true;
      return false;
    }

    // Attend que l'utilisateur relâche ses touches. Ne force jamais rien.
    public static bool WaitModifiersUp(int timeoutMs) {
      var sw = Stopwatch.StartNew();
      while (ModifiersDown()) {
        if (sw.ElapsedMilliseconds > timeoutMs) return false;
        Thread.Sleep(15);
      }
      return true;
    }

    // Ctrl + touche : appui et relâchement immédiats, envoyés d'un seul bloc.
    public static bool CtrlChord(ushort vk) { return Send(new[] { Key(0x11, false), Key(vk, false), Key(vk, true), Key(0x11, true) }); }

    public static bool Tap(ushort vk) { return Send(new[] { Key(vk, false), Key(vk, true) }); }
  }

  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out uint c);
    int SetMasterVolumeLevel(float l, ref Guid g);
    int SetMasterVolumeLevelScalar(float l, ref Guid g);
    int GetMasterVolumeLevel(out float l);
    int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(uint c, float l, ref Guid g);
    int SetChannelVolumeLevelScalar(uint c, float l, ref Guid g);
    int GetChannelVolumeLevel(uint c, out float l);
    int GetChannelVolumeLevelScalar(uint c, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int state, out IntPtr devices);
    int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }

  // Volume du haut-parleur par défaut.
  public static class Audio {
    static IAudioEndpointVolume Endpoint() {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
      var iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static int GetLevel() { float l; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out l)); return (int)Math.Round(l * 100); }
    public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
    public static void SetLevel(int level) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, level)) / 100f, ref g)); }
    public static void SetMute(bool mute) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(mute, ref g)); }
  }

  public static class Theme {
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, UIntPtr w, string l, uint flags, uint timeout, out UIntPtr result);
    // Prévient les applications que le thème a changé.
    public static void Broadcast() { UIntPtr r; SendMessageTimeout(new IntPtr(0xffff), 0x001A, UIntPtr.Zero, "ImmersiveColorSet", 0x0002, 300, out r); }
  }
}
'@

function WinOut($w) {
  if ($null -eq $w) { return $null }
  @{ handle = $w.Handle; title = $w.Title; process = $w.Process; pid = $w.Pid; minimized = $w.Minimized }
}

# ─── WinRT (lecture de texte et PDF) ─────────────────────────────────────────

$script:WinRt = $false
function Use-WinRt {
  if ($script:WinRt) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
  $script:AsTaskOp = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
  $script:AsTaskAction = $methods | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
  $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  $null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $script:WinRt = $true
}

function Await($op, [Type]$type) {
  $task = $script:AsTaskOp.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(30000)) { throw 'Windows met trop de temps à répondre.' }
  $task.Result
}

function Await-Action($op) {
  $task = $script:AsTaskAction.Invoke($null, @($op))
  if (-not $task.Wait(30000)) { throw 'Windows met trop de temps à répondre.' }
}

function Ocr-Engine([string]$lang) {
  $engine = $null
  if ($lang) {
    $l = [Windows.Globalization.Language]::new($lang)
    if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($l)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l) }
  }
  if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
  if ($null -eq $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US')) }
  if ($null -eq $engine) { throw 'Aucune langue de lecture de texte n''est installée dans Windows.' }
  $engine
}

# Image décodée, réduite si elle dépasse la taille que la lecture de texte accepte.
function Read-Bitmap($stream) {
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $w = $decoder.PixelWidth; $h = $decoder.PixelHeight
  if ($w -le $max -and $h -le $max) {
    return Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  }
  $scale = [Math]::Min($max / $w, $max / $h)
  $t = [Windows.Graphics.Imaging.BitmapTransform]::new()
  $t.ScaledWidth = [uint32][Math]::Floor($w * $scale)
  $t.ScaledHeight = [uint32][Math]::Floor($h * $scale)
  Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $t, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
}

function Ocr-Text($engine, $bitmap) {
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  (@($result.Lines | ForEach-Object { $_.Text }) -join "`n")
}

function Open-File([string]$path) {
  if (-not [IO.Path]::IsPathRooted($path) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Fichier introuvable.' }
  Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
}

# ─── Fonctions disponibles ───────────────────────────────────────────────────

$Fns = @{}

$Fns.ping = { @{ pong = $true } }

$Fns.foreground = { @{ window = (WinOut ([Compi.Win]::Foreground())) } }

$Fns.windows = { @{ windows = @([Compi.Win]::List() | ForEach-Object { WinOut $_ }) } }

$Fns.status = {
  $r = @{}
  try { $r.volume = [Compi.Audio]::GetLevel(); $r.muted = [Compi.Audio]::GetMute() } catch { }
  try {
    $b = @(Get-CimInstance Win32_Battery)
    if ($b.Count -gt 0) { $r.battery = @{ percent = [int]$b[0].EstimatedChargeRemaining; plugged = (@(2, 3, 6, 7, 8, 9, 11) -contains [int]$b[0].BatteryStatus) } }
  } catch { }
  try {
    $null = [Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType = WindowsRuntime]
    $p = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
    if ($null -eq $p) { $r.network = @{ connected = $false } }
    else {
      $ssid = $null
      if ($p.IsWlanConnectionProfile) { try { $ssid = $p.WlanConnectionProfileDetails.GetConnectedSsid() } catch { } }
      $r.network = @{ connected = $true; name = $p.ProfileName; wifi = [bool]$p.IsWlanConnectionProfile; ssid = $ssid; level = [string]$p.GetNetworkConnectivityLevel() }
    }
  } catch { }
  try {
    $r.disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ drive = $_.DeviceID; freeGb = [Math]::Round($_.FreeSpace / 1GB, 1); sizeGb = [Math]::Round($_.Size / 1GB, 1) } })
  } catch { }
  try {
    $os = Get-CimInstance Win32_OperatingSystem
    $r.memory = @{ totalGb = [Math]::Round($os.TotalVisibleMemorySize / 1MB, 1); freeGb = [Math]::Round($os.FreePhysicalMemory / 1MB, 1) }
    $r.uptimeHours = [Math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
  } catch { }
  try { $r.cpu = [int](@(Get-CimInstance Win32_Processor) | Measure-Object -Property LoadPercentage -Average).Average } catch { }
  try {
    $r.topApps = @(Get-Process | Group-Object ProcessName | ForEach-Object { @{ name = $_.Name; memMb = [int](($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB) } } | Sort-Object { $_.memMb } -Descending | Select-Object -First 5)
  } catch { }
  try {
    $light = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize' -Name AppsUseLightTheme).AppsUseLightTheme
    $r.theme = if ($light -eq 0) { 'dark' } else { 'light' }
  } catch { }
  $r
}

# Recherche dans l'index Windows Search. La requête est construite et échappée
# par Compi (search.ts) ; on vérifie quand même sa forme.
$Fns.search = {
  param($a)
  $sql = [string]$a.sql
  if ($sql -notmatch '^SELECT TOP \d{1,3} System\.ItemUrl, ' -or $sql -notmatch ' FROM SYSTEMINDEX WHERE ' -or $sql -match ';') { throw 'Requête refusée.' }
  $conn = New-Object System.Data.OleDb.OleDbConnection "Provider=Search.CollatorDSO;Extended Properties='Application=Windows';"
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $sql
    $cmd.CommandTimeout = 5
    $reader = $cmd.ExecuteReader()
    $rows = New-Object System.Collections.ArrayList
    while ($reader.Read()) {
      $modified = $null
      if ($reader[2] -is [DateTime]) { $modified = $reader[2].ToUniversalTime().ToString('o') }
      $size = $null
      if ($reader[3] -isnot [DBNull]) { $size = [int64]$reader[3] }
      $path = (([string]$reader[0]) -replace '^file:', '').Replace('/', '\')
      [void]$rows.Add(@{ path = $path; name = [string]$reader[1]; modified = $modified; size = $size; kind = (@($reader[4]) -join ',') })
    }
    @{ rows = @($rows) }
  } finally { $conn.Close() }
}

$Fns.apps = { @{ apps = @(Get-StartApps | ForEach-Object { @{ name = $_.Name; id = $_.AppID } }) } }

# Lance une application du menu Démarrer, par son identifiant exact.
$Fns.launch = {
  param($a)
  $id = [string]$a.id
  $app = Get-StartApps | Where-Object { $_.AppID -eq $id } | Select-Object -First 1
  if ($null -eq $app) { throw 'Application introuvable dans le menu Démarrer.' }
  Start-Process -FilePath 'explorer.exe' -ArgumentList ('"shell:AppsFolder\' + $app.AppID + '"')
  @{ launched = $app.Name }
}

$Fns.focus = { param($a) @{ focused = [Compi.Win]::Focus([int64]$a.handle) } }

$Fns.volume = {
  param($a)
  if ($null -ne $a.level) { [Compi.Audio]::SetLevel([int]$a.level) }
  if ($null -ne $a.mute) { [Compi.Audio]::SetMute([bool]$a.mute) }
  @{ volume = [Compi.Audio]::GetLevel(); muted = [Compi.Audio]::GetMute() }
}

# Touches multimédia de Windows : lecture/pause, suivant, précédent.
$Fns.media = {
  param($a)
  $keys = @{ play_pause = 0xB3; next = 0xB0; previous = 0xB1 }
  $vk = $keys[[string]$a.action]
  if ($null -eq $vk) { throw 'Action inconnue.' }
  @{ sent = [Compi.Keys]::Tap([uint16]$vk) }
}

$Fns.theme = {
  param($a)
  $mode = [string]$a.mode
  if ($mode -ne 'dark' -and $mode -ne 'light') { throw 'Thème inconnu.' }
  $v = 0
  if ($mode -eq 'light') { $v = 1 }
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
  Set-ItemProperty -Path $key -Name AppsUseLightTheme -Value $v -Type DWord
  Set-ItemProperty -Path $key -Name SystemUsesLightTheme -Value $v -Type DWord
  [Compi.Theme]::Broadcast()
  @{ theme = $mode }
}

# Copie la sélection de la fenêtre au premier plan (un seul Ctrl+C, une fois
# les touches du raccourci relâchées). Le presse-papier est sauvegardé et
# remis en place par Compi.
$Fns.copy = {
  $window = WinOut ([Compi.Win]::Foreground())
  if (-not [Compi.Keys]::WaitModifiersUp(1500)) { return @{ copied = $false; reason = 'keys'; window = $window } }
  $before = [Compi.Keys]::GetClipboardSequenceNumber()
  [void][Compi.Keys]::CtrlChord(0x43)
  $sw = [Diagnostics.Stopwatch]::StartNew()
  while ([Compi.Keys]::GetClipboardSequenceNumber() -eq $before -and $sw.ElapsedMilliseconds -lt 700) { Start-Sleep -Milliseconds 15 }
  @{ copied = ([Compi.Keys]::GetClipboardSequenceNumber() -ne $before); window = $window }
}

# Colle dans la fenêtre d'origine, seulement si elle est bien revenue au premier plan.
$Fns.paste = {
  param($a)
  $h = [int64]$a.handle
  if (-not [Compi.Win]::Focus($h)) { return @{ pasted = $false; reason = 'focus' } }
  if (-not [Compi.Keys]::WaitModifiersUp(1500)) { return @{ pasted = $false; reason = 'keys' } }
  Start-Sleep -Milliseconds 80
  $fg = [Compi.Win]::Foreground()
  if ($null -eq $fg -or $fg.Handle -ne $h) { return @{ pasted = $false; reason = 'focus' } }
  @{ pasted = [Compi.Keys]::CtrlChord(0x56) }
}

$Fns.ocr_languages = {
  Use-WinRt
  @{ languages = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }) }
}

$Fns.ocr_image = {
  param($a)
  Use-WinRt
  $engine = Ocr-Engine ([string]$a.lang)
  $file = Open-File ([string]$a.path)
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  try { @{ text = (Ocr-Text $engine (Read-Bitmap $stream)); lang = $engine.RecognizerLanguage.LanguageTag } }
  finally { $stream.Dispose() }
}

# Lit le texte des pages d'un PDF scanné : chaque page est rendue en image, puis lue.
$Fns.ocr_pdf = {
  param($a)
  Use-WinRt
  $engine = Ocr-Engine ([string]$a.lang)
  $file = Open-File ([string]$a.path)
  $pdf = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($file)) ([Windows.Data.Pdf.PdfDocument])
  $count = [int]$pdf.PageCount
  $max = [Math]::Min($count, [Math]::Max(1, [int]$a.maxPages))
  $limit = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  $pages = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $max; $i++) {
    $page = $pdf.GetPage([uint32]$i)
    $stream = [Windows.Storage.Streams.InMemoryRandomAccessStream]::new()
    try {
      $options = [Windows.Data.Pdf.PdfPageRenderOptions]::new()
      $width = [Math]::Min([Math]::Min(2400, $limit), [Math]::Max(1, $page.Size.Width * 2))
      $options.DestinationWidth = [uint32]$width
      Await-Action ($page.RenderToStreamAsync($stream, $options))
      [void]$pages.Add((Ocr-Text $engine (Read-Bitmap $stream)))
    } finally { $stream.Dispose(); $page.Dispose() }
  }
  @{ pages = @($pages); pageCount = $count; lang = $engine.RecognizerLanguage.LanguageTag }
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
  [Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 8))
  [Console]::Out.Flush()
}
