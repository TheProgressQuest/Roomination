/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
