import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests. Every spec runs twice:
 *   - "dev": against the Vite dev server;
 *   - "prod": against the production build, served from a /Roomination/ sub-path exactly
 *     like GitHub Pages serves it.
 *
 * Browsers: run `npx playwright install chromium` once. To use an already-installed
 * Chromium instead, set PW_CHROMIUM_PATH to its executable.
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: './e2e',
  // The public-site checks have their own config (playwright.live.config.ts).
  testIgnore: '**/live/**',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  // On CI, failures are also reported as GitHub annotations (visible without signing in).
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  // Software WebGL is slow on small CI machines, so 3D tests get extra time there.
  timeout: process.env.CI ? 90_000 : 30_000,
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    // Lets WebGL fall back to software rendering where there's no GPU (as on CI), so the 3D view
    // can be tested there. It doesn't force software rendering on machines that have a GPU.
    launchOptions: { executablePath, args: ['--enable-unsafe-swiftshader'] },
  },
  projects: [
    { name: 'dev', use: { baseURL: 'http://localhost:5173/' } },
    { name: 'prod', use: { baseURL: 'http://localhost:4173/Roomination/' } },
    // Opt-in (CROSS=1): the production build in WebKit (Safari's engine) and Firefox, as
    // installed by `npx playwright install webkit firefox`. Not real Safari or iPhone Safari.
    ...(process.env.CROSS
      ? [
          { name: 'prod-webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 }, launchOptions: {}, baseURL: 'http://localhost:4173/Roomination/' } },
          // Firefox can't emulate a phone's touch screen in Playwright: phone-size tests run in Chromium and WebKit.
          { name: 'prod-firefox', grepInvert: /\b\d{3,4}px\b|phone|iPhone/i, use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 }, launchOptions: {}, baseURL: 'http://localhost:4173/Roomination/' } },
        ]
      : []),
  ],
  webServer: [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173/', reuseExistingServer: true },
    { command: 'npm run build && node e2e/serve-dist.mjs 4173', url: 'http://localhost:4173/Roomination/', reuseExistingServer: false, timeout: 120_000 },
  ],
});
