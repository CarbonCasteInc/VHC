import { spawn, type ChildProcess } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, ConsoleMessage, Page } from '@playwright/test';

export const SHOULD_RUN = process.env.VH_RUN_DAEMON_FIRST_FEED === 'true';
export const GUN_PORT = Number(process.env.VH_DAEMON_FEED_GUN_PORT ?? '8777');
export const LIVE_BASE_URL = process.env.VH_LIVE_BASE_URL ?? 'http://127.0.0.1:2148/';
export const STORYCLUSTER_PORT = Number(process.env.VH_DAEMON_FEED_STORYCLUSTER_PORT ?? '4310');
export const STORYCLUSTER_TOKEN = process.env.VH_DAEMON_FEED_STORYCLUSTER_TOKEN ?? 'vh-daemon-feed-token';
export const RUN_ID = process.env.VH_DAEMON_FEED_RUN_ID ?? `manual-${process.pid}`;
export const QDRANT_URL = process.env.VH_STORYCLUSTER_QDRANT_URL ?? process.env.QDRANT_URL ?? 'http://127.0.0.1:6333';
export const GUN_PEER_URL = `http://localhost:${GUN_PORT}/gun`;
export const NAV_TIMEOUT_MS = 90_000;
export const FEED_READY_TIMEOUT_MS = 180_000;
export const MIN_HEADLINES = 3;

export type LoggedProcess = {
  readonly name: string;
  readonly proc: ChildProcess;
  readonly output: string[];
};

export type HeadlineRow = {
  readonly storyId: string;
  readonly topicId: string;
  readonly headline: string;
};

export type BundledStory = HeadlineRow & {
  readonly sourceBadgeCount: number;
  readonly sourceBadgeIds: string[];
};

export type DaemonFirstStack = {
  readonly storycluster: LoggedProcess;
  readonly daemon: LoggedProcess;
};

export function repoRootDir(): string {
  return path.resolve(process.cwd(), '..', '..');
}

function runArtifactDir(): string {
  return path.join(repoRootDir(), `.tmp/e2e-daemon-feed/${RUN_ID}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killPortOccupants(port: number): void {
  try {
    const output = execFileSync('lsof', ['-ti', `tcp:${port}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!output) {
      return;
    }
    const pids = output
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (pids.length === 0) {
      return;
    }
    execFileSync('kill', ['-9', ...pids], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    // Port already free or lsof unavailable.
  }
}

function resolveDaemonFeedSourcesJson(): string {
  const catalog = {
    'fox-latest': { id: 'fox-latest', name: 'Fox News', displayName: 'Fox News', rssUrl: 'https://moxie.foxnews.com/google-publisher/latest.xml', perspectiveTag: 'conservative', iconKey: 'fox', enabled: true },
    'nypost-politics': { id: 'nypost-politics', name: 'New York Post Politics', displayName: 'New York Post', rssUrl: 'https://nypost.com/politics/feed/', perspectiveTag: 'conservative', iconKey: 'nypost', enabled: true },
    'guardian-us': { id: 'guardian-us', name: 'The Guardian US', displayName: 'The Guardian', rssUrl: 'https://www.theguardian.com/us-news/rss', perspectiveTag: 'progressive', iconKey: 'guardian', enabled: true },
    'cbs-politics': { id: 'cbs-politics', name: 'CBS News Politics', displayName: 'CBS News', rssUrl: 'https://www.cbsnews.com/latest/rss/politics', perspectiveTag: 'progressive', iconKey: 'cbs', enabled: true },
    'bbc-general': { id: 'bbc-general', name: 'BBC News', displayName: 'BBC News', rssUrl: 'https://feeds.bbci.co.uk/news/rss.xml', perspectiveTag: 'international-wire', iconKey: 'bbc', enabled: true },
  } as const;

  const sourceIds = (process.env.VH_LIVE_DEV_FEED_SOURCE_IDS ?? 'fox-latest,nypost-politics,guardian-us,cbs-politics,bbc-general')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const sources = sourceIds
    .map((sourceId) => catalog[sourceId as keyof typeof catalog])
    .filter(Boolean);

  return JSON.stringify(sources.length > 0 ? sources : Object.values(catalog));
}

export function logText(message: ConsoleMessage): string {
  return `[${message.type()}] ${message.text()}`;
}

export function spawnLoggedProcess(
  name: string,
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): LoggedProcess {
  mkdirSync(runArtifactDir(), { recursive: true });
  const logFile = path.join(runArtifactDir(), `${name}.log`);
  const proc = spawn(command, [...args], {
    cwd: repoRootDir(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  const onData = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      output.push(trimmed);
      appendFileSync(logFile, `${trimmed}\n`, 'utf8');
    }
  };
  proc.stdout?.on('data', onData);
  proc.stderr?.on('data', onData);
  return { name, proc, output };
}

export function waitForOutput(process: LoggedProcess, pattern: RegExp, timeoutMs: number): Promise<void> {
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

export async function stopProcess(process: LoggedProcess | null): Promise<void> {
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
    `,
  });
}

function commonEnv(): NodeJS.ProcessEnv {
  const root = repoRootDir();
  const esmLoaderPath = path.join(root, 'tools/node/esm-resolve-loader.mjs');
  return {
    ...process.env,
    NODE_ENV: 'production',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? '',
    VH_STORYCLUSTER_VECTOR_BACKEND: 'qdrant',
    VH_STORYCLUSTER_QDRANT_URL: QDRANT_URL,
    VH_STORYCLUSTER_ESM_LOADER_PATH: esmLoaderPath,
    VH_STORYCLUSTER_STATE_DIR: path.join(root, `.tmp/e2e-daemon-feed/${RUN_ID}/storycluster-state`),
    VH_STORYCLUSTER_SERVER_PORT: String(STORYCLUSTER_PORT),
    VH_STORYCLUSTER_SERVER_AUTH_TOKEN: STORYCLUSTER_TOKEN,
    VH_GUN_PEERS: `["${GUN_PEER_URL}"]`,
    VITE_NEWS_FEED_SOURCES: resolveDaemonFeedSourcesJson(),
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
}

export async function startDaemonFirstStack(): Promise<DaemonFirstStack> {
  const root = repoRootDir();
  const env = commonEnv();
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
  while (Date.now() - startedAt < FEED_READY_TIMEOUT_MS) {
    const count = await page.locator('[data-testid^="news-card-headline-"]').count();
    if (count >= minHeadlines) return Date.now() - startedAt;
    const refresh = page.getByTestId('feed-refresh-button');
    if (await refresh.count()) {
      await refresh.first().click().catch(() => {});
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error('feed-headlines-timeout');
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

export async function findBundledStory(page: Page, limit = 12): Promise<BundledStory> {
  const headlines = page.locator('[data-testid^="news-card-headline-"]');
  const count = await headlines.count();
  for (let index = 0; index < Math.min(count, limit); index += 1) {
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
