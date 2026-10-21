// LM Studio : détection, liste des modèles et chargement avec la bonne fenêtre
// de contexte. Doc : https://lmstudio.ai/docs/developer/rest (API v1).

import type { LocalModelInfo } from '../../shared/types'

interface LmModel {
  key: string
  type: string
  size_bytes?: number
  params_string?: string | null
  max_context_length?: number | null
  capabilities?: { vision?: boolean; trained_for_tool_use?: boolean }
  loaded_instances?: Array<{ id: string; config?: { context_length?: number } }>
}

async function models(base: string): Promise<LmModel[]> {
  const res = await fetch(`${base}/api/v1/models`, { signal: AbortSignal.timeout(2000) })
  if (!res.ok) throw new Error(`LM Studio : HTTP ${res.status}`)
  const data = (await res.json()) as { models?: LmModel[]; data?: LmModel[] }
  return data.models ?? data.data ?? []
}

export async function lmstudioRunning(base: string): Promise<boolean> {
  try {
    await models(base)
    return true
  } catch {
    return false
  }
}

export function toModelInfo(m: LmModel): LocalModelInfo {
  return {
    name: m.key,
    sizeBytes: m.size_bytes ?? 0,
    params: m.params_string ?? undefined,
    tools: Boolean(m.capabilities?.trained_for_tool_use),
    vision: Boolean(m.capabilities?.vision),
    thinking: false,
    contextLength: m.max_context_length ?? undefined
  }
}

/** Modèles chargés dans LM Studio (sans la part dans la carte graphique, que l'API ne donne pas). */
export async function loadedLmStudioModels(base: string): Promise<Array<{ name: string; sizeBytes: number; contextLength?: number }>> {
  return (await models(base))
    .filter((m) => m.loaded_instances?.length)
    .map((m) => ({ name: m.key, sizeBytes: m.size_bytes ?? 0, contextLength: m.loaded_instances?.[0]?.config?.context_length }))
}

export async function listLmStudioModels(base: string): Promise<LocalModelInfo[]> {
  return (await models(base)).filter((m) => m.type === 'llm').map(toModelInfo)
}

/** Charge le modèle avec au moins `contextLength` jetons de contexte, s'il ne l'est pas déjà. */
export async function loadLmStudioModel(base: string, model: string, contextLength: number): Promise<void> {
  const m = (await models(base)).find((x) => x.key === model)
  if (m?.loaded_instances?.some((i) => (i.config?.context_length ?? 0) >= contextLength)) return
  const max = m?.max_context_length ?? contextLength
  const res = await fetch(`${base}/api/v1/models/load`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, context_length: Math.min(contextLength, max) }),
    signal: AbortSignal.timeout(180_000)
  })
  if (!res.ok) throw new Error(`LM Studio n'a pas pu charger ${model} (HTTP ${res.status}).`)
}
