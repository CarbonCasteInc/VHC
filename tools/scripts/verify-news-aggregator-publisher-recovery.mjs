#!/usr/bin/env node

import { chmod, link, lstat, mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyStartControlArtifact } from './news-aggregator-publisher-recovery-guard.mjs';

const MAX_JSON_BYTES = 1_048_576;
const TERMINAL_LIFECYCLE_STATUSES = new Set(['accepted_available', 'terminal_unavailable', 'suppressed']);
const INCOMPLETE_LIFECYCLE_STATUSES = new Set(['pending', 'retryable_failure']);
const ALL_LIFECYCLE_STATUSES = new Set([
  ...TERMINAL_LIFECYCLE_STATUSES,
  ...INCOMPLETE_LIFECYCLE_STATUSES,
  'in_progress',
]);

export class PublisherRecoveryVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PublisherRecoveryVerificationError';
    this.code = code;
  }
}

class CandidateMissingError extends Error {}

function fail(code) {
  throw new PublisherRecoveryVerificationError(code);
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function exactKeys(value, keys) {
  return isObject(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function fullRevision(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function positiveInteger(value, fallback, code) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) fail(code);
  return parsed;
}

function nonNegativeInteger(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}

function timestamp(value, code) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

async function readRegularJson(filePath, label, { privateMode = false } = {}) {
  if (!path.isAbsolute(filePath)) fail(`${label}_path_not_absolute`);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(`${label}_missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label}_not_regular_file`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) fail(`${label}_wrong_owner`);
  if (privateMode && (stat.mode & 0o777) !== 0o600) fail(`${label}_mode_not_0600`);
  if (stat.size <= 0 || stat.size > MAX_JSON_BYTES) fail(`${label}_size_invalid`);
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (!isObject(parsed)) fail(`${label}_shape_invalid`);
    return parsed;
  } catch (error) {
    if (error instanceof PublisherRecoveryVerificationError) throw error;
    fail(`${label}_json_invalid`);
  }
}

async function writePrivateJsonAtomic(filePath, payload) {
  if (!path.isAbsolute(filePath)) fail('output_path_not_absolute');
  const parent = path.dirname(filePath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const tempPath = path.join(parent, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  let handle;
  try {
    handle = await open(tempPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmod(tempPath, 0o600);
    await link(tempPath, filePath);
    // The final link shares the already-fsynced mode-0600 inode. Once link()
    // succeeds the artifact is committed; hidden temp cleanup cannot turn that
    // valid commit into an ambiguous reported failure.
    await rm(tempPath, { force: true }).catch(() => undefined);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function requireOutputAbsent(filePath) {
  if (!path.isAbsolute(filePath)) fail('output_path_not_absolute');
  try {
    await lstat(filePath);
    fail('output_already_exists');
  } catch (error) {
    if (error instanceof PublisherRecoveryVerificationError) throw error;
    if (error?.code !== 'ENOENT') fail('output_preflight_failed');
  }
}

function normalizeOrigins(values, reviewedOrigins) {
  if (!Array.isArray(values) || values.length !== 3) fail('relay_origin_count_invalid');
  const normalized = values.map((value) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      fail('relay_origin_invalid');
    }
    const port = Number(parsed.port);
    if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1'
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || parsed.pathname !== '/' || !parsed.port
      || !Number.isSafeInteger(port) || port <= 0 || port > 65_535 || port === 80
      || value !== `http://127.0.0.1:${port}`) {
      fail('relay_origin_invalid');
    }
    return value;
  });
  if (new Set(normalized).size !== normalized.length) fail('relay_origin_duplicate');
  if (JSON.stringify(normalized) !== JSON.stringify(reviewedOrigins)) fail('relay_origin_review_binding_mismatch');
  return normalized;
}

function validateCurrentRun(currentRun, expectedRevision, startControl) {
  if (currentRun.schemaVersion !== 'vh-news-daemon-current-run-v1') fail('current_run_schema_invalid');
  if (currentRun.status !== 'preflight_passed') fail('current_run_status_invalid');
  if (currentRun.revision !== expectedRevision) fail('current_run_revision_mismatch');
  if (currentRun.noWrite !== false) fail('current_run_not_live');
  if (typeof currentRun.runId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(currentRun.runId)
    || currentRun.runId === '.' || currentRun.runId === '..') fail('current_run_id_invalid');
  if (typeof currentRun.artifactRoot !== 'string' || !path.isAbsolute(currentRun.artifactRoot)
    || path.resolve(currentRun.artifactRoot) !== currentRun.artifactRoot) {
    fail('current_run_artifact_root_invalid');
  }
  const generatedAtMs = timestamp(currentRun.generatedAt, 'current_run_generated_at_invalid');
  if (generatedAtMs < Date.parse(startControl.startedAt)) fail('current_run_predates_attended_start');
  return {
    runId: currentRun.runId,
    generatedAtMs,
    artifactRoot: currentRun.artifactRoot,
  };
}

function validateDiagnostics(diagnostics, currentRun, options) {
  if (diagnostics.schemaVersion !== 'vh-news-runtime-diagnostics-v1') fail('diagnostics_schema_invalid');
  if (diagnostics.runId !== currentRun.runId) fail('diagnostics_run_id_mismatch');
  if (diagnostics.noWrite !== false) fail('diagnostics_not_live');
  if (!Array.isArray(diagnostics.summaries) || diagnostics.summaries.length < 2) {
    fail('diagnostics_summaries_missing');
  }
  const sequences = diagnostics.summaries.map((summary) => summary?.tick_sequence);
  if (sequences.some((value) => !Number.isSafeInteger(value) || value <= 0)
    || new Set(sequences).size !== sequences.length
    || sequences.some((value, index) => index > 0 && value <= sequences[index - 1])) {
    fail('diagnostics_tick_order_invalid');
  }
  const tick = diagnostics.latest;
  const retainedLatest = diagnostics.summaries.filter((summary) => summary.tick_sequence === tick?.tick_sequence);
  if (!isObject(tick) || tick.tick_sequence !== sequences.at(-1)
    || retainedLatest.length !== 1
    || JSON.stringify(retainedLatest[0]) !== JSON.stringify(tick)) {
    fail('diagnostics_latest_invalid');
  }
  if (tick.status !== 'completed' || tick.skipped !== false || tick.no_write !== false
    || tick.raw_write_failed_count !== 0 || tick.nonfatal_prewrite_failure_count !== 0) {
    fail('diagnostics_latest_not_green');
  }
  const initialTicks = [];
  for (const requiredSequence of [1, 2]) {
    const matches = diagnostics.summaries.filter((summary) => summary.tick_sequence === requiredSequence);
    const initialTick = matches[0];
    if (matches.length !== 1) fail('diagnostics_initial_tick_cardinality_invalid');
    if (!isObject(initialTick)
      || initialTick.status !== 'completed' || initialTick.skipped !== false || initialTick.no_write !== false
      || !Number.isSafeInteger(initialTick.raw_write_attempted_count) || initialTick.raw_write_attempted_count <= 0
      || initialTick.raw_write_failed_count !== 0
      || initialTick.nonfatal_prewrite_failure_count !== 0) {
      fail('diagnostics_initial_ticks_not_green');
    }
    initialTicks.push(initialTick);
  }
  const candidate = [...initialTicks].reverse().find((initialTick) => {
    const ids = initialTick.first_raw_written_story_ids;
    return initialTick.raw_wrote_count === initialTick.raw_write_attempted_count
      && initialTick.raw_write_suppressed_count === 0
      && Array.isArray(ids) && ids.length > 0;
  });
  if (!candidate) fail('diagnostics_no_initial_write_candidate');
  const startedAtMs = timestamp(candidate.started_at, 'diagnostics_tick_started_at_invalid');
  const completedAtMs = timestamp(candidate.completed_at, 'diagnostics_tick_completed_at_invalid');
  if (startedAtMs < currentRun.generatedAtMs || completedAtMs < startedAtMs) {
    fail('diagnostics_tick_window_invalid');
  }
  const nowMs = options.nowMs ?? Date.now();
  const maxTickAgeMs = positiveInteger(options.maxTickAgeMs, 30 * 60 * 1000, 'max_tick_age_invalid');
  if (completedAtMs > nowMs + 60_000 || nowMs - completedAtMs > maxTickAgeMs) {
    fail('diagnostics_tick_not_fresh');
  }

  const attempted = nonNegativeInteger(candidate.raw_write_attempted_count, 'diagnostics_attempted_count_invalid');
  const wrote = nonNegativeInteger(candidate.raw_wrote_count, 'diagnostics_wrote_count_invalid');
  const failed = nonNegativeInteger(candidate.raw_write_failed_count, 'diagnostics_failed_count_invalid');
  const suppressed = nonNegativeInteger(candidate.raw_write_suppressed_count, 'diagnostics_suppressed_count_invalid');
  const selected = nonNegativeInteger(candidate.selected_bundle_count, 'diagnostics_selected_count_invalid');
  if (attempted <= 0 || wrote !== attempted || failed !== 0 || suppressed !== 0 || attempted > selected) {
    fail('diagnostics_raw_write_invariants_failed');
  }
  const writtenIds = candidate.first_raw_written_story_ids;
  if (!Array.isArray(writtenIds) || writtenIds.length === 0 || writtenIds.length > 10
    || writtenIds.some((value) => typeof value !== 'string' || !value.trim())
    || new Set(writtenIds).size !== writtenIds.length || writtenIds.length > wrote) {
    fail('diagnostics_written_story_ids_invalid');
  }
  if (!Array.isArray(candidate.first_selected_story_ids)
    || writtenIds.some((storyId) => !candidate.first_selected_story_ids.includes(storyId))) {
    fail('diagnostics_written_story_not_selected');
  }
  return {
    tick: candidate,
    startedAtMs,
    completedAtMs,
    writtenIds,
  };
}

function captureStoriesForTick(capture, runId, tickWindow) {
  if (capture.schemaVersion !== 'daemon-feed-cluster-capture-v1') fail('cluster_capture_schema_invalid');
  if (capture.runId !== runId || !Array.isArray(capture.ticks) || capture.ticks.length === 0) {
    fail('cluster_capture_run_invalid');
  }
  const sequences = capture.ticks.map((tick) => tick?.tickSequence);
  if (sequences.some((value) => !Number.isSafeInteger(value) || value <= 0)
    || new Set(sequences).size !== sequences.length
    || sequences.some((value, index) => index > 0 && value <= sequences[index - 1])) {
    fail('cluster_capture_order_invalid');
  }
  const matching = capture.ticks.filter((tick) => {
    const generatedAtMs = typeof tick?.generatedAt === 'string' ? Date.parse(tick.generatedAt) : Number.NaN;
    return Number.isFinite(generatedAtMs)
      && generatedAtMs >= tickWindow.startedAtMs
      && generatedAtMs <= tickWindow.completedAtMs;
  });
  if (matching.length !== 1 || !Array.isArray(matching[0].topicCaptures)) fail('cluster_capture_tick_invalid');
  const stories = new Map();
  for (const topicCapture of matching[0].topicCaptures) {
    const bundles = topicCapture?.result?.bundles;
    if (!Array.isArray(bundles)) fail('cluster_capture_bundles_invalid');
    for (const story of bundles) {
      if (!isObject(story) || typeof story.story_id !== 'string' || !story.story_id.trim()) {
        fail('cluster_capture_story_invalid');
      }
      if (stories.has(story.story_id)) fail('cluster_capture_story_duplicate');
      stories.set(story.story_id, story);
    }
  }
  return stories;
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let response;
  try {
    response = await options.fetchFn(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
  } catch {
    fail('relay_readback_network_failed');
  } finally {
    clearTimeout(timer);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES) fail('relay_readback_body_too_large');
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) fail('relay_readback_content_type_invalid');
  let text;
  try {
    text = await response.text();
  } catch {
    fail('relay_readback_body_failed');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_JSON_BYTES) fail('relay_readback_body_too_large');
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('relay_readback_json_invalid');
  }
  if (!isObject(payload)) fail('relay_readback_shape_invalid');
  return { status: response.status, payload };
}

function productRecordMatchesStory(record, story) {
  const canonicalSources = Array.isArray(story.primary_sources) ? story.primary_sources : story.sources;
  return isObject(record)
    && record.story_id === story.story_id
    && record.product_state_schema_version === 'vh-news-product-feed-index-v1'
    && record.topic_id === story.topic_id
    && record.source_set_revision === story.provenance_hash
    && record.source_count === story.sources.length
    && record.canonical_source_count === canonicalSources.length
    && record.story_created_at === Math.max(0, Math.floor(story.created_at))
    && record.cluster_window_start === Math.max(0, Math.floor(story.cluster_window_start));
}

function isSignedSystemRecord(record) {
  return isObject(record)
    && record._protocolVersion === 'luma-public-v1'
    && record._writerKind === 'system'
    && typeof record._systemWriterId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(record._systemWriterId)
    && Number.isSafeInteger(record._systemIssuedAt) && record._systemIssuedAt >= 0
    && typeof record._systemSignature === 'string'
    && record._systemSignature.length > 0 && record._systemSignature.length <= 16_384
    && !('_authorScheme' in record) && !('signedWriteEnvelope' in record);
}

function lifecycleMatchesStory(lifecycle, story, tickWindow, nowMs, options) {
  if (!isObject(lifecycle)
    || lifecycle.schemaVersion !== 'vh-news-synthesis-lifecycle-v1'
    || lifecycle.story_id !== story.story_id
    || lifecycle.topic_id !== story.topic_id
    || lifecycle.source_set_revision !== story.provenance_hash
    || lifecycle.source_count !== story.sources.length
    || lifecycle.canonical_source_count !== (Array.isArray(story.primary_sources) ? story.primary_sources : story.sources).length
    || !ALL_LIFECYCLE_STATUSES.has(lifecycle.status)) {
    return null;
  }
  const updatedAt = Number(lifecycle.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || updatedAt > nowMs + 60_000) return null;
  if (updatedAt >= tickWindow.startedAtMs && updatedAt <= tickWindow.completedAtMs) return 'updated_in_tick';
  if (INCOMPLETE_LIFECYCLE_STATUSES.has(lifecycle.status)) {
    const maxAge = positiveInteger(options.incompleteLifecycleMaxAgeMs, 60 * 60 * 1000, 'lifecycle_incomplete_age_invalid');
    return nowMs - updatedAt <= maxAge ? 'preserved_current' : null;
  }
  if (lifecycle.status === 'in_progress') {
    const maxAge = positiveInteger(options.inProgressLifecycleMaxAgeMs, 10 * 60 * 1000, 'lifecycle_in_progress_age_invalid');
    return nowMs - updatedAt <= maxAge ? 'preserved_current' : null;
  }
  return TERMINAL_LIFECYCLE_STATUSES.has(lifecycle.status) ? 'preserved_terminal' : null;
}

async function verifyPositiveStoryOnOrigin(origin, story, tickWindow, options) {
  const storyId = encodeURIComponent(story.story_id);
  const routes = {
    story: {
      path: `/vh/news/story?story_id=${storyId}&readback=exact`,
      missing: 'news-story-not-found',
      keys: ['ok', 'story_id', 'topic_id', 'source', 'story', 'record'],
    },
    latest: {
      path: `/vh/news/latest-index?story_id=${storyId}&readback=exact&persist=false`,
      missing: 'news-latest-index-not-found',
      keys: ['ok', 'story_id', 'record'],
    },
    hot: {
      path: `/vh/news/hot-index?story_id=${storyId}&readback=exact`,
      missing: 'news-hot-index-not-found',
      keys: ['ok', 'story_id', 'record'],
    },
    lifecycle: {
      path: `/vh/news/synthesis-lifecycle?story_id=${storyId}&readback=exact`,
      missing: 'news-synthesis-lifecycle-not-found',
      keys: ['ok', 'story_id', 'topic_id', 'status', 'frame_table_state', 'lifecycle', 'record'],
    },
  };
  const reads = {};
  for (const [name, route] of Object.entries(routes)) {
    reads[name] = await fetchJson(new URL(route.path, origin), options);
    if (reads[name].status === 404
      && exactMissingPayload(reads[name].payload, route.missing, story.story_id)) {
      throw new CandidateMissingError();
    }
    if (reads[name].status !== 200 || !exactKeys(reads[name].payload, route.keys)
      || reads[name].payload.ok !== true
      || reads[name].payload.story_id !== story.story_id) {
      fail(`positive_${name}_readback_failed`);
    }
  }
  const observedStory = reads.story.payload.story;
  let embeddedStory;
  try {
    embeddedStory = JSON.parse(reads.story.payload.record?.__story_bundle_json ?? '');
  } catch {
    embeddedStory = null;
  }
  if (!isObject(observedStory)
    || observedStory.story_id !== story.story_id
    || observedStory.topic_id !== story.topic_id
    || observedStory.provenance_hash !== story.provenance_hash
    || observedStory.created_at !== story.created_at
    || observedStory.cluster_window_start !== story.cluster_window_start
    || observedStory.cluster_window_end !== story.cluster_window_end
    || !isSignedSystemRecord(reads.story.payload.record)
    || reads.story.payload.record.story_id !== story.story_id
    || reads.story.payload.record.created_at !== story.created_at
    || reads.story.payload.record.schemaVersion !== story.schemaVersion
    || JSON.stringify(embeddedStory) !== JSON.stringify(story)) {
    fail('positive_story_contract_mismatch');
  }
  if (!isSignedSystemRecord(reads.latest.payload.record)
    || !productRecordMatchesStory(reads.latest.payload.record, story)
    || reads.latest.payload.record.latest_activity_at !== Math.max(0, Math.floor(story.cluster_window_end))) {
    fail('positive_latest_contract_mismatch');
  }
  if (!isSignedSystemRecord(reads.hot.payload.record)
    || !productRecordMatchesStory(reads.hot.payload.record, story)
    || !Number.isFinite(Number(reads.hot.payload.record.hotness))
    || Number(reads.hot.payload.record.hotness) < 0) {
    fail('positive_hot_contract_mismatch');
  }
  const lifecycleMode = lifecycleMatchesStory(
    reads.lifecycle.payload.lifecycle,
    story,
    tickWindow,
    options.nowMs,
    options,
  );
  if (!isSignedSystemRecord(reads.lifecycle.payload.lifecycle)
    || JSON.stringify(reads.lifecycle.payload.record) !== JSON.stringify(reads.lifecycle.payload.lifecycle)
    || !lifecycleMode) {
    fail('positive_lifecycle_contract_mismatch');
  }
  return {
    lifecycleMode,
    signedRecords: {
      story: reads.story.payload.record,
      latest: reads.latest.payload.record,
      hot: reads.hot.payload.record,
      lifecycle: reads.lifecycle.payload.lifecycle,
    },
  };
}

function exactMissingPayload(payload, error, storyId) {
  return Object.keys(payload).sort().join(',') === 'error,ok,story_id'
    && payload.ok === false && payload.error === error && payload.story_id === storyId;
}

async function verifyMissingContracts(origins, expectedRevision, runId, options) {
  const sentinel = `vh-publisher-recovery-missing-${expectedRevision.slice(0, 12)}-${runId}`;
  const id = encodeURIComponent(sentinel);
  const routes = [
    [`/vh/news/story?story_id=${id}&readback=exact`, 'news-story-not-found'],
    [`/vh/news/latest-index?story_id=${id}&readback=exact&persist=false`, 'news-latest-index-not-found'],
    [`/vh/news/hot-index?story_id=${id}&readback=exact`, 'news-hot-index-not-found'],
    [`/vh/news/synthesis-lifecycle?story_id=${id}&readback=exact`, 'news-synthesis-lifecycle-not-found'],
  ];
  for (const origin of origins) {
    for (const [route, error] of routes) {
      const read = await fetchJson(new URL(route, origin), options);
      if (read.status !== 404 || !exactMissingPayload(read.payload, error, sentinel)) {
        fail('missing_key_contract_failed');
      }
    }
  }
}

export async function verifyPublisherRecovery(options) {
  if (!fullRevision(options.expectedRevision)) fail('expected_revision_invalid');
  await requireOutputAbsent(options.outputFile);
  const fetchOptions = {
    fetchFn: options.fetchFn ?? fetch,
    timeoutMs: positiveInteger(options.timeoutMs, 5_000, 'timeout_invalid'),
    nowMs: options.nowMs ?? Date.now(),
    incompleteLifecycleMaxAgeMs: options.incompleteLifecycleMaxAgeMs,
    inProgressLifecycleMaxAgeMs: options.inProgressLifecycleMaxAgeMs,
  };
  const startControl = await verifyStartControlArtifact({
    filePath: options.startControlFile,
    expectedRevision: options.expectedRevision,
    nowMs: fetchOptions.nowMs,
    maxAgeMs: options.startControlMaxAgeMs,
  });
  const origins = normalizeOrigins(options.relayOrigins, startControl.relayOrigins);
  const currentRunJson = await readRegularJson(options.currentRunFile, 'current_run', { privateMode: true });
  const currentRun = validateCurrentRun(currentRunJson, options.expectedRevision, startControl);
  const diagnosticsJson = await readRegularJson(options.runtimeDiagnosticsFile, 'diagnostics');
  const tickWindow = validateDiagnostics(diagnosticsJson, currentRun, {
    nowMs: fetchOptions.nowMs,
    maxTickAgeMs: options.maxTickAgeMs,
  });
  let canonicalArtifactRoot;
  try {
    canonicalArtifactRoot = await realpath(currentRun.artifactRoot);
  } catch {
    fail('current_run_artifact_root_unavailable');
  }
  if (canonicalArtifactRoot !== currentRun.artifactRoot) fail('current_run_artifact_root_contains_symlink');
  const runDir = path.resolve(currentRun.artifactRoot, currentRun.runId);
  if (!runDir.startsWith(`${currentRun.artifactRoot}${path.sep}`)) fail('current_run_artifact_path_escape');
  let runDirStat;
  let canonicalRunDir;
  try {
    runDirStat = await lstat(runDir);
    canonicalRunDir = await realpath(runDir);
  } catch {
    fail('current_run_artifact_run_directory_unavailable');
  }
  if (runDirStat.isSymbolicLink() || !runDirStat.isDirectory()
    || (typeof process.getuid === 'function' && runDirStat.uid !== process.getuid())
    || canonicalRunDir !== runDir) {
    fail('current_run_artifact_run_directory_invalid');
  }
  const capturePath = path.resolve(runDir, 'cluster-capture.json');
  if (path.dirname(capturePath) !== runDir) fail('current_run_artifact_path_escape');
  const capture = await readRegularJson(capturePath, 'cluster_capture');
  const captureStories = captureStoriesForTick(capture, currentRun.runId, tickWindow);
  for (const storyId of tickWindow.writtenIds) {
    if (!captureStories.has(storyId)) fail('written_story_missing_from_cluster_capture');
  }

  let verifiedStory = null;
  let lifecycleModes = [];
  for (const storyId of tickWindow.writtenIds) {
    const story = captureStories.get(storyId);
    try {
      const modes = [];
      let signedRecordProjection = null;
      for (const origin of origins) {
        const projection = await verifyPositiveStoryOnOrigin(origin, story, tickWindow, fetchOptions);
        if (signedRecordProjection !== null
          && JSON.stringify(projection.signedRecords) !== JSON.stringify(signedRecordProjection)) {
          fail('positive_signed_record_replication_mismatch');
        }
        signedRecordProjection = projection.signedRecords;
        modes.push(projection.lifecycleMode);
      }
      verifiedStory = story;
      lifecycleModes = modes;
      break;
    } catch (error) {
      if (!(error instanceof CandidateMissingError)) throw error;
    }
  }
  if (!verifiedStory) fail('no_written_story_passed_four_route_readback');
  await verifyMissingContracts(origins, options.expectedRevision, currentRun.runId, fetchOptions);

  const completionNowMs = options.completionNowMs ?? Date.now();
  if (!Number.isFinite(completionNowMs)
    || completionNowMs < fetchOptions.nowMs
    || completionNowMs < tickWindow.completedAtMs) {
    fail('completion_timestamp_invalid');
  }

  const result = {
    schemaVersion: 'vh-news-publisher-recovery-readback-v1',
    generatedAt: new Date(completionNowMs).toISOString(),
    status: 'pass',
    revision: options.expectedRevision,
    startedAt: startControl.startedAt,
    runId: currentRun.runId,
    tickSequence: tickWindow.tick.tick_sequence,
    tickCompletedAt: new Date(tickWindow.completedAtMs).toISOString(),
    storyId: verifiedStory.story_id,
    sourceSetRevision: verifiedStory.provenance_hash,
    relayCount: origins.length,
    positiveRoutes: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
    missingKeyRoutes: ['story', 'latest-index', 'hot-index', 'synthesis-lifecycle'],
    lifecycleModes,
    inputBindings: {
      startControlSha256: startControl.sha256,
      preflightSha256: startControl.evidenceBindings.preflight.sha256,
      relayEvidenceSha256: startControl.evidenceBindings.relayRecovery.sha256,
      relayPacketSha256: startControl.evidenceBindings.relayRecovery.packetSha256,
      relayCaptureSha256: startControl.evidenceBindings.relayRecovery.captureSha256,
      mailboxSha256: startControl.evidenceBindings.mailbox.sha256,
    },
  };
  await writePrivateJsonAtomic(options.outputFile, result);
  return result;
}

function parseArgs(argv) {
  const values = new Map();
  const origins = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined) fail('arguments_invalid');
    index += 1;
    if (flag === '--relay-origin') {
      origins.push(value);
    } else {
      if (values.has(flag)) fail('arguments_duplicate');
      values.set(flag, value);
    }
  }
  return { values, origins };
}

async function main() {
  const { values, origins } = parseArgs(process.argv.slice(2));
  const required = ['--expected-revision', '--start-control-file', '--current-run-file', '--runtime-diagnostics-file', '--output-file'];
  if (required.some((key) => !values.get(key))) fail('arguments_missing');
  const result = await verifyPublisherRecovery({
    expectedRevision: values.get('--expected-revision'),
    startControlFile: path.resolve(values.get('--start-control-file')),
    currentRunFile: path.resolve(values.get('--current-run-file')),
    runtimeDiagnosticsFile: path.resolve(values.get('--runtime-diagnostics-file')),
    outputFile: path.resolve(values.get('--output-file')),
    relayOrigins: origins,
    timeoutMs: values.get('--timeout-ms'),
    maxTickAgeMs: values.get('--max-tick-age-ms'),
    startControlMaxAgeMs: values.get('--start-control-max-age-ms'),
    incompleteLifecycleMaxAgeMs: values.get('--incomplete-lifecycle-max-age-ms'),
    inProgressLifecycleMaxAgeMs: values.get('--in-progress-lifecycle-max-age-ms'),
  });
  console.info(JSON.stringify({
    status: result.status,
    revision: result.revision,
    runId: result.runId,
    tickSequence: result.tickSequence,
    relayCount: result.relayCount,
  }));
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
  let outputFile = null;
  try {
    const outputIndex = process.argv.indexOf('--output-file');
    if (outputIndex >= 0 && process.argv[outputIndex + 1]) outputFile = path.resolve(process.argv[outputIndex + 1]);
  } catch {
    outputFile = null;
  }
  main().catch(async (error) => {
    const code = error instanceof PublisherRecoveryVerificationError
      ? error.code
      : 'publisher_recovery_verification_unexpected_failure';
    if (outputFile) {
      await writePrivateJsonAtomic(outputFile, {
        schemaVersion: 'vh-news-publisher-recovery-readback-v1',
        generatedAt: new Date().toISOString(),
        status: 'fail',
        reason: code,
      }).catch(() => undefined);
    }
    console.error(`[vh:publisher-recovery] ${code}`);
    process.exit(78);
  });
}
