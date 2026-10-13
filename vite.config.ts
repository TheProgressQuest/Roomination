/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths so the build works from any GitHub Pages sub-path.
  base: './',
  test: {
    environment: 'node',
  },
});
