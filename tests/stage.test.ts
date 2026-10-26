import { describe, expect, it } from 'vitest'
import { sourcesFrom, stageDetail, STAGE_MAX_MOVES } from '../src/shared/stage'

describe('scène : détail des étapes', () => {
  it('fichier texte : reprend la carte d’accord (chemin, résumé, lignes changées)', () => {
    const card = 'D:\\Docs\\notes.md\nContenu remplacé · 3 → 4 ligne(s)\n\n  # Courses\n- pain\n+ pain complet\n+ œufs'
    const d = stageDetail(
      'mcp__compi__write_text_file',
      { path: 'D:\\Docs\\notes.md' },
      'Contenu écrit dans D:\\Docs\\notes.md (4 ligne(s), modification e3).',
      { card }
    )
    expect(d).toEqual({
      kind: 'file',
      path: 'D:\\Docs\\notes.md',
      summary: 'Contenu remplacé · 3 → 4 ligne(s)',
      diff: ['  # Courses', '- pain', '+ pain complet', '+ œufs']
    })
  })

  it('fichier texte sans carte : le résultat suffit ; rien quand le fichier n’a pas changé', () => {
    expect(stageDetail('mcp__compi__write_text_file', { path: 'D:\\Docs\\a.txt' }, 'Fichier créé : D:\\Docs\\a.txt (2 ligne(s), modification e4).')).toEqual({
      kind: 'file',
      path: 'D:\\Docs\\a.txt',
      summary: 'Nouveau fichier · 2 ligne(s)',
      diff: []
    })
    expect(stageDetail('mcp__compi__write_text_file', { path: 'a.txt' }, 'a.txt contient déjà exactement ce texte : rien n’a changé.')).toBeUndefined()
  })

  it('rangement : les premiers déplacements, le total et les refus', () => {
    const moved = Array.from({ length: 10 }, (_, i) => `- D:\\Docs\\f${i}.pdf → D:\\Docs\\Factures\\f${i}.pdf`).join('\n')
    const result = `Déplacés (10) :\n${moved}\n\nNon déplacés (1) :\n- D:\\Docs\\x.pdf : déjà ouvert\n\nPour annuler : undo_moves (rangement m2).`
    const d = stageDetail('mcp__compi__move_items', {}, result)
    expect(d?.kind).toBe('moves')
    if (d?.kind !== 'moves') return
    expect(d.total).toBe(10)
    expect(d.refused).toBe(1)
    expect(d.moves).toHaveLength(STAGE_MAX_MOVES)
    expect(d.moves[0]).toEqual({ from: 'D:\\Docs\\f0.pdf', to: 'D:\\Docs\\Factures\\f0.pdf' })
    expect(stageDetail('mcp__compi__move_items', {}, 'Rien n’a été déplacé.')).toBeUndefined()
  })

  it('agenda : créé, déplacé, supprimé', () => {
    expect(stageDetail('mcp__compi__calendar_create_event', {}, "Ajouté à l'agenda : « Dentiste », mardi 27 octobre, 17:30 – 18:00.")).toEqual({
      kind: 'event',
      action: 'created',
      text: '« Dentiste », mardi 27 octobre, 17:30 – 18:00'
    })
    expect(
      stageDetail('mcp__compi__calendar_update_event', {}, 'Modifié (le même événement, aucun doublon) : « Dentiste », mercredi 28 octobre, 9:00 – 9:30.')
    ).toMatchObject({
      action: 'updated',
      text: '« Dentiste », mercredi 28 octobre, 9:00 – 9:30'
    })
    expect(stageDetail('mcp__compi__calendar_delete_event', {}, "Supprimé de l'agenda : « Dentiste ».")).toMatchObject({
      action: 'deleted',
      text: '« Dentiste »'
    })
    expect(stageDetail('mcp__compi__calendar_delete_event', {}, "« Dentiste » n'existait déjà plus dans l'agenda.")).toBeUndefined()
  })

  it('rappel et minuteur', () => {
    expect(
      stageDetail('mcp__compi__reminder_create', { message: 'Appeler le garage' }, 'Rappel programmé : lundi 26 octobre à 18:30, puis chaque lundi.')
    ).toEqual({
      kind: 'reminder',
      text: 'Appeler le garage',
      when: 'lundi 26 octobre à 18:30, puis chaque lundi'
    })
    expect(stageDetail('mcp__compi__timer_start', {}, 'Pâtes lancé : 10 min.')).toEqual({ kind: 'timer', text: 'Pâtes lancé : 10 min' })
  })

  it('appli, page, dossier ou paramètres ouverts', () => {
    expect(stageDetail('mcp__compi__open_app', { name: 'word' }, 'Ouverte : Word')).toEqual({ kind: 'opened', what: 'app', target: 'Word' })
    expect(stageDetail('mcp__compi__open_url', { url: 'https://example.com/a' }, 'Ouvert : https://example.com/a')).toEqual({
      kind: 'opened',
      what: 'page',
      target: 'https://example.com/a'
    })
    expect(stageDetail('mcp__compi__open_url', { url: 'javascript:alert(1)' }, 'Ouvert')).toBeUndefined()
    expect(stageDetail('mcp__compi__open_folder', { path: 'D:\\Docs' }, "Dossier ouvert dans l'Explorateur : D:\\Docs")).toMatchObject({
      what: 'folder',
      target: 'D:\\Docs'
    })
    expect(stageDetail('mcp__compi__open_settings', { page: 'bluetooth' }, 'Paramètres ouverts : Bluetooth')).toMatchObject({
      what: 'settings',
      target: 'Bluetooth'
    })
  })

  it('recherche web : sources de Claude Code (structurées ou en texte) et de Compi', () => {
    const structured = {
      query: 'météo',
      results: [{ tool_use_id: 'x', content: [{ title: 'Météo Paris', url: 'https://meteo.example/paris' }] }, 'commentaire']
    }
    expect(sourcesFrom('', structured)).toEqual([{ title: 'Météo Paris', url: 'https://meteo.example/paris' }])
    const text = 'Web search results for query: "météo"\n\nLinks: [{"title":"A","url":"https://a.example"},{"title":"B","url":"https://b.example"}]\n\nRésumé…'
    expect(sourcesFrom(text).map((s) => s.url)).toEqual(['https://a.example', 'https://b.example'])
    const compi =
      'Résultats web pour « météo » (Ollama) :\n\n1. Météo à Paris\n   https://meteo.example/paris\n   Averses\n\n2. Prévisions\n   https://prev.example\n\nLis les pages utiles…'
    expect(stageDetail('mcp__compi__web_search', { query: 'météo' }, compi)).toEqual({
      kind: 'sources',
      sources: [
        { title: 'Météo à Paris', url: 'https://meteo.example/paris' },
        { title: 'Prévisions', url: 'https://prev.example' }
      ]
    })
    // Jamais d'adresse autre que http(s), au plus 5 sources.
    expect(sourcesFrom('Links: [{"title":"x","url":"file:///C:/x"}]')).toEqual([])
    const many = { results: [{ content: Array.from({ length: 9 }, (_, i) => ({ title: `T${i}`, url: `https://s${i}.example` })) }] }
    expect(sourcesFrom('', many)).toHaveLength(5)
  })

  it('les autres outils gardent leur ligne', () => {
    expect(stageDetail('mcp__compi__get_datetime', {}, 'lundi')).toBeUndefined()
    expect(stageDetail('Read', { file_path: 'x' }, '...')).toBeUndefined()
  })
})
