import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Tailscale Serve terminates HTTPS and proxies to this loopback listener.
    // Vite rejects unknown Host headers by default, so permit only Tailscale's
    // managed DNS suffix in addition to its normal localhost allowances.
    host: '127.0.0.1',
    allowedHosts: ['.ts.net'],
    // Proxy the API to the Django dev server (see backend/README.md) so the
    // browser only ever talks to one origin. That keeps the session cookie
    // first-party and means the backend needs no CORS configuration at all.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
      },
    },
  },
})
