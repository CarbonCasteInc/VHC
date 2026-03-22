import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test';
import {
  killPortOccupants,
  killStaleDaemonFirstProcesses,
  repoRootDir,
  runArtifactDir,
  spawnLoggedProcess,
  stopProcess,
  type LoggedProcess,
  waitForOutput,
  sleep,
} from './daemonFirstFeedProcesses';
import {
  readAuditableBundleDiagnostics,
  readAuditableBundles,
  refreshNewsStoreLatest,
} from './browserNewsStore';
import { nudgeFeed } from './feedReadiness';
import { resolveDaemonFeedSourcesJson } from './daemonFeedSources';

export const SHOULD_RUN = process.env.VH_RUN_DAEMON_FIRST_FEED === 'true';
export const GUN_PORT = Number(process.env.VH_DAEMON_FEED_GUN_PORT ?? '8777');
export const LIVE_BASE_URL = process.env.VH_LIVE_BASE_URL ?? 'http://127.0.0.1:2148/';
export const STORYCLUSTER_PORT = Number(process.env.VH_DAEMON_FEED_STORYCLUSTER_PORT ?? '4310');
export const STORYCLUSTER_TOKEN = process.env.VH_DAEMON_FEED_STORYCLUSTER_TOKEN ?? 'vh-daemon-feed-token';
export const RUN_ID = process.env.VH_DAEMON_FEED_RUN_ID ?? `manual-${process.pid}`;
export const QDRANT_URL = process.env.VH_STORYCLUSTER_QDRANT_URL ?? process.env.QDRANT_URL ?? 'http://127.0.0.1:6333';
export const GUN_PEER_URL = `http://localhost:${GUN_PORT}/gun`;
export const NAV_TIMEOUT_MS = 90_000;
export const FEED_READY_TIMEOUT_MS = 240_000;
export const MIN_HEADLINES = process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true' ? 3 : 4;
const FIXTURE_NEWS_POLL_INTERVAL_MS = String(30 * 60 * 1000);
const DEFAULT_NEWS_POLL_INTERVAL_MS = '15000';
const FIXTURE_MAX_ITEMS_PER_SOURCE = '5';
const FIXTURE_MAX_ITEMS_TOTAL = '30';
const LIVE_MAX_ITEMS_PER_SOURCE = '3';
const LIVE_MAX_ITEMS_TOTAL = '15';
const DEFAULT_STORYCLUSTER_REMOTE_TIMEOUT_MS = '300000';
const DEFAULT_STORYCLUSTER_OPENAI_TIMEOUT_MS = '120000';

export type HeadlineRow = {
  readonly storyId: string;
  readonly topicId: string;
  readonly headline: string;
};

export type BundledStory = HeadlineRow & {
  readonly sourceBadgeCount: number;
  readonly sourceBadgeIds: string[];
};

type AuditableStoryRef = {
  readonly story_id: string;
  readonly topic_id: string;
};

export type DaemonFirstStack = {
  readonly storycluster: LoggedProcess;
  readonly daemon: LoggedProcess;
};

export function logText(message: ConsoleMessage): string {
  return `[${message.type()}] ${message.text()}`;
}

export { sleep } from './daemonFirstFeedProcesses';

export async function waitForHealth(url: string, timeoutMs: number, init?: RequestInit): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return;
    } catch {
      // Retry until timeout.
    }
    await sleep(500);
  }
  throw new Error(`health-timeout:${url}`);
}

export async function addConsumerInitScript(context: BrowserContext): Promise<void> {
  await context.addInitScript({
    content: `
      window.__VH_NEWS_RUNTIME_ROLE = 'consumer';
      window.__VH_TEST_SESSION = false;
      window.__VH_EXPOSE_NEWS_STORE__ = true;
      window.__VH_GUN_PEERS__ = [${JSON.stringify(GUN_PEER_URL)}];
    `,
  });
}

function resolveNewsPollIntervalMs(): string {
  const configured = process.env.VITE_NEWS_POLL_INTERVAL_MS?.trim();
  if (configured) {
    return configured;
  }
  return process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true'
    ? FIXTURE_NEWS_POLL_INTERVAL_MS
    : DEFAULT_NEWS_POLL_INTERVAL_MS;
}

function resolveNewsFeedMaxItemsPerSource(): string {
  const configured = process.env.VH_DAEMON_FEED_MAX_ITEMS_PER_SOURCE?.trim();
  if (configured) {
    return configured;
  }
  return process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true'
    ? FIXTURE_MAX_ITEMS_PER_SOURCE
    : LIVE_MAX_ITEMS_PER_SOURCE;
}

function resolveNewsFeedMaxItemsTotal(): string {
  const configured = process.env.VH_DAEMON_FEED_MAX_ITEMS_TOTAL?.trim();
  if (configured) {
    return configured;
  }
  return process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true'
    ? FIXTURE_MAX_ITEMS_TOTAL
    : LIVE_MAX_ITEMS_TOTAL;
}

function resolveMinimumAuditableStories(): number {
  const configured = process.env.VH_DAEMON_FEED_MIN_AUDITABLE_STORIES?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED === 'true' ? 1 : 0;
}

function resolveStoryClusterRemoteTimeoutMs(): string {
  const configured = process.env.VH_DAEMON_FEED_STORYCLUSTER_REMOTE_TIMEOUT_MS?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }

  return DEFAULT_STORYCLUSTER_REMOTE_TIMEOUT_MS;
}

function resolveStoryClusterOpenAITimeoutMs(): string {
  const configured = process.env.VH_DAEMON_FEED_STORYCLUSTER_OPENAI_TIMEOUT_MS?.trim();
  if (configured) {
    const parsed = Number.parseInt(configured, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return String(parsed);
    }
  }

  return DEFAULT_STORYCLUSTER_OPENAI_TIMEOUT_MS;
}

export const daemonFirstFeedHarnessInternal = {
  resolveNewsPollIntervalMs,
  resolveNewsFeedMaxItemsPerSource,
  resolveNewsFeedMaxItemsTotal,
  resolveMinimumAuditableStories,
  resolveStoryClusterRemoteTimeoutMs,
  resolveStoryClusterOpenAITimeoutMs,
};

function commonEnv(): NodeJS.ProcessEnv {
  const root = repoRootDir();
  const esmLoaderPath = path.join(root, 'tools/node/esm-resolve-loader.mjs');
  const maxItemsPerSource = resolveNewsFeedMaxItemsPerSource();
  const maxItemsTotal = resolveNewsFeedMaxItemsTotal();
  const storyClusterRemoteTimeoutMs = resolveStoryClusterRemoteTimeoutMs();
  const storyClusterOpenAITimeoutMs = resolveStoryClusterOpenAITimeoutMs();
  return {
    ...process.env,
    NODE_ENV: 'production',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
    VH_STORYCLUSTER_QDRANT_URL: QDRANT_URL,
    VH_STORYCLUSTER_QDRANT_TIMEOUT_MS: '20000',
    VH_STORYCLUSTER_ESM_LOADER_PATH: esmLoaderPath,
    VH_STORYCLUSTER_STATE_DIR: path.join(root, `.tmp/e2e-daemon-feed/${RUN_ID}/storycluster-state`),
    VH_STORYCLUSTER_SERVER_PORT: String(STORYCLUSTER_PORT),
    VH_STORYCLUSTER_SERVER_AUTH_TOKEN: STORYCLUSTER_TOKEN,
    VH_STORYCLUSTER_OPENAI_TIMEOUT_MS: storyClusterOpenAITimeoutMs,
    VH_GUN_PEERS: `["${GUN_PEER_URL}"]`,
    VITE_NEWS_FEED_SOURCES: resolveDaemonFeedSourcesJson(),
    VITE_NEWS_TOPIC_MAPPING: '{"defaultTopicId":"topic-news","sourceTopics":{}}',
    VITE_NEWS_POLL_INTERVAL_MS: resolveNewsPollIntervalMs(),
    VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE: maxItemsPerSource,
    VH_NEWS_FEED_MAX_ITEMS_TOTAL: maxItemsTotal,
    VH_STORYCLUSTER_REMOTE_URL: `http://127.0.0.1:${STORYCLUSTER_PORT}/cluster`,
    VH_STORYCLUSTER_REMOTE_HEALTH_URL: `http://127.0.0.1:${STORYCLUSTER_PORT}/ready`,
    VH_STORYCLUSTER_REMOTE_TIMEOUT_MS: storyClusterRemoteTimeoutMs,
    VH_STORYCLUSTER_REMOTE_AUTH_TOKEN: STORYCLUSTER_TOKEN,
    VH_STORYCLUSTER_REMOTE_AUTH_HEADER: 'authorization',
    VH_STORYCLUSTER_REMOTE_AUTH_SCHEME: 'Bearer',
    VH_NEWS_DAEMON_HOLDER_ID: 'vh-e2e-news-daemon',
  };
}

export async function startDaemonFirstStack(): Promise<DaemonFirstStack> {
  const root = repoRootDir();
  const env = commonEnv();
  killStaleDaemonFirstProcesses();
  killPortOccupants(STORYCLUSTER_PORT);
  const storyclusterDistUrl = pathToFileURL(path.join(root, 'services/storycluster-engine/dist/server.js')).href;
  const clusterStoreDistUrl = pathToFileURL(path.join(root, 'services/storycluster-engine/dist/clusterStore.js')).href;
  const esmLoaderPath = env.VH_STORYCLUSTER_ESM_LOADER_PATH!;

  const storycluster = spawnLoggedProcess(
    'storycluster',
    'node',
    [
      '--loader',
      esmLoaderPath,
      '--input-type=module',
      '-e',
      `import { startStoryClusterServer } from ${JSON.stringify(storyclusterDistUrl)};
       import { FileClusterStore } from ${JSON.stringify(clusterStoreDistUrl)};
       const stateDir = process.env.VH_STORYCLUSTER_STATE_DIR;
       const server = startStoryClusterServer({
         host: '127.0.0.1',
         port: Number(process.env.VH_STORYCLUSTER_SERVER_PORT),
         authToken: process.env.VH_STORYCLUSTER_SERVER_AUTH_TOKEN,
         store: stateDir ? new FileClusterStore(stateDir) : undefined,
       });
       const shutdown = () => server.close(() => process.exit(0));
       process.on('SIGINT', shutdown);
       process.on('SIGTERM', shutdown);
       console.log('[vh:e2e-storycluster] started', { stateDir });`,
    ],
    env,
    RUN_ID,
  );

  await waitForOutput(storycluster, /\[vh:e2e-storycluster\] started/, 30_000);
  await waitForHealth(`http://127.0.0.1:${STORYCLUSTER_PORT}/ready`, 60_000, {
    headers: { authorization: `Bearer ${STORYCLUSTER_TOKEN}` },
  });

  const daemon = spawnLoggedProcess(
    'news-daemon',
    'pnpm',
    ['--filter', '@vh/news-aggregator', 'daemon'],
    env,
    RUN_ID,
  );
  await waitForOutput(daemon, /\[vh:news-daemon\] leadership loop started/, 90_000);

  return { storycluster, daemon };
}

export async function stopDaemonFirstStack(stack: DaemonFirstStack | null): Promise<void> {
  if (!stack) return;
  await stopProcess(stack.daemon);
  await stopProcess(stack.storycluster);
}

export async function attachRuntimeLogs(
  testInfo: { attach: (name: string, options: { body: string; contentType: string }) => Promise<void> },
  browserLogs: readonly string[],
  stack: DaemonFirstStack,
): Promise<void> {
  await testInfo.attach('daemon-first-feed-runtime-logs', {
    body: JSON.stringify({
      browserLogs,
      storyclusterLogs: [...stack.storycluster.output],
      daemonLogs: [...stack.daemon.output],
    }, null, 2),
    contentType: 'application/json',
  });
}

export async function waitForHeadlines(page: Page, minHeadlines = MIN_HEADLINES): Promise<number> {
  const startedAt = Date.now();
  const minAuditableStories = resolveMinimumAuditableStories();
  let lastDomCount = 0;
  let lastStoryCount = 0;
  let lastAuditableCount = 0;
  let reloadAttempted = false;
  while (Date.now() - startedAt < FEED_READY_TIMEOUT_MS) {
    lastDomCount = await page.locator('[data-testid^="news-card-headline-"]').count();
    if (lastDomCount >= minHeadlines && minAuditableStories === 0) {
      return Date.now() - startedAt;
    }

    await refreshNewsStoreLatest(page, Math.max(120, minHeadlines * 4)).catch(() => {});
    const diagnostics = await readAuditableBundleDiagnostics(page).catch(() => null);
    lastStoryCount = diagnostics?.storyCount ?? 0;
    lastAuditableCount = diagnostics?.auditableCount ?? 0;

    if (lastDomCount >= minHeadlines && lastAuditableCount >= minAuditableStories) {
      return Date.now() - startedAt;
    }

    if (!reloadAttempted && lastDomCount === 0 && lastStoryCount >= minHeadlines) {
      reloadAttempted = true;
      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS }).catch(() => {});
    }

    await nudgeFeed(page);
  }
  throw new Error(
    `feed-headlines-timeout:dom=${lastDomCount}:stories=${lastStoryCount}:auditable=${lastAuditableCount}`,
  );
}

export async function headlineRows(page: Page): Promise<HeadlineRow[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="news-card-headline-"]'))
    .map((node) => ({
      topicId: (node.getAttribute('data-testid') ?? '').replace('news-card-headline-', ''),
      storyId: node.getAttribute('data-story-id') ?? '',
      headline: (node.textContent ?? '').trim(),
    }))
	    .filter((row) => row.topicId && row.storyId && row.headline));
}

async function materializeBundledStory(
  page: Page,
  story: AuditableStoryRef,
): Promise<BundledStory | null> {
  const headline = page
    .locator(`[data-testid="news-card-headline-${story.topic_id}"][data-story-id="${story.story_id}"]`)
    .first();
  if (!(await headline.count())) {
    return null;
  }
  await headline.scrollIntoViewIfNeeded().catch(() => {});
  const headlineText = ((await headline.textContent()) ?? '').trim();
  if (!headlineText) {
    return null;
  }
  const card = headline.locator('xpath=ancestor::article[1]');
  const badgeCount = await card.locator('[data-testid^="source-badge-"]').count();
  if (badgeCount < 2) {
    return null;
  }
  const badgeIds = await card.locator('[data-testid^="source-badge-"]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-testid') ?? '').filter(Boolean));
  return {
    storyId: story.story_id,
    topicId: story.topic_id,
    headline: headlineText,
    sourceBadgeCount: badgeCount,
    sourceBadgeIds: badgeIds,
  };
}

export async function findBundledStory(page: Page, limit = 12): Promise<BundledStory> {
  const deadline = Date.now() + FEED_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const auditableBundles = (await readAuditableBundles(page)).slice(0, limit);
    for (const bundle of auditableBundles) {
      const materialized = await materializeBundledStory(page, bundle);
      if (materialized) {
        return materialized;
      }
    }

    await refreshNewsStoreLatest(page, 120).catch(() => {});
    await nudgeFeed(page);
    await waitForHeadlines(page);
  }
  throw new Error('no-bundled-story-found');
}
