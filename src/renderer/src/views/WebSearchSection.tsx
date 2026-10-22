// Réglages › Cerveau › Recherche web : le service choisi par l'utilisateur
// (Ollama avec la clé de son compte, ou son SearXNG) pour le cerveau local et
// « Autre service ». Désactivée par défaut ; rien n'est préréglé.

import { useState } from 'react'
import { Check, ExternalLink, Globe, Loader2, Play, TriangleAlert } from 'lucide-react'
import type { PublicSettings, Settings, WebSearchProvider, WebSearchTestResult } from '@shared/types'
import { normalizeSearxUrl, OLLAMA_KEYS_URL, SEARXNG_DOCS_URL, webSearchLabel, webSearchReady } from '@shared/webSearch'
import { useCompi } from '../store'
import { Badge, Button, Row, Section, Segmented, TextInput } from '../components/ui'

const PRIVACY_LABEL = {
  ask: 'une carte te demande ton accord avant chaque recherche',
  always: 'tes recherches partent sans demander',
  never: 'aucune recherche ne part'
}

export function WebSearchSection({
  s,
  apply,
  update
}: {
  s: PublicSettings
  apply: (p: Promise<PublicSettings>) => void
  update: (patch: Partial<Settings>) => void
}) {
  const ws = s.webSearch
  const [key, setKey] = useState('')
  const [editingKey, setEditingKey] = useState(!s.hasWebSearchKey)
  const [url, setUrl] = useState(ws.searxngUrl)
  const [test, setTest] = useState<WebSearchTestResult | 'running' | null>(null)
  const focusSettings = useCompi((st) => st.focusSettings)
  const ready = webSearchReady(ws, s.hasWebSearchKey)
  const badUrl = ws.provider === 'searxng' && url.trim() !== '' && normalizeSearxUrl(url) === null
  const setProvider = (provider: WebSearchProvider): void => {
    setTest(null)
    update({ webSearch: { ...ws, provider } })
  }
  const saveUrl = (): void => {
    if (url.trim() === ws.searxngUrl) return
    setTest(null)
    update({ webSearch: { ...ws, searxngUrl: url.trim() } })
  }
  const runTest = (): void => {
    setTest('running')
    window.compi.testWebSearch().then(setTest, (e: Error) => setTest({ ok: false, message: e.message }))
  }

  return (
    <Section title="Recherche web" hint="Pour le cerveau local et « Autre service » : Claude a déjà la sienne. Tes recherches partent chez le service choisi.">
      <Row label="Service de recherche" hint="Désactivée par défaut. Je lis ensuite les pages moi-même, sur ton PC.">
        <Segmented<WebSearchProvider>
          id="websearch-provider"
          value={ws.provider}
          options={[
            { value: 'off', label: 'Désactivée' },
            { value: 'ollama', label: 'Ollama' },
            { value: 'searxng', label: 'SearXNG' }
          ]}
          onChange={setProvider}
        />
      </Row>

      {ws.provider === 'ollama' && (
        <div className="space-y-2 px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] text-fog-500">Clé de ton compte Ollama</span>
            <button
              onClick={() => void window.compi.openExternal(OLLAMA_KEYS_URL)}
              className="inline-flex items-center gap-1 text-[11.5px] text-[var(--led)] hover:underline"
            >
              Obtenir une clé <ExternalLink size={11} />
            </button>
          </div>
          {s.hasWebSearchKey && !editingKey ? (
            <div className="flex items-center gap-1.5">
              <Badge color="#4ADE80">
                <Check size={11} /> Enregistrée
              </Badge>
              <Button size="sm" variant="ghost" onClick={() => setEditingKey(true)}>
                Changer
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTest(null)
                  setEditingKey(true)
                  apply(window.compi.setWebSearchKey(null))
                }}
              >
                Supprimer
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <TextInput id="websearch-key" type="password" placeholder="clé API Ollama" value={key} onChange={(e) => setKey(e.target.value)} />
              <Button
                size="md"
                variant="primary"
                disabled={!key.trim()}
                onClick={() => {
                  setTest(null)
                  apply(window.compi.setWebSearchKey(key.trim()))
                  setKey('')
                  setEditingKey(false)
                }}
              >
                Enregistrer
              </Button>
            </div>
          )}
          <div className="text-[11.5px] leading-snug text-fog-500">
            Compte Ollama gratuit requis ; la clé est chiffrée par Windows. Ollama ne publie pas ses limites : s’il refuse (quota atteint), je te le dirai.
          </div>
        </div>
      )}

      {ws.provider === 'searxng' && (
        <div className="space-y-2 px-3.5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] text-fog-500">Adresse de ton SearXNG</span>
            <button
              onClick={() => void window.compi.openExternal(SEARXNG_DOCS_URL)}
              className="inline-flex items-center gap-1 text-[11.5px] text-[var(--led)] hover:underline"
            >
              Aide <ExternalLink size={11} />
            </button>
          </div>
          <TextInput
            id="websearch-url"
            placeholder="http://localhost:8080"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={saveUrl}
            onKeyDown={(e) => e.key === 'Enter' && saveUrl()}
          />
          <div className={badUrl ? 'text-[11.5px] text-[#FCA5A5]' : 'text-[11.5px] leading-snug text-fog-500'}>
            {badUrl
              ? 'Adresse invalide : par exemple http://localhost:8080.'
              : 'Le format JSON doit être activé sur ton instance (« json » dans search.formats de son settings.yml).'}
          </div>
        </div>
      )}

      {ws.provider !== 'off' && (
        <div className="space-y-2 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={!ready || test === 'running'}
              onClick={runTest}
              title="Envoie une recherche « wikipedia » au service choisi"
            >
              {test === 'running' ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
              Essayer
            </Button>
            {test && test !== 'running' && (
              <span role="status" className={test.ok ? 'text-[11.5px] text-[#86EFAC]' : 'inline-flex items-start gap-1 text-[11.5px] text-[#FCA5A5]'}>
                {!test.ok && <TriangleAlert size={12} className="mt-px shrink-0" />}
                {test.message}
              </span>
            )}
          </div>
          <div className="flex items-start gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-[11.5px] leading-snug text-fog-500">
            <Globe size={12} className="mt-0.5 shrink-0 text-fog-300" />
            <span>
              {ready ? `Mes recherches partent chez ${webSearchLabel(ws)} ; ` : 'Une fois prête, mes recherches partiront chez le service choisi ; '}
              {PRIVACY_LABEL[s.privacy.web]} (
              <button className="text-[var(--led)] hover:underline" onClick={() => focusSettings('privacy')}>
                Confidentialité › Recherches web
              </button>
              ). Avec Claude, c’est sa recherche web qui sert.
            </span>
          </div>
        </div>
      )}
    </Section>
  )
}
