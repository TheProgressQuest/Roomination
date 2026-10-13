/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

/** The commit being built (CI provides it; locally ask git; otherwise "dev"). */
function buildVersion(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  // Relative asset paths so the build works from any GitHub Pages sub-path.
  base: './',
  // Prepare Three.js when the dev server starts. Otherwise Vite discovers it the first time
  // the 3D view opens and reloads the page mid-session.
  optimizeDeps: {
    include: ['three', 'three/examples/jsm/controls/OrbitControls.js', 'three/examples/jsm/utils/BufferGeometryUtils.js'],
  },
  test: {
    environment: 'node',
    // Browser tests live in e2e/ and run with Playwright, not Vitest.
    include: ['src/**/*.test.ts'],
  },
});
