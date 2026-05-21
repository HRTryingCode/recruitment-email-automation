import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./__tests__/_setup/setup.ts'],
    globals: true,
    coverage: { reporter: ['text', 'html'] },
  },
});
