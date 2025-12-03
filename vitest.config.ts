import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@vh/crypto': resolve(__dirname, 'packages/crypto/src/index.ts'),
      '@vh/crypto/primitives': resolve(__dirname, 'packages/crypto/src/primitives.ts'),
      '@vh/crypto/provider': resolve(__dirname, 'packages/crypto/src/provider.ts'),
      '@vh/data-model': resolve(__dirname, 'packages/data-model/src/index.ts')
    }
  },
  test: {
    include: ['packages/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}', 'apps/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: ['packages/e2e/**', '**/node_modules/**', '**/dist/**'],
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/**/src/**/*.{ts,tsx}'
      ],
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        'packages/e2e/**',
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.d.ts'
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    }
  }
});
