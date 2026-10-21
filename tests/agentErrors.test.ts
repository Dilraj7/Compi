import { describe, expect, it } from 'vitest'
import { customHeadersEnv, describeAgentError, normalizeWorkspaceId } from '../src/main/agent/errors'

describe('normalizeWorkspaceId', () => {
  it('garde un ID valide tel quel', () => {
    expect(normalizeWorkspaceId('  wrkspc_01ExempleFauxId42xyz ')).toBe('wrkspc_01ExempleFauxId42xyz')
  })

  it('extrait l’ID d’une URL de la Console', () => {
    expect(normalizeWorkspaceId('https://platform.claude.com/settings/workspaces/wrkspc_01AbC9?tab=keys')).toBe('wrkspc_01AbC9')
  })

  it('empêche l’injection d’en-têtes (retours à la ligne, deux-points)', () => {
    expect(normalizeWorkspaceId('abc\r\nx-api-key: vol')).toBe('abcx-api-keyvol')
  })
})

describe('customHeadersEnv', () => {
  it('ne définit rien sans workspace ni en-tête existant', () => {
    expect(customHeadersEnv('')).toBeUndefined()
  })

  it('ajoute l’en-tête du workspace', () => {
    expect(customHeadersEnv('wrkspc_01AbC')).toBe('anthropic-workspace-id: wrkspc_01AbC')
  })

  it('conserve les en-têtes de l’utilisateur et remplace un ancien workspace', () => {
    const existing = 'X-Proxy: 1\nanthropic-workspace-id: wrkspc_ancien'
    expect(customHeadersEnv('wrkspc_nouveau', existing)).toBe('X-Proxy: 1\nanthropic-workspace-id: wrkspc_nouveau')
    expect(customHeadersEnv('', existing)).toBe('X-Proxy: 1')
  })
})

describe('describeAgentError', () => {
  it('explique l’erreur « clé non rattachée à un workspace » au lieu de « unknown »', () => {
    const raw =
      'API Error: 400 This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use. Add the header, or use an API key that is scoped to a workspace.'
    const msg = describeAgentError(raw)
    expect(msg).toMatch(/workspace/)
    expect(msg).toMatch(/Réglages/)
  })

  it('reconnaît une clé invalide', () => {
    expect(describeAgentError('Invalid API key · Fix external API key')).toMatch(/invalide/)
  })

  it('garde le détail d’une erreur inconnue plutôt qu’un code vague', () => {
    expect(describeAgentError('API Error: 400 Something new happened')).toBe('400 Something new happened')
  })

  it('autre service : un modèle sans outils est expliqué', () => {
    const brain = { provider: 'custom', model: 'meta/petit-modele' } as const
    expect(describeAgentError('API Error: 404 {"error":{"message":"No endpoints found that support tool use. Try disabling \\"tools\\""}}', brain)).toMatch(
      /marqué « tools »/
    )
    expect(describeAgentError('API Error: 400 {"error":{"message":"Invalid request","code":400}}', brain)).toMatch(/refusé la requête.*« tools »/)
    expect(describeAgentError('API Error: 400 {"error":{"message":"invalid model id"}}', brain)).toMatch(/ne connaît pas le modèle/)
  })
})
