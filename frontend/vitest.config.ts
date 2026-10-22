import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./__tests__/_setup/setup.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      // Ratchet floor (audit M30): ~1pt below the measured baseline on
      // 2026-10-22 (41.0 / 39.5 / 42.3 / 42.5 over all of src/). Raise as
      // coverage improves; never lower it to make a PR pass.
      thresholds: {
        statements: 40,
        branches: 38,
        functions: 41,
        lines: 41,
      },
    },
  },
});
