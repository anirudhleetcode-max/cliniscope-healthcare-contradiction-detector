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
  webServer: process.env.BASE_URL ? undefined : [
    {
      command: 'npm run build && npx vite preview --port 4173 --strictPort',
      url: 'http://localhost:4173/',
      reuseExistingServer: true,
      timeout: 120000,
    },
    {
      // Real CLINISCOPE API server with a throw-away database for the shared-workspace tests.
      command: 'rm -rf tmp/e2e-api && npx tsx server/index.ts',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        PORT: '8787', HOST: '127.0.0.1', CLINISCOPE_DATA_DIR: 'tmp/e2e-api', CLINISCOPE_ALLOW_REGISTRATION: 'true',
        CLINISCOPE_ALLOWED_ORIGINS: 'http://localhost:4173', ANTHROPIC_API_KEY: '',
      },
    },
    // TEST FIXTURE: local fake of the Messages API + a second API server configured to use it (AI pipeline e2e).
    { command: 'node tests/e2e/fake-anthropic.mjs', port: 8788, reuseExistingServer: false, timeout: 30000 },
    {
      command: 'rm -rf tmp/e2e-api-ai && npx tsx server/index.ts',
      url: 'http://localhost:8789/api/health',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        PORT: '8789', HOST: '127.0.0.1', CLINISCOPE_DATA_DIR: 'tmp/e2e-api-ai', CLINISCOPE_ALLOW_REGISTRATION: 'true',
        CLINISCOPE_ALLOWED_ORIGINS: 'http://localhost:4173', ANTHROPIC_API_KEY: 'sk-fixture-not-real',
        CLINISCOPE_ANTHROPIC_BASE_URL: 'http://127.0.0.1:8788', CLINISCOPE_AI_FALLBACKS: 'false',
      },
    },
  ],
});
