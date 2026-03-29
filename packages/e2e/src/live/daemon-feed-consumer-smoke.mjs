#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  classifyConsumerSmokeOutcome,
  formatConsoleArgs,
  resolveLatestPassingCanaryArtifact,
} from './daemon-feed-canary-shared.mjs';
import { formatErrorMessage, sleep } from './daemon-feed-semantic-soak-core.mjs';

const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);
/* c8 ignore start */

function consumerSmokeArtifactDirFromEnv(env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = env.VH_DAEMON_FEED_CONSUMER_SMOKE_ARTIFACT_DIR?.trim();
  if (explicit) {
    return explicit;
  }
  return path.join(repoRoot, '.tmp', 'daemon-feed-consumer-smoke', String(Date.now()));
}

export async function loadPlaywrightChromium(importModule = () => import('@playwright/test')) {
  const playwright = await importModule();
  if (!playwright?.chromium) {
    throw new Error('consumer-smoke-playwright-chromium-unavailable');
  }
  return playwright.chromium;
}

function writeAtomicJson(
  targetPath,
  value,
  {
    mkdir = mkdirSync,
    writeFile = writeFileSync,
    rename = renameSync,
  } = {},
) {
  mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.tmp-${process.pid}-${Date.now()}`,
  );
  writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  rename(tempPath, targetPath);
}

async function findAvailablePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHttpReady(url, processHandle, timeoutMs, fetchImpl = fetch, sleepImpl = sleep) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (processHandle.exitCode !== null) {
      throw new Error(`consumer-smoke-web-exited:${processHandle.exitCode}`);
    }
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling.
    }
    await sleepImpl(250);
  }
  throw new Error(`consumer-smoke-web-timeout:${url}`);
}

async function loadConsumerSmokeFixture(repoRoot, env, { exists = existsSync, readdir = readdirSync, stat = statSync, readFile = readFileSync } = {}) {
  const explicitPath = env.VH_DAEMON_FEED_CONSUMER_SMOKE_FIXTURE_PATH?.trim();
  if (explicitPath) {
    return {
      snapshotPath: explicitPath,
      snapshot: JSON.parse(readFile(explicitPath, 'utf8')),
      artifactDir: path.dirname(explicitPath),
      summaryPath: null,
      summary: null,
    };
  }

  const artifactRoot = path.join(repoRoot, '.tmp', 'daemon-feed-publisher-canary');
  const latest = resolveLatestPassingCanaryArtifact(artifactRoot, {
    exists,
    readdir,
    stat,
    readFile,
    summaryFileName: 'publisher-canary-summary.json',
    requiredArtifactNames: ['published-store-snapshot.json'],
    passPredicate: (summary) => summary?.pass === true,
  });
  if (!latest) {
    throw new Error(`no passing publisher canary artifact found under ${artifactRoot}`);
  }

  const snapshotPath = path.join(latest.artifactDir, 'published-store-snapshot.json');
  return {
    snapshotPath,
    snapshot: JSON.parse(readFile(snapshotPath, 'utf8')),
    artifactDir: latest.artifactDir,
    summaryPath: latest.summaryPath,
    summary: latest.summary,
  };
}

async function loadStarterFeedSourcesJson(repoRoot) {
  const newsAggregator = await import(
    pathToFileURL(path.join(repoRoot, 'services/news-aggregator/dist/index.js')).href
  );
  const resolved = newsAggregator.resolveStarterFeedSources({
    cwd: repoRoot,
    env: process.env,
  });
  return JSON.stringify(resolved.feedSources);
}

export async function runDaemonFeedConsumerSmoke({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  exists = existsSync,
  readdir = readdirSync,
  stat = statSync,
  readFile = readFileSync,
  mkdir = mkdirSync,
  writeFile = writeFileSync,
  rename = renameSync,
  fetchImpl = fetch,
  sleepImpl = sleep,
  launchBrowser = null,
  log = console.log,
} = {}) {
  const artifactDir = consumerSmokeArtifactDirFromEnv(env, repoRoot);
  const summaryPath = path.join(artifactDir, 'consumer-smoke-summary.json');
  const logsPath = path.join(artifactDir, 'consumer-smoke-browser-logs.json');
  const serverLogPath = path.join(artifactDir, 'consumer-smoke-web-pwa.log');
  mkdir(artifactDir, { recursive: true });

  const fixture = await loadConsumerSmokeFixture(repoRoot, env, {
    exists,
    readdir,
    stat,
    readFile,
  });
  const feedSourcesJson = await loadStarterFeedSourcesJson(repoRoot);
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const browserLogs = [];
  let browser = null;
  let context = null;
  let webServer = null;
  let summary;

  try {
    writeFile(serverLogPath, '', 'utf8');
    webServer = spawn(
      'pnpm',
      ['--filter', '@vh/web-pwa', 'dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
      {
        cwd: repoRoot,
        env: {
          ...env,
          VITE_E2E_MODE: 'true',
          VITE_NEWS_RUNTIME_ENABLED: 'false',
          VITE_NEWS_BRIDGE_ENABLED: 'false',
          VITE_SYNTHESIS_BRIDGE_ENABLED: 'false',
          VITE_LINKED_SOCIAL_ENABLED: 'false',
          VITE_VH_ANALYSIS_PIPELINE: 'false',
          VITE_NEWS_FEED_SOURCES: feedSourcesJson,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    webServer.stdout?.on('data', (chunk) => writeFile(serverLogPath, chunk.toString('utf8'), { flag: 'a' }));
    webServer.stderr?.on('data', (chunk) => writeFile(serverLogPath, chunk.toString('utf8'), { flag: 'a' }));

    await waitForHttpReady(baseUrl, webServer, 60_000, fetchImpl, sleepImpl);

    const browserLauncher = launchBrowser ?? (async () => {
      const chromium = await loadPlaywrightChromium();
      return await chromium.launch({ headless: true });
    });
    browser = await browserLauncher();
    context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addInitScript({
      content: `
        window.__VH_NEWS_RUNTIME_ROLE = 'consumer';
        window.__VH_TEST_SESSION = false;
        window.__VH_EXPOSE_NEWS_STORE__ = true;
        window.__VH_GUN_PEERS__ = [];
      `,
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      browserLogs.push({
        type: message.type(),
        text: message.text(),
      });
    });

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForSelector('[data-testid="user-link"]', { timeout: 20_000 });
    await page.evaluate(async (snapshot) => {
      const store = window.__VH_NEWS_STORE__;
      if (!store?.getState) {
        throw new Error('news-store-unavailable');
      }
      const { mirrorStoriesIntoDiscovery } = await import('/src/store/news/storeHelpers.ts');
      const state = store.getState();
      state.setStorylines(snapshot.storylines ?? []);
      state.setStories(snapshot.stories ?? []);
      state.setLatestIndex(snapshot.latestIndex ?? {});
      state.setHotIndex(snapshot.hotIndex ?? {});
      const storylinesById = Object.fromEntries(
        (snapshot.storylines ?? []).map((storyline) => [storyline.storyline_id, storyline]),
      );
      await mirrorStoriesIntoDiscovery(
        snapshot.stories ?? [],
        snapshot.hotIndex ?? {},
        storylinesById,
      );
    }, fixture.snapshot);

    await page.waitForSelector('[data-testid^="news-card-headline-"]', { timeout: 20_000 });
    const headlines = page.locator('[data-testid^="news-card-headline-"]');
    const renderCount = await headlines.count();
    const firstHeadline = headlines.first();
    const firstHeadlineText = ((await firstHeadline.textContent()) ?? '').trim();
    const firstStoryId = (await firstHeadline.getAttribute('data-story-id')) ?? null;
    const firstCard = firstHeadline.locator('xpath=ancestor::article[1]');
    const sourceBadgeCount = await firstCard.locator('[data-testid^="source-badge-"]').count();
    const metaText = ((await firstCard.locator('p').nth(1).textContent().catch(() => '')) ?? '').trim();
    await firstHeadline.click();
    await page.waitForTimeout(500);
    const expanded = (await firstCard.getAttribute('aria-expanded')) === 'true';

    summary = {
      schemaVersion: 'daemon-feed-consumer-smoke-summary-v1',
      generatedAt: new Date().toISOString(),
      fixture: {
        artifactDir: fixture.artifactDir,
        summaryPath: fixture.summaryPath,
        snapshotPath: fixture.snapshotPath,
      },
      artifactPaths: {
        artifactDir,
        summaryPath,
        logsPath,
        serverLogPath,
      },
      baseUrl,
      pass: false,
      outcome: classifyConsumerSmokeOutcome({
        renderCount,
        expanded,
        errorMessage: null,
      }),
      renderCount,
      firstStoryId,
      firstHeadline: firstHeadlineText,
      sourceBadgeCount,
      metaText,
      expanded,
    };
    summary.pass = summary.outcome === 'pass';
  } catch (error) {
    summary = {
      schemaVersion: 'daemon-feed-consumer-smoke-summary-v1',
      generatedAt: new Date().toISOString(),
      fixture: {
        artifactDir: fixture.artifactDir,
        summaryPath: fixture.summaryPath,
        snapshotPath: fixture.snapshotPath,
      },
      artifactPaths: {
        artifactDir,
        summaryPath,
        logsPath,
        serverLogPath,
      },
      pass: false,
      outcome: classifyConsumerSmokeOutcome({
        renderCount: 0,
        expanded: false,
        errorMessage: formatErrorMessage(error),
      }),
      errorMessage: formatErrorMessage(error),
    };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (webServer && webServer.exitCode === null) {
      webServer.kill('SIGTERM');
      await new Promise((resolve) => {
        webServer.once('exit', () => resolve());
        setTimeout(resolve, 5_000);
      });
      if (webServer.exitCode === null) {
        webServer.kill('SIGKILL');
      }
    }
  }

  writeAtomicJson(logsPath, {
    schemaVersion: 'daemon-feed-consumer-smoke-browser-logs-v1',
    generatedAt: new Date().toISOString(),
    logs: browserLogs,
  }, {
    mkdir,
    writeFile,
    rename,
  });
  writeAtomicJson(summaryPath, summary, {
    mkdir,
    writeFile,
    rename,
  });
  log(`[vh:consumer-smoke] ${summary.pass ? 'PASS' : 'FAIL'} outcome=${summary.outcome} renderCount=${summary.renderCount ?? 0}`);

  if (!summary.pass) {
    throw new Error(`consumer-smoke-${summary.outcome}`);
  }

  return summary;
}

async function main() {
  await runDaemonFeedConsumerSmoke();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('[vh:consumer-smoke] failed', error);
    process.exit(1);
  });
}
/* c8 ignore stop */
