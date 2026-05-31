#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
let Gun;
try {
  Gun = require('gun');
} catch {
  try {
    Gun = require(path.join(process.cwd(), 'node_modules', 'gun'));
  } catch {
    Gun = require(path.join(process.cwd(), 'packages', 'gun-client', 'node_modules', 'gun'));
  }
}

const STORY_BUNDLE_JSON_KEY = '__story_bundle_json';
const SYSTEM_WRITER_PROTOCOL_VERSION = 'luma-public-v1';
const SYSTEM_WRITER_KIND = 'system';
const SYSTEM_WRITER_SIGNATURE_SUITE = 'jcs-ed25519-sha256-v1';
const HOTNESS_ROUNDING_SCALE = 1_000_000;
const MS_PER_HOUR = 3_600_000;
const DEFAULT_HOTNESS_CONFIG = {
  decayHalfLifeHours: 8,
  breakingWindowHours: 3,
  breakingVelocityBoost: 0.75,
  weights: {
    coverage: 0.32,
    velocity: 0.38,
    confidence: 0.12,
    sourceDiversity: 0.08,
    freshness: 0.1,
  },
};

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnv(name, fallback = '') {
  return process.env[name]?.trim() || fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function parseJsonEnv(name) {
  return JSON.parse(requireEnv(name));
}

function base64UrlToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

function bytesToBufferSource(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  const entries = Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`).join(',')}}`;
}

function canonicalizeSystemWriterRecord(record) {
  if (!isRecord(record)) throw new Error('system writer record must be an object');
  const { _systemSignature: _signature, ...unsigned } = record;
  delete unsigned._system;
  delete unsigned._Signature;
  delete unsigned._WriterId;
  delete unsigned._IssuedAt;
  return canonicalize(unsigned);
}

async function createSignHook(privateKeyPkcs8Base64Url) {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    bytesToBufferSource(base64UrlToBytes(privateKeyPkcs8Base64Url)),
    'Ed25519',
    false,
    ['sign'],
  );
  return async (record) => {
    const canonicalBytes = new TextEncoder().encode(canonicalizeSystemWriterRecord(record));
    return bytesToBase64Url(new Uint8Array(
      await crypto.subtle.sign('Ed25519', privateKey, bytesToBufferSource(canonicalBytes)),
    ));
  };
}

function activeWriter(pin, writerId) {
  if (
    !isRecord(pin)
    || pin.schemaEpoch !== SYSTEM_WRITER_PROTOCOL_VERSION
    || pin.maxProtocolVersion !== SYSTEM_WRITER_PROTOCOL_VERSION
    || pin.signatureSuite !== SYSTEM_WRITER_SIGNATURE_SUITE
    || !Array.isArray(pin.writers)
  ) {
    throw new Error('valid system writer pin is required');
  }
  const writer = pin.writers.find((candidate) => candidate?.id === writerId && candidate.status === 'active');
  if (!writer) throw new Error(`active writer not found in pin: ${writerId}`);
  return writer;
}

async function signRecord({ payload, sign, writerId, now }) {
  const unsigned = {
    ...payload,
    _system: null,
    _Signature: null,
    _WriterId: null,
    _IssuedAt: null,
    _protocolVersion: SYSTEM_WRITER_PROTOCOL_VERSION,
    _writerKind: SYSTEM_WRITER_KIND,
    _systemWriterId: writerId,
    _systemIssuedAt: now(),
  };
  return {
    ...unsigned,
    _systemSignature: await sign(unsigned),
  };
}

function gunPath(gun, segments) {
  return segments.reduce((chain, segment) => chain.get(segment), gun);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function putOffline(chain, value) {
  chain.put(value);
  await sleep(25);
}

async function writeOfflineStory(gun, storyId, record) {
  await putOffline(
    gunPath(gun, ['vh', 'news', 'stories', storyId]),
    record,
  );
}

async function writeOfflineLatest(gun, storyId, record) {
  await putOffline(
    gunPath(gun, ['vh', 'news', 'index', 'latest', storyId]),
    record,
  );
}

async function writeOfflineHot(gun, storyId, record) {
  await putOffline(
    gunPath(gun, ['vh', 'news', 'index', 'hot', storyId]),
    record,
  );
}

async function writeOfflineLifecycle(gun, storyId, record) {
  await putOffline(
    gunPath(gun, ['vh', 'news', 'stories', storyId, 'synthesis_lifecycle', 'latest']),
    record,
  );
}

function canonicalSourceCount(story) {
  return Array.isArray(story.primary_sources) ? story.primary_sources.length : story.sources.length;
}

function latestRecord(story) {
  return {
    story_id: story.story_id,
    latest_activity_at: Math.max(0, Math.floor(story.cluster_window_end)),
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: canonicalSourceCount(story),
    story_created_at: Math.max(0, Math.floor(story.created_at)),
    cluster_window_start: Math.max(0, Math.floor(story.cluster_window_start)),
  };
}

function normalizeUnitInterval(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function sourceDiversityScore(sourceCount) {
  if (!Number.isFinite(sourceCount) || sourceCount <= 0) return 0;
  return Math.min(1, Math.max(0, Math.log1p(sourceCount) / Math.log(8)));
}

function computeStoryHotness(story, nowMs = Date.now(), config = DEFAULT_HOTNESS_CONFIG) {
  const latestActivityAt = Math.max(0, Math.floor(story.cluster_window_end));
  const normalizedNow = Number.isFinite(nowMs) && nowMs >= 0 ? Math.floor(nowMs) : latestActivityAt;
  const ageHours = Math.max(0, normalizedNow - latestActivityAt) / MS_PER_HOUR;
  const freshness = Math.pow(2, -ageHours / Math.max(0.25, config.decayHalfLifeHours));
  const features = isRecord(story.cluster_features) ? story.cluster_features : {};
  const coverage = normalizeUnitInterval(features.coverage_score, 0.35);
  const velocity = normalizeUnitInterval(features.velocity_score, 0.2);
  const confidence = normalizeUnitInterval(features.confidence_score, 0.5);
  const weightedBase = config.weights.coverage * coverage
    + config.weights.velocity * velocity
    + config.weights.confidence * confidence
    + config.weights.sourceDiversity * sourceDiversityScore(story.sources.length)
    + config.weights.freshness * freshness;
  const breakingMultiplier = ageHours <= Math.max(0, config.breakingWindowHours)
    ? 1 + Math.max(0, config.breakingVelocityBoost) * velocity
    : 1;
  return Math.round(Math.max(0, weightedBase * breakingMultiplier) * HOTNESS_ROUNDING_SCALE)
    / HOTNESS_ROUNDING_SCALE;
}

function hotRecord(story) {
  return {
    ...latestRecord(story),
    hotness: computeStoryHotness(story),
  };
}

function storyRecord(story) {
  return {
    [STORY_BUNDLE_JSON_KEY]: JSON.stringify(story),
    story_id: story.story_id,
    created_at: story.created_at,
    schemaVersion: story.schemaVersion,
  };
}

function lifecycleRecord(story, updatedAt) {
  return {
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    story_id: story.story_id,
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: canonicalSourceCount(story),
    status: 'pending',
    retryable: false,
    reason: 'storycluster_public_feed_repair',
    frame_table_state: 'frame_table_pending',
    updated_at: updatedAt,
  };
}

function storyFromEntry(entry) {
  const story = entry?.story;
  if (
    !isRecord(story)
    || typeof story.story_id !== 'string'
    || typeof story.topic_id !== 'string'
    || !Array.isArray(story.sources)
    || typeof story.provenance_hash !== 'string'
  ) {
    return null;
  }
  return story;
}

async function main() {
  const gunFile = requireEnv('VH_PUBLIC_NEWS_OFFLINE_GUN_FILE');
  const snapshotPath = optionalEnv(
    'VH_PUBLIC_NEWS_OFFLINE_SNAPSHOT_FILE',
    path.join(gunFile, 'news-latest-index-snapshot.json'),
  );
  const artifactDir = optionalEnv(
    'VH_PUBLIC_NEWS_OFFLINE_ARTIFACT_DIR',
    path.join(process.cwd(), '.tmp', 'public-news-system-writer-offline-repair', String(Date.now())),
  );
  const limit = parsePositiveInt(optionalEnv('VH_PUBLIC_NEWS_OFFLINE_LIMIT'), 120);
  const offset = parseNonNegativeInt(optionalEnv('VH_PUBLIC_NEWS_OFFLINE_OFFSET'), 0);
  const writerId = requireEnv('VH_NEWS_SYSTEM_WRITER_ID');
  const pin = parseJsonEnv('VH_NEWS_SYSTEM_WRITER_PIN_JSON');
  activeWriter(pin, writerId);
  const sign = await createSignHook(requireEnv('VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL'));
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries : [];
  const gun = Gun({
    peers: [],
    localStorage: false,
    radisk: true,
    file: gunFile,
    axe: false,
    multicast: false,
  });

  const repaired = [];
  const failures = [];
  let counter = 0;
  const now = () => Date.now() + counter++;
  const snapshotUpdatedAt = Date.now();
  const selectedEntries = entries.slice(offset, offset + limit);
  for (const entry of selectedEntries) {
    const story = storyFromEntry(entry);
    if (!story) {
      failures.push({ story_id: entry?.story_id ?? null, reason: 'snapshot-story-invalid' });
      continue;
    }
    try {
      const updatedAt = now();
      const records = {
        story: await signRecord({ payload: storyRecord(story), sign, writerId, now }),
        latest: await signRecord({ payload: latestRecord(story), sign, writerId, now }),
        hot: await signRecord({ payload: hotRecord(story), sign, writerId, now }),
        lifecycle: await signRecord({ payload: lifecycleRecord(story, updatedAt), sign, writerId, now }),
      };
      await writeOfflineStory(gun, story.story_id, records.story);
      await writeOfflineLatest(gun, story.story_id, records.latest);
      await writeOfflineHot(gun, story.story_id, records.hot);
      await writeOfflineLifecycle(gun, story.story_id, records.lifecycle);
      entry.record = records.latest;
      entry.story_state = {
        synthesis_state: 'synthesis_pending',
        frame_table_state: 'frame_table_pending',
        synthesis_id: null,
        epoch: null,
        lifecycle_status: 'pending',
        terminal_unavailable_reason: null,
        retryable: false,
      };
      repaired.push({
        story_id: story.story_id,
        topic_id: story.topic_id,
        source_count: story.sources.length,
        source_set_revision: story.provenance_hash,
      });
    } catch (error) {
      failures.push({
        story_id: story.story_id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 3_000));
  gun.off?.();
  snapshot.cached_at = snapshotUpdatedAt;
  await writeFile(snapshotPath, `${JSON.stringify(snapshot)}\n`);

  await mkdir(artifactDir, { recursive: true });
  const summary = {
    status: failures.length === 0 ? 'pass' : 'fail',
    gun_file: gunFile,
    snapshot_path: snapshotPath,
    writer_id: writerId,
    offset,
    limit,
    sampled: selectedEntries.length,
    repaired_count: repaired.length,
    failure_count: failures.length,
    repaired,
    failures,
    artifact_dir: artifactDir,
  };
  const summaryPath = path.join(artifactDir, 'public-news-system-writer-offline-repair-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, summary_path: summaryPath }, null, 2));
  process.exit(summary.status === 'pass' ? 0 : 1);
}

main().catch((error) => {
  console.error('[vh:public-news-system-writer-offline-repair] failed', error);
  process.exit(1);
});
