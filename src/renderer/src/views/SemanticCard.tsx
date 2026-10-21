// « Recherche par le sens » (Extensions › Dossiers) : retrouver un passage sans
// ses mots exacts. Les vecteurs sont calculés sur le PC par Ollama ; le modèle
// (≈ 640 Mo) ne se télécharge qu'après le clic sur « Activer ».

import { useEffect, useState } from 'react'
import { FileText, RefreshCw, ScanSearch, Search } from 'lucide-react'
import type { BrainProgress, SemanticPassage, SemanticStatus } from '@shared/types'
import { useCompi } from '../store'
import { Button, LedDots, TextInput, timeAgo } from '../components/ui'
import { ConfirmButton } from './MemoryView'

const COLOR = '#A3E635'
const MODEL_SIZE = '≈ 640 Mo'

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p

/** Proximité de sens, en 4 points : les scores bruts (0,4 à 0,8) parlent peu. */
function Closeness({ score }: { score: number }) {
  const on = score >= 0.65 ? 4 : score >= 0.55 ? 3 : score >= 0.45 ? 2 : 1
  return (
    <span className="flex shrink-0 items-center gap-[3px]" title="Proximité de sens">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="size-[5px] rounded-full"
          style={i < on ? { background: COLOR, boxShadow: `0 0 5px ${COLOR}` } : { background: 'rgb(255 255 255 / 0.12)' }}
        />
      ))}
    </span>
  )
}

/** « Essayer » : voir ce que la recherche par le sens trouve, sans passer par un cerveau. */
function TryBox() {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SemanticPassage[] | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    if (!query.trim() || busy) return
    setBusy(true)
    try {
      setHits(await window.compi.trySemantic(query))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-black/30 p-2.5 ring-1 ring-inset ring-white/[0.05]">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fog-700" />
          <TextInput
            className="pl-8"
            value={query}
            maxLength={300}
            placeholder="Essayer : « ce qui est dit sur la résiliation »"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Button size="sm" variant="subtle" type="submit" disabled={busy || !query.trim()}>
          {busy ? <LedDots color={COLOR} /> : 'Chercher'}
        </Button>
      </form>

      {hits === null && <div className="px-1 text-[11.5px] text-led-amber">La recherche n’est pas disponible pour l’instant. Réessaie dans un moment.</div>}
      {hits?.length === 0 && (
        <div className="px-1 text-[11.5px] text-fog-500">Rien de proche. Essaie une autre formulation, ou décris le passage en une phrase.</div>
      )}
      {hits && hits.length > 0 && (
        <div className="divide-y divide-white/[0.05]">
          {hits.map((h) => (
            <button
              key={`${h.file}#${h.page ?? 0}#${h.text.slice(0, 20)}`}
              className="block w-full px-1 py-2 text-left transition-colors hover:bg-white/[0.03]"
              title="Ouvrir le document"
              onClick={() => void window.compi.openSemanticFile(h.file)}
            >
              <div className="flex items-center gap-2">
                <FileText size={12} className="shrink-0" style={{ color: COLOR }} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-fog-100">
                  {baseName(h.file)}
                  {h.page ? <span className="text-fog-500"> · p. {h.page}</span> : null}
                </span>
                <Closeness score={h.score} />
              </div>
              <div className="mt-1 line-clamp-2 pl-5 text-[11.5px] leading-snug text-fog-500">{h.text}</div>
            </button>
          ))}
        </div>
      )}

      <div className="px-1 text-[11px] leading-snug text-fog-700">
        Dans la discussion, demande simplement « dans mes documents, … » : je m’en sers tout seul et je cite le fichier et la page.
      </div>
    </div>
  )
}

function Bar({ value }: { value?: number }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{
          width: `${Math.round((value ?? 0.04) * 100)}%`,
          background: COLOR,
          boxShadow: `0 0 8px ${COLOR}`
        }}
      />
    </div>
  )
}

export function SemanticCard() {
  const hasFolders = useCompi((s) => (s.settings?.folders.length ?? 0) > 0)
  const [status, setStatus] = useState<SemanticStatus | null>(null)
  const [pull, setPull] = useState<BrainProgress | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void window.compi.semanticStatus().then(setStatus)
    const offs = [
      window.compi.onSemantic(setStatus),
      window.compi.onBrainProgress((p) => {
        if (p.kind === 'install') {
          setPull(p.done && !p.error ? null : p)
          if (p.done) void window.compi.semanticStatus().then(setStatus)
        } else if (p.model === status?.model) {
          // Fin du téléchargement : l'état (lecture des documents, ou erreur) prend le relais.
          setPull(p.done ? null : p)
        }
      })
    ]
    return () => offs.forEach((off) => off())
  }, [status?.model])

  if (!status) return null
  const act = async (fn: () => Promise<SemanticStatus>): Promise<void> => {
    setBusy(true)
    try {
      setStatus(await fn())
    } finally {
      setBusy(false)
    }
  }
  const enabled = status.state !== 'off' && status.state !== 'no-ollama'
  const pct = status.files ? status.indexed / status.files : undefined

  return (
    <div className="overflow-hidden rounded-2xl bg-ink-850/80 ring-1 ring-inset ring-white/[0.06]">
      <div className="flex items-start gap-3 px-3.5 py-3">
        <ScanSearch size={17} className="mt-0.5 shrink-0" style={{ color: COLOR }} />
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-[12.5px] text-fog-100">Recherche par le sens</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-fog-500">
              Je retrouve un passage même sans ses mots exacts : « le passage de mon contrat sur la résiliation ». Calculé sur ton PC par Ollama, rien ne part
              en ligne.
            </div>
          </div>

          {status.state === 'no-ollama' && !pull && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" accent={COLOR} onClick={() => void window.compi.installOllama()}>
                Installer Ollama
              </Button>
              <span className="text-[11px] text-fog-700">Le moteur gratuit qui fait tourner les modèles sur ton PC.</span>
            </div>
          )}

          {pull && (
            <div className="space-y-1">
              <Bar value={pull.progress} />
              <div className="flex items-center justify-between gap-2 text-[11px] text-fog-500">
                <span className="truncate">
                  {pull.error ? (
                    <span className="text-led-amber">{pull.error}</span>
                  ) : pull.kind === 'install' ? (
                    `Ollama : ${pull.status}`
                  ) : (
                    `Modèle de recherche : ${pull.status}`
                  )}
                  {pull.progress !== undefined && !pull.error ? ` · ${Math.round(pull.progress * 100)} %` : ''}
                </span>
                {pull.kind === 'pull' && !pull.done && (
                  <Button size="sm" variant="ghost" onClick={() => void act(() => window.compi.disableSemantic(false))}>
                    Annuler
                  </Button>
                )}
              </div>
            </div>
          )}

          {status.state === 'off' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" accent={COLOR} disabled={busy || !hasFolders} onClick={() => void act(() => window.compi.enableSemantic())}>
                {status.modelInstalled ? 'Activer' : `Activer (${MODEL_SIZE} à télécharger)`}
              </Button>
              {!hasFolders && <span className="text-[11px] text-fog-700">Ajoute d’abord un dossier.</span>}
              {status.error && <span className="text-[11px] text-led-amber">{status.error}</span>}
            </div>
          )}

          {status.state === 'indexing' && !pull && (
            <div className="space-y-1">
              <Bar value={pct} />
              <div className="flex items-center gap-2 text-[11px] text-fog-500">
                <LedDots color={COLOR} />
                <span className="truncate">
                  Lecture de tes documents
                  {status.files ? ` · ${status.indexed}/${status.files}` : '…'}
                  {status.current ? ` · ${status.current}` : ''}
                </span>
              </div>
            </div>
          )}

          {status.state === 'ready' && (
            <>
              <div className="text-[11.5px] text-fog-300">
                <span style={{ color: COLOR }}>Prête</span> · {status.files} document{status.files > 1 ? 's' : ''} · {status.passages.toLocaleString('fr-FR')}{' '}
                passages
                {status.updatedAt ? <span className="text-fog-700"> · à jour {timeAgo(status.updatedAt)}</span> : null}
              </div>
              {status.passages > 0 && <TryBox />}
            </>
          )}

          {status.state === 'error' && <div className="text-[11.5px] text-led-amber">{status.error ?? 'La mise à jour a échoué.'}</div>}

          {enabled && !pull && (
            <div className="flex flex-wrap items-center gap-1">
              {(status.state === 'ready' || status.state === 'error') && (
                <Button size="sm" variant="ghost" onClick={() => void act(() => window.compi.reindexSemantic())}>
                  <RefreshCw size={12} /> Mettre à jour
                </Button>
              )}
              {status.state === 'no-model' && !pull && (
                <Button size="sm" variant="primary" accent={COLOR} onClick={() => void act(() => window.compi.enableSemantic())}>
                  Télécharger le modèle ({MODEL_SIZE})
                </Button>
              )}
              <ConfirmButton label="Désactiver" confirm="Sûr ? L’index sera effacé" onConfirm={() => void act(() => window.compi.disableSemantic(false))} />
              <ConfirmButton
                label={`Désactiver et supprimer le modèle (${MODEL_SIZE})`}
                confirm="Sûr ? Tout supprimer"
                onConfirm={() => void act(() => window.compi.disableSemantic(true))}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
