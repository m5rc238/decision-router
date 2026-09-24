import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { liveMiddleware } from './server/live.ts'

// Dev-only middleware proxying /api/live/* to the local OpenCode server
// (Big Pickle) and the Jev Decision API. Only present in `vite dev`.
function liveDev(): Plugin {
  return {
    name: 'decision-router-live',
    configureServer(server) {
      server.middlewares.use(liveMiddleware())
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), liveDev()],
})