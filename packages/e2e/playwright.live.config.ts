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
  'texastribune-main': {
    id: 'texastribune-main',
    name: 'Texas Tribune',
    displayName: 'Texas Tribune',
    rssUrl: 'https://feeds.texastribune.org/feeds/main/',
    perspectiveTag: 'statehouse',
    iconKey: 'texastribune',
    enabled: true,
  },
  'mississippitoday-main': {
    id: 'mississippitoday-main',
    name: 'Mississippi Today',
    displayName: 'Mississippi Today',
    rssUrl: 'https://mississippitoday.org/feed',
    perspectiveTag: 'statehouse',
    iconKey: 'mississippitoday',
    enabled: true,
  },
  'nevadaindependent-main': {
    id: 'nevadaindependent-main',
    name: 'Nevada Independent',
    displayName: 'Nevada Independent',
    rssUrl: 'https://thenevadaindependent.com/feed/',
    perspectiveTag: 'statehouse',
    iconKey: 'nevadaindependent',
    enabled: true,
  },
  'kffhealthnews-original': {
    id: 'kffhealthnews-original',
    name: 'KFF Health News',
    displayName: 'KFF Health News',
    rssUrl: 'https://kffhealthnews.org/topics/syndicate/feed/aprss',
    perspectiveTag: 'health-policy',
    iconKey: 'kff',
    enabled: true,
  },
  'scotusblog-main': {
    id: 'scotusblog-main',
    name: 'SCOTUSblog',
    displayName: 'SCOTUSblog',
    rssUrl: 'https://feeds.feedburner.com/scotusblog/pFXs',
    perspectiveTag: 'courts-legal',
    iconKey: 'scotusblog',
    enabled: true,
  },
  'canarymedia-main': {
    id: 'canarymedia-main',
    name: 'Canary Media',
    displayName: 'Canary Media',
    rssUrl: 'https://www.canarymedia.com/rss.rss',
    perspectiveTag: 'climate-policy',
    iconKey: 'canarymedia',
    enabled: true,
  },
  'sky-world': {
    id: 'sky-world',
    name: 'Sky News World',
    displayName: 'Sky News',
    rssUrl: 'https://feeds.skynews.com/feeds/rss/world.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'sky',
    enabled: true,
  },
  'aljazeera-all': {
    id: 'aljazeera-all',
    name: 'Al Jazeera',
    displayName: 'Al Jazeera',
    rssUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    perspectiveTag: 'international-wire',
    iconKey: 'aljazeera',
    enabled: true,
  },
  'globalnews-politics': {
    id: 'globalnews-politics',
    name: 'Global News Politics',
    displayName: 'Global News',
    rssUrl: 'https://globalnews.ca/politics/feed/',
    perspectiveTag: 'broadcast-news',
    iconKey: 'globalnews',
    enabled: true,
  },
  'channelnewsasia-latest': {
    id: 'channelnewsasia-latest',
    name: 'Channel NewsAsia Latest',
    displayName: 'Channel NewsAsia',
    rssUrl: 'https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml',
    perspectiveTag: 'international-wire',
    iconKey: 'cna',
    enabled: true,
  },
  'dw-top': {
    id: 'dw-top',
    name: 'Deutsche Welle Top Stories',
    displayName: 'DW',
    rssUrl: 'https://rss.dw.com/rdf/rss-en-top',
    perspectiveTag: 'international-wire',
    iconKey: 'dw',
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
        'VITE_NEWS_RUNTIME_ENABLED=true',
        'VITE_NEWS_BRIDGE_ENABLED=true',
        `VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS=${process.env.VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS ?? '7500'}`,
        `VITE_VH_GUN_PUT_ACK_TIMEOUT_MS=${process.env.VITE_VH_GUN_PUT_ACK_TIMEOUT_MS ?? '3000'}`,
        `VITE_VH_GUN_READ_TIMEOUT_MS=${process.env.VITE_VH_GUN_READ_TIMEOUT_MS ?? '4000'}`,
        `VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS=${process.env.VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS ?? '8000'}`,
        `VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS=${process.env.VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS ?? '90000'}`,
        `VITE_GUN_PEERS='[\"http://localhost:7777/gun\"]'`,
        `pnpm --filter @vh/web-pwa dev --port ${extractPort(baseUrl)} --strictPort`,
      ].join(' '),
      url: baseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        VITE_E2E_MODE: 'false',
        VITE_VH_ANALYSIS_PIPELINE: 'true',
        VITE_NEWS_RUNTIME_ENABLED: 'true',
        VITE_NEWS_BRIDGE_ENABLED: 'true',
        VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS: process.env.VITE_VH_GUN_WAIT_FOR_REMOTE_TIMEOUT_MS ?? '7500',
        VITE_VH_GUN_PUT_ACK_TIMEOUT_MS: process.env.VITE_VH_GUN_PUT_ACK_TIMEOUT_MS ?? '3000',
        VITE_VH_GUN_READ_TIMEOUT_MS: process.env.VITE_VH_GUN_READ_TIMEOUT_MS ?? '4000',
        VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS: process.env.VITE_VH_ANALYSIS_MESH_READ_BUDGET_MS ?? '8000',
        VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS: process.env.VITE_NEWS_BRIDGE_REFRESH_TIMEOUT_MS ?? '90000',
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
