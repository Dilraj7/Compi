import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = { '@shared': resolve('src/shared') }
/** Version affichée dans l'interface : celle de package.json, jamais écrite à la main. */
const appVersion = JSON.stringify(JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version)

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // Processus annexes de la dictée partout (reconnaissance sherpa-onnx, touche uiohook), lancés par utilityProcess.
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          speechWorker: resolve('src/main/speech/worker.ts'),
          keyWorker: resolve('src/main/dictation/keyWorker.ts')
        }
      }
    }
  },
  preload: {
    resolve: { alias: shared }
  },
  renderer: {
    resolve: {
      alias: { ...shared, '@renderer': resolve('src/renderer/src') }
    },
    define: { __APP_VERSION__: appVersion },
    plugins: [react(), tailwindcss()]
  }
})
