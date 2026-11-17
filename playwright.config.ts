// End-to-end tests of the interface against demo mode (fictitious data, no real integration).
// Local: npm run test:e2e   (CHROME_PATH=/path/to/chrome to use an installed Chrome)
import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 9997);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    ...(process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } } : {}),
  },
  webServer: {
    command: 'node scripts/demo.mjs --en',
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: { AGENT_BOARD_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
