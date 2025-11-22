import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}',
      'apps/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}'
    ],
    exclude: ['packages/e2e/**', '**/node_modules/**', '**/dist/**'],
    watch: false
  }
});
