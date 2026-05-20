#!/usr/bin/env node

import { chromium } from '@playwright/test';
import {
  createClient,
  readAggregateVoterRows,
  readAggregatesWithRelayRestFallback as readAggregates,
  readNewsLatestIndex,
  readNewsStory,
  readTopicLatestSynthesis,
} from '@vh/gun-client';
import { lookup as dnsLookup } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import { mkdir, rm, symlink, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:2048/';
const DEFAULT_GUN_PEER_URL = 'http://127.0.0.1:7777/gun';
const DEFAULT_MIN_HEADLINES = 4;
const DEFAULT_READY_TIMEOUT_MS = 12 * 60_000;
const DEFAULT_ANALYSIS_TIMEOUT_MS = 120_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;
const DEFAULT_POSTED_COMMENT_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS = 120_000;
const DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS = 120_000;
const DEFAULT_GUN_READBACK_STORY_LIMIT = 16;
const DEFAULT_PUBLIC_RELAY_SYNTHESIS_INDEX_LIMIT = 80;
const DEFAULT_PUBLIC_RELAY_SYNTHESIS_SCAN_LIMIT = 32;
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizeGunPeer(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function storyDetailUrl(baseUrl, storyId) {
  const url = new URL(baseUrl);
  url.searchParams.set('detail', `news:${storyId}`);
  return url.href;
}

function urlsMatch(left, right) {
  if (!left || !right) return false;
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    leftUrl.hash = '';
    rightUrl.hash = '';
    return leftUrl.href === rightUrl.href;
  } catch {
    return left === right;
  }
}

function isNavigationAbortError(error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  return /net::ERR_ABORTED/i.test(message) || /frame was detached/i.test(message);
}

async function navigateToAppRoute(
  page,
  url,
  {
    label = 'app-route',
    progress = () => {},
    optional = false,
    timeout = 90_000,
  } = {},
) {
  let lastAbortError = null;
  for (const waitUntil of ['domcontentloaded', 'commit']) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return { ok: true, aborted: false, reachedTarget: true, waitUntil, url };
    } catch (error) {
      if (!isNavigationAbortError(error)) {
        throw error;
      }
      lastAbortError = error;
      const currentUrl = typeof page.url === 'function' ? page.url() : '';
      progress(`${label}-navigation-aborted`, {
        waitUntil,
        targetUrl: url,
        currentUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      if (urlsMatch(currentUrl, url)) {
        return { ok: true, aborted: true, reachedTarget: true, waitUntil, url: currentUrl };
      }
    }
  }

  const currentUrl = typeof page.url === 'function' ? page.url() : '';
  if (optional) {
    return {
      ok: false,
      aborted: true,
      reachedTarget: urlsMatch(currentUrl, url),
      waitUntil: null,
      url: currentUrl,
      error: lastAbortError instanceof Error ? lastAbortError.message : String(lastAbortError),
    };
  }

  throw lastAbortError ?? new Error(`${label}-navigation-failed`);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value).trim());
}

function parseDelimitedHosts(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) => parseDelimitedHosts(item));
      }
    } catch {
      return [];
    }
  }
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function hostnameFromUrl(value) {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return '';
  }
}

function normalizePublicHostname(value) {
  const host = hostnameFromUrl(value) || String(value ?? '').trim();
  return host.toLowerCase().replace(/^\[|\]$/g, '');
}

function publicSmokeBrowserHostnames({ baseUrl, gunPeerUrl, env = process.env }) {
  const hosts = [
    hostnameFromUrl(baseUrl),
    hostnameFromUrl(gunPeerUrl),
    ...parseDelimitedHosts(env.VH_PUBLIC_FEED_SMOKE_IPV4_HOSTS),
    ...parseDelimitedHosts(env.VH_PUBLIC_FEED_PUBLIC_WSS_PEERS),
    ...parseDelimitedHosts(env.VH_MESH_PUBLIC_WSS_PEERS),
  ]
    .map(normalizePublicHostname)
    .filter((host) => host && !LOCAL_HOSTNAMES.has(host));
  return [...new Set(hosts)].sort();
}

async function buildChromiumHostResolverRules(hostnames, lookupImpl = dnsLookup) {
  const rules = [];
  for (const hostname of hostnames) {
    const result = await lookupImpl(hostname, { family: 4 });
    const address = typeof result === 'string' ? result : result?.address;
    if (!address) continue;
    rules.push(`MAP ${hostname} ${address}`);
  }
  return rules.length ? `--host-resolver-rules=${rules.join(',')}` : '';
}

function parseChromiumArgs(value) {
  return String(value ?? '')
    .split(/\s+/)
    .map((arg) => arg.trim())
    .filter(Boolean);
}

async function launchPublicFeedBrowser({ env, baseUrl, gunPeerUrl, chromiumLauncher = chromium }) {
  const args = parseChromiumArgs(env.VH_PUBLIC_FEED_SMOKE_CHROMIUM_ARGS);
  if (boolEnv(env.VH_PUBLIC_FEED_SMOKE_FORCE_IPV4, false)) {
    const hostnames = publicSmokeBrowserHostnames({ baseUrl, gunPeerUrl, env });
    const resolverRules = await buildChromiumHostResolverRules(hostnames);
    if (resolverRules) args.push(resolverRules);
  }
  return chromiumLauncher.launch({
    headless: env.VH_PUBLIC_FEED_SMOKE_HEADLESS !== 'false',
    args,
  });
}

function resolveArtifactDir(env = process.env, repoRoot = DEFAULT_REPO_ROOT) {
  const explicit = env.VH_PUBLIC_FEED_SMOKE_ARTIFACT_DIR?.trim();
  if (explicit) return explicit;
  return path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-browser-smoke', String(Date.now()));
}

function cssAttr(value) {
  return JSON.stringify(String(value));
}

function parseVoteCount(text) {
  const match = String(text ?? '').match(/[+-]\s*(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseSynthesisIdFromPointId(pointId) {
  const match = String(pointId ?? '').match(/^synth-point:(.+):\d+:(?:frame|reframe)$/);
  return match?.[1] ?? null;
}

function minimumPublicAgreeAfterVote(publicBefore, localBeforeAgree) {
  const publicAgree = Number(publicBefore?.agree);
  if (Number.isFinite(publicAgree) && publicAgree >= 0) {
    return Math.floor(publicAgree) + 1;
  }
  return Math.max(0, Number.isFinite(localBeforeAgree) ? Math.floor(localBeforeAgree) : 0) + 1;
}

function summarizePublicAgreeVoterRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const agreeRows = safeRows.filter((row) => row?.node?.agreement === 1);
  return {
    totalRows: safeRows.length,
    agreeRows: agreeRows.length,
    agreeVoterIds: agreeRows.map((row) => String(row.voter_id)).filter(Boolean).sort(),
  };
}

function publicAgreeVoterRowsAfterVote(beforeRows, afterRows) {
  const before = summarizePublicAgreeVoterRows(beforeRows);
  const after = summarizePublicAgreeVoterRows(afterRows);
  const beforeAgreeVoters = new Set(before.agreeVoterIds);
  const newAgreeVoterIds = after.agreeVoterIds.filter((voterId) => !beforeAgreeVoters.has(voterId));
  if (newAgreeVoterIds.length === 0) {
    return null;
  }

  return {
    beforeTotalRows: before.totalRows,
    afterTotalRows: after.totalRows,
    beforeAgreeRows: before.agreeRows,
    afterAgreeRows: after.agreeRows,
    newAgreeRows: newAgreeVoterIds.length,
    newAgreeVoterIds,
  };
}

function readFixtureConst(source, name) {
  const match = source.match(new RegExp(`export const ${name} =\\n?\\s*'([^']+)';`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1];
}

function loadSystemWriterPin(repoRoot = DEFAULT_REPO_ROOT, env = process.env) {
  const explicit = env.VITE_NEWS_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VH_NEWS_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VITE_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VH_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VITE_E2E_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VH_E2E_SYSTEM_WRITER_PIN_JSON?.trim();
  if (explicit) return JSON.parse(explicit);

  const source = readFileSync(
    path.join(repoRoot, 'packages', 'e2e', 'src', 'live', 'lumaSystemWriterTestFixture.ts'),
    'utf8',
  );
  const writerId = readFixtureConst(source, 'E2E_SYSTEM_WRITER_ID');
  const publicKey = readFixtureConst(source, 'E2E_SYSTEM_WRITER_PUBLIC_KEY_SPKI_BASE64URL');
  return {
    pinVersion: 1,
    schemaEpoch: 'luma-public-v1',
    maxProtocolVersion: 'luma-public-v1',
    signatureSuite: 'jcs-ed25519-sha256-v1',
    writers: [
      {
        id: writerId,
        status: 'active',
        publicKey: {
          encoding: 'spki-base64url',
          material: publicKey,
        },
      },
    ],
  };
}

function trimText(value, max = 240) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function locatorTimeout(timeout = 1_500) {
  return { timeout };
}

async function writeAtomicJson(targetPath, value) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, targetPath);
}

async function updateLatestSymlink(artifactDir, repoRoot) {
  const latestPath = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-browser-smoke', 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(artifactDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeAtomicJson(path.join(latestPath, 'latest-artifact.json'), { artifactDir });
  }
}

function viewportScreenshotOptions(path) {
  return {
    path,
    fullPage: false,
    animations: 'disabled',
  };
}

async function waitFor(label, predicate, { timeoutMs, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError ? `:${lastError instanceof Error ? lastError.message : String(lastError)}` : '';
  throw new Error(`${label}-timeout${suffix}`);
}

async function withTimeout(label, promise, timeoutMs) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label}-timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readGunLatestProof({ gunPeerUrl, minHeadlines, timeoutMs, systemWriterPin }) {
  const client = createClient({
    peers: [gunPeerUrl],
    requireSession: false,
    gunLocalStorage: false,
    gunRadisk: false,
    systemWriterPin,
  });
  client.markSessionReady();
  try {
    const indexReadTimeoutMs = Math.min(10_000, Math.max(2_000, Math.floor(timeoutMs / 12)));
    const storyReadTimeoutMs = Math.min(5_000, Math.max(1_500, Math.floor(timeoutMs / 24)));
    return await waitFor('gun-latest-index-readback', async () => {
      const latestIndex = await withTimeout('gun-latest-index-read', readNewsLatestIndex(client), indexReadTimeoutMs);
      const entries = Object.entries(latestIndex)
        .filter(([, timestamp]) => Number.isFinite(timestamp))
        .sort((left, right) => right[1] - left[1]);
      if (entries.length < minHeadlines) return null;
      const stories = [];
      for (const [storyId, updatedAt] of entries.slice(0, Math.max(minHeadlines, DEFAULT_GUN_READBACK_STORY_LIMIT))) {
        const story = await withTimeout('gun-story-read', readNewsStory(client, storyId), storyReadTimeoutMs);
        if (story) {
          const synthesis = story.topic_id
            ? await withTimeout(
              'gun-topic-synthesis-read',
              readTopicLatestSynthesis(client, story.topic_id),
              storyReadTimeoutMs,
            ).catch(() => null)
            : null;
          stories.push({
            storyId,
            topicId: story.topic_id,
            updatedAt,
            headline: story.headline,
            sourceCount: story.sources?.length ?? 0,
            sourceLabels: (story.sources ?? [])
              .map((source) => source.publisher || source.source || source.url)
              .filter(Boolean),
            acceptedSynthesisReady: Boolean(synthesis?.facts_summary?.trim() && (synthesis.frames?.length ?? 0) > 0),
            synthesisId: synthesis?.synthesis_id ?? null,
          });
        }
      }
      if (stories.length < minHeadlines) return null;
      return {
        latestIndexCount: entries.length,
        storyReadbackCount: stories.length,
        topStories: stories,
      };
    }, { timeoutMs, intervalMs: 2_000 });
  } finally {
    await Promise.race([
      client.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]).catch(() => {});
  }
}

function latestIndexRecordTimestamp(record) {
  const candidates = [
    record?.latest_activity_at,
    record?.updated_at,
    record?.published_at,
    record?._systemIssuedAt,
  ];
  for (const candidate of candidates) {
    const timestamp = Number(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function sourceLabel(source) {
  return String(source?.publisher || source?.source_id || source?.source || source?.url || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function storySourceLabels(story) {
  const sources = Array.isArray(story?.sources)
    ? story.sources
    : Array.isArray(story?.primary_sources)
      ? story.primary_sources
      : [];
  return sources.map(sourceLabel).filter(Boolean);
}

async function fetchJsonWithTimeout(url, timeoutMs, label = 'public-relay-json') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${label}-http-${response.status}:${text.slice(0, 240)}`);
    }
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${label}-json-parse:${error instanceof Error ? error.message : String(error)}:${text.slice(0, 240)}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function acceptedSynthesisReady(synthesis) {
  return Boolean(String(synthesis?.facts_summary ?? '').trim() && (synthesis?.frames?.length ?? 0) > 0);
}

async function readPublicRelaySynthesisCandidates({
  baseUrl,
  indexLimit = DEFAULT_PUBLIC_RELAY_SYNTHESIS_INDEX_LIMIT,
  scanLimit = DEFAULT_PUBLIC_RELAY_SYNTHESIS_SCAN_LIMIT,
  timeoutMs = 15_000,
} = {}) {
  const root = normalizeUrl(baseUrl || DEFAULT_BASE_URL);
  const indexUrl = new URL('/vh/news/latest-index', root);
  indexUrl.searchParams.set('limit', String(indexLimit));
  const index = await fetchJsonWithTimeout(indexUrl.href, timeoutMs, 'public-relay-latest-index');
  const records = Object.values(index?.records ?? {})
    .filter((record) => record && typeof record === 'object')
    .sort((left, right) => latestIndexRecordTimestamp(right) - latestIndexRecordTimestamp(left));
  const topStories = [];
  for (const record of records.slice(0, scanLimit)) {
    const storyId = String(record.story_id || record.storyId || '').trim();
    if (!storyId) continue;
    const storyUrl = new URL('/vh/news/story', root);
    storyUrl.searchParams.set('story_id', storyId);
    const storyPayload = await fetchJsonWithTimeout(storyUrl.href, timeoutMs, 'public-relay-news-story')
      .catch(() => null);
    const story = storyPayload?.story;
    if (!story?.story_id || !story?.topic_id || !story?.headline) continue;
    const synthesisUrl = new URL('/vh/topics/synthesis', root);
    synthesisUrl.searchParams.set('topic_id', story.topic_id);
    const synthesisPayload = await fetchJsonWithTimeout(
      synthesisUrl.href,
      timeoutMs,
      'public-relay-topic-synthesis',
    ).catch(() => null);
    const synthesis = synthesisPayload?.synthesis;
    if (!acceptedSynthesisReady(synthesis)) continue;
    const labels = storySourceLabels(story);
    topStories.push({
      storyId: story.story_id,
      topicId: story.topic_id,
      updatedAt: latestIndexRecordTimestamp(record) || Number(story.cluster_window_end) || Date.now(),
      headline: story.headline,
      sourceCount: labels.length,
      sourceLabels: labels,
      acceptedSynthesisReady: true,
      synthesisId: synthesis.synthesis_id ?? null,
    });
  }
  return {
    latestIndexCount: records.length,
    storyReadbackCount: topStories.length,
    topStories,
  };
}

async function readPublicPointAggregate({ gunPeerUrl, topicId, synthesisId, epoch, pointId }) {
  const client = createClient({
    peers: [gunPeerUrl],
    requireSession: false,
    gunLocalStorage: false,
    gunRadisk: false,
  });
  client.markSessionReady();
  try {
    return await readAggregates(client, topicId, synthesisId, epoch, pointId);
  } finally {
    await Promise.race([
      client.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]).catch(() => {});
  }
}

async function readPublicPointVoterRows({ gunPeerUrl, topicId, synthesisId, epoch, pointId }) {
  const client = createClient({
    peers: [gunPeerUrl],
    requireSession: false,
    gunLocalStorage: false,
    gunRadisk: false,
  });
  client.markSessionReady();
  try {
    return await readAggregateVoterRows(client, topicId, synthesisId, epoch, pointId);
  } finally {
    await Promise.race([
      client.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]).catch(() => {});
  }
}

async function addConsumerInitScript(context, gunPeerUrl) {
  await context.addInitScript({
    content: `
      window.__VH_NEWS_RUNTIME_ROLE = 'consumer';
      window.__VH_TEST_SESSION = false;
      window.__VH_EXPOSE_NEWS_STORE__ = true;
      window.__VH_GUN_PEERS__ = [${JSON.stringify(gunPeerUrl)}];
    `,
  });
}

async function refreshLatest(page, limit = 120, timeoutMs = DEFAULT_REFRESH_TIMEOUT_MS) {
  return page.evaluate(async ({ refreshLimit, refreshTimeoutMs }) => {
    const store = window.__VH_NEWS_STORE__;
    const refresh = store?.getState?.().refreshLatest;
    if (typeof refresh !== 'function') return { status: 'missing-refreshLatest' };

    let timeoutId;
    try {
      return await Promise.race([
        Promise.resolve(refresh(refreshLimit))
          .then(() => ({ status: 'ok' }))
          .catch((error) => ({
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          })),
        new Promise((resolve) => {
          timeoutId = setTimeout(() => resolve({ status: 'timeout' }), refreshTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timeoutId);
    }
  }, { refreshLimit: limit, refreshTimeoutMs: timeoutMs }).catch((error) => ({
    status: 'evaluate-error',
    message: error instanceof Error ? error.message : String(error),
  }));
}

async function visibleCards(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('article[data-testid^="news-card-"]'))
    .map((card) => {
      const headline = card.querySelector('[data-testid^="news-card-headline-"]');
      const hotness = card.querySelector('[data-testid^="news-card-hotness-"]');
      const meta = Array.from(card.querySelectorAll('p')).find((node) => (node.textContent ?? '').includes('Created '));
      if (!headline || !meta) return null;
      return {
        topicId: (headline.getAttribute('data-testid') ?? '').replace('news-card-headline-', ''),
        storyId: headline.getAttribute('data-story-id') ?? '',
        headline: (headline.textContent ?? '').replace(/\s+/g, ' ').trim(),
        meta: (meta.textContent ?? '').replace(/\s+/g, ' ').trim(),
        hotness: Number.parseFloat((hotness?.textContent ?? '').replace('Hotness', '').trim()) || 0,
        sourceLabels: Array.from(card.querySelectorAll('[data-testid^="source-badge-"]'))
          .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean),
      };
    })
    .filter((row) => row && row.topicId && row.storyId && row.headline));
}

async function summarizeFeedState(page) {
  return page.evaluate(() => {
    const store = window.__VH_NEWS_STORE__?.getState?.();
    return {
      href: window.location.href,
      visibleCardCount: document.querySelectorAll('article[data-testid^="news-card-"]').length,
      bodyExcerpt: (document.body?.innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 240),
      store: store
        ? {
          latestIndexCount: Array.isArray(store.latestIndex) ? store.latestIndex.length : null,
          storyCount: store.storiesById && typeof store.storiesById === 'object'
            ? Object.keys(store.storiesById).length
            : null,
          loading: Boolean(store.loading),
          error: store.error ? String(store.error).slice(0, 240) : null,
          peerCount: Array.isArray(store.peerConfig?.peers) ? store.peerConfig.peers.length : null,
        }
        : null,
    };
  });
}

function readbackStoryToVisibleCard(row) {
  return {
    topicId: row.topicId,
    storyId: row.storyId,
    headline: row.headline,
    meta: `Updated ${new Date(row.updatedAt).toISOString()}`,
    hotness: 0,
    sourceLabels: row.sourceLabels?.length
      ? row.sourceLabels
      : Array.from({ length: row.sourceCount }, (_, index) => `source-${index + 1}`),
  };
}

async function clickFeedRefresh(page) {
  const refreshButton = page.getByTestId('feed-refresh-button');
  if (!(await refreshButton.count().catch(() => 0))) return false;
  await refreshButton.click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500).catch(() => {});
  return true;
}

async function waitForHeadlines(page, minHeadlines, timeoutMs, progress = () => {}) {
  const startedAt = Date.now();
  let lastProgressAt = 0;
  return waitFor('public-feed-headlines', async () => {
    const rows = await visibleCards(page);
    if (rows.length >= minHeadlines) return rows;
    const now = Date.now();
    if (now - lastProgressAt >= 15_000) {
      lastProgressAt = now;
      const diagnostics = await withTimeout('headline-wait-diagnostics', summarizeFeedState(page), 3_000)
        .catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }));
      progress('headline-wait-diagnostics', {
        elapsedMs: now - startedAt,
        rows: rows.length,
        minHeadlines,
        diagnostics,
      });
    }
    await clickFeedRefresh(page);
    await page.evaluate(() => window.scrollBy(0, Math.max(400, window.innerHeight))).catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    return null;
  }, { timeoutMs, intervalMs: 1_000 });
}

function findVisibleStoryRow(rows, targetRow) {
  return rows.find((row) => row.storyId === targetRow.storyId)
    ?? rows.find((row) => row.topicId === targetRow.topicId)
    ?? null;
}

async function waitForTargetStoryCard(page, row, timeoutMs) {
  return waitFor('public-feed-target-story-card', async () => {
    if (await headlineLocator(page, row).isVisible().catch(() => false)) {
      return row;
    }

    const rows = await visibleCards(page);
    const visibleRow = findVisibleStoryRow(rows, row);
    if (visibleRow) {
      return visibleRow;
    }

    await refreshLatest(page, 120, DEFAULT_REFRESH_TIMEOUT_MS).catch(() => null);
    await clickFeedRefresh(page);
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(300).catch(() => {});
    return null;
  }, { timeoutMs, intervalMs: 1_000 });
}

async function gotoFeed(page, baseUrl, minHeadlines, timeoutMs, progress = () => {}) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
  return waitForHeadlines(page, minHeadlines, timeoutMs, progress);
}

async function ensureIdentity(page, baseUrl, label) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('user-link').click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  const welcome = page.getByTestId('welcome-msg');
  if (await welcome.isVisible().catch(() => false)) {
    return { created: false, label: trimText(await welcome.textContent()) };
  }
  const createButton = page.getByTestId('create-identity-btn');
  await createButton.waitFor({ state: 'visible', timeout: 30_000 });
  const suffix = `${Date.now().toString().slice(-7)}${Math.floor(Math.random() * 1000)}`;
  const username = `${label}${suffix}`.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24);
  const handle = username.toLowerCase().slice(0, 24);
  await page.fill('input[placeholder="Choose a username"]', username);
  await page.fill('input[placeholder="Choose a handle (letters, numbers, _)"]', handle);
  await waitFor('identity-create-ready', async () =>
    (await createButton.isEnabled().catch(() => false)) ? true : null,
  { timeoutMs: 60_000, intervalMs: 500 });
  await createButton.click();
  await welcome.waitFor({ state: 'visible', timeout: 45_000 });
  return { created: true, username, handle, label: trimText(await welcome.textContent()) };
}

function headlineLocator(page, row) {
  return page.locator(
    `[data-testid=${cssAttr(`news-card-headline-${row.topicId}`)}][data-story-id=${cssAttr(row.storyId)}]`,
  ).first();
}

async function openStory(page, row) {
  const headline = headlineLocator(page, row);
  const card = headline.locator('xpath=ancestor::article[1]');
  const back = card.getByTestId(`news-card-back-${row.topicId}`);
  if (await back.isVisible().catch(() => false)) {
    return card;
  }
  await headline.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  const toggle = card.getByTestId(`news-card-toggle-${row.topicId}`).first();
  const target = await toggle.isVisible().catch(() => false) ? toggle : headline;
  await target.click().catch(async (error) => {
    if (await back.isVisible().catch(() => false)) return;
    await headline.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
      }
    }).catch(() => {
      throw error;
    });
  });
  await card.getByTestId(`news-card-back-${row.topicId}`).waitFor({ state: 'visible', timeout: 30_000 });
  return card;
}

async function closeStory(card, row) {
  await card.getByTestId(`news-card-back-button-${row.topicId}`).click().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 300));
}

async function clickVisibleControl(locator, label, timeout = 15_000) {
  await locator.scrollIntoViewIfNeeded({ timeout }).catch(() => {});
  await locator.evaluate((element) => {
    if (element instanceof HTMLElement) {
      element.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }).catch(() => {});
  try {
    await locator.click({ timeout });
    return;
  } catch (error) {
    await locator.evaluate((element) => {
      if (element instanceof HTMLElement) {
        element.click();
      }
    }).catch(() => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label}-click-failed:${message}`);
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

function firstTestId(scope, testId) {
  const locator = scope.getByTestId(testId);
  return typeof locator.first === 'function' ? locator.first() : locator;
}

function isAcceptedSynthesisText(summaryText, voteButtons) {
  return summaryText.length > 20
    && !/\bpending\b/i.test(summaryText)
    && voteButtons > 0;
}

async function synthesisScopeCandidates(page, card, row) {
  const scopes = [card];
  if (page) {
    const storySuffix = String(row.storyId ?? '').replace(/^story-/, '');
    scopes.push(page.getByTestId(`news-card-${row.topicId}`).first());
    scopes.push(page.getByTestId(`feed-item-story-${storySuffix}`).first());
    scopes.push(page);
  }
  return scopes;
}

async function readVisibleSynthesis(scope, row) {
  const detail = firstTestId(scope, `news-card-detail-${row.topicId}`);
  const root = await detail.count().catch(() => 0) > 0 ? detail : scope;
  const summary = firstTestId(root, `news-card-summary-${row.topicId}`);
  const summaryText = trimText(await summary.textContent(locatorTimeout()).catch(() => ''), 2_000);
  const basis = trimText(await firstTestId(root, `news-card-summary-basis-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''));
  const provenance = trimText(await firstTestId(root, `news-card-synthesis-provenance-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''), 2_000);
  const voteButtons = await root.locator('[data-testid^="cell-vote-agree-"]').count().catch(() => 0);
  if (isAcceptedSynthesisText(summaryText, voteButtons)) {
    return { summaryText, basis, provenance, voteButtonCount: voteButtons };
  }
  return null;
}

async function waitForSynthesis(page, card, row, timeoutMs) {
  return waitFor('accepted-synthesis-visible', async () => {
    for (const scope of await synthesisScopeCandidates(page, card, row)) {
      const synthesis = await readVisibleSynthesis(scope, row);
      if (synthesis) {
        return synthesis;
      }
    }
    return null;
  }, { timeoutMs, intervalMs: 750 });
}

async function openStoryWithAcceptedSynthesis(page, candidateRows, analysisTimeoutMs) {
  const candidates = [];
  const seenStoryIds = new Set();
  for (const row of [
    ...candidateRows.filter((candidate) => candidate.sourceLabels.length >= 2),
    ...candidateRows,
  ]) {
    if (seenStoryIds.has(row.storyId)) continue;
    seenStoryIds.add(row.storyId);
    candidates.push(row);
  }

  const rejectedCandidates = [];
  const perCandidateTimeoutMs = Math.min(45_000, analysisTimeoutMs);
  for (const row of candidates.slice(0, 16)) {
    let card;
    try {
      card = await openStory(page, row);
    } catch (error) {
      rejectedCandidates.push({
        storyId: row.storyId,
        headline: row.headline,
        reason: `open-story-failed:${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    try {
      const synthesis = await waitForSynthesis(page, card, row, perCandidateTimeoutMs);
      return { row, card, synthesis, rejectedCandidates };
    } catch (error) {
      rejectedCandidates.push({
        storyId: row.storyId,
        headline: row.headline,
        reason: error instanceof Error ? error.message : String(error),
      });
      await closeStory(card, row);
    }
  }

  throw new Error(
    `accepted-synthesis-visible-timeout:${rejectedCandidates.map((item) => `${item.storyId}:${item.reason}`).join('|')}`,
  );
}

async function firstVoteTarget(card) {
  const button = card.locator('[data-testid^="cell-vote-agree-"]').first();
  await button.waitFor({ state: 'visible', timeout: 30_000 });
  const testId = await button.getAttribute('data-testid');
  const canonicalPointId = await button.getAttribute('data-canonical-point-id');
  if (!testId) throw new Error('missing-vote-button-testid');
  const pointId = testId.replace('cell-vote-agree-', '');
  const disagree = card.getByTestId(`cell-vote-disagree-${pointId}`);
  return {
    pointId,
    canonicalPointId,
    agree: button,
    disagree,
    beforeAgree: parseVoteCount(await button.textContent(locatorTimeout(5_000))),
    beforeDisagree: parseVoteCount(await disagree.textContent(locatorTimeout()).catch(() => '')),
  };
}

async function voteAgree(card, row, gunPeerUrl) {
  const target = await firstVoteTarget(card);
  const durablePointId = target.canonicalPointId || target.pointId;
  const synthesisId = parseSynthesisIdFromPointId(durablePointId);
  const publicBefore = synthesisId
    ? await withTimeout(
      'public-aggregate-before-read',
      readPublicPointAggregate({
        gunPeerUrl,
        topicId: row.topicId,
        synthesisId,
        epoch: 0,
        pointId: durablePointId,
      }),
      15_000,
    ).catch(() => null)
    : null;
  const publicRowsBefore = synthesisId
    ? await withTimeout(
      'public-voter-rows-before-read',
      readPublicPointVoterRows({
        gunPeerUrl,
        topicId: row.topicId,
        synthesisId,
        epoch: 0,
        pointId: durablePointId,
      }),
      15_000,
    ).catch(() => [])
    : [];
  await target.agree.click();
  await target.agree.waitFor({ state: 'visible', timeout: 10_000 });
  await waitFor('point-stance-write-readback', async () => {
    const pressed = await target.agree.getAttribute('aria-pressed', locatorTimeout()).catch(() => null);
    const count = parseVoteCount(await target.agree.textContent(locatorTimeout()).catch(() => ''));
    return pressed === 'true' && count >= target.beforeAgree + 1
      ? { ...target, afterAgree: count, afterDisagree: parseVoteCount(await target.disagree.textContent(locatorTimeout()).catch(() => '')) }
      : null;
  }, { timeoutMs: 45_000, intervalMs: 500 });
  const minimumPublicAgree = minimumPublicAgreeAfterVote(publicBefore, target.beforeAgree);
  const publicVoteProof = synthesisId
    ? await waitFor('public-vote-readback', async () => {
      const aggregate = await withTimeout(
        'public-aggregate-after-read',
        readPublicPointAggregate({
          gunPeerUrl,
          topicId: row.topicId,
          synthesisId,
          epoch: 0,
          pointId: durablePointId,
        }),
        15_000,
      ).catch(() => null);
      if (aggregate && aggregate.agree >= minimumPublicAgree) {
        return {
          source: 'aggregate',
          aggregate,
          voterRows: null,
        };
      }

      const rows = await withTimeout(
        'public-voter-rows-after-read',
        readPublicPointVoterRows({
          gunPeerUrl,
          topicId: row.topicId,
          synthesisId,
          epoch: 0,
          pointId: durablePointId,
        }),
        15_000,
      ).catch(() => []);
      const voterRows = publicAgreeVoterRowsAfterVote(publicRowsBefore, rows);
      return voterRows
        ? {
          source: 'voter_rows',
          aggregate,
          voterRows,
        }
        : null;
    }, { timeoutMs: 120_000, intervalMs: 3_000 })
    : null;
  const publicAggregate = publicVoteProof?.aggregate ?? null;
  const afterAgree = Math.max(
    publicVoteProof?.voterRows?.afterAgreeRows ?? 0,
    publicAggregate?.agree ?? 0,
    parseVoteCount(await target.agree.textContent(locatorTimeout()).catch(() => '')),
  );
  return {
    pointId: target.pointId,
    canonicalPointId: target.canonicalPointId,
    beforeAgree: target.beforeAgree,
    beforeDisagree: target.beforeDisagree,
    afterAgree,
    afterDisagree: parseVoteCount(await target.disagree.textContent(locatorTimeout()).catch(() => '')),
    publicAggregate,
    publicVoterRows: publicVoteProof?.voterRows ?? null,
    publicVoteProofSource: publicVoteProof?.source ?? null,
  };
}

async function firstVisibleLocator(locator) {
  const count = await locator.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) {
      return candidate;
    }
  }
  return count > 0 ? locator.first() : null;
}

async function findAgreeButtonByCanonical(card, canonicalPointId, fallbackPointId) {
  if (canonicalPointId) {
    const byCanonical = card.locator(
      `[data-testid^="cell-vote-agree-"][data-canonical-point-id=${cssAttr(canonicalPointId)}]`,
    );
    const visibleCanonical = await firstVisibleLocator(byCanonical);
    if (visibleCanonical) return visibleCanonical;
  }
  const byFallback = card.getByTestId(`cell-vote-agree-${fallbackPointId}`);
  return (await firstVisibleLocator(byFallback)) ?? byFallback.first();
}

async function visibleAgreeVoteCount(scope, voteProof) {
  const agree = await findAgreeButtonByCanonical(scope, voteProof.canonicalPointId, voteProof.pointId);
  await agree.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => {});
  return {
    agree,
    count: parseVoteCount(await agree.textContent(locatorTimeout()).catch(() => '')),
  };
}

function storyThreadVisibilityTimeoutMs(commentVisibilityTimeoutMs = DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS) {
  return Math.max(
    45_000,
    parsePositiveInt(commentVisibilityTimeoutMs, DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS),
  );
}

async function waitForStoryThreadHead(page, sectionId, timeoutMs) {
  const threadHead = page.getByTestId(`${sectionId}-thread-head`);
  const formError = page.getByTestId('thread-form-error');
  const result = await waitFor('story-thread-head-visible', async () => {
    if (await threadHead.isVisible().catch(() => false)) {
      return { status: 'visible' };
    }
    if (await formError.isVisible().catch(() => false)) {
      const message = trimText(await formError.textContent(locatorTimeout()).catch(() => ''), 1_000);
      return { status: 'error', message };
    }
    return null;
  }, { timeoutMs, intervalMs: 500 });
  if (result.status === 'error') {
    throw new Error(`story-thread-create-error:${result.message || 'unknown'}`);
  }
}

async function ensureStoryThread(page, row, commentVisibilityTimeoutMs = DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS) {
  const sectionId = `news-card-${row.topicId}`;
  const section = page.getByTestId(`${sectionId}-discussion`);
  await section.waitFor({ state: 'visible', timeout: 30_000 });
  const composeToggle = page.getByTestId(`${sectionId}-discussion-compose-toggle`);
  const newThreadToggle = page.getByTestId(`${sectionId}-discussion-new-thread-toggle`);
  const action = await waitFor('story-thread-action-ready', async () => {
    if (await composeToggle.isVisible().catch(() => false)) {
      return 'reply';
    }
    if (await newThreadToggle.isVisible().catch(() => false)) {
      return 'new-thread';
    }
    return null;
  }, { timeoutMs: 30_000, intervalMs: 500 });
  if (action === 'reply') {
    return { sectionId, createdThread: false };
  }
  try {
    await clickVisibleControl(newThreadToggle, 'story-thread-new-thread');
  } catch (error) {
    if (await composeToggle.isVisible().catch(() => false)) {
      return { sectionId, createdThread: false };
    }
    throw error;
  }
  const trustGate = page.getByTestId(`${sectionId}-discussion-new-thread-trust-gate`);
  const threadContent = page.getByTestId('thread-content');
  try {
    await waitFor('story-thread-form-unlocked', async () =>
      (await threadContent.isVisible().catch(() => false)) ? true : null,
    { timeoutMs: 30_000, intervalMs: 500 });
  } catch (error) {
    if (await trustGate.isVisible().catch(() => false)) {
      throw new Error('story-thread-create-blocked-by-trust-gate');
    }
    throw error;
  }
  const content = `Launch smoke thread for ${row.storyId} at ${new Date().toISOString()}`;
  await threadContent.fill(content);
  await clickVisibleControl(page.getByTestId('submit-thread-btn'), 'story-thread-submit');
  await waitForStoryThreadHead(page, sectionId, storyThreadVisibilityTimeoutMs(commentVisibilityTimeoutMs));
  await composeToggle.waitFor({ state: 'visible', timeout: 30_000 });
  return { sectionId, createdThread: true, threadSeedContent: content };
}

async function postedCommentVisible(page, body) {
  const query = Promise.resolve().then(() => page.evaluate((expected) => {
    const nodes = Array.from(document.querySelectorAll('[data-testid^="comment-"]'));
    return nodes.some((node) => {
      const testId = node.getAttribute('data-testid') ?? '';
      if (
        testId.startsWith('comment-composer')
        || testId.startsWith('comment-stream')
        || testId.startsWith('comment-hidden')
      ) {
        return false;
      }
      if (!/^comment-[0-9a-f][0-9a-f-]{7,}/i.test(testId)) return false;
      return (node.textContent ?? '').includes(expected);
    });
  }, body));
  return Boolean(await withTimeout('posted-comment-visible-query', query, DEFAULT_POSTED_COMMENT_QUERY_TIMEOUT_MS)
    .catch(() => false));
}

async function createStoryComment(page, row, commentVisibilityTimeoutMs = DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS) {
  const thread = await ensureStoryThread(page, row, commentVisibilityTimeoutMs);
  await clickVisibleControl(page.getByTestId(`${thread.sectionId}-discussion-compose-toggle`), 'story-comment-compose');
  const body = `Launch smoke reply ${Date.now()} ${Math.floor(Math.random() * 1000)}`;
  await page.getByTestId('comment-composer').fill(body);
  await clickVisibleControl(page.getByTestId('submit-comment-btn'), 'story-comment-submit');
  await waitFor('story-comment-submit-complete', async () => {
    const composerError = page.getByTestId('comment-composer-error');
    if (await composerError.isVisible().catch(() => false)) {
      throw new Error(`story-comment-submit-error:${trimText(await composerError.textContent(locatorTimeout()), 1_000)}`);
    }
    if (await postedCommentVisible(page, body)) return true;
    const composerVisible = await page.getByTestId('comment-composer').isVisible().catch(() => false);
    return composerVisible ? null : true;
  }, { timeoutMs: 90_000, intervalMs: 500 });
  await waitFor('story-comment-visible', async () =>
    (await postedCommentVisible(page, body)) ? true : null,
  { timeoutMs: commentVisibilityTimeoutMs, intervalMs: 500 });
  const countText = trimText(await page.getByTestId(`${thread.sectionId}-discussion-count`).textContent().catch(() => ''));
  return { ...thread, body, countText };
}

async function reloadStoryDetailForNextStep(page, baseUrl, row, analysisTimeoutMs, progress = () => {}) {
  progress('post-vote-detail-reload-start', { storyId: row.storyId });
  await navigateToAppRoute(page, storyDetailUrl(baseUrl, row.storyId), {
    label: 'post-vote-detail-route',
    progress,
  });
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
  const pageScopedSynthesis = await waitForSynthesis(page, page, row, analysisTimeoutMs)
    .catch((error) => {
      progress('post-vote-detail-route-scope-wait-failed', {
        storyId: row.storyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  if (pageScopedSynthesis) {
    progress('post-vote-detail-route-scope-visible', { storyId: row.storyId });
    progress('post-vote-detail-reload-complete', { storyId: row.storyId });
    return { row, card: page };
  }
  let routedRow;
  try {
    routedRow = await waitForTargetStoryCard(page, row, 120_000);
  } catch (error) {
    progress('post-vote-detail-route-fallback', {
      storyId: row.storyId,
      error: error instanceof Error ? error.message : String(error),
    });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
    routedRow = await waitForTargetStoryCard(page, row, 120_000);
  }
  const card = await openStory(page, routedRow);
  await waitForSynthesis(page, card, routedRow, analysisTimeoutMs);
  progress('post-vote-detail-reload-complete', { storyId: routedRow.storyId });
  return { row: routedRow, card };
}

async function verifyReloadPersistence(
  page,
  baseUrl,
  row,
  voteProof,
  commentBody,
  analysisTimeoutMs,
  commentVisibilityTimeoutMs = DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS,
  progress = () => {},
) {
  progress('reload-start', { storyId: row.storyId });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
  progress('reload-domcontentloaded', { url: page.url() || baseUrl });
  let routedRow = row;
  let card = page;
  let synthesis = await waitForSynthesis(page, page, row, analysisTimeoutMs)
    .catch((error) => {
      progress('reload-detail-scope-wait-failed', {
        storyId: row.storyId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
  if (synthesis) {
    progress('reload-detail-scope-visible', { storyId: row.storyId });
  } else {
    progress('reload-detail-route-retry-feed', { storyId: row.storyId });
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
    await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
    await waitForHeadlines(page, 1, 90_000, progress);
    routedRow = await waitForTargetStoryCard(page, row, 90_000);
    progress('reload-feed-route-visible');
    card = await openStory(page, routedRow);
    progress('reload-story-open');
    synthesis = await waitForSynthesis(page, card, routedRow, analysisTimeoutMs);
  }
  progress('reload-synthesis-visible');
  const agree = await findAgreeButtonByCanonical(card, voteProof.canonicalPointId, voteProof.pointId);
  await waitFor('reload-vote-persistence', async () =>
    (await agree.getAttribute('aria-pressed', locatorTimeout()).catch(() => null)) === 'true',
  { timeoutMs: 45_000, intervalMs: 500 });
  progress('reload-vote-visible');
  await waitFor('reload-comment-persistence', async () =>
    (await postedCommentVisible(page, commentBody)) ? true : null,
  { timeoutMs: commentVisibilityTimeoutMs, intervalMs: 500 });
  progress('reload-comment-visible');
  return {
    votePressed: await agree.getAttribute('aria-pressed', locatorTimeout()),
    commentVisible: true,
    url: page.url() || baseUrl,
  };
}

async function verifySecondBrowser({
  browser,
  baseUrl,
  gunPeerUrl,
  row,
  voteProof,
  commentBody,
  analysisTimeoutMs,
  commentVisibilityTimeoutMs = DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS,
  secondBrowserVoteVisibilityTimeoutMs = DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS,
  progress = () => {},
}) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await addConsumerInitScript(context, gunPeerUrl);
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  let lastVoteDiagnostics = null;
  try {
    progress('second-browser-start', { storyId: row.storyId });
    const identity = await ensureIdentity(page, baseUrl, 'launchsmokepeer');
    progress('second-browser-identity-complete', identity);
    await navigateToAppRoute(page, storyDetailUrl(baseUrl, row.storyId), {
      label: 'second-browser-detail-route',
      progress,
    });
    await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
    let routedRow = row;
    let card = page;
    try {
      const detailScopeSynthesis = await waitForSynthesis(page, page, row, Math.min(30_000, analysisTimeoutMs))
        .catch((error) => {
          progress('second-browser-detail-route-scope-wait-failed', {
            storyId: row.storyId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
      if (detailScopeSynthesis) {
        progress('second-browser-detail-route-scope-visible', { storyId: row.storyId });
      } else {
        routedRow = await waitForTargetStoryCard(page, row, 60_000);
        progress('second-browser-detail-route-visible');
        card = await openStory(page, routedRow);
        progress('second-browser-story-open');
        await waitForSynthesis(page, card, routedRow, Math.min(60_000, analysisTimeoutMs));
      }
    } catch (directError) {
      progress('second-browser-detail-route-retry-feed', {
        storyId: row.storyId,
        error: directError instanceof Error ? directError.message : String(directError),
      });
      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
        await waitForHeadlines(page, 1, 90_000, progress);
        routedRow = await waitForTargetStoryCard(page, row, 60_000);
        progress('second-browser-feed-route-visible');
        card = await openStory(page, routedRow);
        progress('second-browser-feed-story-open');
        await waitForSynthesis(page, card, routedRow, Math.min(60_000, analysisTimeoutMs));
      } catch (feedError) {
        progress('second-browser-detail-scope-fallback', {
          storyId: row.storyId,
          error: feedError instanceof Error ? feedError.message : String(feedError),
        });
        await navigateToAppRoute(page, storyDetailUrl(baseUrl, row.storyId), {
          label: 'second-browser-detail-scope-route',
          progress,
        });
        await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
        routedRow = row;
        card = page;
        await waitForSynthesis(page, card, routedRow, analysisTimeoutMs);
      }
    }
    progress('second-browser-synthesis-visible');
    let lastVoteReopenAt = 0;
    const voteCount = await waitFor('second-browser-vote-visibility', async () => {
      const { count } = await visibleAgreeVoteCount(page, voteProof);
      lastVoteDiagnostics = { domCount: count, expectedCount: voteProof.afterAgree };
      if (count >= voteProof.afterAgree) {
        return count;
      }

      const durablePointId = voteProof.canonicalPointId || voteProof.pointId;
      const synthesisId = parseSynthesisIdFromPointId(durablePointId);
      const now = Date.now();
      if (synthesisId && now - lastVoteReopenAt >= 15_000) {
        const publicAggregate = await withTimeout(
          'second-browser-public-aggregate-read',
          readPublicPointAggregate({
            gunPeerUrl,
            topicId: row.topicId,
            synthesisId,
            epoch: 0,
            pointId: durablePointId,
          }),
          15_000,
        ).catch(() => null);
        lastVoteDiagnostics = {
          ...lastVoteDiagnostics,
          publicAggregate,
        };
        if (publicAggregate?.agree >= voteProof.afterAgree) {
          lastVoteReopenAt = now;
          progress('second-browser-vote-public-ready-reopen', {
            voteCount: publicAggregate.agree,
            expectedCount: voteProof.afterAgree,
          });
          await navigateToAppRoute(page, storyDetailUrl(baseUrl, row.storyId), {
            label: 'second-browser-vote-reopen-route',
            progress,
          });
          await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
          const detailScopeSynthesis = await waitForSynthesis(page, page, row, Math.min(20_000, analysisTimeoutMs))
            .catch((error) => {
              progress('second-browser-vote-reopen-detail-scope-failed', {
                storyId: row.storyId,
                error: error instanceof Error ? error.message : String(error),
              });
              return null;
            });
          if (detailScopeSynthesis) {
            progress('second-browser-vote-reopen-detail-scope-visible', { storyId: row.storyId });
            card = page;
            routedRow = row;
            const reopened = await visibleAgreeVoteCount(page, voteProof).catch(() => null);
            lastVoteDiagnostics = {
              ...lastVoteDiagnostics,
              publicAggregate,
              reopenedDomCount: reopened?.count ?? null,
            };
            if (reopened && reopened.count >= voteProof.afterAgree) {
              return reopened.count;
            }
          } else {
            try {
              await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
              await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
              await waitForHeadlines(page, 1, 30_000, progress);
              routedRow = await waitForTargetStoryCard(page, row, 30_000);
              progress('second-browser-vote-reopen-feed-route-visible');
              card = await openStory(page, routedRow);
              await waitForSynthesis(page, card, routedRow, Math.min(30_000, analysisTimeoutMs));
            } catch (error) {
              progress('second-browser-vote-reopen-feed-route-failed', {
                storyId: row.storyId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }

      return null;
    }, { timeoutMs: secondBrowserVoteVisibilityTimeoutMs, intervalMs: 500 });
    progress('second-browser-vote-visible', { voteCount });
    await waitFor('second-browser-comment-visibility', async () =>
      (await postedCommentVisible(page, commentBody)) ? true : null,
    { timeoutMs: commentVisibilityTimeoutMs, intervalMs: 500 });
    progress('second-browser-comment-visible');
    return {
      voteCount,
      commentVisible: true,
    };
  } catch (error) {
    progress('second-browser-diagnostics', {
      error: error instanceof Error ? error.message : String(error),
      lastVoteDiagnostics,
    });
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function runPublicFeedBrowserSmoke({
  repoRoot = DEFAULT_REPO_ROOT,
  env = process.env,
  launchBrowser,
} = {}) {
  const baseUrl = normalizeUrl(env.VH_PUBLIC_FEED_APP_URL || env.VH_LIVE_BASE_URL || DEFAULT_BASE_URL);
  const gunPeerUrl = normalizeGunPeer(env.VH_PUBLIC_FEED_GUN_PEER_URL || env.VITE_GUN_PEERS?.replace(/^\[?"?|"?\]?$/g, '') || DEFAULT_GUN_PEER_URL);
  const launchBrowserFn = launchBrowser ?? (() => launchPublicFeedBrowser({ env, baseUrl, gunPeerUrl }));
  const minHeadlines = parsePositiveInt(env.VH_PUBLIC_FEED_SMOKE_MIN_HEADLINES, DEFAULT_MIN_HEADLINES);
  const readyTimeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_SMOKE_READY_TIMEOUT_MS, DEFAULT_READY_TIMEOUT_MS);
  const analysisTimeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_SMOKE_ANALYSIS_TIMEOUT_MS, DEFAULT_ANALYSIS_TIMEOUT_MS);
  const commentVisibilityTimeoutMs = parsePositiveInt(
    env.VH_PUBLIC_FEED_SMOKE_COMMENT_VISIBILITY_TIMEOUT_MS,
    DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS,
  );
  const secondBrowserVoteVisibilityTimeoutMs = parsePositiveInt(
    env.VH_PUBLIC_FEED_SMOKE_SECOND_BROWSER_VOTE_TIMEOUT_MS,
    DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS,
  );
  const artifactDir = resolveArtifactDir(env, repoRoot);
  const logs = [];
  const progress = (step, details = {}) => {
    logs.push({ type: 'progress', text: step, details });
    const suffix = Object.keys(details).length ? ` ${JSON.stringify(details)}` : '';
    console.error(`[vh:public-feed-smoke] ${step}${suffix}`);
  };
  const summaryPath = path.join(artifactDir, 'public-feed-browser-smoke-summary.json');
  const logsPath = path.join(artifactDir, 'public-feed-browser-smoke-browser-logs.json');
  const screenshots = {
    initialFeed: path.join(artifactDir, '01-feed-initial.png'),
    afterRefresh: path.join(artifactDir, '02-feed-after-refresh.png'),
    afterScroll: path.join(artifactDir, '03-feed-after-scroll.png'),
    storyDetail: path.join(artifactDir, '04-story-detail-synthesis.png'),
    afterComment: path.join(artifactDir, '05-story-comment.png'),
    reloadPersistence: path.join(artifactDir, '06-reload-persistence.png'),
  };
  await mkdir(artifactDir, { recursive: true });

  let browser;
  let context;
  let summary = {
    schemaVersion: 'public-feed-browser-smoke-summary-v1',
    generatedAt: new Date().toISOString(),
    artifactDir,
    artifactPaths: { summaryPath, logsPath, screenshots },
    config: {
      baseUrl,
      gunPeerUrl,
      minHeadlines,
      readyTimeoutMs,
      analysisTimeoutMs,
      commentVisibilityTimeoutMs,
      secondBrowserVoteVisibilityTimeoutMs,
    },
    status: 'fail',
    checks: {},
  };

  try {
    const gunReadback = await readGunLatestProof({
      gunPeerUrl,
      minHeadlines,
      timeoutMs: readyTimeoutMs,
      systemWriterPin: loadSystemWriterPin(repoRoot, env),
    });
    const publicRelaySynthesisReadback = await readPublicRelaySynthesisCandidates({
      baseUrl,
      timeoutMs: Math.min(15_000, Math.max(5_000, Math.floor(readyTimeoutMs / 24))),
    }).catch((error) => {
      progress('public-relay-synthesis-readback-unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { latestIndexCount: 0, storyReadbackCount: 0, topStories: [] };
    });
    progress('public-relay-synthesis-readback', {
      latestIndexCount: publicRelaySynthesisReadback.latestIndexCount,
      storyReadbackCount: publicRelaySynthesisReadback.storyReadbackCount,
    });
    browser = await launchBrowserFn();
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1200 } });
    await addConsumerInitScript(context, gunPeerUrl);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: formatError(error) }));

    progress('identity-start');
    const identity = await ensureIdentity(page, baseUrl, 'launchsmoke');
    progress('identity-complete', identity);
    progress('initial-feed-wait-start', { minHeadlines });
    const initialCards = await gotoFeed(page, baseUrl, minHeadlines, readyTimeoutMs, progress);
    await page.screenshot(viewportScreenshotOptions(screenshots.initialFeed));
    progress('initial-feed-screenshot', { count: initialCards.length });
    const cardsWithSources = initialCards.filter((card) => card.sourceLabels.length > 0);
    const cardsWithTimestamps = initialCards.filter((card) => /Created .+Updated /i.test(card.meta));
    if (cardsWithSources.length < minHeadlines) throw new Error(`source-labels-missing:${cardsWithSources.length}/${minHeadlines}`);
    if (cardsWithTimestamps.length < minHeadlines) throw new Error(`timestamps-missing:${cardsWithTimestamps.length}/${minHeadlines}`);

    await clickFeedRefresh(page);
    const afterRefreshCards = await waitForHeadlines(page, minHeadlines, 60_000, progress);
    await page.screenshot(viewportScreenshotOptions(screenshots.afterRefresh));
    progress('refresh-screenshot', { count: afterRefreshCards.length });

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_500);
    const afterScrollCards = await visibleCards(page);
    await page.screenshot(viewportScreenshotOptions(screenshots.afterScroll));
    progress('scroll-screenshot', { count: afterScrollCards.length });
    if (afterScrollCards.length < minHeadlines) throw new Error(`scroll-feed-lost-headlines:${afterScrollCards.length}/${minHeadlines}`);

    await page.evaluate(() => window.scrollTo(0, 0));
    const topCards = await waitForHeadlines(page, minHeadlines, 60_000, progress);
    const synthesisReadyStoryIds = new Set(
      gunReadback.topStories
        .filter((story) => story.acceptedSynthesisReady)
        .map((story) => story.storyId),
    );
    const synthesisReadyReadbackRows = gunReadback.topStories
      .filter((story) => story.acceptedSynthesisReady && story.topicId && story.storyId && story.headline)
      .map(readbackStoryToVisibleCard);
    const publicRelaySynthesisReadyRows = publicRelaySynthesisReadback.topStories
      .filter((story) => story.acceptedSynthesisReady && story.topicId && story.storyId && story.headline)
      .map(readbackStoryToVisibleCard);
    const synthesisReadyCards = topCards.filter((card) => synthesisReadyStoryIds.has(card.storyId));
    let detailCandidates = synthesisReadyCards.length > 0 ? synthesisReadyCards : [
      ...publicRelaySynthesisReadyRows,
      ...synthesisReadyReadbackRows,
      ...topCards,
    ];
    progress('detail-candidates', {
      ready: detailCandidates.filter((card) => synthesisReadyStoryIds.has(card.storyId)).length,
      publicRelayReady: publicRelaySynthesisReadyRows.length,
      total: detailCandidates.length,
    });
    const routeFocus = synthesisReadyCards[0] ?? publicRelaySynthesisReadyRows[0] ?? synthesisReadyReadbackRows[0];
    if (routeFocus) {
      const navigation = await navigateToAppRoute(page, storyDetailUrl(baseUrl, routeFocus.storyId), {
        label: 'detail-route-focus',
        progress,
        optional: true,
      });
      let routedReadyCard = null;
      if (navigation.reachedTarget) {
        await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
        routedReadyCard = await waitForTargetStoryCard(page, routeFocus, 120_000);
        if (routedReadyCard) {
          const routedCards = await visibleCards(page);
          detailCandidates = [
            routedReadyCard,
            ...routedCards.filter((card) => card.storyId !== routedReadyCard.storyId && synthesisReadyStoryIds.has(card.storyId)),
            ...synthesisReadyReadbackRows.filter((card) => card.storyId !== routedReadyCard.storyId),
          ];
        }
      } else {
        progress('detail-route-focus-skipped', {
          storyId: routeFocus.storyId,
          currentUrl: navigation.url,
          reason: 'navigation-aborted-before-target',
        });
      }
      progress('detail-route-focus', {
        storyId: routeFocus.storyId,
        routed: Boolean(routedReadyCard),
      });
    }
    const detail = await openStoryWithAcceptedSynthesis(page, detailCandidates, analysisTimeoutMs);
    const target = detail.row;
    const card = detail.card;
    const synthesis = detail.synthesis;
    await page.screenshot(viewportScreenshotOptions(screenshots.storyDetail));
    progress('story-detail-screenshot', { storyId: target.storyId, topicId: target.topicId });
    const voteProof = await voteAgree(card, target, gunPeerUrl);
    progress('vote-readback', { pointId: voteProof.pointId, afterAgree: voteProof.afterAgree });
    await reloadStoryDetailForNextStep(page, baseUrl, target, analysisTimeoutMs, progress);
    const comment = await withTimeout(
      'story-comment-overall',
      createStoryComment(page, target, commentVisibilityTimeoutMs),
      Math.max(180_000, Math.min(300_000, analysisTimeoutMs + 60_000)),
    );
    await page.screenshot(viewportScreenshotOptions(screenshots.afterComment));
    progress('comment-screenshot', { threadId: comment.sectionId, body: comment.body });
    const reload = await withTimeout(
      'reload-persistence-overall',
      verifyReloadPersistence(
        page,
        baseUrl,
        target,
        voteProof,
        comment.body,
        analysisTimeoutMs,
        commentVisibilityTimeoutMs,
        progress,
      ),
      Math.max(180_000, Math.min(300_000, analysisTimeoutMs + 120_000)),
    );
    await page.screenshot(viewportScreenshotOptions(screenshots.reloadPersistence));
    progress('reload-persistence-screenshot');
    const secondBrowser = await withTimeout(
      'second-browser-overall',
      verifySecondBrowser({
        browser,
        baseUrl,
        gunPeerUrl,
        row: target,
        voteProof,
        commentBody: comment.body,
        analysisTimeoutMs,
        commentVisibilityTimeoutMs,
        secondBrowserVoteVisibilityTimeoutMs,
        progress,
      }),
      Math.max(
        180_000,
        Math.min(
          720_000,
          analysisTimeoutMs + secondBrowserVoteVisibilityTimeoutMs + commentVisibilityTimeoutMs + 30_000,
        ),
      ),
    );
    progress('second-browser-complete');

    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: 'pass',
      checks: {
        daemonGunLatestIndexReadback: gunReadback,
        publicRelaySynthesisReadback,
        identityCreation: identity,
        currentPublicHeadlinesVisible: {
          count: initialCards.length,
          topCards: initialCards.slice(0, 8),
        },
        sourceLabelsVisible: {
          count: cardsWithSources.length,
        },
        timestampsVisible: {
          count: cardsWithTimestamps.length,
        },
        refreshWorks: {
          count: afterRefreshCards.length,
          topStoryIds: afterRefreshCards.slice(0, 8).map((card) => card.storyId),
        },
        scrollWorks: {
          count: afterScrollCards.length,
        },
        storyDetailOpens: {
          storyId: target.storyId,
          topicId: target.topicId,
          headline: target.headline,
          rejectedPendingCandidates: detail.rejectedCandidates,
        },
        acceptedAnalysisSynthesisVisible: synthesis,
        pointStanceWriteReadback: voteProof,
        storyThreadCreateComment: comment,
        reloadPersistence: reload,
        secondBrowserVisibility: secondBrowser,
      },
    };
  } catch (error) {
    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: 'fail',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: formatError(error),
    };
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await writeAtomicJson(logsPath, {
      schemaVersion: 'public-feed-browser-smoke-browser-logs-v1',
      generatedAt: new Date().toISOString(),
      logs,
    });
    await writeAtomicJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
  }

  console.log(JSON.stringify({
    status: summary.status,
    artifactDir,
    summaryPath,
    checks: Object.keys(summary.checks ?? {}),
  }, null, 2));
  if (summary.status !== 'pass') {
    throw new Error(summary.errorMessage || 'public-feed-browser-smoke-failed');
  }
  return summary;
}

async function main() {
  await runPublicFeedBrowserSmoke();
}

export const publicFeedBrowserSmokeInternal = {
  cssAttr,
  boolEnv,
  buildChromiumHostResolverRules,
  normalizeGunPeer,
  normalizeUrl,
  normalizePublicHostname,
  parseChromiumArgs,
  parseDelimitedHosts,
  minimumPublicAgreeAfterVote,
  publicAgreeVoterRowsAfterVote,
  publicSmokeBrowserHostnames,
  firstVisibleLocator,
  parseSynthesisIdFromPointId,
  parsePositiveInt,
  parseVoteCount,
  DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS,
  postedCommentVisible,
  ensureStoryThread,
  ensureIdentity,
  readFixtureConst,
  refreshLatest,
  findVisibleStoryRow,
  resolveArtifactDir,
  isAcceptedSynthesisText,
  loadSystemWriterPin,
  readPublicRelaySynthesisCandidates,
  storyThreadVisibilityTimeoutMs,
  storyDetailUrl,
  isNavigationAbortError,
  navigateToAppRoute,
  viewportScreenshotOptions,
  waitForStoryThreadHead,
  withTimeout,
};

export { runPublicFeedBrowserSmoke };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => {
      // Gun can leave relay sockets/timers alive after all evidence is written.
      process.exit(0);
    })
    .catch((error) => {
      console.error('[vh:public-feed-smoke] failed', error);
      process.exit(1);
    });
}
