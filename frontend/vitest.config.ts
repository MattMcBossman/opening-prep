import { defineConfig } from 'vitest/config'

// Separate from vite.config.ts: keeps the app build config free of test-only
// types/globals while still sharing the same resolver/plugins setup style.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
