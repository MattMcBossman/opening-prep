import { defineConfig, devices } from '@playwright/test'

const previewPort = process.env.OPENING_PREP_E2E_PORT ?? '4173'
const previewUrl = `http://127.0.0.1:${previewPort}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: previewUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'android-chrome',
      testMatch: /mobile-layout\.spec\.ts/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone-safari-layout',
      testMatch: /mobile-layout\.spec\.ts/,
      // Safari-sized/touch-emulated layout coverage runs on the installed
      // Chromium binary in local/CI environments; actual WebKit remains part
      // of the real-device smoke pass.
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: `${process.execPath} node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${previewPort}`,
    url: previewUrl,
    reuseExistingServer: false,
  },
})
