import { test, expect, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import * as path from 'node:path';

const SHOULD_RUN = process.env.VH_RUN_DAEMON_FIRST_FEED === 'true';
const GUN_PORT = Number(process.env.VH_DAEMON_FEED_GUN_PORT ?? '8777');
const LIVE_BASE_URL = process.env.VH_LIVE_BASE_URL ?? 'http://127.0.0.1:2148/';
const STORYCLUSTER_PORT = Number(process.env.VH_DAEMON_FEED_STORYCLUSTER_PORT ?? '4310');
const STORYCLUSTER_TOKEN = process.env.VH_DAEMON_FEED_STORYCLUSTER_TOKEN ?? 'vh-daemon-feed-token';
const RUN_ID = process.env.VH_DAEMON_FEED_RUN_ID ?? `manual-${process.pid}`;
const QDRANT_URL = process.env.VH_STORYCLUSTER_QDRANT_URL ?? process.env.QDRANT_URL ?? 'http://127.0.0.1:6333';
const GUN_PEER_URL = `http://localhost:${GUN_PORT}/gun`;
const NAV_TIMEOUT_MS = 90_000;
const FEED_READY_TIMEOUT_MS = 180_000;
const MIN_HEADLINES = 3;

type LoggedProcess = {
  readonly name: string;
  readonly proc: ChildProcess;
  readonly output: string[];
};

type Summary = {
  readonly baseUrl: string;
  readonly feedReadyMs: number;
  readonly headlineCount: number;
  readonly headlineSamples: ReadonlyArray<{ storyId: string; topicId: string; headline: string }>;
  readonly bundledStory: {
    readonly storyId: string;
    readonly topicId: string;
    readonly headline: string;
    readonly sourceBadgeCount: number;
    readonly sourceBadgeIds: ReadonlyArray<string>;
  };
  readonly reloadedStory: {
    readonly storyId: string;
    readonly topicId: string;
    readonly headline: string;
    readonly sourceBadgeCount: number;
  };
  readonly browserConsumerOnly: boolean;
  readonly browserLogs: readonly string[];
  readonly storyclusterLogs: readonly string[];
  readonly daemonLogs: readonly string[];
};

function repoRootDir(): string {
  return path.resolve(process.cwd(), '..', '..');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logText(message: ConsoleMessage): string {
  return `[${message.type()}] ${message.text()}`;
}

function waitForOutput(process: LoggedProcess, pattern: RegExp, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (process.output.some((line) => pattern.test(line))) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (process.proc.exitCode !== null) {
        clearInterval(timer);
        reject(new Error(`${process.name} exited before readiness`));
        return;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        reject(new Error(`${process.name} readiness timeout`));
      }
    }, 250);
  });
}

async function stopProcess(process: LoggedProcess | null): Promise<void> {
  if (!process || process.proc.exitCode !== null) return;
  process.proc.kill('SIGTERM');
  const startedAt = Date.now();
  while (process.proc.exitCode === null && Date.now() - startedAt < 10_000) {
    await sleep(100);
  }
  if (process.proc.exitCode === null) {
    process.proc.kill('SIGKILL');
  }
}

function spawnLoggedProcess(name: string, command: string, args: readonly string[], env: NodeJS.ProcessEnv): LoggedProcess {
  const proc = spawn(command, [...args], {
    cwd: repoRootDir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      output.push(trimmed);
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  return { name, proc, output };
}

async function waitForHealth(url: string, timeoutMs: number, init?: RequestInit): Promise<void> {
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

async function attachRuntimeLogs(
  testInfo: { attach: (name: string, options: { body: string; contentType: string }) => Promise<void> },
  browserLogs: readonly string[],
  storycluster: LoggedProcess,
  daemon: LoggedProcess | null,
): Promise<void> {
  await testInfo.attach('daemon-first-feed-runtime-logs', {
    body: JSON.stringify({
      browserLogs,
      storyclusterLogs: [...storycluster.output],
      daemonLogs: daemon ? [...daemon.output] : [],
    }, null, 2),
    contentType: 'application/json',
  });
}

function createConsumerContextScript(): { content: string } {
  return {
    content: `
      window.__VH_NEWS_RUNTIME_ROLE = 'consumer';
      window.__VH_TEST_SESSION = false;
    `,
  };
}

async function waitForHeadlines(page: Page): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < FEED_READY_TIMEOUT_MS) {
    const count = await page.locator('[data-testid^="news-card-headline-"]').count();
    if (count >= MIN_HEADLINES) {
      return Date.now() - startedAt;
    }
    const refresh = page.getByTestId('feed-refresh-button');
    if (await refresh.count()) {
      await refresh.first().click().catch(() => {});
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error('feed-headlines-timeout');
}

async function headlineRows(page: Page): Promise<Array<{ storyId: string; topicId: string; headline: string }>> {
  return page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="news-card-headline-"]'))
    .map((node) => ({
      topicId: (node.getAttribute('data-testid') ?? '').replace('news-card-headline-', ''),
      storyId: node.getAttribute('data-story-id') ?? '',
      headline: (node.textContent ?? '').trim(),
    }))
    .filter((row) => row.topicId && row.storyId && row.headline));
}

async function findBundledStory(page: Page): Promise<{
  storyId: string;
  topicId: string;
  headline: string;
  sourceBadgeCount: number;
  sourceBadgeIds: string[];
}> {
  const headlines = page.locator('[data-testid^="news-card-headline-"]');
  const count = await headlines.count();
  for (let index = 0; index < Math.min(count, 12); index += 1) {
    const headline = headlines.nth(index);
    await headline.scrollIntoViewIfNeeded();
    const storyId = (await headline.getAttribute('data-story-id')) ?? '';
    const topicId = ((await headline.getAttribute('data-testid')) ?? '').replace('news-card-headline-', '');
    const headlineText = ((await headline.textContent()) ?? '').trim();
    if (!storyId || !topicId || !headlineText) continue;
    const card = headline.locator('xpath=ancestor::article[1]');
    const badgeCount = await card.locator('[data-testid^="source-badge-"]').count();
    if (badgeCount < 2) continue;
    const badgeIds = await card.locator('[data-testid^="source-badge-"]').evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-testid') ?? '').filter(Boolean));
    return { storyId, topicId, headline: headlineText, sourceBadgeCount: badgeCount, sourceBadgeIds: badgeIds };
  }
  throw new Error('no-bundled-story-found');
}

test.describe('daemon-first StoryCluster feed', () => {
  test.skip(!SHOULD_RUN, 'VH_RUN_DAEMON_FIRST_FEED is not enabled');

  test('serves a daemon-written, StoryCluster-bundled feed to a consumer-only browser', async ({ browser }, testInfo) => {
    test.setTimeout(7 * 60_000);

    const root = repoRootDir();
    const esmLoaderPath = path.join(root, 'tools/node/esm-resolve-loader.mjs');
    const storyclusterDistUrl = pathToFileURL(path.join(root, 'services/storycluster-engine/dist/server.js')).href;
    const commonEnv = {
      ...process.env,
      NODE_ENV: 'production',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
      VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
      VH_STORYCLUSTER_QDRANT_URL: QDRANT_URL,
      VH_STORYCLUSTER_STATE_DIR: path.join(root, `.tmp/e2e-daemon-feed/${RUN_ID}/storycluster-state`),
      VH_STORYCLUSTER_SERVER_PORT: String(STORYCLUSTER_PORT),
      VH_STORYCLUSTER_SERVER_AUTH_TOKEN: STORYCLUSTER_TOKEN,
      VH_GUN_PEERS: `["${GUN_PEER_URL}"]`,
      VITE_NEWS_FEED_SOURCES: process.env.VITE_NEWS_FEED_SOURCES ?? JSON.stringify([
        { id: 'fox-latest', name: 'Fox News', displayName: 'Fox News', rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml', perspectiveTag: 'conservative', iconKey: 'fox', enabled: true },
        { id: 'nypost-politics', name: 'New York Post Politics', displayName: 'New York Post', rssUrl: 'https://nypost.com/politics/feed/', perspectiveTag: 'conservative', iconKey: 'nypost', enabled: true },
        { id: 'guardian-us', name: 'The Guardian US', displayName: 'The Guardian', rssUrl: 'https://www.theguardian.com/us-news/rss', perspectiveTag: 'progressive', iconKey: 'guardian', enabled: true },
        { id: 'cbs-politics', name: 'CBS News Politics', displayName: 'CBS News', rssUrl: 'https://www.cbsnews.com/latest/rss/politics', perspectiveTag: 'progressive', iconKey: 'cbs', enabled: true },
        { id: 'bbc-general', name: 'BBC News', displayName: 'BBC News', rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
      ]),
      VITE_NEWS_TOPIC_MAPPING: '{"defaultTopicId":"topic-news","sourceTopics":{}}',
      VITE_NEWS_POLL_INTERVAL_MS: '15000',
      VH_NEWS_FEED_MAX_ITEMS_PER_SOURCE: '3',
      VH_NEWS_FEED_MAX_ITEMS_TOTAL: '8',
      VH_STORYCLUSTER_REMOTE_URL: `http://127.0.0.1:${STORYCLUSTER_PORT}/cluster`,
      VH_STORYCLUSTER_REMOTE_HEALTH_URL: `http://127.0.0.1:${STORYCLUSTER_PORT}/ready`,
      VH_STORYCLUSTER_REMOTE_TIMEOUT_MS: '90000',
      VH_STORYCLUSTER_REMOTE_AUTH_TOKEN: STORYCLUSTER_TOKEN,
      VH_STORYCLUSTER_REMOTE_AUTH_HEADER: 'authorization',
      VH_STORYCLUSTER_REMOTE_AUTH_SCHEME: 'Bearer',
      VH_NEWS_DAEMON_HOLDER_ID: 'vh-e2e-news-daemon',
    };

    const storycluster = spawnLoggedProcess(
      'storycluster',
      'node',
      [
        '--loader',
        esmLoaderPath,
        '--input-type=module',
        '-e',
        `import { startStoryClusterServer } from ${JSON.stringify(storyclusterDistUrl)};
         const server = startStoryClusterServer({
           host: '127.0.0.1',
           port: Number(process.env.VH_STORYCLUSTER_SERVER_PORT),
           authToken: process.env.VH_STORYCLUSTER_SERVER_AUTH_TOKEN,
         });
         const shutdown = () => server.close(() => process.exit(0));
         process.on('SIGINT', shutdown);
         process.on('SIGTERM', shutdown);
         console.log('[vh:e2e-storycluster] started');`,
      ],
      commonEnv,
    );

    let daemon: LoggedProcess | null = null;
    let context: BrowserContext | null = null;
    const browserLogs: string[] = [];

    try {
      await waitForOutput(storycluster, /\[vh:e2e-storycluster\] started/, 30_000);
      await waitForHealth(`http://127.0.0.1:${STORYCLUSTER_PORT}/ready`, 60_000, {
        headers: {
          authorization: `Bearer ${STORYCLUSTER_TOKEN}`,
        },
      });

      daemon = spawnLoggedProcess(
        'news-daemon',
        'pnpm',
        ['--filter', '@vh/news-aggregator', 'daemon'],
        commonEnv,
      );
      await waitForOutput(daemon, /\[vh:news-daemon\] leadership loop started/, 90_000);

      context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.addInitScript(createConsumerContextScript());
      const page = await context.newPage();
      page.on('console', (message) => browserLogs.push(logText(message)));

      await page.goto(LIVE_BASE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      const feedReadyMs = await waitForHeadlines(page);
      const initialRows = await headlineRows(page);
      expect(initialRows.length).toBeGreaterThanOrEqual(MIN_HEADLINES);

      const bundledStory = await findBundledStory(page);
      const browserConsumerOnly = browserLogs.every((line) => !line.includes('[vh:news-runtime] started'));
      expect(browserConsumerOnly).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      await waitForHeadlines(page);
      const reloadedHeadline = page.locator(`[data-testid="news-card-headline-${bundledStory.topicId}"][data-story-id="${bundledStory.storyId}"]`).first();
      await expect(reloadedHeadline).toBeVisible({ timeout: 30_000 });
      const reloadedCard = reloadedHeadline.locator('xpath=ancestor::article[1]');
      const reloadedSourceBadgeCount = await reloadedCard.locator('[data-testid^="source-badge-"]').count();
      expect(reloadedSourceBadgeCount).toBeGreaterThanOrEqual(2);

      const summary: Summary = {
        baseUrl: LIVE_BASE_URL,
        feedReadyMs,
        headlineCount: initialRows.length,
        headlineSamples: initialRows.slice(0, 6),
        bundledStory,
        reloadedStory: {
          storyId: bundledStory.storyId,
          topicId: bundledStory.topicId,
          headline: ((await reloadedHeadline.textContent()) ?? '').trim(),
          sourceBadgeCount: reloadedSourceBadgeCount,
        },
        browserConsumerOnly,
        browserLogs,
        storyclusterLogs: [...storycluster.output],
        daemonLogs: daemon ? [...daemon.output] : [],
      };

      await testInfo.attach('daemon-first-feed-summary', {
        body: JSON.stringify(summary, null, 2),
        contentType: 'application/json',
      });
    } catch (error) {
      await attachRuntimeLogs(testInfo, browserLogs, storycluster, daemon);
      throw error;
    } finally {
      await context?.close().catch(() => {});
      await stopProcess(daemon);
      await stopProcess(storycluster);
    }
  });
});
