import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:4173/';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined },
    trace: 'off',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: process.env.BASE_URL ? undefined : {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
