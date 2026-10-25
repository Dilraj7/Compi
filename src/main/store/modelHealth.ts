// Carnet de fiabilité des modèles locaux (model-health.json) : essais d'outil et appels
// écrits en texte, comptés sur le PC. Seulement des noms de modèles et des nombres.

import { join } from 'node:path'
import { app } from 'electron'
import { recordRun, recordTest, type HealthBook } from '../../shared/modelHealth'
import { readJson, writeJson } from './jsonFile'

let book: HealthBook | null = null
const file = (): string => join(app.getPath('userData'), 'model-health.json')

export function healthBook(): HealthBook {
  book ??= readJson<HealthBook>(file(), {})
  return book
}

function save(next: HealthBook): void {
  book = next
  try {
    writeJson(file(), next)
  } catch {
    // Disque plein… : le carnet reste en mémoire jusqu'au prochain démarrage.
  }
}

/** Fin d'une réponse locale : compte les appels écrits en texte. */
export function noteLocalRun(model: string, stats: { toolTextRepaired?: number; toolTextFailed?: number }): void {
  save(recordRun(healthBook(), model, stats, Date.now()))
}

/** Bouton « Tester » : résultat du vrai essai d'outil. */
export function noteToolTest(model: string, tools: boolean): void {
  save(recordTest(healthBook(), model, tools, Date.now()))
}
