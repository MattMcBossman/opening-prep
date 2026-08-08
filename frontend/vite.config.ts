import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy the API to the Django dev server (see backend/README.md) so the
    // browser only ever talks to one origin. That keeps the session cookie
    // first-party and means the backend needs no CORS configuration at all.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: false,
      },
    },
  },
})
