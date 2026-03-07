import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    watch: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'text-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        '**/*.test.*',
        '**/*.spec.*',
        '**/*.d.ts',
        'src/index.ts',
        'src/modelProvider.ts',
        'src/stageState.ts',
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
});
