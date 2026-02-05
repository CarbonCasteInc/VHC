import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@vh/crypto': resolve(__dirname, 'packages/crypto/src/index.ts'),
      '@vh/crypto/primitives': resolve(__dirname, 'packages/crypto/src/primitives.ts'),
      '@vh/crypto/provider': resolve(__dirname, 'packages/crypto/src/provider.ts'),
      '@vh/data-model': resolve(__dirname, 'packages/data-model/src/index.ts'),
      '@vh/ai-engine': resolve(__dirname, 'packages/ai-engine/src/index.ts'),
      '@vh/identity-vault': resolve(__dirname, 'packages/identity-vault/src/index.ts')
    }
  },
  test: {
    include: ['packages/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}', 'apps/**/src/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    exclude: ['packages/e2e/**', '**/node_modules/**', '**/dist/**'],
    watch: false,
    // Note: The project requires Node 20 LTS (see .nvmrc and package.json engines)
    // Node 23+ has known issues with tinypool worker termination that cause test crashes
    // Run with `pnpm vitest run --no-file-parallelism` if experiencing crashes on Node 23+
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'text-summary'],
      include: [
        'packages/*/src/**/*.{ts,tsx}',
        'apps/**/src/**/*.{ts,tsx}'
      ],
      exclude: [
        // Build artifacts
        '**/dist/**',
        '**/node_modules/**',

        // Test files
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.d.ts',

        // E2E package (tested via Playwright)
        'packages/e2e/**',

        // --- Bootstrap/Entry Points ---
        // Bootstrap wiring; validated via E2E app load.
        'apps/web-pwa/src/main.tsx',
        'apps/web-pwa/src/App.tsx',

        // --- Route Composition ---
        // Pure composition, covered by E2E navigation flows.
        'apps/web-pwa/src/routes/**/*.tsx',

        // --- React UI Components ---
        // Presentational; exercised by 9 passing E2E tests. RTL planned for Sprint 4.
        'apps/web-pwa/src/components/**/*.tsx',

        // --- Mock Store Implementations ---
        // E2E-only mocks.
        'apps/web-pwa/src/store/**/*.mock.ts',
        'apps/web-pwa/src/store/**/mockStore.ts',
        // Dual-mode (real + E2E mock) stores — re-export wrappers.
        'apps/web-pwa/src/store/hermesMessaging.ts',
        'apps/web-pwa/src/store/hermesForum.ts',
        'apps/web-pwa/src/store/xpLedger.ts',
        // Modularized store implementations — core logic is covered by hermesMessaging.test.ts and hermesForum.test.ts
        // E2E mode code paths are exercised in E2E tests; some edge cases (error handling, hydration retries)
        // are covered functionally via integration tests.
        'apps/web-pwa/src/store/chat/**/*.ts',
        'apps/web-pwa/src/store/forum/**/*.ts',

        // --- Store Index Bootstrap ---
        // Client hydration/bootstrap; validated via E2E.
        'apps/web-pwa/src/store/index.ts',

        // --- Utility Wrappers ---
        // Thin wrapper around markdown/rendering; XSS guarded in E2E.
        'apps/web-pwa/src/utils/markdown.ts',

        // --- React Hooks (stateful wiring validated via E2E) ---
        'apps/web-pwa/src/hooks/useIdentity.ts',
        'apps/web-pwa/src/hooks/useRegion.ts',
        'apps/web-pwa/src/hooks/useGovernance.ts',
        'apps/web-pwa/src/hooks/useFeedStore.ts',
        'apps/web-pwa/src/hooks/useSentimentState.ts',

        // --- Gun-Client Adapters & Storage ---
        // Environment-specific storage implementations.
        'packages/gun-client/src/storage/**',
        'packages/gun-client/src/types.ts',
        'packages/gun-client/src/hermesCrypto.ts',
        'packages/gun-client/src/topology.ts',
        'packages/gun-client/src/auth.ts',
        'packages/gun-client/src/sync/barrier.ts',
        // Gun chain wrapper — defensive fallbacks (??'unknown') validated via E2E
        'packages/gun-client/src/chain.ts',
        'packages/gun-client/src/hermesAdapters.ts',

        // --- AI-Engine Unused Modules (Sprint 3) ---
        // Not wired this sprint; to be covered when activated.
        'packages/ai-engine/src/index.ts',
        'packages/ai-engine/src/schema.ts',
        'packages/ai-engine/src/useAI.ts',
        'packages/ai-engine/src/validation.ts',
        'packages/ai-engine/src/worker.ts',
        'packages/ai-engine/src/cache.ts',
        'packages/ai-engine/src/prompts.ts',

        // --- Re-export Index Files ---
        'packages/*/src/index.ts'
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
