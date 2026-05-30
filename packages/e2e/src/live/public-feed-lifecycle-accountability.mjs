#!/usr/bin/env node

import {
  createClient,
  readNewsHotIndex,
  readNewsLatestIndex,
  readNewsStory,
  readTopicLatestSynthesis,
} from '@vh/gun-client';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsePeer(parsed[0]);
    } catch {
      return '';
    }
  }
  return normalizeGunPeer(raw.split(/[,\s]+/).find(Boolean));
}

function resolveGunPeer(env) {
  return parsePeer(env.VH_PUBLIC_FEED_GUN_PEER_URL)
    || parsePeer(env.VITE_GUN_PEERS)
    || DEFAULT_GUN_PEER_URL;
}

function resolveArtifactDir(env, repoRoot) {
  const explicit = env.VH_PUBLIC_FEED_LIFECYCLE_ARTIFACT_DIR?.trim();
  if (explicit) return explicit;
  return path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-lifecycle-accountability', String(Date.now()));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function updateLatestSymlink(artifactDir, repoRoot) {
  const latestPath = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-lifecycle-accountability', 'latest');
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
    composition: payload?.composition && typeof payload.composition === 'object' ? payload.composition : null,
  };
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

function readNewsLifecycleChain(client, storyId) {
  return client.mesh
    ?.get('news')
    ?.get('stories')
    ?.get(storyId)
    ?.get('synthesis_lifecycle')
    ?.get('latest');
}

async function readNewsLifecycleStatus(client, storyId, timeoutMs) {
  const raw = await readGunOnce(readNewsLifecycleChain(client, storyId), timeoutMs);
  const record = stripGunMetadata(raw);
  if (!record || typeof record !== 'object') return null;
  if (record.schemaVersion !== 'vh-news-synthesis-lifecycle-v1') return null;
  if (String(record.story_id ?? '').trim() !== storyId) return null;
  return record;
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

function sourceCount(story) {
  const primary = Array.isArray(story?.primary_sources) ? story.primary_sources.length : 0;
  const canonical = Number(story?.canonical_source_count ?? story?.source_count ?? 0);
  const sources = Array.isArray(story?.sources) ? story.sources.length : 0;
  return Math.max(primary, Number.isFinite(canonical) ? canonical : 0, sources);
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

function classifyLifecycleAccountabilityStatus(failures) {
  if (failures.length === 0) return 'pass';
  const codes = failures.map((failure) => String(failure?.code ?? ''));
  const hasHardLifecycleFailure = codes.some((code) =>
    code === 'eligible_raw_story_hidden_without_allowed_reason'
      || code === 'multi_source_raw_story_hidden_by_synthesis_state'
      || code === 'relay_accepted_synthesis_not_current'
      || code === 'product_feed_hot_index_missing_for_visible_story'
      || code === 'hot_index_product_metadata_missing'
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
  const sampleLimit = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_SAMPLE_LIMIT, 120);
  const timeoutMs = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_TIMEOUT_MS, 15_000);
  const staleWindowMs = parsePositiveInt(env.VH_PUBLIC_FEED_LIFECYCLE_STALE_WINDOW_MS, 7 * 24 * 60 * 60 * 1000);
  const artifactDir = resolveArtifactDir(env, repoRoot);
  const summaryPath = path.join(artifactDir, 'public-feed-lifecycle-accountability-summary.json');
  await mkdir(artifactDir, { recursive: true });

  let summary = {
    schemaVersion: 'public-feed-lifecycle-accountability-v1',
    generatedAt: new Date().toISOString(),
    status: 'fail',
    artifactDir,
    artifactPaths: { summaryPath },
    config: {
      baseUrl,
      gunPeerUrl,
      sampleLimit,
      timeoutMs,
      staleWindowMs,
    },
    counts: {},
    composition: null,
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
    peers: [gunPeerUrl],
    requireSession: false,
    gunLocalStorage: false,
    gunRadisk: false,
    systemWriterPin,
  });
  client.markSessionReady();

  try {
    const [latestIndex, hotIndex, rawStoryIds, relayLatest] = await Promise.all([
      readNewsLatestIndex(client).catch(() => ({})),
      readNewsHotIndex(client).catch(() => ({})),
      readRawStoryIds(client, sampleLimit, Math.min(timeoutMs, 5_000)).catch(() => []),
      readRelayLatest(baseUrl, sampleLimit, timeoutMs),
    ]);
    const latestIds = Object.keys(latestIndex);
    const hotIds = Object.keys(hotIndex);
    const relayIds = Object.keys(relayLatest.records);
    const sampledIds = [...new Set([
      ...relayIds,
      ...latestIds,
      ...hotIds,
      ...rawStoryIds,
    ])].slice(0, sampleLimit);
    const staleCutoffMs = Date.now() - staleWindowMs;
    const stories = [];
    for (const storyId of sampledIds) {
      const story = await readNewsStory(client, storyId).catch(() => null);
      const lifecycle = story ? await readNewsLifecycleStatus(client, storyId, Math.min(timeoutMs, 5_000)).catch(() => null) : null;
      const synthesis = story?.topic_id
        ? await readTopicLatestSynthesis(client, story.topic_id).catch(() => null)
        : null;
      const inLatest = Object.prototype.hasOwnProperty.call(latestIndex, storyId);
      const inHot = Object.prototype.hasOwnProperty.call(hotIndex, storyId);
      const inRelay = Object.prototype.hasOwnProperty.call(relayLatest.records, storyId);
      const productVisible = inLatest || inHot || inRelay;
      const hotProductRecord = inHot
        ? await readNewsHotIndexProductRecord(client, storyId, Math.min(timeoutMs, 5_000)).catch(() => null)
        : null;
      const hotIndexProductMetadataStatus = inHot
        ? classifyProductIndexMetadata(hotProductRecord, story)
        : 'not_in_hot_index';
      const classification = classifyStory({ story, storyId, lifecycle, productVisible, staleCutoffMs });
      const acceptedSynthesisCurrent = isAcceptedSynthesisCurrentForStory({ story, lifecycle, synthesis });
      const frameTableReady = acceptedSynthesisCurrent && isAcceptedFrameReady(synthesis);
      stories.push({
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
        hot_index_hotness: Number.isFinite(hotIndex[storyId]) ? hotIndex[storyId] : null,
        hot_index_product_metadata_status: hotIndexProductMetadataStatus,
        hot_index_product_source_set_revision: hotProductRecord?.source_set_revision ?? null,
        hot_index_product_source_count: finiteNonNegativeIndexInt(hotProductRecord?.source_count),
        lifecycle_status: lifecycle?.status ?? null,
        lifecycle_source_set_revision: lifecycle?.source_set_revision ?? null,
        lifecycle_reason: lifecycle?.reason ?? null,
        frame_table_state: lifecycle?.frame_table_state ?? null,
        accepted_synthesis_available: acceptedSynthesisCurrent,
        topic_latest_synthesis_present: Boolean(synthesis?.facts_summary?.trim()),
        topic_latest_synthesis_id: synthesis?.synthesis_id ?? null,
        topic_latest_synthesis_epoch: Number.isFinite(Number(synthesis?.epoch)) ? Math.floor(Number(synthesis.epoch)) : null,
        frame_table_ready: frameTableReady,
        relay_state: relayLatest.storyStates?.[storyId] ?? null,
        classification,
      });
    }

    const counts = stories.reduce((acc, story) => {
      acc.total_sampled += 1;
      acc[story.classification] = (acc[story.classification] ?? 0) + 1;
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
      return acc;
    }, {
      total_sampled: 0,
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
    const visibleMissingHotIndex = stories.filter((story) =>
      story.product_visible && story.source_count > 0 && !story.in_hot_index,
    );
    if (visibleMissingHotIndex.length > 0) {
      failures.push({
        code: 'product_feed_hot_index_missing_for_visible_story',
        story_ids: visibleMissingHotIndex.map((story) => story.story_id),
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

    summary = {
      ...summary,
      generatedAt: new Date().toISOString(),
      status: classifyLifecycleAccountabilityStatus(failures),
      counts,
      composition: relayLatest.composition,
      mesh: {
        latestIndexCount: latestIds.length,
        hotIndexCount: hotIds.length,
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
  readRelayLatest,
  sourceCount,
  classifyProductIndexMetadata,
  isAcceptedFrameReady,
  isAcceptedSynthesisCurrentForStory,
  classifyLifecycleAccountabilityStatus,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error('[vh:public-feed-lifecycle-accountability] failed', error);
    process.exit(1);
  });
}
