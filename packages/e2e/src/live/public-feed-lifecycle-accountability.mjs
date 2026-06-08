#!/usr/bin/env node

import {
  createClient,
  readNewsStory,
} from '@vh/gun-client';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { summarizeSourceHealthReport } from './public-feed-composition-freshness-gate.mjs';
import { publicFeedBrowserSmokeInternal } from './public-feed-browser-smoke.mjs';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const DEFAULT_BASE_URL = 'http://127.0.0.1:2048/';
const DEFAULT_GUN_PEER_URL = 'http://127.0.0.1:7777/gun';

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? (trimmed.endsWith('/') ? trimmed : `${trimmed}/`) : DEFAULT_BASE_URL;
}

function normalizeGunPeer(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  return trimmed.endsWith('/gun') ? trimmed : `${trimmed.replace(/\/+$/, '')}/gun`;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePeer(value) {
  return parsePeerList(value)[0] ?? '';
}

function parsePeerList(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.flatMap(parsePeerList);
    } catch {
      return [];
    }
  }
  return raw.split(/[,\s]+/).map(normalizeGunPeer).filter(Boolean);
}

function resolveGunPeer(env) {
  return parsePeer(env.VH_PUBLIC_FEED_GUN_PEER_URL)
    || parsePeer(env.VITE_GUN_PEERS)
    || DEFAULT_GUN_PEER_URL;
}

function parseOriginList(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }
  return raw.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean);
}

function gunPeerFromRelayOrigin(origin) {
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol === 'http:') url.protocol = 'ws:';
    url.pathname = '/gun';
    url.search = '';
    url.hash = '';
    return normalizeGunPeer(url.href);
  } catch {
    return '';
  }
}

function resolveGunPeers(env) {
  const explicitPublicPeers = [
    ...parsePeerList(env.VH_PUBLIC_FEED_PUBLIC_WSS_PEERS),
    ...parsePeerList(env.VH_MESH_PUBLIC_WSS_PEERS),
  ].filter(Boolean);
  if (explicitPublicPeers.length > 0) {
    return [...new Set([resolveGunPeer(env), ...explicitPublicPeers].filter(Boolean))];
  }
  const peers = [
    resolveGunPeer(env),
    ...parseOriginList(env.VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS).map(gunPeerFromRelayOrigin),
  ].filter(Boolean);
  return [...new Set(peers)];
}

function resolveArtifactDir(env, repoRoot) {
  const explicit = env.VH_PUBLIC_FEED_LIFECYCLE_ARTIFACT_DIR?.trim();
  if (explicit) return explicit;
  return path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-lifecycle-accountability', String(Date.now()));
}

function resolveSourceHealthReportPath(env, repoRoot) {
  const explicit = env.VH_PUBLIC_FEED_SOURCE_HEALTH_REPORT_PATH?.trim()
    || env.VH_NEWS_SOURCE_HEALTH_REPORT_PATH?.trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
  }
  return path.join(
    repoRoot,
    'services',
    'news-aggregator',
    '.tmp',
    'news-source-admission',
    'latest',
    'source-health-report.json',
  );
}

async function readSourceHealthEvidence(env, repoRoot) {
  const reportPath = resolveSourceHealthReportPath(env, repoRoot);
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    return {
      path: reportPath,
      ...summarizeSourceHealthReport(report),
    };
  } catch (error) {
    return {
      path: reportPath,
      available: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function updateLatestSymlink(artifactDir, repoRoot) {
  const evidenceRoot = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-lifecycle-accountability');
  const resolvedArtifactDir = path.resolve(artifactDir);
  const resolvedEvidenceRoot = path.resolve(evidenceRoot);
  if (!resolvedArtifactDir.startsWith(`${resolvedEvidenceRoot}${path.sep}`)) return;
  const latestPath = path.join(evidenceRoot, 'latest');
  await rm(latestPath, { recursive: true, force: true });
  try {
    await symlink(artifactDir, latestPath, 'dir');
  } catch {
    await mkdir(latestPath, { recursive: true });
    await writeJson(path.join(latestPath, 'latest-artifact.json'), { artifactDir });
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`http-${response.status}:${url}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function latestRecordStoryId(key, record) {
  const candidates = [record?.story_id, record?.storyId, key];
  return candidates.map((candidate) => String(candidate ?? '').trim()).find(Boolean) ?? '';
}

async function readRelayLatest(baseUrl, limit, timeoutMs) {
  const url = new URL('/vh/news/latest-index', normalizeUrl(baseUrl));
  url.searchParams.set('limit', String(limit));
  const payload = await fetchJson(url.href, timeoutMs);
  const rawRecords = payload?.records && typeof payload.records === 'object'
    ? payload.records
    : payload?.index && typeof payload.index === 'object'
      ? payload.index
      : {};
  const records = {};
  for (const [key, record] of Object.entries(rawRecords)) {
    const storyId = latestRecordStoryId(key, record);
    if (storyId) records[storyId] = record;
  }
  return {
    records,
    storyStates: payload?.story_states && typeof payload.story_states === 'object' ? payload.story_states : {},
    stories: payload?.stories && typeof payload.stories === 'object' ? payload.stories : {},
    composition: payload?.composition && typeof payload.composition === 'object' ? payload.composition : null,
  };
}

async function readRelayHot(baseUrl, limit, timeoutMs) {
  const url = new URL('/vh/news/hot-index', normalizeUrl(baseUrl));
  url.searchParams.set('limit', String(limit));
  const payload = await fetchJson(url.href, timeoutMs).catch(() => null);
  const rawRecords = payload?.records && typeof payload.records === 'object'
    ? payload.records
    : payload?.index && typeof payload.index === 'object'
      ? payload.index
      : {};
  const records = {};
  for (const [key, record] of Object.entries(rawRecords)) {
    const storyId = latestRecordStoryId(key, record);
    if (storyId) records[storyId] = record;
  }
  return {
    records,
    available: Boolean(payload?.ok),
  };
}

async function readRelayLifecycle(baseUrl, storyId, timeoutMs) {
  const url = new URL('/vh/news/synthesis-lifecycle', normalizeUrl(baseUrl));
  url.searchParams.set('story_id', storyId);
  const payload = await fetchJson(url.href, timeoutMs).catch(() => null);
  if (payload?.lifecycle && typeof payload.lifecycle === 'object') {
    return payload.lifecycle;
  }
  if (payload?.record && typeof payload.record === 'object') {
    return payload.record;
  }
  return null;
}

async function readRelayTopicSynthesis(baseUrl, topicId, timeoutMs) {
  const url = new URL('/vh/topics/synthesis', normalizeUrl(baseUrl));
  url.searchParams.set('topic_id', topicId);
  const payload = await fetchJson(url.href, timeoutMs).catch(() => null);
  if (payload?.synthesis && typeof payload.synthesis === 'object') {
    return payload.synthesis;
  }
  if (payload?.record && typeof payload.record === 'object') {
    return payload.record;
  }
  return null;
}

function latestIndexFromRelayRecords(records) {
  const index = {};
  for (const [storyId, record] of Object.entries(records ?? {})) {
    const latestActivityAt = finiteNonNegativeIndexInt(
      record && typeof record === 'object'
        ? record.latest_activity_at ?? record.cluster_window_end ?? record.created_at
        : record,
    );
    if (latestActivityAt !== null) {
      index[storyId] = latestActivityAt;
    }
  }
  return index;
}

function hotIndexFromRelayRecords(records) {
  const index = {};
  for (const [storyId, record] of Object.entries(records ?? {})) {
    const hotness = finiteNonNegativeNumber(record && typeof record === 'object' ? record.hotness : record);
    if (hotness !== null) {
      index[storyId] = hotness;
    }
  }
  return index;
}

function readGunMapKeys(chain, limit, timeoutMs) {
  return new Promise((resolve) => {
    const keys = [];
    const seen = new Set();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(keys);
    };
    const timeout = setTimeout(finish, timeoutMs);
    const mapped = chain?.map?.();
    if (!mapped || typeof mapped.once !== 'function') {
      finish();
      return;
    }
    mapped.once((value, key) => {
      const storyId = String(key ?? '').trim();
      if (!storyId || storyId === '_' || value === null || value === undefined || seen.has(storyId)) return;
      seen.add(storyId);
      keys.push(storyId);
      if (keys.length >= limit) finish();
    });
  });
}

function readGunOnce(chain, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value ?? null);
    };
    const timeout = setTimeout(() => finish(null), timeoutMs);
    if (!chain || typeof chain.once !== 'function') {
      finish(null);
      return;
    }
    chain.once((value) => finish(value));
  });
}

function stripGunMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === '_' || key === '#') continue;
    output[key] = entry;
  }
  return output;
}

async function readNewsHotIndexProductRecord(client, storyId, timeoutMs) {
  const raw = stripGunMetadata(await readGunOnce(
    client.mesh?.get('news')?.get('index')?.get('hot')?.get(storyId),
    timeoutMs,
  ));
  if (raw === null || raw === undefined) return null;
  const hotness = Number(raw && typeof raw === 'object' ? raw.hotness : raw);
  if (!Number.isFinite(hotness) || hotness < 0) return null;
  if (!raw || typeof raw !== 'object') {
    return { story_id: storyId, hotness };
  }
  const rawStoryId = String(raw.story_id ?? '').trim();
  if (rawStoryId && rawStoryId !== storyId) return null;
  return {
    ...raw,
    story_id: rawStoryId || storyId,
    hotness,
  };
}

async function readRawStoryIds(client, limit, timeoutMs) {
  return readGunMapKeys(client.mesh?.get('news')?.get('stories'), limit, timeoutMs);
}

function finiteNonNegativeIndexInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function finiteNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function sourceCount(story) {
  const primary = Array.isArray(story?.primary_sources) ? story.primary_sources.length : 0;
  const canonical = Number(story?.canonical_source_count ?? story?.source_count ?? 0);
  const sources = Array.isArray(story?.sources) ? story.sources.length : 0;
  return Math.max(primary, Number.isFinite(canonical) ? canonical : 0, sources);
}

function recordString(record, key) {
  const value = record && typeof record === 'object' ? record[key] : null;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function classifyProductIndexMetadata(record, story) {
  if (!story) return 'story_missing';
  if (!record || typeof record !== 'object') return 'missing';
  const expectedSourceCount = Array.isArray(story.sources) ? story.sources.length : sourceCount(story);
  const expectedCanonicalSourceCount = Array.isArray(story.primary_sources)
    ? story.primary_sources.length
    : expectedSourceCount;
  const expectedStoryCreatedAt = finiteNonNegativeIndexInt(story.created_at);
  const expectedClusterWindowStart = finiteNonNegativeIndexInt(story.cluster_window_start);
  const recordSourceCount = finiteNonNegativeIndexInt(record.source_count);
  const recordCanonicalSourceCount = finiteNonNegativeIndexInt(record.canonical_source_count);
  const recordStoryCreatedAt = finiteNonNegativeIndexInt(record.story_created_at);
  const recordClusterWindowStart = finiteNonNegativeIndexInt(record.cluster_window_start);
  const hasSchema = record.product_state_schema_version === 'vh-news-product-feed-index-v1';
  const hasStoryId = String(record.story_id ?? '').trim() === String(story.story_id ?? '').trim();
  const hasTopic = String(record.topic_id ?? '').trim() === String(story.topic_id ?? '').trim();
  const storyRevision = String(story.provenance_hash ?? '').trim();
  const hasRevision = storyRevision && String(record.source_set_revision ?? '').trim() === storyRevision;
  const hasSourceCounts =
    recordSourceCount === expectedSourceCount &&
    recordCanonicalSourceCount === expectedCanonicalSourceCount;
  const hasTimestamps =
    expectedStoryCreatedAt !== null &&
    expectedClusterWindowStart !== null &&
    recordStoryCreatedAt === expectedStoryCreatedAt &&
    recordClusterWindowStart === expectedClusterWindowStart;
  if (hasSchema && hasStoryId && hasTopic && hasRevision && hasSourceCounts && hasTimestamps) {
    return 'complete';
  }
  return hasSchema || hasTopic || recordSourceCount !== null || recordCanonicalSourceCount !== null
    ? 'partial_or_mismatch'
    : 'missing';
}

function sourceLabels(story) {
  const sources = Array.isArray(story?.primary_sources) && story.primary_sources.length > 0
    ? story.primary_sources
    : Array.isArray(story?.sources)
      ? story.sources
      : [];
  return sources
    .map((source) => String(source?.publisher || source?.source_id || source?.url || '').trim())
    .filter(Boolean);
}

function isEligibleStory(story) {
  return Boolean(
    story?.story_id
      && story?.topic_id
      && story?.headline
      && sourceCount(story) > 0
      && (Array.isArray(story?.sources) || Array.isArray(story?.primary_sources)),
  );
}

function isAcceptedFrameReady(synthesis) {
  return Boolean(
    synthesis?.facts_summary?.trim()
      && Array.isArray(synthesis.frames)
      && synthesis.frames.length > 0
      && synthesis.frames.every((row) =>
        String(row?.frame ?? '').trim()
          && String(row?.reframe ?? '').trim()
          && String(row?.frame_point_id ?? '').trim()
          && String(row?.reframe_point_id ?? '').trim()
      ),
  );
}

function hasAcceptedSynthesisPayload(synthesis) {
  return Boolean(
    synthesis?.facts_summary?.trim()
      && Array.isArray(synthesis.frames)
      && synthesis.frames.length > 0
      && synthesis.frames.every((row) =>
        String(row?.frame ?? '').trim()
          && String(row?.reframe ?? '').trim()
      ),
  );
}

function synthesisInputsIncludeStory(synthesis, storyId) {
  const normalizedStoryId = String(storyId ?? '').trim();
  if (!normalizedStoryId) return false;
  const storyBundleIds = Array.isArray(synthesis?.inputs?.story_bundle_ids)
    ? synthesis.inputs.story_bundle_ids
    : [];
  return storyBundleIds.some((candidate) => String(candidate ?? '').trim() === normalizedStoryId);
}

function isAcceptedSynthesisCurrentForStory({ story, lifecycle, synthesis }) {
  if (!story?.story_id || !story?.provenance_hash) return false;
  if (!hasAcceptedSynthesisPayload(synthesis)) return false;
  if (!synthesisInputsIncludeStory(synthesis, story.story_id)) return false;
  if (!lifecycle || lifecycle.status !== 'accepted_available') return false;
  if (lifecycle.source_set_revision !== story.provenance_hash) return false;
  if (typeof synthesis.synthesis_id !== 'string' || lifecycle.synthesis_id !== synthesis.synthesis_id) return false;
  if (Number.isFinite(Number(synthesis.epoch)) && Number.isFinite(Number(lifecycle.epoch))) {
    return Math.floor(Number(synthesis.epoch)) === Math.floor(Number(lifecycle.epoch));
  }
  return true;
}

function lifecycleFromRelayState(story, relayState) {
  if (!story || !relayState || typeof relayState !== 'object') {
    return null;
  }
  const status = recordString(relayState, 'lifecycle_status');
  const sourceSetRevision = recordString(relayState, 'lifecycle_source_set_revision');
  if (!LIFECYCLE_STATUSES.has(status) || !sourceSetRevision) {
    return null;
  }
  const updatedAt = finiteNonNegativeIndexInt(relayState.lifecycle_updated_at);
  return {
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    story_id: story.story_id,
    topic_id: story.topic_id,
    source_set_revision: sourceSetRevision,
    source_count: Array.isArray(story.sources) ? story.sources.length : sourceCount(story),
    canonical_source_count: Array.isArray(story.primary_sources)
      ? story.primary_sources.length
      : sourceCount(story),
    status,
    retryable: relayState.retryable === true,
    ...(recordString(relayState, 'terminal_unavailable_reason')
      ? { reason: recordString(relayState, 'terminal_unavailable_reason') }
      : {}),
    ...(recordString(relayState, 'synthesis_id') ? { synthesis_id: recordString(relayState, 'synthesis_id') } : {}),
    ...(Number.isFinite(Number(relayState.epoch)) ? { epoch: Math.floor(Number(relayState.epoch)) } : {}),
    frame_table_state: recordString(relayState, 'frame_table_state') || 'frame_table_pending',
    updated_at: updatedAt ?? 0,
  };
}

function classifyStory({ story, storyId, lifecycle, productVisible, staleCutoffMs }) {
  if (!story) return 'blocked';
  if (!isEligibleStory(story)) return 'rejected_source';
  if (productVisible) return 'product_visible';
  const latestActivity = Number(story.cluster_window_end ?? story.latest_activity_at ?? story.created_at ?? 0);
  if (Number.isFinite(latestActivity) && latestActivity > 0 && latestActivity < staleCutoffMs) return 'stale';
  if (lifecycle?.status === 'terminal_unavailable') return 'hidden_bug';
  if (['pending', 'in_progress', 'retryable_failure', 'accepted_available', 'suppressed'].includes(String(lifecycle?.status ?? ''))) {
    return 'hidden_bug';
  }
  return storyId ? 'hidden_bug' : 'blocked';
}

const LIFECYCLE_STATUSES = new Set([
  'pending',
  'in_progress',
  'accepted_available',
  'retryable_failure',
  'terminal_unavailable',
  'suppressed',
]);
const INCOMPLETE_SYNTHESIS_LIFECYCLE_STATUSES = new Set([
  'pending',
  'in_progress',
  'retryable_failure',
]);

function classifyLifecycleLedgerStatus(story) {
  if (!story?.product_visible || story.source_count <= 0) return 'not_required';
  const lifecycleStatus = String(story.lifecycle_status ?? '').trim();
  if (!lifecycleStatus) return 'missing';
  if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) return 'invalid_status';
  const lifecycleRevision = String(story.lifecycle_source_set_revision ?? '').trim();
  if (!lifecycleRevision) return 'missing_revision';
  const storyRevision = String(story.source_set_revision ?? '').trim();
  if (storyRevision && lifecycleRevision !== storyRevision) return 'source_set_mismatch';
  return 'complete';
}

function classifySynthesisLifecycleFreshness(story, nowMs, staleWindowMs) {
  if (!story?.product_visible || story.source_count <= 0) return 'not_required';
  const lifecycleStatus = String(story.lifecycle_status ?? '').trim();
  if (!INCOMPLETE_SYNTHESIS_LIFECYCLE_STATUSES.has(lifecycleStatus)) return 'not_pending';
  const updatedAt = Number(story.lifecycle_updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 'missing_updated_at';
  const ageMs = Math.max(0, Math.floor(nowMs - updatedAt));
  return ageMs > staleWindowMs ? 'stale_pending' : 'fresh_pending';
}

function selectLifecycleSampleIds({
  relayIds = [],
  latestIds = [],
  hotIds = [],
  rawStoryIds = [],
  sampleLimit,
}) {
  const effectiveLimit = Math.max(
    parsePositiveInt(sampleLimit, 1),
    Array.isArray(relayIds) ? relayIds.length : 0,
  );
  return [...new Set([
    ...relayIds,
    ...latestIds,
    ...hotIds,
    ...rawStoryIds,
  ])].slice(0, effectiveLimit);
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function classifyLifecycleAccountabilityStatus(failures) {
  if (failures.length === 0) return 'pass';
  const codes = failures.map((failure) => String(failure?.code ?? ''));
  const hasHardLifecycleFailure = codes.some((code) =>
    code === 'eligible_raw_story_hidden_without_allowed_reason'
      || code === 'multi_source_raw_story_hidden_by_synthesis_state'
      || code === 'relay_accepted_synthesis_not_current'
      || code === 'product_feed_hot_index_missing_for_visible_story'
      || code === 'hot_index_product_metadata_missing'
      || code === 'public_raw_story_mesh_missing_multi_source'
      || code === 'product_visible_synthesis_lifecycle_missing_or_stale'
      || code === 'product_visible_synthesis_lifecycle_pending_stale'
  );
  if (hasHardLifecycleFailure) return 'fail';
  if (codes.every((code) =>
    code === 'public_feed_composition_missing_singleton'
      || code === 'public_feed_composition_missing_multi_source'
  )) {
    return 'setup_scarcity';
  }
  return 'fail';
}

async function runPublicFeedLifecycleAccountability({
  env = process.env,
  repoRoot = DEFAULT_REPO_ROOT,
} = {}) {
  const baseUrl = normalizeUrl(env.VH_PUBLIC_FEED_APP_URL || env.VH_LIVE_BASE_URL || DEFAULT_BASE_URL);
  const gunPeerUrl = resolveGunPeer(env);
  const gunPeerUrls = resolveGunPeers(env);
  const sampleLimit = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_SAMPLE_LIMIT, 120);
  const hotLimit = parsePositiveInt(
    env.VH_PUBLIC_FEED_LIFECYCLE_HOT_LIMIT,
    Math.min(sampleLimit, 40),
  );
  const timeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_TIMEOUT_MS, 75_000);
  const rowTimeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_ROW_TIMEOUT_MS, 10_000);
  const rowConcurrency = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_ROW_CONCURRENCY, 10);
  const staleWindowMs = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_STALE_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  const synthesisPendingStaleMs = parsePositiveInt(
    env.VH_PUBLIC_FEED_SYNTHESIS_PENDING_STALE_MS,
    2 * 60 * 60 * 1000,
  );
  const artifactDir = resolveArtifactDir(env, repoRoot);
  const summaryPath = path.join(artifactDir, 'public-feed-lifecycle-accountability-summary.json');
  await mkdir(artifactDir, { recursive: true });
  const sourceHealthEvidence = await readSourceHealthEvidence(env, repoRoot);

  let summary = {
    schemaVersion: 'public-feed-lifecycle-accountability-v1',
    generatedAt: new Date().toISOString(),
    status: 'fail',
    artifactDir,
    artifactPaths: { summaryPath },
    config: {
      baseUrl,
      gunPeerUrl,
      gunPeerUrls,
      sampleLimit,
      hotLimit,
      timeoutMs,
      rowTimeoutMs,
      rowConcurrency,
      staleWindowMs,
      synthesisPendingStaleMs,
    },
    counts: {},
    composition: null,
    sourceHealthEvidence,
    stories: [],
    failures: [],
  };

  const systemWriterPin = await publicFeedBrowserSmokeInternal.resolveSystemWriterPin({
    repoRoot,
    env,
    baseUrl,
    progress: () => {},
  });
  const client = createClient({
    peers: gunPeerUrls,
    requireSession: false,
    gunLocalStorage: false,
    gunFile: path.join(artifactDir, 'gun-client'),
    systemWriterPin,
  });
  client.markSessionReady();

  try {
    const [rawStoryIds, relayLatest, relayHot] = await Promise.all([
      readRawStoryIds(client, sampleLimit, Math.min(timeoutMs, 5_000)).catch(() => []),
      readRelayLatest(baseUrl, sampleLimit, timeoutMs),
      readRelayHot(baseUrl, hotLimit, timeoutMs),
    ]);
    const latestIndex = latestIndexFromRelayRecords(relayLatest.records);
    const hotIndex = hotIndexFromRelayRecords(relayHot.records);
    const latestIds = Object.keys(latestIndex);
    const hotIds = [...new Set([...Object.keys(hotIndex), ...Object.keys(relayHot.records)])];
    const relayIds = Object.keys(relayLatest.records);
    const sampledIds = selectLifecycleSampleIds({
      relayIds,
      latestIds,
      hotIds,
      rawStoryIds,
      sampleLimit,
    });
    const staleCutoffMs = Date.now() - staleWindowMs;
    const stories = await mapWithConcurrency(sampledIds, rowConcurrency, async (storyId) => {
      const relayStory = relayLatest.stories?.[storyId] && typeof relayLatest.stories[storyId] === 'object'
        ? relayLatest.stories[storyId]
        : null;
      const story = relayStory ?? await readNewsStory(client, storyId).catch(() => null);
      const relayState = relayLatest.storyStates?.[storyId] ?? null;
      const lifecycle = lifecycleFromRelayState(story, relayState)
        ?? (story ? await readRelayLifecycle(baseUrl, storyId, rowTimeoutMs) : null);
      const synthesis = story?.topic_id && (
        lifecycle?.status === 'accepted_available'
          || relayState?.synthesis_state === 'accepted_synthesis_available'
      )
        ? await readRelayTopicSynthesis(baseUrl, story.topic_id, rowTimeoutMs)
        : null;
      const inLatest = Object.prototype.hasOwnProperty.call(latestIndex, storyId);
      const inHot = Object.prototype.hasOwnProperty.call(hotIndex, storyId)
        || Object.prototype.hasOwnProperty.call(relayHot.records, storyId);
      const inRelay = Object.prototype.hasOwnProperty.call(relayLatest.records, storyId);
      const productVisible = inLatest || inHot || inRelay;
      const hotProductRecord = inHot
        ? relayHot.records[storyId]
          ?? null
        : null;
      const hotIndexProductMetadataStatus = inHot
        ? classifyProductIndexMetadata(hotProductRecord, story)
        : 'not_in_hot_index';
      const classification = classifyStory({ story, storyId, lifecycle, productVisible, staleCutoffMs });
      const acceptedSynthesisCurrent = isAcceptedSynthesisCurrentForStory({ story, lifecycle, synthesis });
      const frameTableReady = acceptedSynthesisCurrent && isAcceptedFrameReady(synthesis);
      const storySummary = {
        story_id: storyId,
        topic_id: story?.topic_id ?? null,
        headline: story?.headline ?? null,
        source_set_revision: story?.provenance_hash ?? null,
        source_count: story ? sourceCount(story) : 0,
        source_labels: story ? sourceLabels(story) : [],
        latest_activity_at: story?.cluster_window_end ?? story?.latest_activity_at ?? null,
        in_latest_index: inLatest,
        in_hot_index: inHot,
        in_relay_latest_index: inRelay,
        product_visible: productVisible,
        hot_index_hotness: Number.isFinite(hotIndex[storyId])
          ? hotIndex[storyId]
          : finiteNonNegativeNumber(hotProductRecord?.hotness ?? hotProductRecord),
        hot_index_product_metadata_status: hotIndexProductMetadataStatus,
        hot_index_product_source_set_revision: hotProductRecord?.source_set_revision ?? null,
        hot_index_product_source_count: finiteNonNegativeIndexInt(hotProductRecord?.source_count),
        lifecycle_status: lifecycle?.status ?? null,
        lifecycle_source_set_revision: lifecycle?.source_set_revision ?? null,
        lifecycle_updated_at: finiteNonNegativeIndexInt(lifecycle?.updated_at),
        lifecycle_reason: lifecycle?.reason ?? null,
        frame_table_state: lifecycle?.frame_table_state ?? null,
        accepted_synthesis_available: acceptedSynthesisCurrent,
        topic_latest_synthesis_present: Boolean(synthesis?.facts_summary?.trim()),
        topic_latest_synthesis_id: synthesis?.synthesis_id ?? null,
        topic_latest_synthesis_epoch: Number.isFinite(Number(synthesis?.epoch)) ? Math.floor(Number(synthesis.epoch)) : null,
        frame_table_ready: frameTableReady,
        relay_state: relayState,
        classification,
      };
      return {
        ...storySummary,
        lifecycle_ledger_status: classifyLifecycleLedgerStatus(storySummary),
        synthesis_lifecycle_freshness_status: classifySynthesisLifecycleFreshness(
          storySummary,
          Date.now(),
          synthesisPendingStaleMs,
        ),
      };
    });

    const counts = stories.reduce((acc, story) => {
      acc.total_sampled += 1;
      acc[story.classification] = (acc[story.classification] ?? 0) + 1;
      if (story.source_count > 0) acc.raw_story_readable_total += 1;
      if (story.source_count === 1) acc.singleton_raw_total += 1;
      if (story.source_count > 1) acc.multi_source_raw_total += 1;
      if (story.product_visible) acc.product_visible_total += 1;
      if (story.source_count === 1 && story.product_visible) acc.singleton_visible += 1;
      if (story.source_count > 1 && story.product_visible) acc.multi_source_visible += 1;
      if (story.product_visible && story.source_count > 0 && !story.in_hot_index) acc.visible_missing_hot_index += 1;
      if (story.in_hot_index) {
        const key = `hot_index_product_metadata_${story.hot_index_product_metadata_status}`;
        acc[key] = (acc[key] ?? 0) + 1;
      }
      if (story.lifecycle_status === 'pending') acc.pending += 1;
      if (story.lifecycle_status === 'in_progress') acc.in_progress += 1;
      if (story.lifecycle_status === 'retryable_failure') acc.retryable_failure += 1;
      if (story.lifecycle_status === 'terminal_unavailable') acc.terminal_unavailable += 1;
      if (story.accepted_synthesis_available) acc.accepted_available += 1;
      if (story.frame_table_ready) acc.frame_table_ready += 1;
      const lifecycleLedgerKey = `lifecycle_ledger_${story.lifecycle_ledger_status}`;
      acc[lifecycleLedgerKey] = (acc[lifecycleLedgerKey] ?? 0) + 1;
      const lifecycleFreshnessKey = `synthesis_lifecycle_${story.synthesis_lifecycle_freshness_status}`;
      acc[lifecycleFreshnessKey] = (acc[lifecycleFreshnessKey] ?? 0) + 1;
      return acc;
    }, {
      total_sampled: 0,
      raw_story_readable_total: 0,
      singleton_raw_total: 0,
      multi_source_raw_total: 0,
      product_visible_total: 0,
      singleton_visible: 0,
      multi_source_visible: 0,
      visible_missing_hot_index: 0,
      hot_index_product_metadata_complete: 0,
      hot_index_product_metadata_missing: 0,
      hot_index_product_metadata_partial_or_mismatch: 0,
      hot_index_product_metadata_story_missing: 0,
      pending: 0,
      in_progress: 0,
      retryable_failure: 0,
      terminal_unavailable: 0,
      accepted_available: 0,
      frame_table_ready: 0,
      lifecycle_ledger_complete: 0,
      lifecycle_ledger_missing: 0,
      lifecycle_ledger_invalid_status: 0,
      lifecycle_ledger_missing_revision: 0,
      lifecycle_ledger_source_set_mismatch: 0,
      lifecycle_ledger_not_required: 0,
      synthesis_lifecycle_fresh_pending: 0,
      synthesis_lifecycle_stale_pending: 0,
      synthesis_lifecycle_missing_updated_at: 0,
      synthesis_lifecycle_not_pending: 0,
      synthesis_lifecycle_not_required: 0,
    });
    const failures = [];
    const hiddenEligible = stories.filter((story) => story.classification === 'hidden_bug');
    if (hiddenEligible.length > 0) {
      failures.push({
        code: 'eligible_raw_story_hidden_without_allowed_reason',
        story_ids: hiddenEligible.map((story) => story.story_id),
      });
    }
    const hiddenMultiSourcePending = hiddenEligible.filter(
      (story) => story.source_count > 1 && ['pending', 'in_progress', 'retryable_failure', null].includes(story.lifecycle_status),
    );
    if (hiddenMultiSourcePending.length > 0) {
      failures.push({
        code: 'multi_source_raw_story_hidden_by_synthesis_state',
        story_ids: hiddenMultiSourcePending.map((story) => story.story_id),
      });
    }
    const relayAcceptedNotCurrent = stories.filter(
      (story) => story.relay_state?.synthesis_state === 'accepted_synthesis_available'
        && !story.accepted_synthesis_available,
    );
    if (relayAcceptedNotCurrent.length > 0) {
      failures.push({
        code: 'relay_accepted_synthesis_not_current',
        story_ids: relayAcceptedNotCurrent.map((story) => story.story_id),
      });
    }
    const lifecycleLedgerMissingOrStale = stories.filter((story) =>
      story.product_visible
        && story.source_count > 0
        && story.lifecycle_ledger_status !== 'complete',
    );
    if (lifecycleLedgerMissingOrStale.length > 0) {
      failures.push({
        code: 'product_visible_synthesis_lifecycle_missing_or_stale',
        story_ids: lifecycleLedgerMissingOrStale.map((story) => story.story_id),
        status_counts: lifecycleLedgerMissingOrStale.reduce((acc, story) => {
          acc[story.lifecycle_ledger_status] = (acc[story.lifecycle_ledger_status] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }
    const stalePendingLifecycle = stories.filter((story) =>
      story.product_visible
        && story.source_count > 0
        && ['stale_pending', 'missing_updated_at'].includes(story.synthesis_lifecycle_freshness_status),
    );
    if (stalePendingLifecycle.length > 0) {
      failures.push({
        code: 'product_visible_synthesis_lifecycle_pending_stale',
        story_ids: stalePendingLifecycle.map((story) => story.story_id),
        status_counts: stalePendingLifecycle.reduce((acc, story) => {
          acc[story.synthesis_lifecycle_freshness_status] =
            (acc[story.synthesis_lifecycle_freshness_status] ?? 0) + 1;
          return acc;
        }, {}),
        stale_window_ms: synthesisPendingStaleMs,
      });
    }
    if (!relayHot.available || Object.keys(relayHot.records).length === 0) {
      failures.push({
        code: 'product_feed_hot_index_unavailable_or_empty',
        hot_limit: hotLimit,
      });
    }
    const hotIndexMetadataMissing = stories.filter((story) =>
      story.in_hot_index && story.hot_index_product_metadata_status !== 'complete',
    );
    if (hotIndexMetadataMissing.length > 0) {
      failures.push({
        code: 'hot_index_product_metadata_missing',
        story_ids: hotIndexMetadataMissing.map((story) => story.story_id),
        status_counts: hotIndexMetadataMissing.reduce((acc, story) => {
          acc[story.hot_index_product_metadata_status] = (acc[story.hot_index_product_metadata_status] ?? 0) + 1;
          return acc;
        }, {}),
      });
    }
    if (counts.singleton_visible <= 0) {
      failures.push({ code: 'public_feed_composition_missing_singleton' });
    }
    if (counts.multi_source_visible <= 0) {
      failures.push({ code: 'public_feed_composition_missing_multi_source' });
    }
    const sourceHealthCorroboratedCount = finiteNonNegativeIndexInt(
      sourceHealthEvidence?.totalCorroboratedBundleCount,
    ) ?? 0;
    if (sourceHealthCorroboratedCount > 0 && counts.multi_source_raw_total <= 0) {
      failures.push({
        code: 'public_raw_story_mesh_missing_multi_source',
        source_health_corroborated_bundle_count: sourceHealthCorroboratedCount,
      });
    }

    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: classifyLifecycleAccountabilityStatus(failures),
      config: {
        ...summary.config,
        effectiveSampleCount: sampledIds.length,
      },
      counts,
      composition: relayLatest.composition,
      sourceHealthEvidence,
      mesh: {
        latestIndexCount: latestIds.length,
        hotIndexCount: hotIds.length,
        relayHotIndexCount: Object.keys(relayHot.records).length,
        relayHotIndexAvailable: relayHot.available,
        rawStoryRootSampleCount: rawStoryIds.length,
      },
      stories,
      failures,
    };
    await writeJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
    if (summary.status !== 'pass') {
      const codes = failures.map((failure) => failure.code).join(',');
      throw new Error(`${summary.status}:${codes}`);
    }
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failures = summary.failures?.length
      ? summary.failures
      : [{ code: 'public_feed_lifecycle_readback_failed', error: message }];
    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: classifyLifecycleAccountabilityStatus(failures),
      failures,
    };
    await writeJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
    throw new Error(`${summary.status}:${failures.map((failure) => failure.code).join(',')}`);
  } finally {
    await Promise.race([
      client.shutdown(),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]).catch(() => {});
    await writeJson(summaryPath, summary);
    await updateLatestSymlink(artifactDir, repoRoot);
  }
}

async function main() {
  const summary = await runPublicFeedLifecycleAccountability();
  console.info(JSON.stringify({
    status: summary.status,
    counts: summary.counts,
    artifact: summary.artifactPaths.summaryPath,
  }, null, 2));
}

export {
  runPublicFeedLifecycleAccountability,
  resolveGunPeers,
  readRelayLatest,
  readRelayHot,
  sourceCount,
  classifyProductIndexMetadata,
  classifyLifecycleLedgerStatus,
  classifySynthesisLifecycleFreshness,
  selectLifecycleSampleIds,
  isAcceptedFrameReady,
  isAcceptedSynthesisCurrentForStory,
  classifyLifecycleAccountabilityStatus,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .then(() => {
      // Gun can leave relay sockets/timers alive after all evidence is written.
      process.exit(0);
    })
    .catch((error) => {
      console.error('[vh:public-feed-lifecycle-accountability] failed', error);
      process.exit(1);
    });
}
