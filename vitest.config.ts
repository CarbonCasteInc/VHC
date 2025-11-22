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
      include: [
        'packages/crypto/src/**/*.{ts,tsx}',
        'packages/gun-client/src/**/*.{ts,tsx}',
        'packages/data-model/src/**/*.{ts,tsx}',
        'packages/ai-engine/src/**/*.{ts,tsx}',
        'apps/web-pwa/src/store/**/*.{ts,tsx}'
      ],
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        '**/*.d.ts',
        'packages/ai-engine/src/index.ts',
        'packages/ai-engine/src/useAI.ts',
        'packages/gun-client/src/index.ts',
        'packages/gun-client/src/storage/adapter.ts',
        'packages/gun-client/src/storage/types.ts',
        'packages/gun-client/src/types.ts',
        'packages/data-model/src/index.ts'
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80
      }
    }
  }
});
