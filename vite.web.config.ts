// Aperçu de l'interface dans un navigateur classique (sans Electron),
// avec une API `window.compi` simulée. Pratique pour itérer sur le design.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve('src/renderer'),
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true }
})
