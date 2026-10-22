# Son de l'ordinateur pour l'enregistreur d'appels : la sortie audio par défaut
# de Windows, captée « en boucle » (loopback) par Windows lui-même et convertie
# par lui en 16 kHz mono 16 bits, quel que soit le casque (7.1 compris, là où la
# capture de Chromium échoue). Une ligne JSON au démarrage ({ ready } ou
# { error }), puis le son brut sur la sortie standard. Ni écran, ni micro, ni
# fichier ; s'arrête quand Compi ferme l'entrée standard ou arrête le processus.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace CompiCall {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }

  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }

  [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    [PreserveSig] int Initialize(int shareMode, int streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
  }

  [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }

  public static class Loopback {
    const int Rate = 16000;
    // Partagé, en boucle, sans mémoriser de volume, converti par Windows (bonne qualité).
    const int Flags = 0x00020000 | 0x00080000 | unchecked((int)0x80000000) | 0x08000000;
    // Rien ne joue : Windows n'envoie rien ; on comble par du silence, avec cette marge.
    const int FillMargin = Rate * 3 / 10;

    static volatile bool quit;
    static Stream output;
    static readonly MemoryStream pending = new MemoryStream();
    static long written;
    static double start100ns;

    static void Line(string json) {
      byte[] b = Encoding.UTF8.GetBytes(json + "\n");
      output.Write(b, 0, b.Length);
      output.Flush();
    }

    static void Flush() {
      if (pending.Length == 0) return;
      output.Write(pending.GetBuffer(), 0, (int)pending.Length);
      output.Flush();
      pending.SetLength(0);
    }

    static void Zeros(long n) {
      if (n <= 0) return;
      pending.Write(new byte[n * 2], 0, (int)(n * 2));
      written += n;
    }

    static long Now() {
      return (long)((Stopwatch.GetTimestamp() * 1e7 / Stopwatch.Frequency - start100ns) * Rate / 1e7);
    }

    static int Open(out IAudioClient client, out IAudioCaptureClient capture) {
      client = null;
      capture = null;
      IMMDevice device;
      int hr = ((IMMDeviceEnumerator)new MMDeviceEnumeratorCo()).GetDefaultAudioEndpoint(0, 0, out device);
      if (hr != 0) return hr;
      Guid iidClient = typeof(IAudioClient).GUID;
      object o;
      hr = device.Activate(ref iidClient, 23, IntPtr.Zero, out o);
      if (hr != 0) return hr;
      client = (IAudioClient)o;
      IntPtr format = Marshal.AllocCoTaskMem(18);
      try {
        Marshal.WriteInt16(format, 0, 1);         // PCM
        Marshal.WriteInt16(format, 2, 1);         // mono
        Marshal.WriteInt32(format, 4, Rate);
        Marshal.WriteInt32(format, 8, Rate * 2);
        Marshal.WriteInt16(format, 12, 2);
        Marshal.WriteInt16(format, 14, 16);
        Marshal.WriteInt16(format, 16, 0);
        hr = client.Initialize(0, Flags, 20000000, 0, format, IntPtr.Zero);
      } finally {
        Marshal.FreeCoTaskMem(format);
      }
      if (hr != 0) return hr;
      Guid iidCapture = typeof(IAudioCaptureClient).GUID;
      hr = client.GetService(ref iidCapture, out o);
      if (hr != 0) return hr;
      capture = (IAudioCaptureClient)o;
      return client.Start();
    }

    // Lit tout ce que Windows a capté ; faux si la sortie a disparu (casque débranché…).
    static bool Drain(IAudioCaptureClient capture) {
      uint size;
      if (capture.GetNextPacketSize(out size) != 0) return false;
      while (size > 0) {
        IntPtr data; uint frames, flags; ulong devicePosition, qpc;
        if (capture.GetBuffer(out data, out frames, out flags, out devicePosition, out qpc) != 0) return false;
        // Position datée par Windows : les trous (rien ne jouait) deviennent du silence.
        long at = (flags & 4) != 0 ? written : (long)(((double)qpc - start100ns) * Rate / 1e7);
        if (at > written) Zeros(at - written);
        int skip = at < written ? (int)Math.Min(frames, written - at) : 0;
        int n = (int)frames - skip;
        if (n > 0) {
          if ((flags & 2) != 0) Zeros(n);
          else {
            byte[] b = new byte[n * 2];
            Marshal.Copy(new IntPtr(data.ToInt64() + skip * 2), b, 0, n * 2);
            pending.Write(b, 0, b.Length);
            written += n;
          }
        }
        capture.ReleaseBuffer(frames);
        if (capture.GetNextPacketSize(out size) != 0) return false;
      }
      return true;
    }

    public static void Run() {
      output = Console.OpenStandardOutput();
      Thread watch = new Thread(() => {
        try { while (Console.In.ReadLine() != null) {} } catch {}
        quit = true;
      });
      watch.IsBackground = true;
      watch.Start();
      bool started = false;
      int failures = 0;
      while (!quit) {
        IAudioClient client;
        IAudioCaptureClient capture;
        int hr = Open(out client, out capture);
        if (hr != 0) {
          if (client != null) Marshal.ReleaseComObject(client);
          if (!started) { Line("{\"error\":\"0x" + hr.ToString("X8") + "\"}"); return; }
          // Sortie audio en train de changer : on réessaie quelques secondes.
          if (++failures > 20) return;
          Thread.Sleep(500);
          continue;
        }
        failures = 0;
        if (!started) {
          started = true;
          start100ns = Stopwatch.GetTimestamp() * 1e7 / Stopwatch.Frequency;
          Line("{\"ready\":true}");
        }
        long flushedAt = 0;
        while (!quit) {
          Thread.Sleep(10);
          if (!Drain(capture)) break;
          long target = Now() - FillMargin;
          if (target > written) Zeros(target - written);
          if (written - flushedAt >= Rate / 10) { Flush(); flushedAt = written; }
        }
        Flush();
        client.Stop();
        Marshal.ReleaseComObject(capture);
        Marshal.ReleaseComObject(client);
      }
    }
  }
}
'@

[CompiCall.Loopback]::Run()
