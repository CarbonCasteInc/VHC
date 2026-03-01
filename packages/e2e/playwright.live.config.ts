import { defineConfig, devices, type TestConfig } from '@playwright/test';

const baseUrl = process.env.VH_LIVE_BASE_URL ?? '';
const isLocalTarget = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(baseUrl);
type DevFeedSource = {
  id: string;
  name: string;
  displayName: string;
  rssUrl: string;
  perspectiveTag: string;
  iconKey: string;
  enabled: true;
};

const DEV_FEED_CATALOG: Record<string, DevFeedSource> = {
  'fox-latest': {
    id: 'fox-latest',
    name: 'Fox News',
    displayName: 'Fox News',
    rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml',
    perspectiveTag: 'conservative',
    iconKey: 'fox',
    enabled: true,
  },
  'nypost-politics': {
    id: 'nypost-politics',
    name: 'New York Post Politics',
    displayName: 'New York Post',
    rssUrl: 'https://nypost.com/politics/feed/',
    perspectiveTag: 'conservative',
    iconKey: 'nypost',
    enabled: true,
  },
  'guardian-us': {
    id: 'guardian-us',
    name: 'The Guardian US',
    displayName: 'The Guardian',
    rssUrl: 'https://www.theguardian.com/us-news/rss',
    perspectiveTag: 'progressive',
    iconKey: 'guardian',
    enabled: true,
  },
  'cbs-politics': {
    id: 'cbs-politics',
    name: 'CBS News Politics',
    displayName: 'CBS News',
    rssUrl: 'https://www.cbsnews.com/latest/rss/politics',
    perspectiveTag: 'progressive',
    iconKey: 'cbs',
    enabled: true,
  },
  'bbc-general': {
    id: 'bbc-general',
    name: 'BBC News',
    displayName: 'BBC News',
    rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'bbc',
    enabled: true,
  },
  'bbc-us-canada': {
    id: 'bbc-us-canada',
    name: 'BBC US & Canada',
    displayName: 'BBC',
    rssUrl: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'bbc',
    enabled: true,
  },
};
const DEFAULT_DEV_FEED_SOURCE_IDS = [
  'fox-latest',
  'cbs-politics',
  'bbc-general',
  'bbc-us-canada',
  'guardian-us',
];

// Extract port from local base URL (e.g. http://127.0.0.1:2048/ → 2048).
// Falls back to 5173 (Vite default) if no port is specified.
function extractPort(url: string): number {
  try {
    return Number(new URL(url).port) || 5173;
  } catch {
    return 5173;
  }
}

function resolveDevFeedSourcesJson(): string {
  if (typeof process.env.VITE_NEWS_FEED_SOURCES === 'string' && process.env.VITE_NEWS_FEED_SOURCES.trim().length > 0) {
    return process.env.VITE_NEWS_FEED_SOURCES;
  }

  const requestedIds = (process.env.VH_LIVE_DEV_FEED_SOURCE_IDS ?? DEFAULT_DEV_FEED_SOURCE_IDS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const resolved = requestedIds
    .map((id) => DEV_FEED_CATALOG[id])
    .filter((source): source is DevFeedSource => Boolean(source));
  const fallback = DEFAULT_DEV_FEED_SOURCE_IDS
    .map((id) => DEV_FEED_CATALOG[id])
    .filter((source): source is DevFeedSource => Boolean(source));
  return JSON.stringify(resolved.length > 0 ? resolved : fallback);
}

// When targeting a local server, Playwright manages the dev server lifecycle
// to guarantee that the required VITE_* feature flags are baked into the build.
// This eliminates the recurring "feed-not-ready" failure class caused by a
// manually-started server missing VITE_VH_ANALYSIS_PIPELINE (and its cascading
// VITE_NEWS_RUNTIME_ENABLED / VITE_NEWS_BRIDGE_ENABLED defaults).
const localWebServers: TestConfig['webServer'] = isLocalTarget
  ? [
    {
      command: 'node ../../infra/relay/server.js',
      url: 'http://localhost:7777',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        GUN_PORT: '7777',
      },
    },
    {
      command: [
        'VITE_E2E_MODE=false',
        'VITE_VH_ANALYSIS_PIPELINE=true',
        'VITE_VH_BIAS_TABLE_V2=true',
        'VITE_NEWS_RUNTIME_ENABLED=true',
        'VITE_NEWS_BRIDGE_ENABLED=true',
        `VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS=${process.env.VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS ?? '7500'}`,
        `VITE_VH_GUN_PUT_ACK_TIMEOUT_MS=${process.env.VITE_VH_GUN_PUT_ACK_TIMEOUT_MS ?? '3000'}`,
        `VITE_VH_GUN_READ_TIMEOUT_MS=${process.env.VITE_VH_GUN_READ_TIMEOUT_MS ?? '4000'}`,
        `VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS=${process.env.VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS ?? '8000'}`,
        `VITE_GUN_PEERS='[\"http://localhost:7777/gun\"]'`,
        `pnpm --filter @vh/web-pwa dev --port ${extractPort(baseUrl)} --strictPort`,
      ].join(' '),
      url: baseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_E2E_MODE: 'false',
        VITE_VH_ANALYSIS_PIPELINE: 'true',
        VITE_VH_BIAS_TABLE_V2: 'true',
        VITE_NEWS_RUNTIME_ENABLED: 'true',
        VITE_NEWS_BRIDGE_ENABLED: 'true',
        VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS: process.env.VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS ?? '7500',
        VITE_VH_GUN_PUT_ACK_TIMEOUT_MS: process.env.VITE_VH_GUN_PUT_ACK_TIMEOUT_MS ?? '3000',
        VITE_VH_GUN_READ_TIMEOUT_MS: process.env.VITE_VH_GUN_READ_TIMEOUT_MS ?? '4000',
        VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS: process.env.VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS ?? '8000',
        VITE_GUN_PEERS: '["http://localhost:7777/gun"]',
        VITE_NEWS_FEED_SOURCES: resolveDevFeedSourcesJson(),
      },
    },
  ]
  : undefined;

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
  webServer: localWebServers,
});
