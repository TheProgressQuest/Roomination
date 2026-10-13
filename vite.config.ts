/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

function jsForMjs(asset: { names?: string[] }): string {
  return asset.names?.some((n) => n.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]';
}

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
  // Prepare on-demand libraries when the dev server starts. Otherwise Vite discovers each one
  // the first time it's used (3D view, Smart remove, ZIP export) and reloads mid-session.
  optimizeDeps: {
    include: ['three', 'three/examples/jsm/controls/OrbitControls.js', 'three/examples/jsm/utils/BufferGeometryUtils.js', 'onnxruntime-web/wasm', 'fflate'],
  },
  // The AI runtime's loader ships as .mjs; emit it as .js so every static host (GitHub Pages
  // included) serves it with a JavaScript content type.
  build: { rollupOptions: { output: { assetFileNames: jsForMjs } } },
  worker: { format: 'es', rollupOptions: { output: { assetFileNames: jsForMjs } } },
  test: {
    environment: 'node',
    // Browser tests live in e2e/ and run with Playwright, not Vitest.
    include: ['src/**/*.test.ts'],
  },
});
