// Pont vers Windows : deux processus PowerShell, pilotés en JSON.
// - L'hôte Windows (host.ps1, voice.ps1) : ce que l'utilisateur demande (fenêtres,
//   collage, lecture de texte, voix de Windows). Arrêté après 10 min sans appel.
// - L'hôte de veille (music.ps1, notifications.ps1, perf.ps1) : les relevés réguliers
//   (musique, messages, Ce PC). Il ne vit que tant que l'un d'eux est actif.
// Seules des fonctions nommées existent de l'autre côté, avec des paramètres
// vérifiés : aucune commande libre ne passe. Chaque appel a un délai maximal :
// au-delà, il échoue tout de suite pour Compi. Les scripts ont leurs propres délais
// (Windows lent : erreur propre après 8 s) ; PowerShell n'est arrêté puis relancé
// que s'il reste muet bien après, pour que Compi ne reste jamais bloqué.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import prelude from './prelude.ps1?raw'
import loop from './loop.ps1?raw'
import script from './host.ps1?raw'
import winrt from './winrt.ps1?raw'
import voice from './voice.ps1?raw'
import music from './music.ps1?raw'
import notifications from './notifications.ps1?raw'
import perf from './perf.ps1?raw'
import { log } from '../log'

export type HostFn =
  | 'ping'
  | 'status'
  | 'foreground'
  | 'windows'
  | 'search'
  | 'apps'
  | 'launch'
  | 'focus'
  | 'volume'
  | 'media'
  | 'theme'
  | 'copy'
  | 'paste'
  | 'clip_text'
  | 'ocr_languages'
  | 'ocr_image'
  | 'ocr_pdf'
  | 'voices'
  | 'speak'

/** Fonctions de l'hôte de veille : musique, notifications, activité du PC. */
export type WatchFn =
  | 'ping'
  | 'media_now'
  | 'media_art'
  | 'media_control'
  | 'access'
  | 'request_access'
  | 'list'
  | 'health'
  | 'sample'
  | 'ram_top'
  | 'quns'

export const END = '#COMPI-END#'

/** Script complet d'un hôte : début commun, scripts de fonctions, boucle de commandes. */
export function composeHost(...parts: string[]): string {
  return [prelude, ...parts, loop].join('\n')
}

/**
 * Amorce passée en ligne de commande : lit le script sur l'entrée standard
 * jusqu'au marqueur de fin, puis l'exécute. Le script complet dépasserait la
 * longueur maximale d'une ligne de commande.
 */
export const BOOTSTRAP =
  "$ProgressPreference='SilentlyContinue';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);$b=New-Object Text.StringBuilder;" +
  `while((($l=[Console]::In.ReadLine()) -ne $null) -and ($l -ne '${END}')){[void]$b.AppendLine($l)};` +
  '. ([ScriptBlock]::Create($b.ToString()))'

/** Argument de -EncodedCommand : le texte en UTF-16LE, en base 64. */
export function encodeCommand(s: string): string {
  return Buffer.from(s, 'utf16le').toString('base64')
}

export type HostLine = { ready: true } | { id: number; ok: boolean; result?: unknown; error?: string }

/** Lit une ligne de réponse de l'hôte ; `null` pour tout ce qui n'en est pas une. */
export function parseHostLine(line: string): HostLine | null {
  const t = line.trim()
  if (!t.startsWith('{')) return null
  try {
    const v = JSON.parse(t) as Record<string, unknown>
    if (v.ready === true) return { ready: true }
    if (typeof v.id !== 'number' || typeof v.ok !== 'boolean') return null
    return { id: v.id, ok: v.ok, result: v.result ?? undefined, error: typeof v.error === 'string' ? v.error : undefined }
  } catch {
    return null
  }
}

export class HostError extends Error {}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
  /** L'appel a déjà échoué pour Compi (délai dépassé) : une réponse tardive est ignorée. */
  late?: { fn: string; since: number }
}

const START_TIMEOUT_MS = 20_000
/**
 * Après le délai d'un appel, PowerShell a encore ce temps pour répondre avant d'être
 * relancé. Ses propres attentes (8 à 30 s) se terminent par une erreur propre :
 * relancer plus tôt tuait un hôte sain (la liste des notifications avait le même
 * délai de 8 s des deux côtés).
 */
export const STUCK_GRACE_MS = 45_000
/** Après 10 min sans appel, PowerShell est arrêté (relancé au besoin). */
const IDLE_MS = 10 * 60_000

const hosts = new Set<PowerShellHost<string>>()

/**
 * Un processus PowerShell qui exécute un script de fonctions nommées. Les
 * appels passent un par un : un hôte lent ne bloque que ses propres appels.
 */
export class PowerShellHost<F extends string> {
  private proc: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private idleTimer: NodeJS.Timeout | null = null
  private pending = new Map<number, Pending>()

  constructor(
    /** Nom dans le journal : « hôte Windows », « hôte de veille »… */
    private readonly name: string,
    private readonly source: string,
    private readonly idleMs = IDLE_MS
  ) {
    hosts.add(this as PowerShellHost<string>)
  }

  private reset(reason: string): void {
    const p = this.proc
    this.proc = null
    this.ready = null
    for (const [, q] of this.pending) {
      clearTimeout(q.timer)
      q.reject(new HostError(reason))
    }
    this.pending.clear()
    if (p && p.exitCode === null) p.kill()
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready
    this.ready = new Promise<void>((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeCommand(BOOTSTRAP)],
        {
          windowsHide: true
        }
      )
      this.proc = child
      let stderr = ''
      let started = false
      const fail = (message: string): void => {
        if (this.proc === child) this.reset(message)
        if (!started) reject(new HostError(message))
      }
      const timer = setTimeout(() => fail('Windows n’a pas répondu au démarrage.'), START_TIMEOUT_MS)

      createInterface({ input: child.stdout }).on('line', (line) => {
        const msg = parseHostLine(line)
        if (!msg) return
        if ('ready' in msg) {
          started = true
          clearTimeout(timer)
          resolve()
          return
        }
        const q = this.pending.get(msg.id)
        if (!q) return
        this.pending.delete(msg.id)
        clearTimeout(q.timer)
        if (q.late) {
          log('info', `${this.name} : « ${q.late.fn} » a répondu en retard (${((Date.now() - q.late.since) / 1000).toFixed(1)} s), sans relance`)
          return
        }
        if (msg.ok) q.resolve(msg.result)
        else q.reject(new HostError(msg.error ?? 'Erreur inconnue.'))
      })
      child.stderr.on('data', (d: Buffer) => {
        stderr = (stderr + d.toString('utf8')).slice(-2000)
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        fail(`PowerShell n’a pas pu démarrer : ${e.message}`)
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (stderr.trim()) log('warn', `${this.name} arrêté (code ${code})`, stderr.trim().slice(-600))
        fail('Windows a interrompu l’action.')
      })
      child.stdin.on('error', () => undefined)
      child.stdin.write(`${this.source.replace(/\r\n/g, '\n')}\n${END}\n`)
    })
    return this.ready
  }

  /**
   * Appelle une fonction de l'hôte. Au-delà de `timeoutMs`, l'appel échoue ; si
   * PowerShell reste muet `STUCK_GRACE_MS` de plus, il est relancé : rien ne reste
   * bloqué.
   */
  async call<T>(fn: F, args: Record<string, unknown> = {}, timeoutMs = 5000, graceMs = STUCK_GRACE_MS): Promise<T> {
    await this.start()
    const child = this.proc
    if (!child) throw new HostError('Windows a interrompu l’action.')
    this.touch()
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      // PowerShell traite les appels dans l'ordre : un appel qui attend derrière un
      // plus ancien (lecture d'un long PDF…) ne relance pas l'hôte. Seul l'appel en
      // cours le peut, s'il reste muet bien après son propre délai.
      const stuck = (): void => {
        const q = this.pending.get(id)
        if (!q) return
        if ([...this.pending.keys()].some((k) => k < id)) {
          q.timer = setTimeout(stuck, graceMs)
          return
        }
        this.pending.delete(id)
        log('warn', `${this.name} : « ${fn} » toujours sans réponse après ${Math.round((Date.now() - (q.late?.since ?? Date.now())) / 1000)} s, relance`)
        if (this.proc === child) this.reset('Windows a été relancé.')
      }
      const timer = setTimeout(() => {
        const q = this.pending.get(id)
        if (!q) return
        reject(new HostError('Windows n’a pas répondu à temps : action abandonnée.'))
        q.late = { fn, since: Date.now() - timeoutMs }
        q.timer = setTimeout(stuck, graceMs)
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      child.stdin.write(`${JSON.stringify({ id, fn, args })}\n`)
    })
  }

  /** Arme l'arrêt après `idleMs` sans appel (repoussé tant qu'un appel est en cours). */
  private touch(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    const idle = (): void => {
      this.idleTimer = null
      if (this.pending.size) this.idleTimer = setTimeout(idle, this.idleMs)
      else if (this.proc) this.reset('inactif')
    }
    this.idleTimer = setTimeout(idle, this.idleMs)
  }

  /** Démarre l'hôte d'avance, sans attendre. Il s'arrête ensuite comme après un appel. */
  warm(): void {
    this.start().then(
      () => this.touch(),
      (e) => log('warn', `${this.name} indisponible`, (e as Error).message)
    )
  }

  /** PowerShell tourne en ce moment. */
  get running(): boolean {
    return this.proc !== null
  }

  /** Relance PowerShell à neuf s'il n'a aucun appel en cours (mémoire qui grossit). */
  recycle(): boolean {
    if (!this.proc || this.pending.size) return false
    this.reset('relancé à neuf')
    return true
  }

  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    if (this.proc) this.reset('Compi se ferme.')
  }
}

const main = new PowerShellHost<HostFn>('hôte Windows', composeHost(script, winrt, voice))
/** Arrêté 5 min après le dernier relevé. */
const watch = new PowerShellHost<WatchFn>('hôte de veille', composeHost(winrt, music, notifications, perf), 5 * 60_000)

/** Appelle une fonction de l'hôte Windows principal. */
export function callHost<T>(fn: HostFn, args: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
  return main.call<T>(fn, args, timeoutMs)
}

/** Appelle une fonction de l'hôte de veille (relevés réguliers). */
export function callWatch<T>(fn: WatchFn, args: Record<string, unknown> = {}, timeoutMs = 5000): Promise<T> {
  return watch.call<T>(fn, args, timeoutMs)
}

/** Relance l'hôte de veille à neuf, s'il est libre (voir PowerShellHost.recycle). */
export function recycleWatch(): boolean {
  return watch.recycle()
}

/** Démarre l'hôte d'avance (ouverture de l'îlot), sans attendre. */
export function warmHost(): void {
  main.warm()
}

/** Arrête tous les hôtes PowerShell (fermeture de Compi). */
export function stopHost(): void {
  for (const h of hosts) h.stop()
}
