import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['index.ts'],
      exclude: ['*.test.ts'],
      reporter: ['text'],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100
      }
    }
  }
});
