import { defineConfig, devices } from '@playwright/test';

const baseUrl = process.env.VH_LIVE_BASE_URL ?? '';
const isLocalTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(baseUrl);

// Extract port from local base URL (e.g. http://127.0.0.1:2048/ → 2048).
// Falls back to 5173 (Vite default) if no port is specified.
function extractPort(url: string): number {
  try {
    return Number(new URL(url).port) || 5173;
  } catch {
    return 5173;
  }
}

// When targeting a local server, Playwright manages the dev server lifecycle
// to guarantee that the required VITE_* feature flags are baked into the build.
// This eliminates the recurring "feed-not-ready" failure class caused by a
// manually-started server missing VITE_VH_ANALYSIS_PIPELINE (and its cascading
// VITE_NEWS_RUNTIME_ENABLED / VITE_NEWS_BRIDGE_ENABLED defaults).
const localWebServer = isLocalTarget
  ? {
    webServer: {
      command: [
        'VITE_VH_ANALYSIS_PIPELINE=true',
        'VITE_VH_BIAS_TABLE_V2=true',
        'VITE_NEWS_RUNTIME_ENABLED=true',
        'VITE_NEWS_BRIDGE_ENABLED=true',
        `pnpm --filter @vh/web-pwa dev --port ${extractPort(baseUrl)} --strictPort`,
      ].join(' '),
      url: baseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_VH_ANALYSIS_PIPELINE: 'true',
        VITE_VH_BIAS_TABLE_V2: 'true',
        VITE_NEWS_RUNTIME_ENABLED: 'true',
        VITE_NEWS_BRIDGE_ENABLED: 'true',
      },
    },
  }
  : {};

export default defineConfig({
  testDir: './src/live',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  ...localWebServer,
});
