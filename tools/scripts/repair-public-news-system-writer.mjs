#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..', '..');
const workspaceResolutionRoots = [
  process.cwd(),
  repoRoot,
  path.join(repoRoot, 'services', 'news-aggregator'),
];

let buildNewsSynthesisLifecycleRecord;
let buildSignedSystemWriterRecord;
let computeStoryHotness;
let writeNewsHotIndexEntry;
let writeNewsLatestIndexEntry;
let writeNewsStory;
let writeNewsSynthesisLifecycleStatus;
let createNodeMeshClient;

function workspacePackageEntrypoints(root, specifier) {
  const gunClientRoot = path.join(root, 'node_modules', '@vh', 'gun-client');
  if (specifier === '@vh/gun-client') {
    return [path.join(gunClientRoot, 'dist', 'index.js')];
  }
  if (specifier === '@vh/gun-client/node') {
    return [path.join(gunClientRoot, 'dist', 'nodeMeshClient.js')];
  }
  return [];
}

const DEFAULT_APP_URL = 'https://venn.carboncaste.io';
const DEFAULT_LIMIT = 120;
const DEFAULT_REPAIR_MODE = 'gun';
const DEFAULT_HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_ARTIFACT_DIR = path.join(
  process.cwd(),
  '.tmp',
  'release-evidence',
  'public-news-system-writer-repair',
  String(Date.now()),
);

async function importWorkspacePackage(specifier) {
  for (const root of workspaceResolutionRoots) {
    try {
      const resolved = require.resolve(specifier, { paths: [root] });
      return import(pathToFileURL(resolved).href);
    } catch {
      // Try the next workspace/package root.
    }
    for (const candidate of workspacePackageEntrypoints(root, specifier)) {
      try {
        return await import(pathToFileURL(candidate).href);
      } catch {
        // Try the next explicit ESM entrypoint.
      }
    }
  }
  return import(specifier);
}

async function loadWorkspaceModules() {
  if (computeStoryHotness && createNodeMeshClient) {
    return;
  }
  const gunClient = await importWorkspacePackage('@vh/gun-client');
  const nodeMeshClient = await importWorkspacePackage('@vh/gun-client/node');
  ({
    buildNewsSynthesisLifecycleRecord,
    buildSignedSystemWriterRecord,
    computeStoryHotness,
    writeNewsHotIndexEntry,
    writeNewsLatestIndexEntry,
    writeNewsStory,
    writeNewsSynthesisLifecycleStatus,
  } = gunClient);
  ({ createNodeMeshClient } = nodeMeshClient);
}

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
  const value = requireEnv(name);
  return JSON.parse(value);
}

function parseOptionalJsonEnv(name, fallback) {
  const value = optionalEnv(name);
  if (!value) return fallback;
  return JSON.parse(value);
}

function parseRelayOrigins(value) {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Fall back to comma-delimited.
  }
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseRepairMode(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return DEFAULT_REPAIR_MODE;
  if (normalized === 'gun' || normalized === 'relay-rest') return normalized;
  throw new Error(`unsupported repair mode: ${value}`);
}

function parseBooleanEnv(name, fallback = false) {
  const value = optionalEnv(name);
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean value`);
}

function deriveGunPeer(origin) {
  const url = new URL(origin);
  url.pathname = '/gun';
  url.search = '';
  url.hash = '';
  return url.href;
}

function bytesToBufferSource(bytes) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

function bytesToBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url');
}

async function createSignHook(privateKeyPkcs8Base64Url) {
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    bytesToBufferSource(base64UrlToBytes(privateKeyPkcs8Base64Url)),
    'Ed25519',
    false,
    ['sign'],
  );
  return async ({ canonicalBytes }) => bytesToBase64Url(new Uint8Array(
    await crypto.subtle.sign('Ed25519', privateKey, bytesToBufferSource(canonicalBytes)),
  ));
}

function encodedStoryRecord(story) {
  return {
    __story_bundle_json: JSON.stringify(story),
    story_id: story.story_id,
    created_at: story.created_at,
    schemaVersion: story.schemaVersion,
  };
}

function latestRecord(story) {
  return {
    story_id: story.story_id,
    latest_activity_at: Math.max(0, Math.floor(story.cluster_window_end)),
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: (story.primary_sources ?? story.sources).length,
    story_created_at: Math.max(0, Math.floor(story.created_at)),
    cluster_window_start: Math.max(0, Math.floor(story.cluster_window_start)),
  };
}

function hotRecord(story) {
  return {
    story_id: story.story_id,
    hotness: computeStoryHotness(story),
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: story.topic_id,
    source_set_revision: story.provenance_hash,
    source_count: story.sources.length,
    canonical_source_count: (story.primary_sources ?? story.sources).length,
    story_created_at: Math.max(0, Math.floor(story.created_at)),
    cluster_window_start: Math.max(0, Math.floor(story.cluster_window_start)),
  };
}

async function signRecord({ pathName, payload, sign, pin, writerId }) {
  return buildSignedSystemWriterRecord({
    path: pathName,
    payload,
    sign,
    pin,
    writerId,
    now: Date.now,
    defaultWriterId: writerId,
    missingSignerError: 'system writer signer is required for public news repair',
  });
}

async function fetchJson(url, label, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson(url, token, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      throw new Error(`HTTP ${response.status}: ${payload?.error ?? 'write failed'}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function repairStep(step, work) {
  try {
    return await work();
  } catch (error) {
    if (error && typeof error === 'object') {
      error.repair_step = error.repair_step ?? step;
    }
    throw error;
  }
}

function createRepairClient({ peers, pin, writerId, sign }) {
  if (peers.length === 0) {
    throw new Error('at least one Gun peer is required for gun repair mode');
  }
  const client = createNodeMeshClient({
    peers,
    systemWriterId: writerId,
    systemWriterPin: pin,
    systemWriterSign: sign,
    systemWriterNow: Date.now,
    relayRestOrigins: [],
  });
  client.markSessionReady();
  return client;
}

async function readLatestStories(appUrl, limit, offset, timeoutMs) {
  const latestUrl = new URL('/vh/news/latest-index', appUrl);
  latestUrl.searchParams.set('limit', String(limit + offset));
  latestUrl.searchParams.set('t', String(Date.now()));
  const latest = await fetchJson(latestUrl.href, 'latest-index', timeoutMs);
  const records = latest.records && typeof latest.records === 'object' ? latest.records : {};
  const embeddedStories = latest.stories && typeof latest.stories === 'object' ? latest.stories : {};
  const storyIds = Object.keys(records).slice(offset, offset + limit);
  const stories = {};
  for (const storyId of storyIds) {
    if (embeddedStories[storyId]) {
      stories[storyId] = embeddedStories[storyId];
      continue;
    }
    const storyUrl = new URL('/vh/news/story', appUrl);
    storyUrl.searchParams.set('story_id', storyId);
    storyUrl.searchParams.set('t', String(Date.now()));
    const storyPayload = await fetchJson(storyUrl.href, `story:${storyId}`, timeoutMs);
    if (storyPayload?.story?.story_id === storyId) {
      stories[storyId] = storyPayload.story;
    }
  }
  return { latest, storyIds, stories };
}

async function repairStoryViaGun({ client, story }) {
  await repairStep('gun_story_body', () => writeNewsStory(client, story));
  await repairStep('gun_latest_index', () => (
    writeNewsLatestIndexEntry(client, story.story_id, story.cluster_window_end, story)
  ));
  await repairStep('gun_hot_index', () => (
    writeNewsHotIndexEntry(client, story.story_id, computeStoryHotness(story), story)
  ));
  await repairStep('gun_synthesis_lifecycle', () => (
    writeNewsSynthesisLifecycleStatus(client, buildNewsSynthesisLifecycleRecord({
      story,
      status: 'pending',
      frameTableState: 'frame_table_pending',
      reason: 'storycluster_public_feed_repair',
      updatedAt: Date.now(),
    }))
  ));
}

async function repairStoryViaGunPeers({ peerClients, story }) {
  const failures = [];
  for (const { peer, client } of peerClients) {
    try {
      await repairStoryViaGun({ client, story });
    } catch (error) {
      failures.push({
        peer,
        repair_step: error && typeof error === 'object' ? error.repair_step ?? null : null,
        error_name: error && typeof error === 'object' ? error.name ?? null : null,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (failures.length > 0) {
    const error = new Error(`direct Gun repair failed on ${failures.length}/${peerClients.length} peer(s)`);
    error.repair_step = 'gun_peer_readback';
    error.peer_failures = failures;
    throw error;
  }
}

async function repairStoryViaRelayRest({ relayOrigins, relayToken, story, sign, pin, writerId, timeoutMs }) {
  const records = {
    story: await signRecord({
      pathName: `vh/news/stories/${story.story_id}`,
      payload: encodedStoryRecord(story),
      sign,
      pin,
      writerId,
    }),
    latest: await signRecord({
      pathName: `vh/news/index/latest/${story.story_id}`,
      payload: latestRecord(story),
      sign,
      pin,
      writerId,
    }),
    hot: await signRecord({
      pathName: `vh/news/index/hot/${story.story_id}`,
      payload: hotRecord(story),
      sign,
      pin,
      writerId,
    }),
    lifecycle: await signRecord({
      pathName: `vh/news/stories/${story.story_id}/synthesis_lifecycle/latest`,
      payload: buildNewsSynthesisLifecycleRecord({
        story,
        status: 'pending',
        frameTableState: 'frame_table_pending',
        reason: 'storycluster_public_feed_repair',
        updatedAt: Date.now(),
      }),
      sign,
      pin,
      writerId,
    }),
  };

  for (const origin of relayOrigins) {
    await repairStep('relay_story_body', () => (
      postJson(new URL('/vh/news/story', origin).href, relayToken, { record: records.story }, timeoutMs)
    ));
    await repairStep('relay_latest_index', () => (
      postJson(new URL('/vh/news/latest-index', origin).href, relayToken, { record: records.latest }, timeoutMs)
    ));
    await repairStep('relay_hot_index', () => (
      postJson(new URL('/vh/news/hot-index', origin).href, relayToken, { record: records.hot }, timeoutMs)
    ));
    await repairStep('relay_synthesis_lifecycle', () => (
      postJson(new URL('/vh/news/synthesis-lifecycle', origin).href, relayToken, { record: records.lifecycle }, timeoutMs)
    ));
  }
}

async function main() {
  await loadWorkspaceModules();
  const appUrl = optionalEnv('VH_PUBLIC_FEED_APP_URL', DEFAULT_APP_URL);
  const limit = parsePositiveInt(optionalEnv('VH_PUBLIC_NEWS_REPAIR_LIMIT'), DEFAULT_LIMIT);
  const offset = parseNonNegativeInt(optionalEnv('VH_PUBLIC_NEWS_REPAIR_OFFSET'), 0);
  const httpTimeoutMs = parsePositiveInt(
    optionalEnv('VH_PUBLIC_NEWS_REPAIR_HTTP_TIMEOUT_MS'),
    DEFAULT_HTTP_TIMEOUT_MS,
  );
  const repairMode = parseRepairMode(optionalEnv('VH_PUBLIC_NEWS_REPAIR_MODE', DEFAULT_REPAIR_MODE));
  const relayOrigins = parseRelayOrigins(optionalEnv('VH_PUBLIC_NEWS_REPAIR_RELAY_ORIGINS'));
  const relayToken = repairMode === 'relay-rest' ? requireEnv('VH_RELAY_DAEMON_TOKEN') : '';
  const writerId = requireEnv('VH_NEWS_SYSTEM_WRITER_ID');
  const pin = parseJsonEnv('VH_NEWS_SYSTEM_WRITER_PIN_JSON');
  const privateKey = requireEnv('VH_NEWS_SYSTEM_WRITER_PRIVATE_KEY_PKCS8_BASE64URL');
  const artifactDir = optionalEnv('VH_PUBLIC_NEWS_REPAIR_ARTIFACT_DIR', DEFAULT_ARTIFACT_DIR);
  const sign = await createSignHook(privateKey);
  const gunPeers = repairMode === 'gun'
    ? parseOptionalJsonEnv(
      'VH_PUBLIC_NEWS_REPAIR_GUN_PEERS',
      relayOrigins.map(deriveGunPeer),
    ).map(String).map((item) => item.trim()).filter(Boolean)
    : [];
  const requireEachGunPeer = repairMode === 'gun'
    && parseBooleanEnv('VH_PUBLIC_NEWS_REPAIR_REQUIRE_EACH_GUN_PEER', false);
  if (requireEachGunPeer && gunPeers.length === 0) {
    throw new Error('at least one Gun peer is required for per-peer gun repair mode');
  }
  const client = repairMode === 'gun' && !requireEachGunPeer
    ? createRepairClient({ peers: gunPeers, pin, writerId, sign })
    : null;
  const peerClients = requireEachGunPeer
    ? gunPeers.map((peer) => ({
      peer,
      client: createRepairClient({ peers: [peer], pin, writerId, sign }),
    }))
    : [];
  const { storyIds, stories } = await readLatestStories(appUrl, limit, offset, httpTimeoutMs);

  const repaired = [];
  const failures = [];
  try {
    for (const storyId of storyIds) {
      const story = stories[storyId];
      if (!story?.story_id || !story?.topic_id || !Array.isArray(story.sources)) {
        failures.push({ story_id: storyId, reason: 'story-body-unavailable-or-invalid' });
        continue;
      }
      try {
        if (repairMode === 'gun') {
          if (requireEachGunPeer) {
            await repairStoryViaGunPeers({ peerClients, story });
          } else {
            await repairStoryViaGun({ client, story });
          }
        } else {
          await repairStoryViaRelayRest({
            relayOrigins,
            relayToken,
            story,
            sign,
            pin,
            writerId,
            timeoutMs: httpTimeoutMs,
          });
        }
        repaired.push({
          story_id: storyId,
          topic_id: story.topic_id,
          source_count: story.sources.length,
          source_set_revision: story.provenance_hash,
          ...(requireEachGunPeer ? { repaired_peer_count: peerClients.length } : {}),
        });
      } catch (error) {
        failures.push({
          story_id: storyId,
          repair_step: error && typeof error === 'object' ? error.repair_step ?? null : null,
          error_name: error && typeof error === 'object' ? error.name ?? null : null,
          reason: error instanceof Error ? error.message : String(error),
          ...(error && typeof error === 'object' && Array.isArray(error.peer_failures)
            ? { peer_failures: error.peer_failures }
            : {}),
        });
      }
    }
  } finally {
    await Promise.all([
      ...(client ? [client] : []),
      ...peerClients.map(({ client: peerClient }) => peerClient),
    ].map((repairClient) => repairClient.shutdown?.().catch(() => undefined)));
  }

  await mkdir(artifactDir, { recursive: true });
  const summary = {
    status: failures.length === 0 ? 'pass' : 'fail',
    repair_mode: repairMode,
    app_url: appUrl,
    relay_origin_count: relayOrigins.length,
    gun_peer_count: gunPeers.length,
    require_each_gun_peer: requireEachGunPeer,
    writer_id: writerId,
    offset,
    limit,
    http_timeout_ms: httpTimeoutMs,
    sampled: storyIds.length,
    repaired_count: repaired.length,
    failure_count: failures.length,
    repaired,
    failures,
    artifact_dir: artifactDir,
  };
  const summaryPath = path.join(artifactDir, 'public-news-system-writer-repair-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ...summary, summary_path: summaryPath }, null, 2));
  if (summary.status !== 'pass') {
    process.exitCode = 1;
  }
}

main()
  .then(() => {
    process.exit(process.exitCode ?? 0);
  })
  .catch((error) => {
    console.error('[vh:public-news-system-writer-repair] failed', error);
    process.exit(1);
  });
