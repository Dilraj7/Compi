import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'
import { createMockApi } from './lib/mockApi'

// Hors d'Electron (aperçu navigateur), on branche une API simulée.
if (!('compi' in window)) {
  ;(window as Window).compi = createMockApi()
  document.body.classList.add('web-preview')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
