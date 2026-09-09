import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:8080',
    viewport: { width: 380, height: 800 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH },
  },
  webServer: {
    command: 'node scripts/dev-server.mjs --no-watch',
    url: 'http://127.0.0.1:8080',
    reuseExistingServer: false,
  },
});
