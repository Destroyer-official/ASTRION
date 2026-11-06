import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    proxy: {
      '/api/horizons': {
        target: 'https://ssd.jpl.nasa.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/horizons/, '/api/horizons.api'),
      },
    },
  },
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: {
        // Three.js is the bulk of the shipped bytes and changes far less often
        // than the simulation code, so it belongs in its own cacheable chunk.
        // Rolldown requires the function form of manualChunks.
        manualChunks(id: string) {
          if (id.includes('node_modules/three')) return 'three';
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      // Ratchet, not aspiration: every floor below is set a few points under the
      // coverage actually measured on 2026-11-06 (90 files / 589 tests), so a
      // dropped test or newly dead branch fails CI while normal edits do not.
      // No per-directory floor is set for render/ui/main/workers: that code is
      // exercised by the real-browser audit (`npm run audit:ui`), not by Vitest.
      thresholds: {
        statements: 60,
        lines: 60,
        branches: 43,
        functions: 61,
        'src/physics/**': { statements: 90, branches: 70, functions: 90 },
        'src/sim/**': { statements: 82, branches: 70, functions: 86 },
        'src/frames/**': { statements: 98, branches: 95, functions: 98 },
        'src/data/**': { statements: 95, functions: 95 },
        'src/universe/**': { statements: 88, branches: 82, functions: 90 },
        'src/observability/**': { statements: 84, branches: 65, functions: 90 },
      },
    },
  },
});
