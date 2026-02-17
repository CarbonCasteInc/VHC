import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@vh/crypto': resolve(__dirname, '../../packages/crypto/src/index.ts'),
      '@vh/crypto/primitives': resolve(__dirname, '../../packages/crypto/src/primitives.ts'),
      '@vh/crypto/provider': resolve(__dirname, '../../packages/crypto/src/provider.ts'),
      '@vh/data-model': resolve(__dirname, '../../packages/data-model/src/index.ts'),
      '@vh/ai-engine': resolve(__dirname, '../../packages/ai-engine/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/*.d.ts', 'src/index.ts'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
