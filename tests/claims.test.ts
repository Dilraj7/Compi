import { describe, expect, it } from 'vitest'
import { autoFollowUp, followUpFor, unverifiedClaim } from '../src/shared/claims'

const none: Array<{ name: string; status: string }> = []
const did = (name: string, status = 'done'): Array<{ name: string; status: string }> => [{ name: `mcp__compi__${name}`, status }]

describe('action annoncée sans outil', () => {
  it('repère « c’est fait » et « j’ai déplacé » sans aucun outil (cas réel du Bureau)', () => {
    expect(unverifiedClaim("C'est fait ! Tes dossiers sont rangés.", none)).toBe('no-action')
    expect(unverifiedClaim('J’ai déplacé les dossiers Projets et Factures dans CompiDocs.', none)).toBe('no-action')
    expect(unverifiedClaim("J'ai bien créé les dossiers 01_PROJETS_EN_COURS et 02_ADMIN.", none)).toBe('no-action')
    expect(unverifiedClaim('Les fichiers ont été déplacés.', none)).toBe('no-action')
    expect(unverifiedClaim('**Dossiers déplacés vers CompiDocs :**\n- Projets\n- Photos', none)).toBe('no-action')
    expect(unverifiedClaim("Voilà, c'est ouvert dans l'Explorateur.", none)).toBe('no-action')
  })

  it('repère « je lance… » laissé sans suite', () => {
    expect(unverifiedClaim('Parfait, je lance l’analyse de ton Bureau…', none)).toBe('stopped')
    expect(unverifiedClaim('En attente de la liste des fichiers…', none)).toBe('stopped')
    expect(unverifiedClaim('Je vais maintenant créer les dossiers.', none)).toBe('stopped')
  })

  it('une action réussie rend la phrase vraie', () => {
    expect(unverifiedClaim("C'est fait : 12 éléments déplacés.", did('move_items'))).toBeNull()
    expect(unverifiedClaim("J'ai ouvert PdfCraft.", did('open_app'))).toBeNull()
    expect(unverifiedClaim('Je lance le minuteur.', did('timer_start'))).toBeNull()
  })

  it('une simple lecture, un outil refusé ou en erreur ne rendent pas la phrase vraie', () => {
    expect(unverifiedClaim("J'ai rangé ton Bureau.", did('folder_inventory'))).toBe('no-action')
    expect(unverifiedClaim("J'ai rangé ton Bureau.", did('screen_capture'))).toBe('no-action')
    expect(unverifiedClaim("C'est fait.", did('move_items', 'error'))).toBe('no-action')
    expect(unverifiedClaim("C'est fait.", [{ name: 'WebSearch', status: 'done' }])).toBe('no-action')
  })

  it('pas de fausse alerte sur une question, un plan ou du code', () => {
    expect(unverifiedClaim('Je vais créer ces dossiers : Documents, Images. On y va ?', none)).toBeNull()
    expect(unverifiedClaim('Voici le plan proposé :\n- Documents ← facture.pdf\n\nTu valides ?', none)).toBeNull()
    expect(unverifiedClaim('Il fait 17 °C à Paris demain.', none)).toBeNull()
    expect(unverifiedClaim("```bat\nREM c'est fait\nmove a b\n```\nCe script n’a pas été lancé.", none)).toBeNull()
    expect(unverifiedClaim("Je n'ai pas d'outil pour ça : je ne peux pas déplacer ce fichier.", none)).toBeNull()
  })

  it('souvenir promis sans memory_save (cas réel : « C’est noté, je m’en souviens »)', () => {
    expect(unverifiedClaim('C’est noté, je m’en souviens : tu préfères le thé vert.', none)).toBe('not-saved')
    expect(unverifiedClaim('Noté ! Ton anniversaire est le 12 mars.', none)).toBe('not-saved')
    expect(unverifiedClaim('D’accord, je retiens que tu travailles le samedi.', none)).toBe('not-saved')
    expect(unverifiedClaim('Je m’en souviendrai.', none)).toBe('not-saved')
    expect(unverifiedClaim('Je garde ça en tête pour la suite.', none)).toBe('not-saved')
    expect(unverifiedClaim('C’est enregistré.', none)).toBe('not-saved')
    // L'utilisateur demande de retenir, le modèle ne dit rien de particulier.
    expect(unverifiedClaim('Très bien.', none, { asked: 'Retiens que ma fille s’appelle Léa' })).toBe('not-saved')
    expect(unverifiedClaim('D’accord.', none, { asked: "N'oublie pas que je suis végétarien" })).toBe('not-saved')
    expect(unverifiedClaim('Ok.', none, { asked: 'Ajoute dans ta mémoire : je préfère le tutoiement' })).toBe('not-saved')
  })

  it('souvenir : enregistré, routine ou phrase sans rapport ne déclenchent rien', () => {
    expect(unverifiedClaim('C’est noté, je m’en souviendrai.', did('memory_save'))).toBeNull()
    expect(unverifiedClaim('Très bien.', did('memory_save'), { asked: 'Retiens que je suis végétarien' })).toBeNull()
    // Une autre vraie action : « c'est noté » parle d'elle (rappel, agenda).
    expect(unverifiedClaim('C’est noté dans ton agenda pour mardi.', did('calendar_create_event'))).toBeNull()
    expect(unverifiedClaim('C’est noté, je te le rappellerai à 18 h.', did('reminder_create'))).toBeNull()
    // Routine : la mémoire y est fermée.
    expect(unverifiedClaim('C’est noté.', none, { asked: 'Retiens que…', memory: false })).toBeNull()
    expect(unverifiedClaim('Ce restaurant est très bien noté par la critique.', none)).toBeNull()
    expect(unverifiedClaim('Le film est noté 4 sur 5.', none)).toBeNull()
    expect(unverifiedClaim('Bonne idée.', none, { asked: 'Je retiens ton conseil, merci' })).toBeNull()
    expect(unverifiedClaim('Le voici.', none, { asked: 'Souviens-toi de ce que je t’ai dit hier sur le projet ?' })).toBeNull()
    expect(unverifiedClaim('Je te le rappellerai.', none, { asked: "N'oublie pas de m'appeler à 18 h" })).toBeNull()
    expect(followUpFor('not-saved')).toMatch(/memory_save/)
    expect(autoFollowUp('not-saved')).toMatch(/Appelle maintenant memory_save[\s\S]*Si rien ne mérite d’être retenu/)
  })

  it('la relance demande d’agir ou de dire qu’il ne peut pas', () => {
    expect(followUpFor('no-action')).toMatch(/aucun outil/)
    expect(followUpFor('stopped')).toMatch(/sans la faire/)
    for (const n of ['no-action', 'stopped'] as const) expect(followUpFor(n)).toMatch(/ne peux pas/)
  })

  it('relance automatique : faire l’action ou dire pourquoi, sans refaire une action déjà faite', () => {
    expect(autoFollowUp('stopped')).toMatch(/s’arrête avant de la faire/)
    expect(autoFollowUp('no-action')).toMatch(/plus tôt dans la discussion, dis-le simplement, sans la refaire/)
    for (const n of ['no-action', 'stopped'] as const) {
      expect(autoFollowUp(n)).toMatch(/^<verification>[\s\S]*<\/verification>$/)
      expect(autoFollowUp(n)).toMatch(/Ne répète pas/)
    }
  })

  it('l’outil qui charge une extension ne rend pas vraie une phrase « j’ai créé »', () => {
    expect(unverifiedClaim('C’est fait, j’ai créé la page.', [{ name: 'mcp__compi__use_extension', status: 'done' }])).toBe('no-action')
  })

  it('lire la documentation d’une extension n’est pas une action', () => {
    expect(unverifiedClaim('C’est fait, j’ai créé la page.', [{ name: 'ReadMcpResourceTool', status: 'done' }])).toBe('no-action')
    expect(unverifiedClaim('C’est fait, j’ai créé la page.', [{ name: 'ListMcpResourcesTool', status: 'done' }])).toBe('no-action')
  })
})
