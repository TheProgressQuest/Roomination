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
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  // On CI, failures are also reported as GitHub annotations (visible without signing in).
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    // Software WebGL, so the 3D view can be tested on machines (and CI) without a GPU.
    launchOptions: { executablePath, args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
  },
  projects: [
    { name: 'dev', use: { baseURL: 'http://localhost:5173/' } },
    { name: 'prod', use: { baseURL: 'http://localhost:4173/Roomination/' } },
  ],
  webServer: [
    { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173/', reuseExistingServer: true },
    { command: 'npm run build && node e2e/serve-dist.mjs 4173', url: 'http://localhost:4173/Roomination/', reuseExistingServer: false, timeout: 120_000 },
  ],
});
