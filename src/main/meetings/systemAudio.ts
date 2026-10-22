// Son de l'ordinateur pendant un appel, capté par Windows lui-même
// (systemAudio.ps1) : déjà en 16 kHz mono, quel que soit le casque. La capture
// de Chromium échoue sur les sorties de plus de 2 canaux (casques 7.1) ; elle
// ne reste qu'en secours, si ce processus ne démarre pas.

import { spawn } from 'node:child_process'
import script from './systemAudio.ps1?raw'
import { BOOTSTRAP, END, encodeCommand } from '../windows/host'
import { log } from '../log'

const START_TIMEOUT_MS = 10_000
/** Morceaux remis à l'enregistreur : 1 s au plus. */
const CHUNK = 16_000

export interface SystemAudio {
  stop(): void
}

/** Codes de Windows les plus courants, en mots simples (jamais d'autre détail). */
function reason(code: string): string {
  if (code === '0x80070490') return 'aucune sortie audio active'
  if (code === '0x88890004') return 'la sortie audio a changé'
  if (code === '0x8889000A') return 'la sortie audio est utilisée en mode exclusif'
  return `erreur Windows ${code}`
}

/**
 * Démarre la capture ; `onPcm` reçoit le son (16 bits, 16 kHz, mono) au fil de
 * l'eau, `onEnd` si elle s'arrête d'elle-même. Rejette si elle ne démarre pas.
 */
export function startSystemAudio(onPcm: (pcm: Int16Array) => void, onEnd: (message: string) => void): Promise<SystemAudio> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeCommand(BOOTSTRAP)],
      {
        windowsHide: true
      }
    )
    let started = false
    let stopped = false
    let head = Buffer.alloc(0)
    let odd: Buffer | null = null
    let stderr = ''
    const fail = (message: string): void => {
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      reject(new Error(message))
    }
    const timer = setTimeout(() => fail('Windows n’a pas répondu au démarrage.'), START_TIMEOUT_MS)
    const deliver = (data: Buffer): void => {
      let b = odd ? Buffer.concat([odd, data]) : data
      odd = b.length % 2 ? b.subarray(b.length - 1) : null
      if (odd) b = b.subarray(0, b.length - 1)
      // Copie alignée : le tampon reçu peut commencer à une adresse impaire.
      for (let i = 0; i < b.length; i += CHUNK * 2) {
        const part = b.subarray(i, Math.min(b.length, i + CHUNK * 2))
        const pcm = new Int16Array(part.length / 2)
        Buffer.from(pcm.buffer).set(part)
        onPcm(pcm)
      }
    }
    child.stdout.on('data', (d: Buffer) => {
      if (started) return deliver(d)
      head = Buffer.concat([head, d])
      const nl = head.indexOf(10)
      if (nl < 0) return
      let msg: { ready?: boolean; error?: string } = {}
      try {
        msg = JSON.parse(head.subarray(0, nl).toString('utf8')) as typeof msg
      } catch {
        // Ligne illisible : traitée comme un échec plus bas.
      }
      if (!msg.ready) return fail(msg.error ? reason(msg.error) : 'réponse inattendue')
      started = true
      clearTimeout(timer)
      resolve({
        stop: () => {
          stopped = true
          if (child.exitCode === null) child.kill()
        }
      })
      if (head.length > nl + 1) deliver(head.subarray(nl + 1))
    })
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-2000)
    })
    child.on('error', (e) => fail(`PowerShell n’a pas pu démarrer : ${e.message}`))
    child.on('exit', (code) => {
      if (!started) return fail(`arrêt au démarrage (code ${code})`)
      if (stopped) return
      if (stderr.trim()) log('warn', `réunions : capture du son de l’ordinateur arrêtée (code ${code})`, stderr.trim().slice(-600))
      onEnd('Le son de l’ordinateur n’est plus capté ; ton micro continue d’être enregistré.')
    })
    child.stdin.on('error', () => undefined)
    child.stdin.write(`${script.replace(/\r\n/g, '\n')}\n${END}\n`)
  })
}
