import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/**', 'src/index.ts'],
      // Ratchet floor (audit M30): set ~1pt below the measured baseline on
      // 2026-10-22 (37.5 / 29.0 / 38.5 / 39.1). Raise as gmail.service.ts gets
      // service-level tests; never lower it to make a PR pass.
      thresholds: {
        statements: 36,
        branches: 28,
        functions: 37,
        lines: 38,
      },
    },
    setupFiles: ['__tests__/setup.ts'],
  },
});
