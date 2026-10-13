import { defineConfig, devices } from '@playwright/test';

/**
 * Checks the PUBLIC website after a deploy (no local servers). Run with:
 *   LIVE_URL=https://theprogressquest.github.io/Roomination/ EXPECTED_VERSION=<commit> \
 *     npx playwright test -c playwright.live.config.ts
 */
export default defineConfig({
  testDir: './e2e/live',
  timeout: 240_000,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ['--enable-unsafe-swiftshader'] },
  },
});
