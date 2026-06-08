#!/usr/bin/env node

import { chromium } from '@playwright/test';
import {
  createClient,
  readAggregateVoterRows,
  readAggregatesWithRelayRestFallback as readAggregates,
  readNewsLatestIndexPageWithRelayRestFallback,
  readNewsSynthesisLifecycleStatusWithRelayRestFallback,
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
const DEFAULT_INITIAL_OPEN_TIMEOUT_MS = 45_000;
const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;
const DEFAULT_POSTED_COMMENT_QUERY_TIMEOUT_MS = 5_000;
const DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS = 120_000;
const DEFAULT_SECOND_BROWSER_VOTE_VISIBILITY_TIMEOUT_MS = 120_000;
const DEFAULT_GUN_READBACK_STORY_LIMIT = 16;
const DEFAULT_PUBLIC_RELAY_SYNTHESIS_INDEX_LIMIT = 80;
const DEFAULT_PUBLIC_FEED_MVP_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;
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

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function loadExplicitSystemWriterPin(env = process.env) {
  const explicit = env.VITE_NEWS_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VH_NEWS_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VITE_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VH_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VITE_E2E_SYSTEM_WRITER_PIN_JSON?.trim()
    || env.VH_E2E_SYSTEM_WRITER_PIN_JSON?.trim();
  return explicit ? JSON.parse(explicit) : null;
}

function loadFixtureSystemWriterPin(repoRoot = DEFAULT_REPO_ROOT) {
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

function loadRepoSystemWriterPin(repoRoot = DEFAULT_REPO_ROOT) {
  try {
    return JSON.parse(readFileSync(
      path.join(repoRoot, 'apps', 'web-pwa', 'src', 'luma', 'system-writer-pin.json'),
      'utf8',
    ));
  } catch {
    return null;
  }
}

function loadSystemWriterPin(repoRoot = DEFAULT_REPO_ROOT, env = process.env) {
  return loadExplicitSystemWriterPin(env)
    ?? loadRepoSystemWriterPin(repoRoot)
    ?? loadFixtureSystemWriterPin(repoRoot);
}

function extractViteEnvString(source, name) {
  const marker = `${name}:`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  let cursor = markerIndex + marker.length;
  while (/\s/.test(source[cursor] ?? '')) cursor += 1;
  const quote = source[cursor];
  if (quote !== '"' && quote !== "'") return null;
  let escaped = false;
  for (let end = cursor + 1; end < source.length; end += 1) {
    const char = source[end];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === quote) {
      const literal = source.slice(cursor, end + 1);
      return Function(`"use strict"; return (${literal});`)();
    }
  }
  return null;
}

async function fetchDeployedSystemWriterPin(baseUrl, fetchImpl = fetch) {
  if (typeof fetchImpl !== 'function') return null;
  const appUrl = new URL(baseUrl);
  const htmlResponse = await fetchImpl(appUrl.href, { headers: { accept: 'text/html' } });
  if (!htmlResponse.ok) return null;
  const html = await htmlResponse.text();
  const initialScriptUrls = new Set();
  const scriptPattern = /<script\b[^>]*\bsrc=["']([^"']+\.js)["'][^>]*>/gi;
  const preloadPattern = /<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']([^"']+\.js)["'][^>]*>/gi;
  for (const pattern of [scriptPattern, preloadPattern]) {
    for (const match of html.matchAll(pattern)) {
      initialScriptUrls.add(new URL(match[1], appUrl).href);
    }
  }
  if (initialScriptUrls.size === 0) return null;

  const queue = [...initialScriptUrls];
  const visited = new Set();
  const maxScripts = 32;
  while (queue.length > 0 && visited.size < maxScripts) {
    const scriptHref = queue.shift();
    if (!scriptHref || visited.has(scriptHref)) continue;
    visited.add(scriptHref);

    const scriptResponse = await fetchImpl(scriptHref, {
      headers: { accept: 'application/javascript,text/javascript,*/*' },
    });
    if (!scriptResponse.ok) continue;
    const script = await scriptResponse.text();
    const pinJson = extractViteEnvString(script, 'VITE_NEWS_SYSTEM_WRITER_PIN_JSON')
      || extractViteEnvString(script, 'VITE_SYSTEM_WRITER_PIN_JSON');
    if (pinJson) return JSON.parse(pinJson);

    for (const match of script.matchAll(/["']([^"']+\.js)["']/g)) {
      const candidate = new URL(match[1], scriptHref).href;
      if (new URL(candidate).origin === appUrl.origin && !visited.has(candidate)) {
        queue.push(candidate);
      }
    }
  }
  return null;
}

async function resolveSystemWriterPin({ repoRoot = DEFAULT_REPO_ROOT, env = process.env, baseUrl, progress = () => {} } = {}) {
  const explicit = loadExplicitSystemWriterPin(env);
  if (explicit) {
    progress('system-writer-pin-source', { source: 'env' });
    return explicit;
  }
  if (baseUrl) {
    try {
      const deployed = await fetchDeployedSystemWriterPin(baseUrl);
      if (deployed) {
        progress('system-writer-pin-source', { source: 'deployed-app' });
        return deployed;
      }
    } catch (error) {
      progress('system-writer-pin-deployed-app-unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const repoPin = loadRepoSystemWriterPin(repoRoot);
  if (repoPin) {
    progress('system-writer-pin-source', { source: 'repo-public-pin' });
    return repoPin;
  }
  progress('system-writer-pin-source', { source: 'e2e-fixture' });
  return loadFixtureSystemWriterPin(repoRoot);
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
    const indexReadTimeoutMs = Math.min(60_000, Math.max(10_000, Math.floor(timeoutMs * 0.75)));
    const storyReadTimeoutMs = Math.min(20_000, Math.max(3_000, Math.floor(timeoutMs / 6)));
    return await waitFor('gun-latest-index-readback', async () => {
      const latestPage = await withTimeout(
        'gun-latest-index-read',
        readNewsLatestIndexPageWithRelayRestFallback(client, {
          limit: Math.max(minHeadlines, DEFAULT_GUN_READBACK_STORY_LIMIT),
        }),
        indexReadTimeoutMs,
      );
      const latestIndex = latestPage.index ?? {};
      const entries = Object.entries(latestIndex)
        .filter(([, timestamp]) => Number.isFinite(timestamp))
        .sort((left, right) => right[1] - left[1]);
      if (entries.length < minHeadlines) return null;
      const stories = [];
      for (const [storyId, updatedAt] of entries.slice(0, Math.max(minHeadlines, DEFAULT_GUN_READBACK_STORY_LIMIT))) {
        const embeddedStory = latestPage.stories?.[storyId] ?? null;
        const story = embeddedStory ?? await withTimeout('gun-story-read', readNewsStory(client, storyId), storyReadTimeoutMs);
        if (story) {
          const synthesis = story.topic_id
            ? await withTimeout(
              'gun-topic-synthesis-read',
              readTopicLatestSynthesis(client, story.topic_id),
              storyReadTimeoutMs,
            ).catch(() => null)
            : null;
          const lifecycle = synthesis
            ? await withTimeout(
              'gun-story-synthesis-lifecycle-read',
              readNewsSynthesisLifecycleStatusWithRelayRestFallback(client, storyId),
              storyReadTimeoutMs,
            ).catch(() => null)
            : null;
          const acceptedCurrent = acceptedSynthesisCurrentForStory(story, synthesis, lifecycle);
          stories.push({
            storyId,
            topicId: story.topic_id,
            updatedAt,
            headline: story.headline,
            sourceCount: story.sources?.length ?? 0,
            sourceLabels: (story.sources ?? [])
              .map((source) => source.publisher || source.source || source.url)
              .filter(Boolean),
            acceptedSynthesisReady: acceptedCurrent,
            staleAcceptedSynthesisReady: Boolean(acceptedSynthesisReady(synthesis) && !acceptedCurrent),
            synthesisId: synthesis?.synthesis_id ?? null,
            lifecycleStatus: lifecycle?.status ?? null,
            lifecycleSourceSetRevision: lifecycle?.source_set_revision ?? null,
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
  if (typeof record === 'number' && Number.isFinite(record)) {
    return record;
  }
  if (typeof record === 'string' && Number.isFinite(Number(record))) {
    return Number(record);
  }
  const candidates = [
    record?.latest_activity_at,
    record?.cluster_window_end,
    record?.created_at,
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
  let timeout;
  const timeoutError = new Error(`${label}-timeout:${timeoutMs}`);
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(timeoutError);
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetch(url, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    const text = await Promise.race([
      response.text(),
      timeoutPromise,
    ]);
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

function parsePublicPointAggregatePayload(payload, pointId) {
  const aggregate = payload?.aggregate;
  if (!aggregate || typeof aggregate !== 'object' || aggregate.point_id !== pointId) {
    return null;
  }
  const agree = Number(aggregate.agree);
  const disagree = Number(aggregate.disagree);
  const participants = Number(aggregate.participants);
  const weight = Number(aggregate.weight);
  const rowCount = Number(payload?.row_count);
  return {
    point_id: pointId,
    agree: Number.isFinite(agree) ? agree : 0,
    disagree: Number.isFinite(disagree) ? disagree : 0,
    participants: Number.isFinite(participants) ? participants : 0,
    weight: Number.isFinite(weight) ? weight : 0,
    row_count: Number.isFinite(rowCount) ? rowCount : null,
  };
}

async function readPublicPointAggregateViaOrigin({
  baseUrl,
  topicId,
  synthesisId,
  epoch,
  pointId,
  timeoutMs = 15_000,
}) {
  if (!baseUrl) return null;
  const url = new URL('/vh/aggregates/point', normalizeUrl(baseUrl));
  url.searchParams.set('topic_id', topicId);
  url.searchParams.set('synthesis_id', synthesisId);
  url.searchParams.set('epoch', String(epoch));
  url.searchParams.set('point_id', pointId);
  const payload = await fetchJsonWithTimeout(url.href, timeoutMs, 'public-origin-point-aggregate');
  if (payload?.ok !== true) return null;
  return parsePublicPointAggregatePayload(payload, pointId);
}

function acceptedSynthesisReady(synthesis) {
  return Boolean(String(synthesis?.facts_summary ?? '').trim() && (synthesis?.frames?.length ?? 0) > 0);
}

function acceptedSynthesisCurrentForStory(story, synthesis, lifecycle) {
  if (!story?.story_id || !story?.provenance_hash || !acceptedSynthesisReady(synthesis)) {
    return false;
  }
  if (!lifecycle || lifecycle.status !== 'accepted_available') {
    return false;
  }
  if (lifecycle.story_id !== story.story_id) {
    return false;
  }
  if (lifecycle.source_set_revision !== story.provenance_hash) {
    return false;
  }
  if (lifecycle.synthesis_id && lifecycle.synthesis_id !== synthesis.synthesis_id) {
    return false;
  }
  if (
    lifecycle.epoch !== undefined
    && lifecycle.epoch !== null
    && synthesis.epoch !== undefined
    && Number(lifecycle.epoch) !== Number(synthesis.epoch)
  ) {
    return false;
  }
  const storyBundleIds = Array.isArray(synthesis.inputs?.story_bundle_ids)
    ? synthesis.inputs.story_bundle_ids
    : [];
  if (storyBundleIds.length > 0 && !storyBundleIds.includes(story.story_id)) {
    return false;
  }
  return true;
}

function latestIndexEntryStoryId(storyId, record) {
  const direct = String(record?.story_id || record?.storyId || storyId || '').trim();
  return direct || null;
}

function finiteNonNegativeIndexNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function latestIndexRecordsFromPayload(payload) {
  const rawRecords = payload?.records && typeof payload.records === 'object'
    ? payload.records
    : payload?.index && typeof payload.index === 'object'
      ? payload.index
      : {};
  return Object.entries(rawRecords)
    .map(([storyId, record]) => ({
      storyId: latestIndexEntryStoryId(storyId, record),
      record,
      latestActivityAt: latestIndexRecordTimestamp(record),
    }))
    .filter((entry) => entry.storyId)
    .sort((left, right) => right.latestActivityAt - left.latestActivityAt || left.storyId.localeCompare(right.storyId));
}

function compositionBackfillRecordsFromPayload(payload) {
  return Array.isArray(payload?.composition_backfill_records)
    ? payload.composition_backfill_records.filter((record) => record && typeof record === 'object')
    : [];
}

function backfillStoryIdsFromPayload(payload) {
  const explicit = Array.isArray(payload?.backfill_story_ids)
    ? payload.backfill_story_ids
    : Array.isArray(payload?.composition?.backfill_story_ids)
      ? payload.composition.backfill_story_ids
      : compositionBackfillRecordsFromPayload(payload).map((record) => record.story_id);
  return [...new Set(explicit.map((storyId) => String(storyId ?? '').trim()).filter(Boolean))];
}

function mvpFreshnessWindowMsFromEnv(env = process.env) {
  return parseNonNegativeInt(
    env.VH_PUBLIC_FEED_MVP_FRESHNESS_WINDOW_MS ?? env.VH_PUBLIC_FEED_FRESHNESS_WINDOW_MS,
    DEFAULT_PUBLIC_FEED_MVP_FRESHNESS_WINDOW_MS,
    0,
  );
}

async function readPublicRelayLatestIndexPage({
  baseUrl,
  limit,
  before,
  scanLimit,
  timeoutMs = 15_000,
} = {}) {
  const root = normalizeUrl(baseUrl || DEFAULT_BASE_URL);
  const indexUrl = new URL('/vh/news/latest-index', root);
  indexUrl.searchParams.set('limit', String(parsePositiveInt(limit, DEFAULT_PUBLIC_RELAY_SYNTHESIS_INDEX_LIMIT)));
  if (Number.isFinite(before) && before >= 0) {
    indexUrl.searchParams.set('before', String(Math.floor(before)));
  }
  if (Number.isFinite(scanLimit) && scanLimit > 0) {
    indexUrl.searchParams.set('scan_limit', String(Math.floor(scanLimit)));
  }
  const payload = await fetchJsonWithTimeout(indexUrl.href, timeoutMs, 'public-relay-latest-index-page');
  const entries = latestIndexRecordsFromPayload(payload);
  const compositionBackfillRecords = compositionBackfillRecordsFromPayload(payload);
  const backfillStoryIds = backfillStoryIdsFromPayload(payload);
  return {
    requestUrl: indexUrl.href,
    recordCount: entries.length,
    storyIds: entries.map((entry) => entry.storyId),
    latestActivityValues: entries.map((entry) => entry.latestActivityAt).filter((value) => Number.isFinite(value) && value >= 0),
    nextCursor: finiteNonNegativeIndexNumber(payload?.next_cursor),
    before: finiteNonNegativeIndexNumber(payload?.before),
    sourceKeyCount: finiteNonNegativeIndexInt(payload?.source_key_count),
    windowSourceKeyCount: finiteNonNegativeIndexInt(payload?.window_source_key_count),
    scannedKeyCount: finiteNonNegativeIndexInt(payload?.scanned_key_count),
    truncated: Boolean(payload?.truncated),
    composition: payload?.composition && typeof payload.composition === 'object' ? payload.composition : null,
    compositionBackfillRecords,
    backfillUsed: Boolean(payload?.backfill_used ?? payload?.composition?.backfill_used ?? compositionBackfillRecords.length > 0),
    backfillStoryIds,
    storyStateCount: payload?.story_states && typeof payload.story_states === 'object'
      ? Object.keys(payload.story_states).length
      : 0,
  };
}

async function readPublicRelayPaginationReadback({
  baseUrl,
  pageLimit = 6,
  timeoutMs = 15_000,
} = {}) {
  const normalizedPageLimit = parsePositiveInt(pageLimit, 6);
  const scanLimit = Math.max(normalizedPageLimit * 4, normalizedPageLimit);
  const firstPage = await readPublicRelayLatestIndexPage({
    baseUrl,
    limit: normalizedPageLimit,
    scanLimit,
    timeoutMs,
  });
  if (firstPage.recordCount === 0) {
    return {
      status: 'fail',
      failure: 'first-page-empty',
      pageLimit: normalizedPageLimit,
      firstPage,
      secondPage: null,
      olderStoryIds: [],
      overlapStoryIds: [],
    };
  }
  if (!Number.isFinite(firstPage.nextCursor)) {
    return {
      status: 'unproven',
      failure: 'first-page-next-cursor-missing',
      pageLimit: normalizedPageLimit,
      firstPage,
      secondPage: null,
      olderStoryIds: [],
      overlapStoryIds: [],
    };
  }
  const secondPage = await readPublicRelayLatestIndexPage({
    baseUrl,
    limit: normalizedPageLimit,
    before: firstPage.nextCursor,
    scanLimit,
    timeoutMs,
  });
  const firstStoryIds = new Set(firstPage.storyIds);
  const overlapStoryIds = secondPage.storyIds.filter((storyId) => firstStoryIds.has(storyId));
  const olderStoryIds = secondPage.storyIds.filter((storyId) => !firstStoryIds.has(storyId));
  const newestSecondPageActivity = Math.max(0, ...secondPage.latestActivityValues);
  const secondPageIsExclusive =
    secondPage.recordCount > 0
    && olderStoryIds.length > 0
    && overlapStoryIds.length === 0
    && newestSecondPageActivity < firstPage.nextCursor;
  return {
    status: secondPageIsExclusive ? 'pass' : 'fail',
    failure: secondPageIsExclusive
      ? null
      : secondPage.recordCount === 0
        ? 'second-page-empty'
        : overlapStoryIds.length > 0
          ? 'second-page-overlaps-first-page'
          : newestSecondPageActivity >= firstPage.nextCursor
            ? 'second-page-not-older-than-exclusive-cursor'
            : 'second-page-has-no-new-story-ids',
    pageLimit: normalizedPageLimit,
    firstPage,
    secondPage,
    olderStoryIds,
    overlapStoryIds,
  };
}

function assertPublicRelayPaginationReadback(paginationReadback, env = process.env, sourceHealthEvidence = null) {
  const requirePagination = String(env.VH_PUBLIC_FEED_REQUIRE_CURSOR_PAGINATION ?? 'true').trim().toLowerCase() !== 'false';
  if (!requirePagination) {
    return;
  }
  const firstPage = paginationReadback?.firstPage ?? {};
  const pageLimit = Number(paginationReadback?.pageLimit ?? 0);
  const visibleSourceKeyCount = Math.max(
    Number(firstPage.sourceKeyCount ?? 0),
    Number(firstPage.windowSourceKeyCount ?? 0),
    Number(firstPage.recordCount ?? 0),
  );
  const sourceHealthBundleCount = Number(sourceHealthEvidence?.totalBundleCount ?? 0);
  const sourceHealthCorroboratedCount = Number(sourceHealthEvidence?.totalCorroboratedBundleCount ?? 0);
  const shouldRequireOlderWindow =
    pageLimit > 0
    && (
      visibleSourceKeyCount > pageLimit
      || sourceHealthBundleCount > pageLimit
      || sourceHealthCorroboratedCount > 0
    );
  if (!shouldRequireOlderWindow) {
    return;
  }
  if (paginationReadback?.status !== 'pass') {
    throw new Error(
      `public-relay-latest-index-pagination-unavailable:${paginationReadback?.failure ?? 'unknown'}`,
    );
  }
}

function finiteNonNegativeIndexInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function classifyLatestIndexProductMetadata(record, story) {
  if (!record || typeof record !== 'object') return 'missing';
  const expectedSourceCount = Array.isArray(story?.sources)
    ? story.sources.length
    : storySources(story).length;
  const expectedCanonicalSourceCount = Array.isArray(story?.primary_sources)
    ? story.primary_sources.length
    : expectedSourceCount;
  const expectedStoryCreatedAt = finiteNonNegativeIndexInt(story?.created_at);
  const expectedClusterWindowStart = finiteNonNegativeIndexInt(story?.cluster_window_start);
  const recordSourceCount = finiteNonNegativeIndexInt(record.source_count);
  const recordCanonicalSourceCount = finiteNonNegativeIndexInt(record.canonical_source_count);
  const recordStoryCreatedAt = finiteNonNegativeIndexInt(record.story_created_at);
  const recordClusterWindowStart = finiteNonNegativeIndexInt(record.cluster_window_start);
  const hasSchema = record.product_state_schema_version === 'vh-news-product-feed-index-v1';
  const hasTopic = String(record.topic_id ?? '').trim() === String(story?.topic_id ?? '').trim();
  const storyRevision = String(story?.provenance_hash ?? '').trim();
  const hasRevision = storyRevision && String(record.source_set_revision ?? '').trim() === storyRevision;
  const hasSourceCounts =
    recordSourceCount === expectedSourceCount &&
    recordCanonicalSourceCount === expectedCanonicalSourceCount;
  const hasTimestamps =
    expectedStoryCreatedAt !== null &&
    expectedClusterWindowStart !== null &&
    recordStoryCreatedAt === expectedStoryCreatedAt &&
    recordClusterWindowStart === expectedClusterWindowStart;
  if (hasSchema && hasTopic && hasRevision && hasSourceCounts && hasTimestamps) {
    return 'complete';
  }
  return hasSchema || hasTopic || recordSourceCount !== null || recordCanonicalSourceCount !== null
    ? 'partial_or_mismatch'
    : 'missing';
}

function sourceUrl(source) {
  return String(source?.url || source?.canonical_url || source?.href || '').trim();
}

function storySources(story) {
  if (Array.isArray(story?.sources)) return story.sources;
  if (Array.isArray(story?.primary_sources)) return story.primary_sources;
  return [];
}

function sourceLooksVideoWatch(source) {
  const text = `${sourceUrl(source)} ${source?.title ?? ''} ${source?.source_id ?? ''}`.toLowerCase();
  return /(?:\byoutube\.com\b|\byoutu\.be\b|\bvideo\b|\bvideos\b|\/watch(?:[/?#]|$)|\bwatch\b|\blive\b)/.test(text);
}

function classifyStoryMedia(story) {
  const sources = storySources(story);
  if (sources.length === 0) return 'unknown';
  const videoCount = sources.filter(sourceLooksVideoWatch).length;
  if (videoCount === 0) return 'text';
  if (videoCount === sources.length) return 'video_watch';
  return 'mixed';
}

function durableTerminalUnavailableReason(...values) {
  const keys = [
    'accepted_synthesis_unavailable_reason',
    'synthesis_unavailable_reason',
    'terminal_unavailable_reason',
    'terminal_reason',
    'rejection_reason',
    'reason',
  ];
  for (const value of values) {
    if (!value || typeof value !== 'object') continue;
    for (const key of keys) {
      const reason = String(value[key] ?? '').trim();
      if (reason) return reason;
    }
  }
  return null;
}

function classifySourceFilterStatus(source) {
  const raw = String(
    source?.source_filter_status
      || source?.sourceFilterStatus
      || source?.admission_status
      || source?.admissionStatus
      || '',
  ).toLowerCase();
  if (['pass', 'passed', 'eligible', 'accepted', 'admitted'].includes(raw)) return 'pass';
  if (['fail', 'failed', 'excluded', 'rejected', 'blocked'].includes(raw)) return 'fail';
  return 'unknown';
}

async function readArticleTextSampleStatus({ root, story, timeoutMs }) {
  const firstUrl = storySources(story).map(sourceUrl).find(Boolean);
  if (!firstUrl) return 'no_source_url';
  const articleUrl = new URL('/article-text', root);
  articleUrl.searchParams.set('url', firstUrl);
  try {
    const payload = await fetchJsonWithTimeout(articleUrl.href, timeoutMs, 'public-relay-article-text');
    const text = String(payload?.text || payload?.article_text || '').trim();
    return text ? '200_text' : '200_empty';
  } catch (error) {
    const match = String(error instanceof Error ? error.message : error).match(/http-(\d+)/);
    return match?.[1] ?? 'error';
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

async function readPublicRelaySynthesisCandidates({
  baseUrl,
  indexLimit = DEFAULT_PUBLIC_RELAY_SYNTHESIS_INDEX_LIMIT,
  scanLimit = indexLimit,
  timeoutMs = 15_000,
} = {}) {
  const root = normalizeUrl(baseUrl || DEFAULT_BASE_URL);
  const indexUrl = new URL('/vh/news/latest-index', root);
  indexUrl.searchParams.set('limit', String(indexLimit));
  const index = await fetchJsonWithTimeout(indexUrl.href, timeoutMs, 'public-relay-latest-index');
  const storyStates = index?.story_states && typeof index.story_states === 'object'
    ? index.story_states
    : {};
  const relayStoryStatesPresent = Boolean(index?.story_states && typeof index.story_states === 'object');
  const relayComposition = index?.composition && typeof index.composition === 'object'
    ? index.composition
    : null;
  const compositionBackfillRecords = compositionBackfillRecordsFromPayload(index);
  const backfillStoryIds = backfillStoryIdsFromPayload(index);
  const backfillUsed = Boolean(index?.backfill_used ?? relayComposition?.backfill_used ?? compositionBackfillRecords.length > 0);
  const organicComposition = relayComposition
    ? {
      selectedCount: finiteNonNegativeIndexInt(relayComposition.organic_selected_count),
      singletonVisible: finiteNonNegativeIndexInt(relayComposition.organic_singleton_visible),
      multiSourceVisible: finiteNonNegativeIndexInt(relayComposition.organic_multi_source_visible),
    }
    : null;
  const scanWindowComposition = relayComposition
    ? {
      selectedCount: finiteNonNegativeIndexInt(relayComposition.scan_window_selected_count),
      singletonVisible: finiteNonNegativeIndexInt(relayComposition.scan_window_singleton_visible),
      multiSourceVisible: finiteNonNegativeIndexInt(relayComposition.scan_window_multi_source_visible),
    }
    : null;
  const records = latestIndexRecordsFromPayload(index);
  const topStories = [];
  const sampledStoryIds = [];
  const sampledTopicIds = [];
  const storyBodyStatusCounts = {};
  const synthesisStatusCounts = {};
  const frameCountDistribution = {};
  const mediaClassCounts = {};
  const sourceFilterStatusCounts = {};
  const articleTextSampleStatusCounts = {};
  const latestIndexProductMetadataStatusCounts = {};
  const missingLatestIndexProductMetadataStories = [];
  let singletonReadableCount = 0;
  let multiSourceReadableCount = 0;
  let singletonVisibleAcceptedCount = 0;
  let storyReadbackCount = 0;
  let framePointIdsPresent = 0;
  let reframePointIdsPresent = 0;
  let frameRows = 0;
  const missingAcceptedSynthesisStories = [];
  const terminalUnavailableReasonCounts = {};
  const publicStateCounts = {};
  const candidateConcurrency = parsePositiveInt(
    process.env.VH_PUBLIC_RELAY_SYNTHESIS_CANDIDATE_CONCURRENCY,
    6,
  );
  const candidateResults = await mapWithConcurrency(
    records.slice(0, scanLimit),
    candidateConcurrency,
    async (entry) => {
      const record = entry.record;
      const storyId = entry.storyId;
      const relayStoryState = storyStates[storyId] && typeof storyStates[storyId] === 'object'
        ? storyStates[storyId]
        : null;
      const result = {
        storyId,
        sampledTopicId: null,
        storyBodyStatus: null,
        storyReadback: false,
        synthesisStatus: null,
        publicState: '',
        mediaClass: null,
        sourceFilterStatuses: [],
        latestMetadataStatus: null,
        missingLatestIndexProductMetadataStory: null,
        singletonReadable: false,
        multiSourceReadable: false,
        singletonVisibleAccepted: false,
        frameRows: 0,
        framePointIdsPresent: 0,
        reframePointIdsPresent: 0,
        articleTextStatus: null,
        terminalReason: null,
        missingAcceptedSynthesisStory: null,
        topStory: null,
      };
      if (!storyId) return result;

      const storyUrl = new URL('/vh/news/story', root);
      storyUrl.searchParams.set('story_id', storyId);
      let storyPayload = null;
      try {
        storyPayload = await fetchJsonWithTimeout(storyUrl.href, timeoutMs, 'public-relay-news-story');
        result.storyBodyStatus = '200';
        result.storyReadback = true;
      } catch (error) {
        const match = String(error instanceof Error ? error.message : error).match(/http-(\d+)/);
        result.storyBodyStatus = match?.[1] ?? 'error';
        return result;
      }

      const story = storyPayload?.story;
      if (!story?.story_id || !story?.topic_id || !story?.headline) return result;
      result.sampledTopicId = story.topic_id;
      const latestMetadataStatus = classifyLatestIndexProductMetadata(record, story);
      result.latestMetadataStatus = latestMetadataStatus;
      if (latestMetadataStatus !== 'complete') {
        result.missingLatestIndexProductMetadataStory = {
          storyId: story.story_id,
          status: latestMetadataStatus,
          expectedSourceCount: Array.isArray(story.sources) ? story.sources.length : storySources(story).length,
          recordSourceCount: finiteNonNegativeIndexInt(record?.source_count),
        };
      }

      const labels = storySourceLabels(story);
      const mediaClass = classifyStoryMedia(story);
      result.mediaClass = mediaClass;
      result.sourceFilterStatuses = storySources(story).map(classifySourceFilterStatus);
      result.singletonReadable = labels.length === 1;
      result.multiSourceReadable = labels.length > 1;

      const synthesisUrl = new URL('/vh/topics/synthesis', root);
      synthesisUrl.searchParams.set('topic_id', story.topic_id);
      let synthesisPayload = null;
      try {
        synthesisPayload = await fetchJsonWithTimeout(
          synthesisUrl.href,
          timeoutMs,
          'public-relay-topic-synthesis',
        );
        result.synthesisStatus = '200';
      } catch (error) {
        const match = String(error instanceof Error ? error.message : error).match(/http-(\d+)/);
        result.synthesisStatus = match?.[1] ?? 'error';
      }

      const synthesis = synthesisPayload?.synthesis;
      const relaySynthesisState = String(relayStoryState?.synthesis_state ?? '').trim();
      result.publicState = relaySynthesisState;
      const relayAcceptedSynthesis = relaySynthesisState === 'accepted_synthesis_available';
      const currentAcceptedSynthesisReady = relayAcceptedSynthesis && acceptedSynthesisReady(synthesis);
      const rows = currentAcceptedSynthesisReady && Array.isArray(synthesis?.frames) ? synthesis.frames : [];
      result.frameRows = rows.length;
      for (const row of rows) {
        if (typeof row?.frame_point_id === 'string' && row.frame_point_id.trim()) result.framePointIdsPresent += 1;
        if (typeof row?.reframe_point_id === 'string' && row.reframe_point_id.trim()) result.reframePointIdsPresent += 1;
      }

      if (!currentAcceptedSynthesisReady) {
        const honestNonAcceptedState = [
          'synthesis_pending',
          'synthesis_loading',
          'synthesis_retryable',
          'synthesis_terminal_unavailable',
          'accepted_synthesis_suppressed',
        ].includes(relaySynthesisState);
        result.articleTextStatus = honestNonAcceptedState
          ? `not_checked_${relaySynthesisState}`
          : await readArticleTextSampleStatus({ root, story, timeoutMs });
        const terminalReason = durableTerminalUnavailableReason(relayStoryState, storyPayload, record, story, synthesisPayload);
        result.terminalReason = terminalReason;
        if (
          !terminalReason
          && !honestNonAcceptedState
          && (mediaClass === 'text' || mediaClass === 'mixed')
          && result.articleTextStatus === '200_text'
        ) {
          result.missingAcceptedSynthesisStory = {
            storyId: story.story_id,
            topicId: story.topic_id,
            headline: trimText(story.headline, 160),
            mediaClass,
            articleTextStatus: result.articleTextStatus,
            relaySynthesisState: relaySynthesisState || null,
          };
        }
        return result;
      }

      result.singletonVisibleAccepted = labels.length === 1;
      result.topStory = {
        storyId: story.story_id,
        topicId: story.topic_id,
        updatedAt: latestIndexRecordTimestamp(record) || Number(story.cluster_window_end) || Date.now(),
        headline: story.headline,
        sourceCount: labels.length,
        sourceLabels: labels,
        acceptedSynthesisReady: true,
        synthesisId: synthesis.synthesis_id ?? null,
      };
      return result;
    },
  );
  for (const result of candidateResults) {
    if (!result?.storyId) continue;
    sampledStoryIds.push(result.storyId);
    if (result.storyBodyStatus) {
      storyBodyStatusCounts[result.storyBodyStatus] = (storyBodyStatusCounts[result.storyBodyStatus] ?? 0) + 1;
    }
    if (result.storyReadback) storyReadbackCount += 1;
    if (!result.storyReadback) continue;
    if (result.sampledTopicId) sampledTopicIds.push(result.sampledTopicId);
    if (result.latestMetadataStatus) {
      latestIndexProductMetadataStatusCounts[result.latestMetadataStatus] =
        (latestIndexProductMetadataStatusCounts[result.latestMetadataStatus] ?? 0) + 1;
    }
    if (result.missingLatestIndexProductMetadataStory) {
      missingLatestIndexProductMetadataStories.push(result.missingLatestIndexProductMetadataStory);
    }
    if (result.mediaClass) {
      mediaClassCounts[result.mediaClass] = (mediaClassCounts[result.mediaClass] ?? 0) + 1;
    }
    for (const sourceFilterStatus of result.sourceFilterStatuses) {
      sourceFilterStatusCounts[sourceFilterStatus] = (sourceFilterStatusCounts[sourceFilterStatus] ?? 0) + 1;
    }
    if (result.singletonReadable) singletonReadableCount += 1;
    if (result.multiSourceReadable) multiSourceReadableCount += 1;
    if (result.synthesisStatus) {
      synthesisStatusCounts[result.synthesisStatus] = (synthesisStatusCounts[result.synthesisStatus] ?? 0) + 1;
    }
    if (result.publicState) {
      publicStateCounts[result.publicState] = (publicStateCounts[result.publicState] ?? 0) + 1;
    }
    frameRows += result.frameRows;
    frameCountDistribution[String(result.frameRows)] = (frameCountDistribution[String(result.frameRows)] ?? 0) + 1;
    framePointIdsPresent += result.framePointIdsPresent;
    reframePointIdsPresent += result.reframePointIdsPresent;
    if (result.articleTextStatus) {
      articleTextSampleStatusCounts[result.articleTextStatus] =
        (articleTextSampleStatusCounts[result.articleTextStatus] ?? 0) + 1;
    }
    if (result.terminalReason) {
      terminalUnavailableReasonCounts[result.terminalReason] =
        (terminalUnavailableReasonCounts[result.terminalReason] ?? 0) + 1;
    }
    if (result.missingAcceptedSynthesisStory) {
      missingAcceptedSynthesisStories.push(result.missingAcceptedSynthesisStory);
    }
    if (result.singletonVisibleAccepted) singletonVisibleAcceptedCount += 1;
    if (result.topStory) topStories.push(result.topStory);
  }
  return {
    latestIndexCount: records.length,
    sampledStoryIds,
    sampledTopicIds: [...new Set(sampledTopicIds)],
    storyBodyStatusCounts,
    synthesisStatusCounts,
    publicStateCounts,
    relayCapability: {
      composition_present: Boolean(relayComposition),
      story_states_present: relayStoryStatesPresent,
      story_state_count: Object.keys(storyStates).length,
    },
    relayComposition,
    compositionBackfill: {
      used: backfillUsed,
      storyIds: backfillStoryIds,
      records: compositionBackfillRecords,
    },
    organicComposition,
    scanWindowComposition,
    mediaClassCounts,
    sourceFilterStatusCounts,
    articleTextSampleStatusCounts,
    latestIndexProductMetadataStatusCounts,
    missingLatestIndexProductMetadataStoryCount: missingLatestIndexProductMetadataStories.length,
    missingLatestIndexProductMetadataStories,
    terminalUnavailableReasonCounts,
    missingAcceptedSynthesisStoryCount: missingAcceptedSynthesisStories.length,
    missingAcceptedSynthesisStories,
    singletonReadableCount,
    multiSourceReadableCount,
    singletonVisibleAcceptedCount,
    frameCountDistribution,
    pointIdPresence: {
      frameRows,
      framePointIdsPresent,
      reframePointIdsPresent,
    },
    storyReadbackCount,
    acceptedSynthesisStoryCount: topStories.length,
    topStories,
  };
}

function assertPublicRelayAnalysisFrameCoverage(publicRelaySynthesisReadback, env = process.env) {
  const requireRelayStateSurface = String(env.VH_PUBLIC_FEED_REQUIRE_RELAY_STATE_SURFACE ?? 'true').trim().toLowerCase() !== 'false';
  if (requireRelayStateSurface) {
    const capability = publicRelaySynthesisReadback.relayCapability ?? {};
    if (!capability.composition_present) {
      throw new Error('public-relay-latest-index-missing-composition');
    }
    if (!capability.story_states_present) {
      throw new Error('public-relay-latest-index-missing-story-states');
    }
  }

  const requireLatestIndexProductMetadata = String(
    env.VH_PUBLIC_FEED_REQUIRE_LATEST_INDEX_PRODUCT_METADATA ?? 'true',
  ).trim().toLowerCase() !== 'false';
  if (requireLatestIndexProductMetadata) {
    const missingMetadataCount = Number(
      publicRelaySynthesisReadback.missingLatestIndexProductMetadataStoryCount
        ?? publicRelaySynthesisReadback.missingLatestIndexProductMetadataStories?.length
        ?? 0,
    );
    if (missingMetadataCount > 0) {
      const sample = (publicRelaySynthesisReadback.missingLatestIndexProductMetadataStories ?? [])
        .slice(0, 5)
        .map((story) => story.storyId)
        .filter(Boolean)
        .join(',');
      throw new Error(
        `public-relay-latest-index-product-metadata-missing:${missingMetadataCount}${sample ? `:${sample}` : ''}`,
      );
    }
  }

  const requireMixedComposition = String(env.VH_PUBLIC_FEED_REQUIRE_MIXED_COMPOSITION ?? 'true').trim().toLowerCase() !== 'false';
  const singletonReadableCount = Number(publicRelaySynthesisReadback.singletonReadableCount ?? 0);
  const multiSourceReadableCount = Number(publicRelaySynthesisReadback.multiSourceReadableCount ?? 0);
  const organicSingletonVisible = finiteNonNegativeIndexInt(
    publicRelaySynthesisReadback.organicComposition?.singletonVisible
      ?? publicRelaySynthesisReadback.relayComposition?.organic_singleton_visible,
  ) ?? singletonReadableCount;
  const organicMultiSourceVisible = finiteNonNegativeIndexInt(
    publicRelaySynthesisReadback.organicComposition?.multiSourceVisible
      ?? publicRelaySynthesisReadback.relayComposition?.organic_multi_source_visible,
  ) ?? multiSourceReadableCount;
  const scanWindowMultiSourceVisible = finiteNonNegativeIndexInt(
    publicRelaySynthesisReadback.scanWindowComposition?.multiSourceVisible
      ?? publicRelaySynthesisReadback.relayComposition?.scan_window_multi_source_visible,
  ) ?? multiSourceReadableCount;
  const backfillUsed = Boolean(
    publicRelaySynthesisReadback.compositionBackfill?.used
      ?? publicRelaySynthesisReadback.relayComposition?.backfill_used,
  );
  if (requireMixedComposition) {
    if (organicSingletonVisible <= 0) {
      throw new Error('public-relay-feed-composition-missing-singleton');
    }
    if (organicMultiSourceVisible <= 0) {
      if (backfillUsed || scanWindowMultiSourceVisible > 0) {
        throw new Error('public-relay-feed-composition-backfill-only-multi-source');
      }
      throw new Error('public-relay-feed-composition-missing-multi-source');
    }
  }

  const freshnessWindowMs = mvpFreshnessWindowMsFromEnv(env);
  const relayFreshnessAge = Number(publicRelaySynthesisReadback.relayComposition?.freshness_age_ms ?? Number.NaN);
  const sampledLatestActivity = Math.max(
    0,
    ...(publicRelaySynthesisReadback.topStories ?? []).map((story) => Number(story.updatedAt)).filter(Number.isFinite),
  );
  const sampledFreshnessAge = sampledLatestActivity > 0 ? Math.max(0, Date.now() - sampledLatestActivity) : Number.NaN;
  const freshnessAge = Number.isFinite(relayFreshnessAge) ? relayFreshnessAge : sampledFreshnessAge;
  if (freshnessWindowMs > 0 && Number.isFinite(freshnessAge) && freshnessAge > freshnessWindowMs) {
    throw new Error(`public-relay-feed-stale:${freshnessAge}/${freshnessWindowMs}`);
  }

  const acceptedRepairWindowStory404Threshold = parseNonNegativeInt(
    env.VH_PUBLIC_FEED_REPAIR_WINDOW_STORY_404_THRESHOLD,
    0,
    0,
  );
  const storyBody404Count = Number(publicRelaySynthesisReadback.storyBodyStatusCounts?.['404'] ?? 0);
  if (storyBody404Count > acceptedRepairWindowStory404Threshold) {
    throw new Error(`public-relay-latest-index-story-404:${storyBody404Count}/${acceptedRepairWindowStory404Threshold}`);
  }

  const missingAcceptedSynthesisStoryCount = Number(
    publicRelaySynthesisReadback.missingAcceptedSynthesisStoryCount
      ?? publicRelaySynthesisReadback.missingAcceptedSynthesisStories?.length
      ?? 0,
  );
  if (missingAcceptedSynthesisStoryCount > 0) {
    const sample = (publicRelaySynthesisReadback.missingAcceptedSynthesisStories ?? [])
      .slice(0, 5)
      .map((story) => story.storyId)
      .filter(Boolean)
      .join(',');
    throw new Error(
      `public-relay-readable-text-synthesis-missing:${missingAcceptedSynthesisStoryCount}${sample ? `:${sample}` : ''}`,
    );
  }

  const requireAcceptedSynthesis = String(
    env.VH_PUBLIC_FEED_REQUIRE_ACCEPTED_SYNTHESIS
      ?? env.VH_PUBLIC_FEED_SMOKE_REQUIRE_ACCEPTED_SYNTHESIS
      ?? 'true',
  ).trim().toLowerCase() !== 'false';
  if (requireAcceptedSynthesis && Number(publicRelaySynthesisReadback.acceptedSynthesisStoryCount ?? 0) <= 0) {
    throw new Error('public-relay-current-accepted-synthesis-missing');
  }

  const pointPresence = publicRelaySynthesisReadback.pointIdPresence ?? {};
  const frameRows = Number(pointPresence.frameRows ?? 0);
  if (
    frameRows > 0
    && (
      Number(pointPresence.framePointIdsPresent ?? 0) < frameRows
      || Number(pointPresence.reframePointIdsPresent ?? 0) < frameRows
    )
  ) {
    throw new Error(`public-relay-synthesis-point-ids-missing:${JSON.stringify(pointPresence)}`);
  }
}

function capturePublicRelayAnalysisFrameCoverage(publicRelaySynthesisReadback, env = process.env) {
  try {
    assertPublicRelayAnalysisFrameCoverage(publicRelaySynthesisReadback, env);
    return { status: 'pass' };
  } catch (error) {
    return {
      status: 'fail',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: formatError(error),
    };
  }
}

async function readPublicPointAggregate({ baseUrl, gunPeerUrl, topicId, synthesisId, epoch, pointId }) {
  const originAggregate = await readPublicPointAggregateViaOrigin({
    baseUrl,
    topicId,
    synthesisId,
    epoch,
    pointId,
  }).catch(() => null);
  if (originAggregate && (originAggregate.participants > 0 || originAggregate.agree > 0 || originAggregate.disagree > 0)) {
    return { ...originAggregate, publicReadPath: 'origin_relay_fanout' };
  }

  const client = createClient({
    peers: [gunPeerUrl],
    requireSession: false,
    gunLocalStorage: false,
    gunRadisk: false,
  });
  client.markSessionReady();
  try {
    return await readAggregates(client, topicId, synthesisId, epoch, pointId) ?? originAggregate;
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

async function installRefreshLatestRecorder(page) {
  return page.evaluate(() => {
    const store = window.__VH_NEWS_STORE__;
    const state = store?.getState?.();
    const refresh = state?.refreshLatest;
    if (!store || typeof store.setState !== 'function' || typeof refresh !== 'function') {
      return { installed: false, reason: 'news-store-refreshLatest-missing' };
    }
    if (window.__VH_PUBLIC_FEED_REFRESH_RECORDER_INSTALLED) {
      window.__VH_PUBLIC_FEED_REFRESH_CALLS = [];
      return { installed: true, reused: true };
    }
    window.__VH_PUBLIC_FEED_REFRESH_CALLS = [];
    window.__VH_PUBLIC_FEED_REFRESH_RECORDER_INSTALLED = true;
    store.setState({
      refreshLatest: async (...args) => {
        window.__VH_PUBLIC_FEED_REFRESH_CALLS.push({
          args,
          at: Date.now(),
        });
        return refresh(...args);
      },
    });
    return { installed: true, reused: false };
  }).catch((error) => ({
    installed: false,
    reason: error instanceof Error ? error.message : String(error),
  }));
}

async function readRefreshLatestRecorder(page) {
  return page.evaluate(() => Array.isArray(window.__VH_PUBLIC_FEED_REFRESH_CALLS)
    ? window.__VH_PUBLIC_FEED_REFRESH_CALLS
    : [])
    .catch(() => []);
}

async function readPublicNewsStoreSnapshot(page) {
  return page.evaluate(() => {
    const store = window.__VH_NEWS_STORE__?.getState?.();
    if (!store) return null;
    return {
      latestIndexCount: store.latestIndex && typeof store.latestIndex === 'object'
        ? Object.keys(store.latestIndex).length
        : null,
      storyCount: Array.isArray(store.stories) ? store.stories.length : null,
      loading: Boolean(store.loading),
      error: store.error ? String(store.error).slice(0, 240) : null,
    };
  }).catch(() => null);
}

async function waitForPublicNewsStoreIdle(page, timeoutMs, progress, label) {
  const startedAt = Date.now();
  const result = await page.waitForFunction(() => {
    const store = window.__VH_NEWS_STORE__?.getState?.();
    return !store || store.loading === false;
  }, null, { timeout: timeoutMs }).then(
    () => ({ status: 'idle', elapsedMs: Date.now() - startedAt }),
    (error) => ({
      status: 'timeout',
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  progress('news-store-idle-wait', { label, ...result });
  return result;
}

async function waitForPublicNewsStoreGrowth(page, initialCount, timeoutMs, progress) {
  const startedAt = Date.now();
  const result = await page.waitForFunction((count) => {
    const store = window.__VH_NEWS_STORE__?.getState?.();
    if (!store) return false;
    const storyCount = Array.isArray(store.stories) ? store.stories.length : 0;
    return storyCount > count && store.loading === false;
  }, initialCount, { timeout: timeoutMs }).then(
    () => ({ status: 'grew', elapsedMs: Date.now() - startedAt }),
    (error) => ({
      status: 'timeout',
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  progress('news-store-growth-wait', { initialCount, ...result });
  return result;
}

async function waitForVisibleCardGrowth(page, initialCount, timeoutMs, progress) {
  const startedAt = Date.now();
  const result = await page.waitForFunction((count) => (
    document.querySelectorAll('article[data-testid^="news-card-"]').length > count
  ), initialCount, { timeout: timeoutMs }).then(
    () => ({ status: 'grew', elapsedMs: Date.now() - startedAt }),
    (error) => ({
      status: 'timeout',
      elapsedMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  progress('visible-card-growth-wait', { initialCount, ...result });
  return result;
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
          latestIndexCount: store.latestIndex && typeof store.latestIndex === 'object'
            ? Object.keys(store.latestIndex).length
            : null,
          storyCount: Array.isArray(store.stories)
            ? store.stories.length
            : store.storiesById && typeof store.storiesById === 'object'
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

function summarizeBrowserLogDiagnostics(logs) {
  const browserErrors = logs
    .filter((entry) => ['error', 'pageerror'].includes(String(entry?.type ?? '').toLowerCase()))
    .map((entry) => String(entry?.text ?? '').trim())
    .filter(Boolean);
  const cspViolations = browserErrors.filter((text) =>
    /content security policy|connect-src|refused to connect/i.test(text),
  );
  const criticalCspViolations = cspViolations.filter((text) =>
    /healthz|\/gun\b|\/vh\/news\/|\/vh\/topics\/synthesis|\/vh\/aggregates\//i.test(text),
  );
  return {
    browserErrorCount: browserErrors.length,
    cspViolationCount: cspViolations.length,
    criticalCspViolationCount: criticalCspViolations.length,
    criticalCspViolations: criticalCspViolations.slice(0, 12),
  };
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

async function waitForInitialOpenHeadlines(page, minHeadlines, timeoutMs, progress = () => {}) {
  const startedAt = Date.now();
  let lastProgressAt = 0;
  return waitFor('public-feed-initial-open-headlines', async () => {
    const rows = await visibleCards(page);
    if (rows.length >= minHeadlines) return rows;
    const now = Date.now();
    if (now - lastProgressAt >= 10_000) {
      lastProgressAt = now;
      const diagnostics = await withTimeout('initial-open-diagnostics', summarizeFeedState(page), 3_000)
        .catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
        }));
      progress('initial-open-wait-diagnostics', {
        elapsedMs: now - startedAt,
        rows: rows.length,
        minHeadlines,
        diagnostics,
      });
    }
    return null;
  }, { timeoutMs, intervalMs: 500 });
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

async function gotoFeedInitialOpen(page, baseUrl, minHeadlines, timeoutMs, progress = () => {}) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByTestId('user-link').waitFor({ state: 'visible', timeout: 30_000 });
  return waitForInitialOpenHeadlines(page, minHeadlines, timeoutMs, progress);
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

async function readVisibleNonAcceptedSynthesisState(scope, row) {
  const detail = firstTestId(scope, `news-card-detail-${row.topicId}`);
  const root = await detail.count().catch(() => 0) > 0 ? detail : scope;
  const summary = trimText(
    await firstTestId(root, `news-card-summary-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''),
    2_000,
  );
  const basis = trimText(
    await firstTestId(root, `news-card-summary-basis-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''),
    500,
  );
  const pending = trimText(
    await firstTestId(root, `news-card-synthesis-unavailable-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''),
    1_000,
  );
  const terminal = trimText(
    await firstTestId(root, `news-card-synthesis-terminal-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''),
    1_000,
  );
  const retryable = trimText(
    await firstTestId(root, `news-card-synthesis-retryable-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''),
    1_000,
  );
  const correction = trimText(
    await firstTestId(root, `news-card-synthesis-correction-state-${row.topicId}`).textContent(locatorTimeout()).catch(() => ''),
    1_000,
  );
  const biasEmpty = trimText(
    await root.getByTestId('bias-table-empty').textContent(locatorTimeout()).catch(() => ''),
    1_000,
  );
  const voteButtons = await root.locator('[data-testid^="cell-vote-agree-"]').count().catch(() => 0);
  const stateText = pending || terminal || retryable || correction;
  if (!stateText && !/pending|unavailable|retrying|suppressed|correction/i.test(`${basis} ${biasEmpty}`)) {
    return null;
  }
  return {
    summary,
    basis,
    stateText,
    biasEmpty,
    voteButtonCount: voteButtons,
  };
}

async function waitForNonAcceptedSynthesisState(page, card, row, timeoutMs) {
  return waitFor('non-accepted-synthesis-state-visible', async () => {
    for (const scope of await synthesisScopeCandidates(page, card, row)) {
      const state = await readVisibleNonAcceptedSynthesisState(scope, row);
      if (state) {
        return state;
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

async function openStoryWithNonAcceptedSynthesisState(page, candidateRows, analysisTimeoutMs) {
  const rejectedCandidates = [];
  const perCandidateTimeoutMs = Math.min(30_000, analysisTimeoutMs);
  for (const row of candidateRows.slice(0, 8)) {
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
      const state = await waitForNonAcceptedSynthesisState(page, card, row, perCandidateTimeoutMs);
      if (state.voteButtonCount > 0) {
        throw new Error(`non-accepted-synthesis-votable:${state.voteButtonCount}`);
      }
      return { row, card, state, rejectedCandidates };
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
    `non-accepted-synthesis-state-timeout:${rejectedCandidates.map((item) => `${item.storyId}:${item.reason}`).join('|')}`,
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

async function voteAgree(card, row, gunPeerUrl, baseUrl) {
  const target = await firstVoteTarget(card);
  const durablePointId = target.canonicalPointId || target.pointId;
  const synthesisId = parseSynthesisIdFromPointId(durablePointId);
  const publicBefore = synthesisId
    ? await withTimeout(
      'public-aggregate-before-read',
      readPublicPointAggregate({
        baseUrl,
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
          baseUrl,
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
  await section.scrollIntoViewIfNeeded({ timeout: 30_000 }).catch(() => {});
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
    const voteVisibility = await waitFor('second-browser-vote-visibility', async () => {
      const { count } = await visibleAgreeVoteCount(page, voteProof);
      lastVoteDiagnostics = { domCount: count, expectedCount: voteProof.afterAgree };
      if (count >= voteProof.afterAgree) {
        return { count, source: 'dom' };
      }

      const durablePointId = voteProof.canonicalPointId || voteProof.pointId;
      const synthesisId = parseSynthesisIdFromPointId(durablePointId);
      const now = Date.now();
      if (synthesisId && now - lastVoteReopenAt >= 15_000) {
        const publicAggregate = await withTimeout(
          'second-browser-public-aggregate-read',
          readPublicPointAggregate({
            baseUrl,
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
          const currentSynthesis = await waitForSynthesis(page, page, row, Math.min(5_000, analysisTimeoutMs))
            .catch(() => null);
          if (currentSynthesis) {
            lastVoteReopenAt = now;
            progress('second-browser-vote-public-ready-current-detail', {
              voteCount: publicAggregate.agree,
              expectedCount: voteProof.afterAgree,
            });
            return null;
          }
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
              return {
                count: reopened.count,
                source: 'dom_after_public_aggregate_reopen',
                publicAggregate,
              };
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
    progress('second-browser-vote-visible', {
      voteCount: voteVisibility.count,
      source: voteVisibility.source,
    });
    if (commentBody) {
      await waitFor('second-browser-comment-visibility', async () =>
        (await postedCommentVisible(page, commentBody)) ? true : null,
      { timeoutMs: commentVisibilityTimeoutMs, intervalMs: 500 });
      progress('second-browser-comment-visible');
    } else {
      progress('second-browser-comment-skipped', { reason: 'not_required_for_vote_convergence' });
    }
    return {
      voteCount: voteVisibility.count,
      voteCountSource: voteVisibility.source,
      publicAggregate: voteVisibility.publicAggregate ?? null,
      commentVisible: Boolean(commentBody),
      commentSkippedReason: commentBody ? null : 'not_required_for_vote_convergence',
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
  const initialOpenTimeoutMs = parsePositiveInt(
    env.VH_PUBLIC_FEED_INITIAL_OPEN_TIMEOUT_MS,
    Math.min(DEFAULT_INITIAL_OPEN_TIMEOUT_MS, Math.max(15_000, Math.floor(readyTimeoutMs / 8))),
  );
  const publicRelayReadbackTimeoutMs = parsePositiveInt(
    env.VH_PUBLIC_FEED_SMOKE_PUBLIC_RELAY_READBACK_TIMEOUT_MS,
    Math.min(60_000, Math.max(30_000, Math.floor(readyTimeoutMs / 12))),
  );
  const commentVisibilityTimeoutMs = parsePositiveInt(
    env.VH_PUBLIC_FEED_SMOKE_COMMENT_VISIBILITY_TIMEOUT_MS,
    DEFAULT_COMMENT_VISIBILITY_TIMEOUT_MS,
  );
  const requireStoryComments = boolEnv(env.VH_PUBLIC_FEED_SMOKE_REQUIRE_STORY_COMMENTS, false);
  const requireSecondBrowserVote = boolEnv(env.VH_PUBLIC_FEED_SMOKE_REQUIRE_SECOND_BROWSER_VOTE, false);
  const requireAcceptedSynthesis = boolEnv(env.VH_PUBLIC_FEED_SMOKE_REQUIRE_ACCEPTED_SYNTHESIS, true);
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
      initialOpenTimeoutMs,
      analysisTimeoutMs,
      publicRelayReadbackTimeoutMs,
      commentVisibilityTimeoutMs,
      requireStoryComments,
      requireSecondBrowserVote,
      requireAcceptedSynthesis,
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
      systemWriterPin: await resolveSystemWriterPin({ repoRoot, env, baseUrl, progress }),
    });
    const publicRelaySynthesisReadback = await readPublicRelaySynthesisCandidates({
      baseUrl,
      timeoutMs: publicRelayReadbackTimeoutMs,
    }).catch((error) => {
      progress('public-relay-synthesis-readback-unavailable', {
        error: error instanceof Error ? error.message : String(error),
      });
      return { latestIndexCount: 0, storyReadbackCount: 0, topStories: [] };
    });
    progress('public-relay-synthesis-readback', {
      latestIndexCount: publicRelaySynthesisReadback.latestIndexCount,
      storyReadbackCount: publicRelaySynthesisReadback.storyReadbackCount,
      storyBodyStatusCounts: publicRelaySynthesisReadback.storyBodyStatusCounts,
      synthesisStatusCounts: publicRelaySynthesisReadback.synthesisStatusCounts,
      publicStateCounts: publicRelaySynthesisReadback.publicStateCounts,
      relayCapability: publicRelaySynthesisReadback.relayCapability,
      relayComposition: publicRelaySynthesisReadback.relayComposition,
      singletonReadableCount: publicRelaySynthesisReadback.singletonReadableCount,
      multiSourceReadableCount: publicRelaySynthesisReadback.multiSourceReadableCount,
      mediaClassCounts: publicRelaySynthesisReadback.mediaClassCounts,
      sourceFilterStatusCounts: publicRelaySynthesisReadback.sourceFilterStatusCounts,
      articleTextSampleStatusCounts: publicRelaySynthesisReadback.articleTextSampleStatusCounts,
      latestIndexProductMetadataStatusCounts: publicRelaySynthesisReadback.latestIndexProductMetadataStatusCounts,
      missingLatestIndexProductMetadataStoryCount: publicRelaySynthesisReadback.missingLatestIndexProductMetadataStoryCount,
      terminalUnavailableReasonCounts: publicRelaySynthesisReadback.terminalUnavailableReasonCounts,
      missingAcceptedSynthesisStoryCount: publicRelaySynthesisReadback.missingAcceptedSynthesisStoryCount,
      frameCountDistribution: publicRelaySynthesisReadback.frameCountDistribution,
      pointIdPresence: publicRelaySynthesisReadback.pointIdPresence,
    });
    const publicRelayAnalysisFrameCoverage = capturePublicRelayAnalysisFrameCoverage(
      publicRelaySynthesisReadback,
      env,
    );
    progress('public-relay-analysis-frame-coverage', publicRelayAnalysisFrameCoverage);
    const publicRelayPaginationReadback = await readPublicRelayPaginationReadback({
      baseUrl,
      pageLimit: parsePositiveInt(env.VH_PUBLIC_FEED_PAGINATION_PAGE_LIMIT, 6),
      timeoutMs: publicRelayReadbackTimeoutMs,
    }).catch((error) => ({
      status: 'fail',
      failure: error instanceof Error ? error.message : String(error),
    }));
    progress('public-relay-pagination-readback', publicRelayPaginationReadback);
    summary = {
      ...summary,
      checks: {
        ...summary.checks,
        daemonGunLatestIndexReadback: gunReadback,
        publicRelaySynthesisReadback,
        publicRelayAnalysisFrameCoverage,
        publicRelayPaginationReadback,
      },
    };
    browser = await launchBrowserFn();
    context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1200 } });
    await addConsumerInitScript(context, gunPeerUrl);
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    page.on('console', (message) => logs.push({ type: message.type(), text: message.text() }));
    page.on('pageerror', (error) => logs.push({ type: 'pageerror', text: formatError(error) }));

    let identity = {
      status: 'skipped',
      reason: 'no-current-accepted-synthesis',
    };
    progress('initial-feed-wait-start', {
      minHeadlines,
      timeoutMs: initialOpenTimeoutMs,
      manualRefreshAllowed: false,
    });
    const initialCards = await gotoFeedInitialOpen(page, baseUrl, minHeadlines, initialOpenTimeoutMs, progress);
    await page.screenshot(viewportScreenshotOptions(screenshots.initialFeed));
    progress('initial-feed-screenshot', { count: initialCards.length });
    const cardsWithSources = initialCards.filter((card) => card.sourceLabels.length > 0);
    const cardsWithTimestamps = initialCards.filter((card) => /Created .+Updated /i.test(card.meta));
    const initialStoryIds = new Set(initialCards.map((card) => card.storyId).filter(Boolean));
    if (cardsWithSources.length < minHeadlines) throw new Error(`source-labels-missing:${cardsWithSources.length}/${minHeadlines}`);
    if (cardsWithTimestamps.length < minHeadlines) throw new Error(`timestamps-missing:${cardsWithTimestamps.length}/${minHeadlines}`);

    await clickFeedRefresh(page);
    const afterRefreshCards = await waitForHeadlines(page, minHeadlines, 60_000, progress);
    await waitForPublicNewsStoreIdle(page, 60_000, progress, 'after-refresh-before-scroll');
    await page.screenshot(viewportScreenshotOptions(screenshots.afterRefresh));
    progress('refresh-screenshot', { count: afterRefreshCards.length });

    const beforeScrollNewsStore = await readPublicNewsStoreSnapshot(page);
    const refreshRecorder = await installRefreshLatestRecorder(page);
    const meshIndexCount = Math.max(
      Number(gunReadback.latestIndexCount ?? 0),
      Number(publicRelaySynthesisReadback.latestIndexCount ?? 0),
    );
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    if (meshIndexCount > initialCards.length) {
      await waitForPublicNewsStoreGrowth(page, initialCards.length, 45_000, progress);
      await waitForVisibleCardGrowth(page, initialCards.length, 15_000, progress);
    } else {
      await page.waitForTimeout(1_500);
    }
    const afterScrollCards = await visibleCards(page);
    const loadMoreRefreshCalls = await readRefreshLatestRecorder(page);
    const afterScrollNewsStore = await readPublicNewsStoreSnapshot(page);
    await page.screenshot(viewportScreenshotOptions(screenshots.afterScroll));
    const afterScrollNewStoryIds = afterScrollCards
      .map((card) => card.storyId)
      .filter((storyId) => storyId && !initialStoryIds.has(storyId));
    progress('scroll-screenshot', {
      count: afterScrollCards.length,
      newStoryIds: afterScrollNewStoryIds.slice(0, 12),
      meshIndexCount,
      initialCount: initialCards.length,
      beforeScrollNewsStore,
      afterScrollNewsStore,
      refreshRecorder,
      loadMoreRefreshCalls: loadMoreRefreshCalls.slice(0, 12),
    });
    if (afterScrollCards.length < minHeadlines) throw new Error(`scroll-feed-lost-headlines:${afterScrollCards.length}/${minHeadlines}`);
    if (meshIndexCount > initialCards.length && afterScrollNewStoryIds.length > 0 && loadMoreRefreshCalls.length === 0) {
      throw new Error(`public-feed-load-more-not-from-mesh:${afterScrollCards.length}/${initialCards.length}/${meshIndexCount}:preloaded-window`);
    }
    if (meshIndexCount > initialCards.length && afterScrollNewStoryIds.length === 0) {
      throw new Error(`public-feed-load-more-not-from-mesh:${afterScrollCards.length}/${initialCards.length}/${meshIndexCount}`);
    }

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
    const hasCurrentAcceptedSynthesisCandidate =
      synthesisReadyCards.length > 0 ||
      publicRelaySynthesisReadyRows.length > 0 ||
      synthesisReadyReadbackRows.length > 0;
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
    if (hasCurrentAcceptedSynthesisCandidate) {
      progress('identity-start');
      identity = await ensureIdentity(page, baseUrl, 'launchsmoke');
      progress('identity-complete', identity);
    } else {
      progress('identity-skipped', { reason: identity.reason });
    }
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
    let target;
    let card;
    let synthesis = null;
    let detail;
    let storyDetailCheck;
    let voteProof = {
      status: 'skipped',
      reason: 'no-current-accepted-synthesis',
    };
    if (hasCurrentAcceptedSynthesisCandidate) {
      detail = await openStoryWithAcceptedSynthesis(page, detailCandidates, analysisTimeoutMs);
      target = detail.row;
      card = detail.card;
      synthesis = detail.synthesis;
      await page.screenshot(viewportScreenshotOptions(screenshots.storyDetail));
      progress('story-detail-screenshot', { storyId: target.storyId, topicId: target.topicId });
      voteProof = await voteAgree(card, target, gunPeerUrl, baseUrl);
      progress('vote-readback', { pointId: voteProof.pointId, afterAgree: voteProof.afterAgree });
      await reloadStoryDetailForNextStep(page, baseUrl, target, analysisTimeoutMs, progress);
      storyDetailCheck = {
        mode: 'accepted_synthesis',
        storyId: target.storyId,
        topicId: target.topicId,
        headline: target.headline,
        rejectedPendingCandidates: detail.rejectedCandidates,
      };
    } else {
      detail = await openStoryWithNonAcceptedSynthesisState(page, topCards, analysisTimeoutMs);
      target = detail.row;
      card = detail.card;
      await page.screenshot(viewportScreenshotOptions(screenshots.storyDetail));
      progress('story-detail-non-accepted-screenshot', {
        storyId: target.storyId,
        topicId: target.topicId,
        stateText: detail.state.stateText,
        voteButtonCount: detail.state.voteButtonCount,
      });
      storyDetailCheck = {
        mode: 'non_accepted_synthesis',
        storyId: target.storyId,
        topicId: target.topicId,
        headline: target.headline,
        rejectedPendingCandidates: detail.rejectedCandidates,
        state: detail.state,
      };
    }
    let comment = {
      status: 'skipped',
      reason: 'story-comment-workflow-not-required-for-analysis-frame-smoke',
    };
    let reload = {
      status: 'skipped',
      reason: 'story-comment-workflow-not-required-for-analysis-frame-smoke',
    };
    let secondBrowser = {
      status: 'skipped',
      reason: 'story-comment-workflow-not-required-for-analysis-frame-smoke',
    };
    if ((requireStoryComments || requireSecondBrowserVote) && hasCurrentAcceptedSynthesisCandidate) {
      if (requireStoryComments) {
        comment = await withTimeout(
          'story-comment-overall',
          createStoryComment(page, target, commentVisibilityTimeoutMs),
          Math.max(180_000, Math.min(300_000, analysisTimeoutMs + 60_000)),
        );
        await page.screenshot(viewportScreenshotOptions(screenshots.afterComment));
        progress('comment-screenshot', { threadId: comment.sectionId, body: comment.body });
        reload = await withTimeout(
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
      }
      secondBrowser = await withTimeout(
        'second-browser-overall',
        verifySecondBrowser({
          browser,
          baseUrl,
          gunPeerUrl,
          row: target,
          voteProof,
          commentBody: requireStoryComments ? comment.body : null,
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
    } else if (requireStoryComments || requireSecondBrowserVote) {
      progress('story-comment-workflow-skipped', { reason: 'no-current-accepted-synthesis' });
    } else {
      progress('story-comment-workflow-skipped', { reason: comment.reason });
    }

    const browserLogDiagnostics = summarizeBrowserLogDiagnostics(logs);
    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: 'pass',
      browserLogDiagnostics,
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
          initialCount: initialCards.length,
          meshIndexCount,
          newStoryIds: afterScrollNewStoryIds.slice(0, 24),
          beforeScrollNewsStore,
          afterScrollNewsStore,
          loadMoreRefreshCalls: loadMoreRefreshCalls.slice(0, 24),
        },
        storyDetailOpens: storyDetailCheck,
        acceptedAnalysisSynthesisVisible: synthesis,
        pointStanceWriteReadback: voteProof,
        storyThreadCreateComment: comment,
        reloadPersistence: reload,
        secondBrowserVisibility: secondBrowser,
      },
    };
    if (browserLogDiagnostics.criticalCspViolationCount > 0) {
      throw new Error(`public-feed-browser-csp-violations:${browserLogDiagnostics.criticalCspViolationCount}`);
    }
    if (publicRelayAnalysisFrameCoverage.status !== 'pass') {
      throw new Error(publicRelayAnalysisFrameCoverage.errorMessage || 'public-relay-analysis-frame-coverage-failed');
    }
    assertPublicRelayPaginationReadback(publicRelayPaginationReadback, env);
  } catch (error) {
    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: 'fail',
      browserLogDiagnostics: summarizeBrowserLogDiagnostics(logs),
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
  extractViteEnvString,
  fetchDeployedSystemWriterPin,
  refreshLatest,
  installRefreshLatestRecorder,
  readRefreshLatestRecorder,
  readPublicNewsStoreSnapshot,
  findVisibleStoryRow,
  summarizeBrowserLogDiagnostics,
  waitForInitialOpenHeadlines,
  gotoFeedInitialOpen,
  resolveArtifactDir,
  resolveSystemWriterPin,
  isAcceptedSynthesisText,
  acceptedSynthesisCurrentForStory,
  readVisibleNonAcceptedSynthesisState,
  loadSystemWriterPin,
  parsePublicPointAggregatePayload,
  readPublicPointAggregateViaOrigin,
  loadRepoSystemWriterPin,
  latestIndexRecordsFromPayload,
  readPublicRelayLatestIndexPage,
  readPublicRelayPaginationReadback,
  assertPublicRelayPaginationReadback,
  readPublicRelaySynthesisCandidates,
  assertPublicRelayAnalysisFrameCoverage,
  capturePublicRelayAnalysisFrameCoverage,
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
