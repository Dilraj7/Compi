// Aperçu de l'interface dans un navigateur classique (sans Electron),
// avec une API `window.compi` simulée. Pratique pour itérer sur le design.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  root: resolve('src/renderer'),
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version) },
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true }
})
