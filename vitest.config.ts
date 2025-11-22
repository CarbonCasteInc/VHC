import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@vh/crypto': resolve(__dirname, 'packages/crypto/src/index.ts'),
      '@vh/crypto/primitives': resolve(__dirname, 'packages/crypto/src/primitives.ts'),
      '@vh/crypto/provider': resolve(__dirname, 'packages/crypto/src/provider.ts')
    }
  },
  test: {
    include: [
      'packages/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}',
      'apps/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}'
    ],
    exclude: ['packages/e2e/**', '**/node_modules/**', '**/dist/**'],
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['packages/**/src/**/*.{ts,tsx,js,jsx}', 'apps/**/src/**/*.{ts,tsx,js,jsx}'],
      exclude: ['**/dist/**', '**/node_modules/**']
    }
  }
});
