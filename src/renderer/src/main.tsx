import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { createMockApi } from './lib/mockApi'

// Hors d'Electron (aperçu navigateur), on branche une API simulée.
if (!('compi' in window)) {
  ;(window as Window).compi = createMockApi()
  document.body.classList.add('web-preview')
}

// La transcription flottante d'un appel est une autre fenêtre, avec sa propre page.
const TranscriptApp = lazy(() => import('./floating/TranscriptApp').then((m) => ({ default: m.TranscriptApp })))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {location.hash === '#transcript' ? (
      <Suspense fallback={null}>
        <TranscriptApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
)
