import { describe, expect, it, vi } from 'vitest'
import { brainLabel, brainMissing, defaultBrain, isPrivateHost, normalizeBaseUrl } from '../src/shared/brains'
import { CATALOG } from '../src/shared/catalog'
import { contextFor, fitFor, recommend } from '../src/shared/recommend'
import type { BrainQuizAnswers, HardwareInfo, Settings } from '../src/shared/types'
import { describeAgentError } from '../src/main/agent/errors'
import { brainEnv, hostEnv, resolveBrain } from '../src/main/brains/brain'
import { toModelInfo } from '../src/main/brains/lmstudio'
import { parseNumCtx, parsePullLine, parseShow, parseWingetLine, variantName, versionAtLeast } from '../src/main/brains/ollama'

vi.mock('electron', () => ({ app: { getPath: () => '.' } }))
const { parseGpus } = await import('../src/main/brains/hardware')

const base = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  local: { engine: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen3.5:9b', cloudHelp: true },
  custom: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-flash' }
} as unknown as Settings

describe('cerveau par défaut et discussions', () => {
  it('suit le fournisseur choisi', () => {
    expect(defaultBrain(base)).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
    expect(defaultBrain({ ...base, provider: 'local' })).toEqual({ provider: 'local', model: 'qwen3.5:9b' })
    expect(defaultBrain({ ...base, provider: 'custom' })).toEqual({ provider: 'custom', model: 'deepseek-v4-flash' })
  })

  it('garde le cerveau de la discussion, et Claude pour les anciennes', () => {
    const local = { ...base, provider: 'local' } as Settings
    expect(resolveBrain(local)).toEqual({ provider: 'local', model: 'qwen3.5:9b' })
    expect(resolveBrain(local, { brain: { provider: 'custom', model: 'x' } })).toEqual({ provider: 'custom', model: 'x' })
    expect(resolveBrain(local, {})).toEqual({ provider: 'anthropic', model: 'claude-opus-5-5' })
  })

  it('dit ce qui manque', () => {
    expect(brainMissing({ provider: 'anthropic', model: 'claude-opus-5-5' }, { hasApiKey: false, hasCustomKey: false, custom: base.custom })).toMatch(/clé API/)
    expect(brainMissing({ provider: 'local', model: '' }, { hasApiKey: true, hasCustomKey: false, custom: base.custom })).toMatch(/modèle local/)
    expect(brainMissing({ provider: 'custom', model: 'm' }, { hasApiKey: true, hasCustomKey: false, custom: { name: '', baseUrl: '', model: 'm' } })).toMatch(/adresse/)
    const deepseek = { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-v4-flash' }
    expect(brainMissing({ provider: 'custom', model: deepseek.model }, { hasApiKey: true, hasCustomKey: false, custom: deepseek })).toMatch(/clé DeepSeek/)
    expect(brainMissing({ provider: 'custom', model: deepseek.model }, { hasApiKey: false, hasCustomKey: true, custom: deepseek })).toBeNull()
    const llamacpp = { name: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080', model: 'local' }
    expect(brainMissing({ provider: 'custom', model: 'local' }, { hasApiKey: false, hasCustomKey: false, custom: llamacpp })).toBeNull()
    expect(brainMissing({ provider: 'local', model: 'qwen3.5:9b' }, { hasApiKey: false, hasCustomKey: false, custom: base.custom })).toBeNull()
  })

  it('affiche des libellés lisibles', () => {
    expect(brainLabel({ provider: 'anthropic', model: 'claude-sonnet-5-5' })).toBe('Sonnet 5.5')
    expect(brainLabel({ provider: 'custom', model: 'deepseek-v4-flash' }, base)).toBe('DeepSeek · deepseek-v4-flash')
  })
})

describe('adresses', () => {
  it('normalise l’adresse de base (sans / final ni /v1)', () => {
    expect(normalizeBaseUrl('http://localhost:11434/')).toBe('http://localhost:11434')
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1')).toBe('https://openrouter.ai/api')
    expect(normalizeBaseUrl('127.0.0.1:8080')).toBe('http://127.0.0.1:8080')
    expect(normalizeBaseUrl('api.deepseek.com/anthropic')).toBe('https://api.deepseek.com/anthropic')
  })

  it('reconnaît les adresses locales et privées', () => {
    for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.20', '172.20.0.1', '[::1]']) expect(isPrivateHost(h)).toBe(true)
    for (const h of ['example.com', '172.40.0.1', '8.8.8.8']) expect(isPrivateHost(h)).toBe(false)
  })
})

describe('brainEnv', () => {
  const secret = 'sk-ant-api03-secret'

  it('Claude : clé Anthropic et en-tête de workspace, comme avant', () => {
    const env = brainEnv({ provider: 'anthropic', model: 'claude-opus-5-5' }, { apiKey: secret, workspaceId: 'wrkspc_01Ab' })
    expect(env.ANTHROPIC_API_KEY).toBe(secret)
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBe('anthropic-workspace-id: wrkspc_01Ab')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it('Claude : aucune statistique d’usage envoyée par le moteur', () => {
    const env = brainEnv({ provider: 'anthropic', model: 'claude-opus-5-5' }, { apiKey: secret })
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
  })

  it('local : aucune clé Anthropic, tout redirigé vers le modèle local, rien d’annexe vers Anthropic', () => {
    const env = brainEnv(
      { provider: 'local', model: 'qwen3.5:9b-compi' },
      { apiKey: secret, workspaceId: 'wrkspc_01Ab', baseUrl: 'http://127.0.0.1:11434/', authToken: 'ollama', contextTokens: 65536 }
    )
    expect(JSON.stringify(env)).not.toContain(secret)
    expect(env.ANTHROPIC_API_KEY).toBe('')
    expect(env.ANTHROPIC_CUSTOM_HEADERS).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:11434')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('ollama')
    for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
      expect(env[k]).toBe('qwen3.5:9b-compi')
    }
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1')
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe('65536')
    // Requête standard : pas d'effort (Ollama le traduirait en réflexion), pas de bêta Claude.
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('auto')
    expect(env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('1')
    // Modèle sans réflexion : on ne la demande pas.
    expect(env.CLAUDE_CODE_DISABLE_THINKING).toBe('1')
    expect(brainEnv({ provider: 'local', model: 'qwen3.5:9b-compi' }, { baseUrl: 'http://127.0.0.1:11434', thinking: true }).CLAUDE_CODE_DISABLE_THINKING).toBeUndefined()
  })

  it('autre service : sa clé à lui, jamais celle d’Anthropic', () => {
    const env = brainEnv({ provider: 'custom', model: 'deepseek-v4-flash' }, { apiKey: secret, baseUrl: 'https://api.deepseek.com/anthropic', authToken: 'sk-ds' })
    expect(JSON.stringify(env)).not.toContain(secret)
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-ds')
    expect(env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined()
    expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('auto')
    expect(env.CLAUDE_CODE_DISABLE_THINKING).toBeUndefined()
  })

  it('lancé depuis un autre agent : son identité et sa session ne passent pas au moteur', () => {
    const env = hostEnv({
      PATH: 'C:\\Windows',
      HTTPS_PROXY: 'http://proxy:8080',
      ANTHROPIC_API_KEY: 'sk-ant-garde',
      CLAUDE_CONFIG_DIR: 'C:\\compi',
      CLAUDECODE: '1',
      CLAUDE_CODE_USER_EMAIL: 'moi@example.com',
      CLAUDE_CODE_ACCOUNT_UUID: '0d1f',
      CLAUDE_CODE_MESSAGING_TOKEN: 'jeton',
      CLAUDE_AGENT_SDK_VERSION: '0.3',
      CLAUDE_EFFORT: 'xhigh',
      AI_AGENT: 'claude'
    })
    expect(Object.keys(env).sort()).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR', 'HTTPS_PROXY', 'PATH'])
  })
})

describe('conseiller', () => {
  const rx6800: HardwareInfo = { ramGb: 16, gpu: { name: 'AMD Radeon RX 6800', vramGb: 16, vendor: 'amd' }, freeDiskGb: 140 }
  const laptop: HardwareInfo = { ramGb: 16, gpu: { name: 'Intel Iris Xe', vramGb: 0.1, vendor: 'intel' }, freeDiskGb: 80 }
  const small: HardwareInfo = { ramGb: 8, freeDiskGb: 50 }
  const tiny: HardwareInfo = { ramGb: 4, freeDiskGb: 50 }
  const answers: BrainQuizAnswers = { priority: 'both', uses: ['write', 'docs'], language: 'fr', pace: 'fast' }

  it('ne conseille que des modèles qui savent utiliser des outils', () => {
    expect(CATALOG.every((m) => m.scores.tools >= 3)).toBe(true)
  })

  it('RX 6800 : un modèle de dernière génération qui tient en VRAM', () => {
    const rec = recommend(answers, rx6800)
    expect(rec.provider).toBe('local')
    expect(rec.fit).toBe('gpu')
    expect(['qwen3.5:9b', 'gemma4:12b', 'ministral-3:14b']).toContain(rec.pick?.id)
    expect(rec.reasons.join(' ')).toContain('RX 6800')
    expect(rec.alternatives.length).toBe(2)
  })

  it('portable sans carte graphique, réponses rapides : un petit modèle', () => {
    const rec = recommend(answers, laptop)
    expect(rec.fit).toBe('cpu')
    expect(rec.pick!.sizeGb).toBeLessThan(5)
  })

  it('PC de 8 Go : encore un modèle léger', () => {
    expect(recommend(answers, small).pick?.needGb).toBeLessThanOrEqual(5)
  })

  it('PC trop juste : pas de modèle, explication honnête', () => {
    const rec = recommend(answers, tiny)
    expect(rec.pick).toBeUndefined()
    expect(rec.reasons[0]).toMatch(/mémoire/)
  })

  it('disque presque plein : écarte les modèles trop gros', () => {
    const rec = recommend(answers, { ...rx6800, freeDiskGb: 6 })
    expect(rec.pick!.sizeGb + 2).toBeLessThanOrEqual(6)
  })

  it('« images » impose la vision', () => {
    const rec = recommend({ ...answers, uses: ['images'] }, rx6800)
    expect(rec.pick?.vision).toBe(true)
    expect(rec.alternatives.every((m) => m.vision)).toBe(true)
  })

  it('« tout sur mon PC » ne propose jamais Claude ; « qualité maximale » conseille Claude', () => {
    expect(recommend({ ...answers, priority: 'privacy' }, rx6800)).toMatchObject({ provider: 'local', cloudHelp: false })
    const q = recommend({ ...answers, priority: 'quality' }, rx6800)
    expect(q.provider).toBe('anthropic')
    expect(q.alternatives.length).toBeGreaterThan(0)
  })

  it('évalue où tourne un modèle', () => {
    const gptOss = CATALOG.find((m) => m.id === 'gpt-oss:20b')!
    expect(fitFor(gptOss, rx6800)).toBe('gpu')
    expect(fitFor(gptOss, laptop)).toBeNull()
    // 32 000 jetons par défaut ; 64 000 seulement si demandé et avec 6 Go de marge sur la carte.
    expect(contextFor(6.6, rx6800)).toBe(32768)
    expect(contextFor(6.6, rx6800, true)).toBe(65536)
    expect(contextFor(14, rx6800, true)).toBe(32768)
    expect(contextFor(6.6, laptop, true)).toBe(32768)
  })
})

describe('Ollama', () => {
  it('lit les capacités de /api/show', () => {
    expect(
      parseShow({ capabilities: ['completion', 'tools', 'vision', 'thinking'], model_info: { 'qwen35.context_length': 262144 }, details: { parameter_size: '9.7B' } })
    ).toEqual({ tools: true, vision: true, thinking: true, contextLength: 262144, params: '9.7B' })
    expect(parseShow({ capabilities: ['completion'] })).toMatchObject({ tools: false, vision: false })
  })

  it('relit num_ctx et nomme la variante', () => {
    expect(parseNumCtx('temperature 0.7\nnum_ctx 32768\nstop "<|im_end|>"')).toBe(32768)
    expect(parseNumCtx(undefined)).toBeUndefined()
    expect(variantName('qwen3.5:9b')).toBe('qwen3.5:9b-compi')
    expect(variantName('mistral-nemo')).toBe('mistral-nemo:latest-compi')
    expect(variantName('hf.co/user/model:Q4_K_M')).toBe('hf.co/user/model:Q4_K_M-compi')
  })

  it('compare les versions', () => {
    expect(versionAtLeast('0.32.1', '0.14.0')).toBe(true)
    expect(versionAtLeast('0.14.0', '0.14.0')).toBe(true)
    expect(versionAtLeast('0.13.5', '0.14.0')).toBe(false)
    expect(versionAtLeast('0.14.0-rc1', '0.14.0')).toBe(true)
  })

  it('traduit la progression des téléchargements', () => {
    expect(parsePullLine('{"status":"pulling abc","digest":"abc","total":200,"completed":50}')).toEqual({ status: 'Téléchargement', progress: 0.25 })
    expect(parsePullLine('{"status":"success"}')).toEqual({ status: 'Terminé', progress: 1 })
    expect(parsePullLine('{"error":"pull model manifest: file does not exist"}')).toMatchObject({ error: expect.stringContaining('manifest') })
    expect(parsePullLine('pas du json')).toBeNull()
  })

  it('lit la progression de winget', () => {
    expect(parseWingetLine('  ██████████  512 MB / 1.00 GB')?.progress).toBeCloseTo(0.512)
    expect(parseWingetLine('Successfully installed')).toEqual({ status: 'Terminé', progress: 1 })
    expect(parseWingetLine('Found Ollama [Ollama.Ollama]')).toBeNull()
  })
})

describe('matériel et LM Studio', () => {
  it('garde la carte graphique la mieux dotée (VRAM réelle du registre)', () => {
    const json = JSON.stringify([
      { name: 'Intel(R) UHD Graphics', q: null, m: 1073741824 },
      { name: 'AMD Radeon RX 6800', q: 17163091968, m: 4293918720 }
    ])
    expect(parseGpus(json)).toEqual({ name: 'AMD Radeon RX 6800', vramGb: 16, vendor: 'amd' })
    expect(parseGpus('{"name":"NVIDIA GeForce RTX 4070","q":12884901888}')).toMatchObject({ vendor: 'nvidia', vramGb: 12 })
    expect(parseGpus('')).toBeUndefined()
  })

  it('traduit la liste de LM Studio', () => {
    expect(
      toModelInfo({ key: 'google/gemma-4-12b', type: 'llm', size_bytes: 8e9, params_string: '12B', max_context_length: 131072, capabilities: { vision: true, trained_for_tool_use: true } })
    ).toEqual({ name: 'google/gemma-4-12b', sizeBytes: 8e9, params: '12B', tools: true, vision: true, thinking: false, contextLength: 131072 })
  })
})

describe('erreurs des autres cerveaux', () => {
  const local = { provider: 'local' as const, model: 'qwen3.5:9b' }
  it('local', () => {
    expect(describeAgentError('connect ECONNREFUSED 127.0.0.1:11434', local)).toMatch(/ne répond pas/)
    expect(describeAgentError('API Error: 404 model "qwen3.5:9b" not found, try pulling it first', local)).toMatch(/pas installé/)
    expect(describeAgentError('registry.ollama.ai/library/llama2 does not support tools', local)).toMatch(/outils/)
  })
  it('autre service', () => {
    const custom = { provider: 'custom' as const, model: 'deepseek-v4-flash' }
    expect(describeAgentError('API Error: 401 Unauthorized', custom)).toMatch(/refuse la clé/)
    expect(describeAgentError('API Error: 402 Insufficient Balance', custom)).toMatch(/solde/)
  })
})
