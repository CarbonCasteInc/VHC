import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeSystemWriterRecordBytes,
  validateSystemWriterRecord,
} from '../../packages/gun-client/dist/systemWriter.js';
import {
  PublisherRecoveryVerificationError,
  verifyPublisherRecovery,
} from './verify-news-aggregator-publisher-recovery.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPT_DIR, 'verify-news-aggregator-publisher-recovery.mjs');
const REVISION = '1883841555c4924be8d35747272c38ce8f2071d9';
const NOW = Date.parse('2026-07-10T12:00:00.000Z');
const SYSTEM_WRITER_ID = 'vh-e2e-news-daemon-system-writer-v1';
const SYSTEM_WRITER_PUBLIC_KEY =
  'MCowBQYDK2VwAyEA4ZHLho6yDOsGogTtrVUWiTRIGYlxKexsprzKjbuy9js';
const SYSTEM_WRITER_PRIVATE_KEY = createPrivateKey({
  key: Buffer.from(
    'MC4CAQAwBQYDK2VwBCIEIOHbQB3dtUl7cAXBpr6o_V7Tb1YuS6hcp7CLnRS-CscA',
    'base64url',
  ),
  format: 'der',
  type: 'pkcs8',
});
const SYSTEM_WRITER_PIN = {
  pinVersion: 1,
  schemaEpoch: 'luma-public-v1',
  maxProtocolVersion: 'luma-public-v1',
  signatureSuite: 'jcs-ed25519-sha256-v1',
  writers: [{
    id: SYSTEM_WRITER_ID,
    status: 'active',
    publicKey: { encoding: 'spki-base64url', material: SYSTEM_WRITER_PUBLIC_KEY },
  }],
};
const SIGNED_PATHS = {
  story: (storyId) => `vh/news/stories/${storyId}/`,
  latest: (storyId) => `vh/news/index/latest/${storyId}/`,
  hot: (storyId) => `vh/news/index/hot/${storyId}/`,
  lifecycle: (storyId) => `vh/news/stories/${storyId}/synthesis_lifecycle/latest/`,
};

const story = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-recovery',
  topic_id: 'topic-recovery',
  headline: 'Recovery story',
  cluster_window_start: 1_720_000_000_000,
  cluster_window_end: 1_720_000_060_000,
  sources: [{
    source_id: 'source-a', publisher: 'Source A', url: 'https://example.test/a',
    url_hash: 'hash-a', title: 'Recovery source',
  }],
  cluster_features: { entity_keys: ['recovery'], time_bucket: '2026-07-10T11', semantic_signature: 'sig' },
  provenance_hash: 'source-set-recovery',
  created_at: 1_720_000_070_000,
};
const secondStory = {
  ...structuredClone(story),
  story_id: 'story-recovery-second',
  provenance_hash: 'source-set-recovery-second',
  headline: 'Second recovery story',
};

function productRecord(extra = {}, selectedStory = story) {
  return {
    story_id: selectedStory.story_id,
    product_state_schema_version: 'vh-news-product-feed-index-v1',
    topic_id: selectedStory.topic_id,
    source_set_revision: selectedStory.provenance_hash,
    source_count: selectedStory.sources.length,
    canonical_source_count: (selectedStory.primary_sources ?? selectedStory.sources).length,
    story_created_at: selectedStory.created_at,
    cluster_window_start: selectedStory.cluster_window_start,
    ...extra,
  };
}

function lifecycle(updatedAt = Date.parse('2026-07-10T11:30:00.000Z'), status = 'pending', selectedStory = story) {
  return {
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    story_id: selectedStory.story_id,
    topic_id: selectedStory.topic_id,
    source_set_revision: selectedStory.provenance_hash,
    source_count: selectedStory.sources.length,
    canonical_source_count: (selectedStory.primary_sources ?? selectedStory.sources).length,
    status,
    retryable: status === 'retryable_failure',
    frame_table_state: 'frame_table_pending',
    updated_at: updatedAt,
  };
}

function signSystemRecord(payload, selectedStory, route, overrides = {}) {
  const unsigned = {
    ...payload,
    _system: null,
    _Signature: null,
    _WriterId: null,
    _IssuedAt: null,
    _protocolVersion: 'luma-public-v1',
    _writerKind: 'system',
    _systemWriterId: SYSTEM_WRITER_ID,
    _systemIssuedAt: selectedStory.created_at + 1,
    ...overrides,
  };
  const signature = sign(
    null,
    Buffer.from(canonicalizeSystemWriterRecordBytes(unsigned)),
    SYSTEM_WRITER_PRIVATE_KEY,
  ).toString('base64url');
  assert.ok(SIGNED_PATHS[route](selectedStory.story_id));
  return { ...unsigned, _systemSignature: signature };
}

async function privateJson(file, payload) {
  await writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

function tick(sequence, overrides = {}) {
  const started = sequence === 1 ? '2026-07-10T11:00:00.000Z' : '2026-07-10T11:10:00.000Z';
  const completed = sequence === 1 ? '2026-07-10T11:05:00.000Z' : '2026-07-10T11:15:00.000Z';
  return {
    schemaVersion: 'vh-news-runtime-tick-summary-v1',
    tick_sequence: sequence,
    first_tick: sequence === 1,
    status: 'completed',
    skipped: false,
    no_write: false,
    started_at: started,
    completed_at: completed,
    duration_ms: 300_000,
    selected_bundle_count: 1,
    raw_write_attempted_count: 1,
    raw_write_suppressed_count: 0,
    raw_wrote_count: 1,
    raw_write_failed_count: 0,
    nonfatal_prewrite_failure_count: 0,
    first_selected_story_ids: [story.story_id],
    first_raw_written_story_ids: [story.story_id],
    ...overrides,
  };
}

function startControl(overrides = {}) {
  return {
    schemaVersion: 'vh-news-publisher-start-control-v1',
    generatedAt: '2026-07-10T10:31:00.000Z',
    status: 'active_attended_permit_consumed',
    revision: REVISION,
    startedAt: '2026-07-10T10:30:00.000Z',
    activatedAt: '2026-07-10T10:30:30.000Z',
    preStart: {
      activeState: 'failed', subState: 'failed', result: 'exit-code', execMainStatus: 78,
      incidentNRestarts: 4, enabledState: 'disabled',
    },
    activationBaseline: { nRestarts: 0, capturedAfterResetFailed: true },
    postActivation: {
      activeState: 'active', subState: 'running', nRestarts: 0,
      attendedPermitConsumed: true,
      legacyManagerApprovalCleared: true,
      attendedPermitBindingSha256: '7'.repeat(64),
    },
    evidenceBindings: {
      preflight: {
        schemaVersion: 'vh-news-daemon-recovery-preflight-v1', sha256: '1'.repeat(64), revision: REVISION,
        runId: 'preflight-recovery', generatedAt: '2026-07-10T10:20:00.000Z',
      },
      relayRecovery: {
        schemaVersion: 'vh-a6-s1b-relay-recovery-evidence-v1', sha256: '2'.repeat(64), revision: REVISION,
        generatedAt: '2026-07-10T10:10:00.000Z', immutableImageId: `sha256:${'3'.repeat(64)}`,
        imageTag: 'vhc-public-beta-relay:20260710-main-v18838415-amd64', packetSha256: '4'.repeat(64),
        captureSha256: '5'.repeat(64), reviewerIdentity: 'reviewer-1', reviewedAt: '2026-07-10T10:25:00.000Z',
        relayOrder: ['vhc-relay-a', 'vhc-relay-b', 'vhc-relay-c'],
        relayOrigins: ['http://127.0.0.1:8765', 'http://127.0.0.1:8766', 'http://127.0.0.1:8767'],
      },
      mailbox: {
        schemaVersion: 'vhc-failure-mailbox-monitor-v1', sha256: '6'.repeat(64),
        newCriticalCount: 11, generatedAt: '2026-07-10T10:26:00.000Z',
      },
    },
    ...overrides,
  };
}

function clusterTick(generatedAt, tickSequence = 299, stories = [story]) {
  return {
    schemaVersion: 'news-orchestrator-cluster-artifacts-v1',
    generatedAt,
    tickSequence,
    rawItemCount: 1,
    normalizedItems: [],
    topicCaptures: [{
      topicId: story.topic_id,
      items: [],
      result: { bundles: stories, storylines: [] },
    }],
  };
}

async function fixture(overrides = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'vh-publisher-readback-')));
  const artifactRoot = path.join(root, 'artifacts');
  const runId = 'run-recovery';
  const runDir = path.join(artifactRoot, runId);
  let captureRunDir = runDir;
  if (overrides.runDirSymlink) {
    await mkdir(artifactRoot, { recursive: true });
    captureRunDir = path.join(root, 'escaped-run-directory');
    await mkdir(captureRunDir, { recursive: true });
    await symlink(captureRunDir, runDir);
  } else {
    await mkdir(runDir, { recursive: true });
  }
  let recordedArtifactRoot = artifactRoot;
  if (overrides.artifactRootSymlink) {
    recordedArtifactRoot = path.join(root, 'artifact-link');
    await symlink(artifactRoot, recordedArtifactRoot);
  }
  const ticks = overrides.ticks ?? [tick(1), tick(2)];
  const latest = overrides.latest ?? structuredClone(ticks.at(-1));
  const startFile = await privateJson(path.join(root, 'start-control.json'), startControl(overrides.start));
  const currentRunFile = await privateJson(path.join(root, 'current-run.json'), {
    schemaVersion: 'vh-news-daemon-current-run-v1',
    generatedAt: '2026-07-10T10:40:00.000Z',
    status: 'preflight_passed',
    revision: overrides.currentRevision ?? REVISION,
    runId: overrides.currentRunId ?? runId,
    artifactRoot: recordedArtifactRoot,
    noWrite: false,
  });
  const diagnosticsFile = await privateJson(path.join(root, 'diagnostics.json'), {
    schemaVersion: 'vh-news-runtime-diagnostics-v1',
    generatedAt: '2026-07-10T11:15:00.000Z',
    runId: overrides.diagnosticsRunId ?? runId,
    noWrite: false,
    latest,
    summaries: ticks,
  });
  const captureTicks = overrides.captureTicks ?? [clusterTick('2026-07-10T11:12:00.000Z')];
  await privateJson(path.join(captureRunDir, 'cluster-capture.json'), {
    schemaVersion: 'daemon-feed-cluster-capture-v1',
    generatedAt: '2026-07-10T11:12:01.000Z',
    runId,
    ticks: captureTicks,
  });
  return {
    root,
    startFile,
    currentRunFile,
    diagnosticsFile,
    outputFile: path.join(root, 'readback.json'),
  };
}

async function bindStartControlOrigins(files, origins) {
  const payload = JSON.parse(await readFile(files.startFile, 'utf8'));
  payload.evidenceBindings.relayRecovery.relayOrigins = [...origins];
  await privateJson(files.startFile, payload);
}

function jsonResponse(res, status, payload, headers = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(body);
}

function responder(options = {}) {
  const counts = { positive: 0, missing: 0 };
  const requests = [];
  const handler = (req, res) => {
    const url = new URL(req.url, 'http://relay.invalid');
    requests.push(`${url.pathname}?${url.searchParams.toString()}`);
    const storyId = url.searchParams.get('story_id');
    const missing = storyId?.startsWith('vh-publisher-recovery-missing-');
    if (missing) {
      counts.missing += 1;
      const errors = {
        '/vh/news/story': 'news-story-not-found',
        '/vh/news/latest-index': 'news-latest-index-not-found',
        '/vh/news/hot-index': 'news-hot-index-not-found',
        '/vh/news/synthesis-lifecycle': 'news-synthesis-lifecycle-not-found',
      };
      jsonResponse(res, 404, { ok: false, error: errors[url.pathname], story_id: storyId });
      return;
    }
    const selectedStory = options.stories?.find((candidate) => candidate.story_id === storyId) ?? story;
    if (options.missingStoryId === storyId) {
      const errors = {
        '/vh/news/story': 'news-story-not-found',
        '/vh/news/latest-index': 'news-latest-index-not-found',
        '/vh/news/hot-index': 'news-hot-index-not-found',
        '/vh/news/synthesis-lifecycle': 'news-synthesis-lifecycle-not-found',
      };
      jsonResponse(res, 404, { ok: false, error: errors[url.pathname], story_id: storyId });
      return;
    }
    counts.positive += 1;
    if (options.hostilePath === url.pathname) {
      jsonResponse(res, 200, { ok: true, story_id: story.story_id, leaked_secret: options.secret ?? 'TOP-SECRET' });
      return;
    }
    if (options.malformedPath === url.pathname) {
      jsonResponse(res, 200, '{not-json');
      return;
    }
    if (options.oversizePath === url.pathname) {
      jsonResponse(res, 200, {}, { 'content-length': String(1_048_577) });
      return;
    }
    if (options.redirectPath === url.pathname) {
      res.writeHead(302, { location: options.redirectLocation });
      res.end();
      return;
    }
    if (options.stalledBodyPath === url.pathname) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.write('{"ok":');
      return;
    }
    let payload;
    if (url.pathname === '/vh/news/story') {
      const record = signSystemRecord({
        __story_bundle_json: JSON.stringify(selectedStory),
        story_id: selectedStory.story_id,
        created_at: selectedStory.created_at,
        schemaVersion: selectedStory.schemaVersion,
      }, selectedStory, 'story', options.signatureOverrides?.story);
      payload = {
        ok: true, story_id: selectedStory.story_id, topic_id: selectedStory.topic_id,
        source: 'story-body', story: selectedStory,
        record,
      };
    } else if (url.pathname === '/vh/news/latest-index') {
      const record = signSystemRecord(
        productRecord({ latest_activity_at: selectedStory.cluster_window_end }, selectedStory),
        selectedStory,
        'latest',
        options.signatureOverrides?.latest,
      );
      payload = {
        ok: true, story_id: selectedStory.story_id,
        record,
      };
    } else if (url.pathname === '/vh/news/hot-index') {
      const record = signSystemRecord(
        productRecord({ hotness: 0.75 }, selectedStory),
        selectedStory,
        'hot',
        options.signatureOverrides?.hot,
      );
      payload = {
        ok: true, story_id: selectedStory.story_id,
        record,
      };
    } else if (url.pathname === '/vh/news/synthesis-lifecycle') {
      const perRelayLifecycle = options.lifecycleByRelay?.[options.relayIndex];
      const record = signSystemRecord(lifecycle(
        perRelayLifecycle?.updatedAt ?? options.lifecycleUpdatedAt,
        perRelayLifecycle?.status ?? options.lifecycleStatus,
        selectedStory,
      ), selectedStory, 'lifecycle', options.signatureOverrides?.lifecycle);
      if (options.malformedLifecycle) delete record.source_set_revision;
      payload = {
        ok: true, story_id: selectedStory.story_id, topic_id: selectedStory.topic_id,
        status: record.status, frame_table_state: record.frame_table_state, lifecycle: record, record,
      };
    } else {
      jsonResponse(res, 404, { ok: false });
      return;
    }
    if (options.extraFieldPath === url.pathname
      && (!options.extraFieldStoryId || options.extraFieldStoryId === storyId)) {
      payload.token = options.secret ?? 'TOP-SECRET';
    }
    if (options.tamperedSignatureStoryId === storyId && options.relayIndex === 0) {
      if (url.pathname === '/vh/news/synthesis-lifecycle') {
        payload.lifecycle._systemSignature = Buffer.alloc(64, 0xa5).toString('base64url');
        payload.record = payload.lifecycle;
      } else if (payload.record) {
        payload.record._systemSignature = Buffer.alloc(64, 0xa5).toString('base64url');
      }
    }
    if (options.forgedSignaturePath === url.pathname) {
      const forged = Buffer.alloc(64, options.relayIndex + 1).toString('base64url');
      if (url.pathname === '/vh/news/synthesis-lifecycle') {
        payload.lifecycle._systemSignature = forged;
        payload.record = payload.lifecycle;
      } else {
        payload.record._systemSignature = forged;
      }
    }
    jsonResponse(res, 200, payload);
  };
  return { handler, counts, requests };
}

async function startRelays(options = {}) {
  const relays = [];
  const counts = [];
  const requests = [];
  for (let index = 0; index < 3; index += 1) {
    const route = responder({ ...options, relayIndex: index });
    const server = http.createServer(route.handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    relays.push({ server, origin: `http://127.0.0.1:${address.port}` });
    counts.push(route.counts);
    requests.push(route.requests);
  }
  return {
    origins: relays.map((relay) => relay.origin),
    counts,
    requests,
    close: () => Promise.all(relays.map(({ server }) => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }))),
  };
}

async function verify(files, relays, overrides = {}) {
  if (overrides.bindReviewedOrigins !== false) {
    await bindStartControlOrigins(files, relays.origins);
  }
  const { bindReviewedOrigins: _ignored, ...verificationOverrides } = overrides;
  return verifyPublisherRecovery({
    expectedRevision: REVISION,
    startControlFile: files.startFile,
    currentRunFile: files.currentRunFile,
    runtimeDiagnosticsFile: files.diagnosticsFile,
    outputFile: files.outputFile,
    relayOrigins: relays.origins,
    nowMs: NOW,
    timeoutMs: 2_000,
    maxTickAgeMs: 60 * 60 * 1000,
    startControlMaxAgeMs: 2 * 60 * 60 * 1000,
    completionNowMs: NOW,
    systemWriterPin: SYSTEM_WRITER_PIN,
    ...verificationOverrides,
  });
}

test('real Ed25519 verification passes three relays x four positive and four missing contracts', async () => {
  const files = await fixture();
  const relays = await startRelays();
  try {
    const result = await verify(files, relays);
    assert.equal(result.status, 'pass');
    assert.equal(result.tickSequence, 2);
    assert.equal(result.relayCount, 3);
    assert.equal(result.storyId, story.story_id);
    assert.deepEqual(relays.counts, [
      { positive: 4, missing: 4 },
      { positive: 4, missing: 4 },
      { positive: 4, missing: 4 },
    ]);
    for (const requests of relays.requests) {
      assert.deepEqual(requests.map((value) => value.replace(/story_id=[^&]+/, 'story_id=<id>')), [
        '/vh/news/story?story_id=<id>&readback=exact',
        '/vh/news/latest-index?story_id=<id>&readback=exact&persist=false',
        '/vh/news/hot-index?story_id=<id>&readback=exact',
        '/vh/news/synthesis-lifecycle?story_id=<id>&readback=exact',
        '/vh/news/story?story_id=<id>&readback=exact',
        '/vh/news/latest-index?story_id=<id>&readback=exact&persist=false',
        '/vh/news/hot-index?story_id=<id>&readback=exact',
        '/vh/news/synthesis-lifecycle?story_id=<id>&readback=exact',
      ]);
    }
    const artifact = JSON.parse(await readFile(files.outputFile, 'utf8'));
    assert.equal(artifact.revision, REVISION);
    assert.equal((await lstat(files.outputFile)).mode & 0o777, 0o600);
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('real Ed25519 verification rejects tampering independently on all four positive routes', async () => {
  const rows = [
    ['/vh/news/story', 'positive_story_signature_invalid'],
    ['/vh/news/latest-index', 'positive_latest_signature_invalid'],
    ['/vh/news/hot-index', 'positive_hot_signature_invalid'],
    ['/vh/news/synthesis-lifecycle', 'positive_lifecycle_signature_invalid'],
  ];
  for (const [forgedSignaturePath, code] of rows) {
    const files = await fixture();
    const relays = await startRelays({ forgedSignaturePath });
    try {
      await assert.rejects(verify(files, relays), (error) => error.code === code);
      await assert.rejects(lstat(files.outputFile), (error) => error.code === 'ENOENT');
    } finally {
      await relays.close();
      await rm(files.root, { recursive: true, force: true });
    }
  }
});

test('real Ed25519 verification rejects a valid signature under the wrong pinned public key', async () => {
  const files = await fixture();
  const relays = await startRelays();
  const wrongPublicKey = generateKeyPairSync('ed25519').publicKey.export({
    format: 'der',
    type: 'spki',
  }).toString('base64url');
  const wrongPin = structuredClone(SYSTEM_WRITER_PIN);
  wrongPin.writers[0].publicKey.material = wrongPublicKey;
  try {
    await assert.rejects(
      verify(files, relays, { systemWriterPin: wrongPin }),
      (error) => error.code === 'positive_story_signature_invalid',
    );
    await assert.rejects(lstat(files.outputFile), (error) => error.code === 'ENOENT');
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('canonical signature validation fails closed when a positive record is checked at a wrong path', async () => {
  const files = await fixture();
  const relays = await startRelays();
  let injectedWrongPath = false;
  try {
    await assert.rejects(
      verify(files, relays, {
        validateSystemWriterRecord: async (input) => {
          if (!injectedWrongPath) {
            injectedWrongPath = true;
            return validateSystemWriterRecord({
              ...input,
              path: `vh/not-allowed/${story.story_id}`,
            });
          }
          return validateSystemWriterRecord(input);
        },
      }),
      (error) => error.code === 'positive_story_signature_invalid',
    );
    assert.equal(injectedWrongPath, true);
    await assert.rejects(lstat(files.outputFile), (error) => error.code === 'ENOENT');
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('uses tick1 when tick2 is green-attempted but has no complete successful write set', async () => {
  const tick2 = tick(2, {
    raw_wrote_count: 0,
    raw_write_suppressed_count: 1,
    first_raw_written_story_ids: [],
  });
  const files = await fixture({
    ticks: [tick(1), tick2],
    captureTicks: [clusterTick('2026-07-10T11:02:00.000Z', 17)],
  });
  const relays = await startRelays({ lifecycleUpdatedAt: Date.parse('2026-07-10T11:02:30.000Z') });
  try {
    const result = await verify(files, relays);
    assert.equal(result.tickSequence, 1);
    assert.deepEqual(result.lifecycleModes, ['updated_in_tick', 'updated_in_tick', 'updated_in_tick']);
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('fails closed on missing first tick, contradictory latest, and successful-ID membership mismatch', async () => {
  const rows = [
    {
      name: 'missing first tick',
      fixture: { ticks: [tick(2)] },
      code: 'diagnostics_summaries_missing',
    },
    {
      name: 'contradictory latest',
      fixture: { latest: tick(2, { raw_wrote_count: 99 }) },
      code: 'diagnostics_latest_invalid',
    },
    {
      name: 'written id not selected',
      fixture: { ticks: [tick(1), tick(2, { first_selected_story_ids: ['other-story'] })] },
      code: 'diagnostics_written_story_not_selected',
    },
  ];
  const relays = await startRelays();
  try {
    for (const row of rows) {
      const files = await fixture(row.fixture);
      try {
        await assert.rejects(
          verify(files, relays),
          (error) => error instanceof PublisherRecoveryVerificationError && error.code === row.code,
          row.name,
        );
      } finally {
        await rm(files.root, { recursive: true, force: true });
      }
    }
  } finally {
    await relays.close();
  }
});

test('capture binding rejects both zero and multiple capture rows inside the chosen runtime window', async () => {
  const rows = [
    [clusterTick('2026-07-10T10:00:00.000Z', 1)],
    [
      clusterTick('2026-07-10T11:11:00.000Z', 1),
      clusterTick('2026-07-10T11:12:00.000Z', 2),
    ],
  ];
  const relays = await startRelays();
  try {
    for (const captureTicks of rows) {
      const files = await fixture({ captureTicks });
      try {
        await assert.rejects(verify(files, relays), (error) => error.code === 'cluster_capture_tick_invalid');
      } finally {
        await rm(files.root, { recursive: true, force: true });
      }
    }
  } finally {
    await relays.close();
  }
});

test('never hides a tampered first written candidate behind a later good candidate', async () => {
  const tick2 = tick(2, {
    selected_bundle_count: 2,
    raw_write_attempted_count: 2,
    raw_wrote_count: 2,
    first_selected_story_ids: [story.story_id, secondStory.story_id],
    first_raw_written_story_ids: [story.story_id, secondStory.story_id],
  });
  const files = await fixture({
    ticks: [tick(1), tick2],
    latest: structuredClone(tick2),
    captureTicks: [clusterTick('2026-07-10T11:12:00.000Z', 299, [story, secondStory])],
  });
  const relays = await startRelays({
    stories: [story, secondStory],
    tamperedSignatureStoryId: story.story_id,
  });
  try {
    await assert.rejects(
      verify(files, relays),
      (error) => error.code === 'positive_story_signature_invalid',
    );
    assert.equal(relays.requests.flat().some((request) => request.includes(secondStory.story_id)), false);
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('only an exact closed 404 may make one written candidate ineligible', async () => {
  const tick2 = tick(2, {
    selected_bundle_count: 2,
    raw_write_attempted_count: 2,
    raw_wrote_count: 2,
    first_selected_story_ids: [story.story_id, secondStory.story_id],
    first_raw_written_story_ids: [story.story_id, secondStory.story_id],
  });
  const files = await fixture({
    ticks: [tick(1), tick2],
    latest: structuredClone(tick2),
    captureTicks: [clusterTick('2026-07-10T11:12:00.000Z', 299, [story, secondStory])],
  });
  const relays = await startRelays({ stories: [story, secondStory], missingStoryId: story.story_id });
  try {
    const result = await verify(files, relays);
    assert.equal(result.storyId, secondStory.story_id);
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('accepts a preserved current lifecycle and rejects a stale preserved pending lifecycle', async () => {
  const passFiles = await fixture();
  const passRelays = await startRelays({ lifecycleUpdatedAt: Date.parse('2026-07-10T11:30:00.000Z') });
  try {
    const result = await verify(passFiles, passRelays);
    assert.deepEqual(result.lifecycleModes, ['preserved_current', 'preserved_current', 'preserved_current']);
  } finally {
    await passRelays.close();
    await rm(passFiles.root, { recursive: true, force: true });
  }

  const staleFiles = await fixture();
  const staleRelays = await startRelays({ lifecycleUpdatedAt: Date.parse('2026-07-10T10:00:00.000Z') });
  try {
    await assert.rejects(
      verify(staleFiles, staleRelays),
      (error) => error.code === 'positive_lifecycle_contract_mismatch',
    );
  } finally {
    await staleRelays.close();
    await rm(staleFiles.root, { recursive: true, force: true });
  }
});

test('accepts mixed updated, preserved-current, and preserved-terminal lifecycle states across relays', async () => {
  const files = await fixture();
  const relays = await startRelays({
    lifecycleByRelay: [
      { status: 'pending', updatedAt: Date.parse('2026-07-10T11:12:00.000Z') },
      { status: 'retryable_failure', updatedAt: Date.parse('2026-07-10T11:30:00.000Z') },
      { status: 'accepted_available', updatedAt: Date.parse('2026-06-01T00:00:00.000Z') },
    ],
  });
  try {
    const result = await verify(files, relays);
    assert.deepEqual(result.lifecycleModes, [
      'updated_in_tick',
      'preserved_current',
      'preserved_terminal',
    ]);
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('accepts preserved terminal lifecycle and enforces the distinct 10-minute in-progress boundary', async () => {
  const terminalFiles = await fixture();
  const terminalRelays = await startRelays({
    lifecycleStatus: 'accepted_available',
    lifecycleUpdatedAt: Date.parse('2026-06-01T00:00:00.000Z'),
  });
  try {
    const result = await verify(terminalFiles, terminalRelays);
    assert.deepEqual(result.lifecycleModes, ['preserved_terminal', 'preserved_terminal', 'preserved_terminal']);
  } finally {
    await terminalRelays.close();
    await rm(terminalFiles.root, { recursive: true, force: true });
  }

  for (const [updatedAt, shouldPass] of [
    [Date.parse('2026-07-10T11:51:00.000Z'), true],
    [Date.parse('2026-07-10T11:49:59.999Z'), false],
  ]) {
    const files = await fixture();
    const relays = await startRelays({ lifecycleStatus: 'in_progress', lifecycleUpdatedAt: updatedAt });
    try {
      if (shouldPass) {
        const result = await verify(files, relays);
        assert.deepEqual(result.lifecycleModes, ['preserved_current', 'preserved_current', 'preserved_current']);
      } else {
        await assert.rejects(verify(files, relays), (error) => error.code === 'positive_lifecycle_contract_mismatch');
      }
    } finally {
      await relays.close();
      await rm(files.root, { recursive: true, force: true });
    }
  }

  const malformedFiles = await fixture();
  const malformedRelays = await startRelays({ lifecycleStatus: 'accepted_available', malformedLifecycle: true });
  try {
    await assert.rejects(verify(malformedFiles, malformedRelays), (error) => error.code === 'positive_lifecycle_signature_invalid');
  } finally {
    await malformedRelays.close();
    await rm(malformedFiles.root, { recursive: true, force: true });
  }
});

test('rejects malformed and oversize response bodies without accepting partial route proof', async () => {
  for (const [options, code] of [
    [{ malformedPath: '/vh/news/latest-index' }, 'relay_readback_json_invalid'],
    [{ oversizePath: '/vh/news/hot-index' }, 'relay_readback_body_too_large'],
  ]) {
    const files = await fixture();
    const relays = await startRelays(options);
    try {
      await assert.rejects(
        verify(files, relays),
        (error) => error.code === code,
      );
    } finally {
      await relays.close();
      await rm(files.root, { recursive: true, force: true });
    }
  }
});

test('rejects redirects without ever contacting the redirect target', async () => {
  let redirectTargetContacts = 0;
  const target = http.createServer((_req, res) => {
    redirectTargetContacts += 1;
    jsonResponse(res, 200, { ok: true });
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetAddress = target.address();
  const targetOrigin = `http://127.0.0.1:${targetAddress.port}`;
  const files = await fixture();
  const relays = await startRelays({
    redirectPath: '/vh/news/story',
    redirectLocation: `${targetOrigin}/must-not-be-contacted`,
  });
  try {
    await assert.rejects(
      verify(files, relays),
      (error) => error.code === 'relay_readback_network_failed',
    );
    assert.equal(redirectTargetContacts, 0);
    await assert.rejects(lstat(files.outputFile), (error) => error.code === 'ENOENT');
  } finally {
    await relays.close();
    await new Promise((resolve) => {
      target.close(resolve);
      target.closeAllConnections?.();
    });
    await rm(files.root, { recursive: true, force: true });
  }
});

test('response-body stalls remain inside the relay timeout and leave no pass artifact', async () => {
  const files = await fixture();
  const relays = await startRelays({ stalledBodyPath: '/vh/news/story' });
  const startedAt = Date.now();
  try {
    await assert.rejects(
      verify(files, relays, { timeoutMs: 100 }),
      (error) => error.code === 'relay_readback_body_failed',
    );
    assert.ok(Date.now() - startedAt < 2_000, 'stalled body exceeded the bounded verifier timeout');
    await assert.rejects(lstat(files.outputFile), (error) => error.code === 'ENOENT');
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});

test('rejects revision, run, and start-boundary mismatches before network proof', async () => {
  const rows = [
    [{ currentRevision: 'b'.repeat(40) }, 'current_run_revision_mismatch'],
    [{ diagnosticsRunId: 'old-run' }, 'diagnostics_run_id_mismatch'],
    [{ currentRunId: '../escape' }, 'current_run_id_invalid'],
    [{ artifactRootSymlink: true }, 'current_run_artifact_root_contains_symlink'],
    [{ runDirSymlink: true }, 'current_run_artifact_run_directory_invalid'],
    [{ start: {
      startedAt: '2026-07-10T10:50:00.000Z', activatedAt: '2026-07-10T10:50:10.000Z',
      generatedAt: '2026-07-10T10:50:20.000Z',
    } }, 'current_run_predates_attended_start'],
  ];
  const relays = await startRelays();
  try {
    for (const [overrides, code] of rows) {
      const files = await fixture(overrides);
      try {
        await assert.rejects(verify(files, relays), (error) => error.code === code);
      } finally {
        await rm(files.root, { recursive: true, force: true });
      }
    }
  } finally {
    await relays.close();
  }
});

test('binds relay probes to the reviewed ordered explicit loopback origins only', async () => {
  const relays = await startRelays();
  const rows = [
    [['https://127.0.0.1:8765', relays.origins[1], relays.origins[2]], 'relay_origin_invalid'],
    [['http://localhost:8765', relays.origins[1], relays.origins[2]], 'relay_origin_invalid'],
    [['http://192.0.2.10:8765', relays.origins[1], relays.origins[2]], 'relay_origin_invalid'],
    [['http://127.0.0.1', relays.origins[1], relays.origins[2]], 'relay_origin_invalid'],
    [['http://127.0.0.1:80', relays.origins[1], relays.origins[2]], 'relay_origin_invalid'],
    [[relays.origins[0], relays.origins[0], relays.origins[2]], 'relay_origin_duplicate'],
    [[relays.origins[1], relays.origins[0], relays.origins[2]], 'relay_origin_review_binding_mismatch'],
  ];
  try {
    for (const [relayOrigins, code] of rows) {
      const files = await fixture();
      try {
        await bindStartControlOrigins(files, relays.origins);
        await assert.rejects(
          verify(files, relays, { bindReviewedOrigins: false, relayOrigins }),
          (error) => error.code === code,
        );
      } finally {
        await rm(files.root, { recursive: true, force: true });
      }
    }
  } finally {
    await relays.close();
  }
});

test('requires private current-run mode and refuses to clobber any existing readback evidence', async () => {
  const relays = await startRelays();
  const weak = await fixture();
  try {
    await chmod(weak.currentRunFile, 0o644);
    await assert.rejects(verify(weak, relays), (error) => error.code === 'current_run_mode_not_0600');
  } finally {
    await rm(weak.root, { recursive: true, force: true });
  }

  const existing = await fixture();
  try {
    await writeFile(existing.outputFile, 'preserved-prior-pass\n', { mode: 0o600 });
    await assert.rejects(verify(existing, relays), (error) => error.code === 'output_already_exists');
    assert.equal(await readFile(existing.outputFile, 'utf8'), 'preserved-prior-pass\n');
    assert.deepEqual(relays.counts, [{ positive: 0, missing: 0 }, { positive: 0, missing: 0 }, { positive: 0, missing: 0 }]);
  } finally {
    await relays.close();
    await rm(existing.root, { recursive: true, force: true });
  }
});

function spawnVerifier(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: path.resolve(SCRIPT_DIR, '../..'),
      env: {
        ...process.env,
        VH_NEWS_SYSTEM_WRITER_PIN_JSON: JSON.stringify(SYSTEM_WRITER_PIN),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('rejects hostile extra top-level fields on every positive route with closed reasons', async () => {
  const rows = [
    ['/vh/news/story', 'positive_story_readback_failed'],
    ['/vh/news/latest-index', 'positive_latest_readback_failed'],
    ['/vh/news/hot-index', 'positive_hot_readback_failed'],
    ['/vh/news/synthesis-lifecycle', 'positive_lifecycle_readback_failed'],
  ];
  for (const [extraFieldPath, code] of rows) {
    const files = await fixture();
    const relays = await startRelays({ extraFieldPath, secret: 'NEVER-ECHO-THIS' });
    try {
      await assert.rejects(
        verify(files, relays),
        (error) => error.code === code && !String(error.message).includes('NEVER-ECHO-THIS'),
      );
    } finally {
      await relays.close();
      await rm(files.root, { recursive: true, force: true });
    }
  }
});

test('CLI failure artifact is mode 0600 and never preserves hostile response content', async () => {
  const files = await fixture();
  const secret = 'HOSTILE-RELAY-SECRET-DO-NOT-PERSIST';
  const relays = await startRelays({ extraFieldPath: '/vh/news/story', secret });
  try {
    await bindStartControlOrigins(files, relays.origins);
    const args = [
      '--expected-revision', REVISION,
      '--start-control-file', files.startFile,
      '--current-run-file', files.currentRunFile,
      '--runtime-diagnostics-file', files.diagnosticsFile,
      '--output-file', files.outputFile,
      '--timeout-ms', '2000',
      '--max-tick-age-ms', String(60 * 60 * 1000),
      '--start-control-max-age-ms', String(2 * 60 * 60 * 1000),
      ...relays.origins.flatMap((origin) => ['--relay-origin', origin]),
    ];
    const result = await spawnVerifier(args);
    assert.equal(result.status, 78);
    const artifactText = await readFile(files.outputFile, 'utf8');
    const artifact = JSON.parse(artifactText);
    assert.deepEqual(Object.keys(artifact).sort(), ['generatedAt', 'reason', 'schemaVersion', 'status']);
    assert.equal(artifact.status, 'fail');
    assert.doesNotMatch(artifactText + result.stdout + result.stderr, new RegExp(secret));
    for (const origin of relays.origins) {
      assert.doesNotMatch(artifactText, new RegExp(origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    assert.equal((await lstat(files.outputFile)).mode & 0o777, 0o600);
  } finally {
    await relays.close();
    await rm(files.root, { recursive: true, force: true });
  }
});
