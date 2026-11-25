import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // REST and the WebSocket both go to FastAPI, so the browser sees one origin.
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', ws: true, changeOrigin: true },
    },
  },
})
