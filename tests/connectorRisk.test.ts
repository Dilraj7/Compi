import { describe, expect, it } from 'vitest'
import { destructiveTool, docsResource, isConnectorTool } from '../src/shared/connectorRisk'

describe('outils des connecteurs qui détruisent', () => {
  it('outil d’un connecteur, pas de Compi ni du moteur', () => {
    expect(isConnectorTool('mcp__notion-741c__notion-search')).toBe(true)
    expect(isConnectorTool('mcp__compi__memory_save')).toBe(false)
    expect(isConnectorTool('ReadMcpResourceTool')).toBe(false)
  })

  it('le nom le dit : suppressions et mises à la corbeille de Notion, et des autres services', () => {
    expect(destructiveTool('mcp__notion-741c__notion-delete-pages')).toBe(true)
    expect(destructiveTool('mcp__notion-741c__notion-delete-databases')).toBe(true)
    expect(destructiveTool('mcp__notion-741c__notion-delete-comment')).toBe(true)
    expect(destructiveTool('mcp__todoist-1a2b__deleteTask')).toBe(true)
    expect(destructiveTool('mcp__drive-9f0e__trash_file')).toBe(true)
    expect(destructiveTool('mcp__linear-77aa__remove_label')).toBe(true)
  })

  it('le service le déclare, même sans le mot dans le nom', () => {
    expect(destructiveTool('mcp__crm-d369__archive_records', { destructive: true })).toBe(true)
    expect(destructiveTool('mcp__crm-d369__archive_records')).toBe(false)
  })

  it('lire, créer, modifier, déplacer ou restaurer ne détruit pas', () => {
    for (const t of [
      'notion-search',
      'notion-fetch',
      'notion-create-pages',
      'notion-update-page',
      'notion-move-pages',
      'notion-restore-pages',
      'notion-duplicate-page'
    ])
      expect(destructiveTool(`mcp__notion-741c__${t}`)).toBe(false)
    expect(destructiveTool('mcp__notion-741c__notion-update-page', { destructive: false })).toBe(false)
  })

  it('les outils de Compi ont leurs propres règles', () => {
    expect(destructiveTool('mcp__compi__memory_forget')).toBe(false)
    expect(destructiveTool('mcp__compi__reminder_cancel', { destructive: true })).toBe(false)
  })
})

describe('documentation d’un connecteur, lue sans carte', () => {
  it('ressources « docs » de Notion', () => {
    expect(docsResource('notion://docs/enhanced-markdown-spec')).toBe(true)
    expect(docsResource('notion://docs/view-dsl-spec')).toBe(true)
    expect(docsResource('notion://docs/memory')).toBe(true)
  })

  it('le reste demande une carte', () => {
    expect(docsResource('notion://page/1234')).toBe(false)
    expect(docsResource('file:///C:/Users/alex/docs/secret.txt')).toBe(false)
    expect(docsResource('notion://docs/')).toBe(false)
    expect(docsResource('')).toBe(false)
  })
})
