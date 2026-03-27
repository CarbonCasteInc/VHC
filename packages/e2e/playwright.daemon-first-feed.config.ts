import * as path from 'node:path';
import { defineConfig, devices, type TestConfig } from '@playwright/test';
import { buildPortClearShellCommand } from './src/live/daemonFirstFeedProcesses';

process.env.VH_DAEMON_FEED_RUN_ID ??= `${Date.now()}-${process.pid}`;

function stablePort(base: number, span: number, seed: string): number {
  const offset = [...seed].reduce((total, char) => total + char.charCodeAt(0), 0) % span;
  return base + offset;
}

function wrapLoggedWebServerCommand(name: string, script: string): string {
  const logPath = path.resolve(
    process.cwd(),
    `../../.tmp/e2e-daemon-feed/${runId}/webserver-${name}.log`,
  );
  return [
    `mkdir -p ${JSON.stringify(path.dirname(logPath))}`,
    `: > ${JSON.stringify(logPath)}`,
    `{ echo "[vh:e2e-webserver] starting ${name}"; ${script}; status=$?; echo "[vh:e2e-webserver] exit ${name} status=$status"; exit $status; } >> ${JSON.stringify(logPath)} 2>&1`,
  ].join(' && ');
}

const runId = process.env.VH_DAEMON_FEED_RUN_ID;
process.env.VH_DAEMON_FEED_GUN_PORT ??= String(stablePort(8700, 200, runId));
process.env.VH_DAEMON_FEED_STORYCLUSTER_PORT ??= String(stablePort(4300, 200, runId));
process.env.VH_DAEMON_FEED_FIXTURE_PORT ??= String(stablePort(8900, 100, runId));
process.env.VH_DAEMON_FEED_QDRANT_PORT ??= String(stablePort(6300, 100, runId));
process.env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT ??= String(stablePort(9100, 100, runId));
process.env.VH_LIVE_BASE_URL ??= `http://127.0.0.1:${stablePort(2100, 200, runId)}/`;

const gunPort = Number(process.env.VH_DAEMON_FEED_GUN_PORT);
const baseUrl = process.env.VH_LIVE_BASE_URL;
const basePort = extractPort(baseUrl);
const gunPeerUrl = `http://localhost:${gunPort}/gun`;
const fixtureFeedPort = Number(process.env.VH_DAEMON_FEED_FIXTURE_PORT);
const fixtureFeedBaseUrl = `http://127.0.0.1:${fixtureFeedPort}`;
const qdrantPort = Number(process.env.VH_DAEMON_FEED_QDRANT_PORT);
const qdrantBaseUrl = `http://127.0.0.1:${qdrantPort}`;
const analysisStubPort = Number(process.env.VH_DAEMON_FEED_ANALYSIS_STUB_PORT);
const analysisStubBaseUrl = `http://127.0.0.1:${analysisStubPort}`;
const useFixtureFeed = process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true';
const useFixtureAnalysisStub = useFixtureFeed && process.env.VH_DAEMON_FEED_USE_ANALYSIS_STUB !== 'false';
const storyclusterVectorBackend = process.env.VH_STORYCLUSTER_VECTOR_BACKEND?.trim() || 'qdrant';
process.env.VH_STORYCLUSTER_USE_TEST_PROVIDER ??= useFixtureFeed ? 'true' : 'false';
process.env.VH_STORYCLUSTER_VECTOR_BACKEND ??= storyclusterVectorBackend;
const relayRootDir = path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId, 'relay');
const relayDataPath = path.join(relayRootDir, 'data');
const relayServerPath = path.resolve(process.cwd(), '../../infra/relay/server.js');
const fixtureServerPath = path.resolve(process.cwd(), './src/live/daemon-feed-fixtures.mjs');
const qdrantServerPath = path.resolve(process.cwd(), './src/live/daemon-feed-qdrant-stub.mjs');
const analysisStubServerPath = path.resolve(process.cwd(), './src/live/daemon-feed-analysis-stub.mjs');
const cleanupServerPath = path.resolve(process.cwd(), './src/live/daemon-feed-process-cleanup.mjs');

if (storyclusterVectorBackend === 'qdrant') {
  process.env.VH_STORYCLUSTER_QDRANT_URL ??= qdrantBaseUrl;
  process.env.QDRANT_URL ??= qdrantBaseUrl;
}

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
  'yahoo-world': {
    id: 'yahoo-world',
    name: 'Yahoo News World',
    displayName: 'Yahoo News',
    rssUrl: 'https://news.yahoo.com/rss/world',
    perspectiveTag: 'international-wire',
    iconKey: 'yahoo',
    enabled: true,
  },
  'npr-news': {
    id: 'npr-news',
    name: 'NPR News',
    displayName: 'NPR',
    rssUrl: 'https://feeds.npr.org/1001/rss.xml',
    perspectiveTag: 'public-radio',
    iconKey: 'npr',
    enabled: true,
  },
  'npr-politics': {
    id: 'npr-politics',
    name: 'NPR Politics',
    displayName: 'NPR',
    rssUrl: 'https://feeds.npr.org/1014/rss.xml',
    perspectiveTag: 'public-radio',
    iconKey: 'npr',
    enabled: true,
  },
  'abc-politics': {
    id: 'abc-politics',
    name: 'ABC News Politics',
    displayName: 'ABC News',
    rssUrl: 'https://abcnews.go.com/abcnews/politicsheadlines',
    perspectiveTag: 'broadcast-news',
    iconKey: 'abc',
    enabled: true,
  },
  'nbc-politics': {
    id: 'nbc-politics',
    name: 'NBC News Politics',
    displayName: 'NBC News',
    rssUrl: 'https://feeds.nbcnews.com/feeds/nbcpolitics',
    perspectiveTag: 'broadcast-news',
    iconKey: 'nbc',
    enabled: true,
  },
  'pbs-politics': {
    id: 'pbs-politics',
    name: 'PBS News Politics',
    displayName: 'PBS News',
    rssUrl: 'https://www.pbs.org/newshour/feeds/rss/politics',
    perspectiveTag: 'public-broadcast',
    iconKey: 'pbs',
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

const DEFAULT_SOURCE_IDS = [
  'guardian-us',
  'cbs-politics',
  'bbc-us-canada',
  'nypost-politics',
  'fox-latest',
];

function extractPort(url: string): number {
  try {
    return Number(new URL(url).port) || 2148;
  } catch {
    return 2148;
  }
}

function resolveDevFeedSourcesJson(): string {
  const requestedIds = (process.env.VH_LIVE_DEV_FEED_SOURCE_IDS ?? DEFAULT_SOURCE_IDS.join(','))
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const resolved = requestedIds
    .map((id) => DEV_FEED_CATALOG[id])
    .filter((source): source is DevFeedSource => Boolean(source));
  const fallback = DEFAULT_SOURCE_IDS
    .map((id) => DEV_FEED_CATALOG[id])
    .filter((source): source is DevFeedSource => Boolean(source));
  return JSON.stringify(resolved.length > 0 ? resolved : fallback);
}

function resolveAnalysisRelayEnv(): Record<string, string> {
  if (useFixtureAnalysisStub) {
    return {
      ANALYSIS_RELAY_UPSTREAM_URL: `${analysisStubBaseUrl}/v1/chat/completions`,
      ANALYSIS_RELAY_API_KEY: 'fixture-analysis-stub-key',
      ANALYSIS_RELAY_MODEL: 'fixture-analysis-stub',
      ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS: '15000',
    };
  }

  const upstreamUrl =
    process.env.ANALYSIS_RELAY_UPSTREAM_URL?.trim()
    || (process.env.OPENAI_API_KEY?.trim() ? 'https://api.openai.com/v1/chat/completions' : '');
  const apiKey =
    process.env.ANALYSIS_RELAY_API_KEY?.trim()
    || process.env.OPENAI_API_KEY?.trim()
    || '';

  if (!upstreamUrl || !apiKey) {
    return {};
  }

  return {
    ANALYSIS_RELAY_UPSTREAM_URL: upstreamUrl,
    ANALYSIS_RELAY_API_KEY: apiKey,
    ...(process.env.ANALYSIS_RELAY_MODEL?.trim()
      ? { ANALYSIS_RELAY_MODEL: process.env.ANALYSIS_RELAY_MODEL.trim() }
      : {}),
    ...(process.env.ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS?.trim()
      ? {
          ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS:
            process.env.ANALYSIS_RELAY_UPSTREAM_TIMEOUT_MS.trim(),
        }
      : {}),
  };
}

const localWebServers: TestConfig['webServer'] = [
  ...(storyclusterVectorBackend === 'qdrant'
    ? [{
        command: wrapLoggedWebServerCommand('qdrant', [
          buildPortClearShellCommand(qdrantPort),
          `VH_DAEMON_FEED_QDRANT_PORT=${qdrantPort} node ${JSON.stringify(qdrantServerPath)}`,
        ].join(' && ')),
        url: `${qdrantBaseUrl}/readyz`,
        reuseExistingServer: false,
        timeout: 30_000,
      }]
    : []),
  ...(useFixtureFeed
    ? [{
        command: wrapLoggedWebServerCommand('fixture-feed', [
          buildPortClearShellCommand(fixtureFeedPort),
          `VH_DAEMON_FEED_FIXTURE_PORT=${fixtureFeedPort} node ${JSON.stringify(fixtureServerPath)}`,
        ].join(' && ')),
        url: `${fixtureFeedBaseUrl}/health`,
        reuseExistingServer: false,
        timeout: 30_000,
      }]
    : []),
  ...(useFixtureAnalysisStub
    ? [{
        command: wrapLoggedWebServerCommand('analysis-stub', [
          buildPortClearShellCommand(analysisStubPort),
          `VH_DAEMON_FEED_ANALYSIS_STUB_PORT=${analysisStubPort} node ${JSON.stringify(analysisStubServerPath)}`,
        ].join(' && ')),
        url: `${analysisStubBaseUrl}/health`,
        reuseExistingServer: false,
        timeout: 30_000,
      }]
    : []),
  {
    command: wrapLoggedWebServerCommand('relay', [
      buildPortClearShellCommand(gunPort),
      `rm -rf ${JSON.stringify(relayRootDir)}`,
      `mkdir -p ${JSON.stringify(relayRootDir)}`,
      `node ${JSON.stringify(cleanupServerPath)} --repo-root ${JSON.stringify(path.resolve(process.cwd(), '../../'))} --gun-peer-url ${JSON.stringify(gunPeerUrl)} || true`,
      `GUN_HOST=127.0.0.1 GUN_PORT=${gunPort} GUN_FILE=${JSON.stringify(relayDataPath)} node ${JSON.stringify(relayServerPath)}`,
    ].join(' && ')),
    url: `http://127.0.0.1:${gunPort}`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  {
    command: wrapLoggedWebServerCommand('web-pwa', [
      buildPortClearShellCommand(basePort),
      `pnpm --filter @vh/web-pwa dev --port ${basePort} --strictPort`,
    ].join(' && ')),
    url: baseUrl,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_E2E_MODE: 'false',
      VITE_VH_ANALYSIS_PIPELINE: 'true',
      VITE_VH_ANALYSIS_SKIP_ARTICLE_TEXT:
        useFixtureAnalysisStub ? 'true' : 'false',
      VITE_VH_ANALYSIS_PENDING_WAIT_WINDOW_MS:
        useFixtureAnalysisStub ? '1500' : process.env.VITE_VH_ANALYSIS_PENDING_WAIT_WINDOW_MS,
      VITE_NEWS_BRIDGE_ENABLED: 'true',
      VITE_NEWS_RUNTIME_ENABLED: 'false',
      VITE_NEWS_RUNTIME_ROLE: 'consumer',
      VH_DAEMON_FEED_USE_FIXTURE_FEED: useFixtureFeed ? 'true' : 'false',
      VH_DAEMON_FEED_FIXTURE_BASE_URL: fixtureFeedBaseUrl,
      VITE_GUN_PEERS: `["${gunPeerUrl}"]`,
      VITE_NEWS_FEED_SOURCES: resolveDevFeedSourcesJson(),
      ...resolveAnalysisRelayEnv(),
    },
  },
];

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
