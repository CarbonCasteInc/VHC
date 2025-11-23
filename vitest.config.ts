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
    include: ['packages/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}', 'apps/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: ['packages/e2e/**', '**/node_modules/**', '**/dist/**'],
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/data-model/src/**/*.{ts,tsx}',
        'packages/crdt/src/**/*.{ts,tsx}',
        'packages/crypto/src/**/*.{ts,tsx}',
        'packages/types/src/**/*.{ts,tsx}',
        'packages/ai-engine/src/analysis.ts',
        'packages/ai-engine/src/decay.ts',
        'apps/web-pwa/src/hooks/useWallet.ts',
        'apps/web-pwa/src/routes/WalletPanel.tsx',
        'apps/web-pwa/src/routes/AnalysisFeed.tsx'
      ],
      exclude: ['**/dist/**', '**/node_modules/**', 'packages/e2e/**'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    }
  }
});
