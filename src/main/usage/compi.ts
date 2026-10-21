// Utilisation de Compi (vue Activité) : réponses et coût par cerveau et par
// jour. Le coût vient du moteur (Claude seulement) ; pour les autres cerveaux,
// seulement le nombre de jetons. Rien d'autre n'est gardé.

import { join } from 'node:path'
import { app } from 'electron'
import { IPC } from '../../shared/ipc'
import { addCompiReply, type CompiUsageRow } from '../../shared/usage'
import { emit } from '../bus'
import { log } from '../log'
import { readJson, writeJson } from '../store/jsonFile'

const file = (): string => join(app.getPath('userData'), 'usage-compi.json')

export function compiUsage(): CompiUsageRow[] {
  const rows = readJson<CompiUsageRow[]>(file(), [])
  return Array.isArray(rows) ? rows : []
}

export function recordCompiReply(reply: { brain: string; provider: string; costUsd?: number; input?: number; output?: number }): void {
  try {
    const next = addCompiReply(compiUsage(), {
      at: Date.now(),
      brain: reply.brain.slice(0, 80),
      provider: reply.provider,
      costUsd: reply.costUsd && Number.isFinite(reply.costUsd) ? reply.costUsd : 0,
      input: reply.input ?? 0,
      output: reply.output ?? 0
    })
    writeJson(file(), next)
    emit(IPC.compiUsageChanged, next)
  } catch (e) {
    log('warn', 'utilisation de Compi non enregistrée', (e as Error).message)
  }
}
