import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
const relayServerPath = path.join(repoRoot, 'infra/relay/server.js');
const gunRequire = createRequire(path.join(repoRoot, 'packages/gun-client/package.json'));
const Gun = gunRequire('gun');
const SEA = gunRequire('gun/sea');

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate free port')));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

function requestJson(url, { method = 'GET', headers = {}, body = undefined } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          const parsedBody = (() => {
            try {
              return raw.trim() ? JSON.parse(raw) : null;
            } catch {
              return raw;
            }
          })();
          resolve({ statusCode: response.statusCode ?? 0, body: parsedBody, raw });
        });
      }
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function websocketUpgradeStatus(port, pathname = '/gun') {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.write(
        [
          `GET ${pathname} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
          '',
          '',
        ].join('\r\n')
      );
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      raw += chunk;
      const match = raw.match(/^HTTP\/1\.1\s+(\d+)/);
      if (match) {
        socket.destroy();
        resolve(Number(match[1]));
      }
    });
    socket.on('error', reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error('websocket-upgrade-timeout'));
    });
  });
}

async function relaySignatureHeaders(pathname, body, pair) {
  const nonce = `nonce-${Date.now()}-${Math.random()}`;
  const timestamp = String(Date.now());
  const canonical = JSON.stringify({ path: pathname, body, nonce, timestamp });
  const signature = await SEA.sign(canonical, pair);
  return {
    'x-vh-relay-device-pub': pair.pub,
    'x-vh-relay-signature': Buffer.from(signature, 'utf8').toString('base64url'),
    'x-vh-relay-nonce': nonce,
    'x-vh-relay-timestamp': timestamp,
  };
}

async function startRelay(children, tempDirs, env = {}) {
  const port = await findFreePort();
  const gunDir = mkdtempSync(path.join(os.tmpdir(), 'vh-relay-test-'));
  tempDirs.add(gunDir);
  const child = spawn(process.execPath, [relayServerPath], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GUN_HOST: '127.0.0.1',
      GUN_PORT: String(port),
      GUN_FILE: path.join(gunDir, 'data'),
      VH_RELAY_PEERS: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.on('data', (chunk) => { child.stdoutText += chunk; });
  child.stderr.on('data', (chunk) => { child.stderrText += chunk; });
  children.add(child);
  await waitForOutput(child, new RegExp(`Gun relay listening on 127\\.0\\.0\\.1:${port}`));
  return { port, child };
}

async function waitForOutput(child, pattern, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const stdout = child.stdoutText || '';
    const stderr = child.stderrText || '';
    if (pattern.test(`${stdout}\n${stderr}`)) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`relay exited early: ${stderr || stdout}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for output ${pattern}`);
}

function readGunOnce(node, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);
    node.once((data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(data ?? null);
    });
  });
}

async function putGunValueAndWaitForReadback(node, value, timeoutMs = 5_000) {
  node.put(value);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await readGunOnce(node, 500) === value) {
      return;
    }
  }
  throw new Error('gun-put-readback-timeout');
}

async function putGunObjectAndWaitForField(node, value, field, expected, timeoutMs = 5_000) {
  node.put(value);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const observed = await readGunOnce(node, 500);
    if (observed && typeof observed === 'object' && observed[field] === expected) {
      return;
    }
  }
  throw new Error('gun-object-put-readback-timeout');
}

function createRelayGunClient(port) {
  return Gun({
    peers: [`http://127.0.0.1:${port}/gun`],
    localStorage: false,
    radisk: false,
    file: path.join(os.tmpdir(), `vh-relay-client-${process.pid}-${port}-${Date.now()}-${Math.random()}`),
  });
}

function makeRelayNewsStory(storyId, latestActivityAt, sources) {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: storyId,
    topic_id: `topic-${storyId}`,
    headline: `Relay pagination story ${storyId}`,
    cluster_window_start: latestActivityAt - 10,
    cluster_window_end: latestActivityAt,
    sources,
    cluster_features: {
      entity_keys: [storyId],
      time_bucket: `tb-${storyId}`,
      semantic_signature: `sig-${storyId}`,
    },
    provenance_hash: `prov-${storyId}`,
    created_at: latestActivityAt - 20,
  };
}

async function writeRelayNewsStory(port, story) {
  expect(await requestJson(`http://127.0.0.1:${port}/vh/news/story`, {
    method: 'POST',
    body: {
      record: {
        __story_bundle_json: JSON.stringify(story),
        story_id: story.story_id,
        created_at: story.created_at,
        schemaVersion: story.schemaVersion,
      },
    },
  })).toMatchObject({
    statusCode: 200,
    body: expect.objectContaining({ ok: true, story_id: story.story_id }),
  });
}

async function writeRelayLatestIndexRecord(port, storyId, latestActivityAt) {
  expect(await requestJson(`http://127.0.0.1:${port}/vh/news/latest-index`, {
    method: 'POST',
    body: {
      record: {
        story_id: storyId,
        latest_activity_at: latestActivityAt,
      },
    },
  })).toMatchObject({
    statusCode: 200,
    body: expect.objectContaining({ ok: true, story_id: storyId }),
  });
}

async function writeRelayHotIndexRecord(port, storyId, hotness, metadata = {}) {
  expect(await requestJson(`http://127.0.0.1:${port}/vh/news/hot-index`, {
    method: 'POST',
    body: {
      record: {
        story_id: storyId,
        hotness,
        ...metadata,
      },
    },
  })).toMatchObject({
    statusCode: 200,
    body: expect.objectContaining({ ok: true, story_id: storyId }),
  });
}

describe('infra relay server', () => {
  const children = new Set();
  const tempDirs = new Set();

  afterEach(async () => {
    await Promise.all([...children].map((child) => new Promise((resolve) => {
      if (child.exitCode !== null) {
        children.delete(child);
        resolve();
        return;
      }
      child.once('exit', () => {
        children.delete(child);
        resolve();
      });
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL');
        }
      }, 2000);
    })));
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  it('binds to the configured loopback host', async () => {
    const { port } = await startRelay(children, tempDirs);
    const response = await fetchText(`http://127.0.0.1:${port}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('vh relay alive');
  });

  it('exposes health, readiness, and prometheus metrics', async () => {
    const { port } = await startRelay(children, tempDirs);

    await expect(requestJson(`http://127.0.0.1:${port}/healthz`)).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, service: 'vh-relay' }),
    });
    await expect(requestJson(`http://127.0.0.1:${port}/readyz`)).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, daemon_auth_configured: false }),
    });

    const metrics = await fetchText(`http://127.0.0.1:${port}/metrics`);
    expect(metrics.statusCode).toBe(200);
    expect(metrics.body).toContain('vh_relay_http_requests_total');
    expect(metrics.body).toContain('vh_relay_active_connections');
    expect(metrics.body).toContain('vh_relay_radata_bytes');
    expect(metrics.body).toMatch(/vh_relay_process_open_fds \d+/);
  });

  it('exposes explicit relay topology metadata when relay peers are configured', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_ID: 'relay-topology-test',
      VH_RELAY_PEERS: JSON.stringify(['http://127.0.0.1:7788/gun', 'http://127.0.0.1:7789/gun']),
      VH_RELAY_PEER_AUTH_MODE: 'private_network_allowlist',
      VH_RELAY_PEER_ALLOWLIST: 'loopback',
    });

    await expect(requestJson(`http://127.0.0.1:${port}/healthz`)).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        relay_id: 'relay-topology-test',
        relay_peer_count: 2,
        relay_peers_configured: true,
        relay_peer_auth_mode: 'private_network_allowlist',
      }),
    });
    await expect(requestJson(`http://127.0.0.1:${port}/vh/relay-peer/authz`)).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        relay_id: 'relay-topology-test',
        reason: 'relay-peer-private-network-allowed',
      }),
    });
  });

  it('rejects unauthorized relay peer websocket upgrades without weakening origin checks', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_ID: 'relay-peer-auth-test',
      VH_RELAY_PEER_AUTH_MODE: 'private_network_allowlist',
      VH_RELAY_PEER_ALLOWLIST: '10.255.255.255',
    });

    await expect(websocketUpgradeStatus(port)).resolves.toBe(403);
    await expect(requestJson(`http://127.0.0.1:${port}/vh/relay-peer/authz`)).resolves.toMatchObject({
      statusCode: 403,
      body: expect.objectContaining({
        ok: false,
        reason: 'relay-peer-private-network-rejected',
      }),
    });
  });

  it('rejects unauthenticated user graph injection and accepts signed user writes when auth is required', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'daemon-secret',
    });
    const body = {
      topic_id: 'topic-auth',
      synthesis_id: 'synthesis-auth',
      epoch: 1,
      voter_id: 'voter-auth',
      node: {
        point_id: 'point-auth',
        agreement: 1,
        weight: 1,
        updated_at: '2026-05-02T00:00:00.000Z',
      },
    };

    const rejected = await requestJson(`http://127.0.0.1:${port}/vh/aggregates/voter`, {
      method: 'POST',
      body,
    });
    expect(rejected).toMatchObject({
      statusCode: 401,
      body: expect.objectContaining({ ok: false, error: 'user-signature-required' }),
    });

    const pair = await SEA.pair();
    const accepted = await requestJson(`http://127.0.0.1:${port}/vh/aggregates/voter`, {
      method: 'POST',
      headers: await relaySignatureHeaders('/vh/aggregates/voter', body, pair),
      body,
    });
    expect(accepted).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: 'topic-auth',
        synthesis_id: 'synthesis-auth',
        voter_id: 'voter-auth',
        point_id: 'point-auth',
      }),
    });

    const metrics = await fetchText(`http://127.0.0.1:${port}/metrics`);
    expect(metrics.body).toContain('vh_relay_auth_rejects_total 1');
    expect(metrics.body).toContain('vh_relay_write_successes_total{route="/vh/aggregates/voter"} 1');
  });

  it('requires daemon bearer auth for synthesis injection when auth is required', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_AUTH_REQUIRED: 'true',
      VH_RELAY_DAEMON_TOKEN: 'daemon-secret',
    });
    const body = {
      synthesis: {
        schemaVersion: 'topic-synthesis-v2',
        topic_id: 'topic-daemon',
        synthesis_id: 'synthesis-daemon',
        epoch: 1,
        created_at: '2026-05-02T00:00:00.000Z',
      },
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis`, {
      method: 'POST',
      body,
    })).resolves.toMatchObject({
      statusCode: 401,
      body: expect.objectContaining({ ok: false, error: 'daemon-token-required' }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis`, {
      method: 'POST',
      headers: { authorization: 'Bearer daemon-secret' },
      body,
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: 'topic-daemon',
        synthesis_id: 'synthesis-daemon',
      }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis?topic_id=topic-daemon`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          topic_id: 'topic-daemon',
          synthesis_id: 'synthesis-daemon',
          record: expect.objectContaining({
            __topic_synthesis_json: expect.any(String),
          }),
        }),
      });

    const candidateBody = {
      candidate: {
        candidate_id: 'candidate-daemon',
        topic_id: 'topic-daemon',
        epoch: 1,
        created_at: 1_700_000_000_000,
      },
    };
    await expect(requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis-candidate`, {
      method: 'POST',
      body: candidateBody,
    })).resolves.toMatchObject({
      statusCode: 401,
      body: expect.objectContaining({ ok: false, error: 'daemon-token-required' }),
    });
    await expect(requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis-candidate`, {
      method: 'POST',
      headers: { authorization: 'Bearer daemon-secret' },
      body: candidateBody,
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: 'topic-daemon',
        epoch: 1,
        candidate_id: 'candidate-daemon',
      }),
    });
  });

  it('serves scalar-only topic synthesis records without waiting for a missing parent node', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_TOPIC_SYNTHESIS_REST_READ_TIMEOUT_MS: '800',
    });
    const gun = createRelayGunClient(port);
    const synthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-scalar-only',
      synthesis_id: 'synthesis-scalar-only',
      epoch: 1,
      created_at: '2026-05-02T00:00:00.000Z',
      facts_summary: 'Scalar-only topic synthesis remains available through the relay REST fallback.',
      frames: [],
      provenance: {
        candidate_ids: [],
        provider_mix: {},
      },
      warnings: [],
    };
    await putGunValueAndWaitForReadback(
      gun.get('vh').get('topics').get(synthesis.topic_id).get('latest').get('__topic_synthesis_json'),
      JSON.stringify(synthesis),
    );
    await expect(readGunOnce(
      gun.get('vh').get('topics').get(synthesis.topic_id).get('latest').get('__topic_synthesis_json'),
    )).resolves.toBe(JSON.stringify(synthesis));

    const startedAt = Date.now();
    await expect(requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis?topic_id=${synthesis.topic_id}`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          topic_id: synthesis.topic_id,
          synthesis_id: synthesis.synthesis_id,
          synthesis,
          record: expect.objectContaining({
            __topic_synthesis_json: JSON.stringify(synthesis),
          }),
        }),
      });
    expect(Date.now() - startedAt).toBeLessThan(800);
    gun.off();
  }, 15_000);

  it('serves topic synthesis rows from the relay snapshot after restart', async () => {
    const snapshotDir = mkdtempSync(path.join(os.tmpdir(), 'vh-relay-topic-synthesis-snapshot-test-'));
    tempDirs.add(snapshotDir);
    const gunFile = path.join(snapshotDir, 'data');
    const topicSynthesisSnapshotFile = path.join(snapshotDir, 'topic-synthesis-latest-snapshot.json');
    const env = {
      GUN_FILE: gunFile,
      VH_RELAY_TOPIC_SYNTHESIS_SNAPSHOT_FILE: topicSynthesisSnapshotFile,
    };
    const writer = await startRelay(children, tempDirs, env);
    const synthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-synthesis-snapshot',
      synthesis_id: 'synthesis-snapshot',
      epoch: 0,
      inputs: { story_bundle_ids: ['story-synthesis-snapshot'] },
      quorum: {
        required: 1,
        received: 1,
        reached_at: 1_700_000_000_000,
        timed_out: false,
        selection_rule: 'deterministic',
      },
      facts_summary: 'Snapshot-backed topic synthesis remains readable after relay restart.',
      frames: [
        {
          frame_point_id: 'frame-snapshot',
          frame: 'One frame',
          reframe_point_id: 'reframe-snapshot',
          reframe: 'One reframe',
        },
      ],
      warnings: [],
      divergence_metrics: {
        disagreement_score: 0,
        source_dispersion: 0,
        candidate_count: 1,
      },
      provenance: {
        candidate_ids: ['candidate-snapshot'],
        provider_mix: [{ provider_id: 'test', count: 1 }],
      },
      created_at: 1_700_000_000_000,
    };

    await expect(requestJson(`http://127.0.0.1:${writer.port}/vh/topics/synthesis`, {
      method: 'POST',
      body: { synthesis },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: synthesis.topic_id,
        synthesis_id: synthesis.synthesis_id,
      }),
    });

    await new Promise((resolve) => {
      if (writer.child.exitCode !== null) {
        resolve();
        return;
      }
      writer.child.once('exit', resolve);
      writer.child.kill('SIGTERM');
      setTimeout(() => {
        if (writer.child.exitCode === null) writer.child.kill('SIGKILL');
      }, 1_000);
    });
    children.delete(writer.child);
    const reader = await startRelay(children, tempDirs, env);

    await expect(requestJson(
      `http://127.0.0.1:${reader.port}/vh/topics/synthesis?topic_id=${synthesis.topic_id}`,
    )).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: synthesis.topic_id,
        synthesis_id: synthesis.synthesis_id,
        synthesis: expect.objectContaining({
          facts_summary: synthesis.facts_summary,
          frames: expect.arrayContaining([
            expect.objectContaining({
              frame_point_id: 'frame-snapshot',
              reframe_point_id: 'reframe-snapshot',
            }),
          ]),
        }),
        record: expect.objectContaining({
          __topic_synthesis_json: expect.any(String),
        }),
      }),
    });
  });

  it('preserves LUMA aggregate voter envelopes written through the relay fallback', async () => {
    const { port } = await startRelay(children, tempDirs);
    const voterId = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const payload = {
      schema_version: 'aggregate-voter-node-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'voter-v1',
      topic_id: 'topic-relay-luma',
      synthesis_id: 'synthesis-relay-luma',
      epoch: 7,
      voter_id: voterId,
      point_id: 'point-relay-luma',
      agreement: 1,
      weight: 1,
      updated_at: '2026-05-02T00:00:00.000Z',
    };
    const signedWriteEnvelope = {
      envelopeVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      protocolVersion: 'luma-write-v1',
      profile: 'public-beta',
      audience: 'vh-aggregate-voter',
      origin: `http://127.0.0.1:${port}`,
      scheme: 'voter-v1',
      publicAuthor: voterId,
      sessionRef: {
        tokenHash: 'token-hash',
        envelopeDigest: 'envelope-digest',
      },
      payload,
      payloadDigest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sequence: 1778990000000,
      nonce: '00112233445566778899aabbccddeeff',
      idempotencyKey: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      issuedAt: 1778990000000,
      signature: 'signature-relay',
    };
    const node = {
      ...payload,
      signedWriteEnvelope,
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/aggregates/voter`, {
      method: 'POST',
      body: {
        topic_id: payload.topic_id,
        synthesis_id: payload.synthesis_id,
        epoch: payload.epoch,
        voter_id: voterId,
        node,
      },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: payload.topic_id,
        synthesis_id: payload.synthesis_id,
        epoch: payload.epoch,
        voter_id: voterId,
        point_id: payload.point_id,
      }),
    });

    const gun = createRelayGunClient(port);
    const pointChain = gun.get('vh').get('aggregates').get('topics').get(payload.topic_id)
      .get('syntheses').get(payload.synthesis_id)
      .get('epochs').get(String(payload.epoch))
      .get('voters').get(voterId)
      .get(payload.point_id);
    const storedPoint = await readGunOnce(pointChain);
    const storedEnvelope = await readGunOnce(pointChain.get('signedWriteEnvelope'));
    const storedPayload = await readGunOnce(pointChain.get('signedWriteEnvelope').get('payload'));
    const storedSessionRef = await readGunOnce(pointChain.get('signedWriteEnvelope').get('sessionRef'));
    gun.off();

    expect(storedPoint).toMatchObject({
      ...payload,
      signedWriteEnvelope: { '#': `vh/aggregates/topics/${payload.topic_id}/syntheses/${payload.synthesis_id}/epochs/${payload.epoch}/voters/${voterId}/${payload.point_id}/signedWriteEnvelope` },
    });
    expect(storedEnvelope).toMatchObject({
      envelopeVersion: 1,
      audience: 'vh-aggregate-voter',
      publicAuthor: voterId,
      payload: { '#': `vh/aggregates/topics/${payload.topic_id}/syntheses/${payload.synthesis_id}/epochs/${payload.epoch}/voters/${voterId}/${payload.point_id}/signedWriteEnvelope/payload` },
      sessionRef: { '#': `vh/aggregates/topics/${payload.topic_id}/syntheses/${payload.synthesis_id}/epochs/${payload.epoch}/voters/${voterId}/${payload.point_id}/signedWriteEnvelope/sessionRef` },
    });
    expect(storedPayload).toMatchObject(payload);
    expect(storedSessionRef).toMatchObject(signedWriteEnvelope.sessionRef);
  });

  it('serves a read-only aggregate point snapshot from persisted voter rows', async () => {
    const { port } = await startRelay(children, tempDirs);
    const baseWrite = {
      topic_id: 'topic-aggregate-read',
      synthesis_id: 'synthesis-aggregate-read',
      epoch: 2,
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/aggregates/point-snapshot`, {
      method: 'POST',
      body: {
        snapshot: {
          schema_version: 'point-aggregate-snapshot-v1',
          ...baseWrite,
          point_id: 'point-readable',
          agree: 1,
          disagree: 0,
          weight: 1,
          participants: 1,
          version: 1,
          computed_at: 1,
          source_window: { from_seq: 1, to_seq: 1 },
        },
      },
    })).resolves.toMatchObject({ statusCode: 200, body: expect.objectContaining({ ok: true }) });

    for (const [voter_id, agreement, updated_at] of [
      ['voter-one', 1, '2026-05-02T00:00:00.000Z'],
      ['voter-two', 1, '2026-05-02T00:01:00.000Z'],
      ['voter-three', -1, '2026-05-02T00:02:00.000Z'],
    ]) {
      await expect(requestJson(`http://127.0.0.1:${port}/vh/aggregates/voter`, {
        method: 'POST',
        body: {
          ...baseWrite,
          voter_id,
          node: {
            point_id: 'point-readable',
            agreement,
            weight: 1,
            updated_at,
          },
        },
      })).resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({ ok: true, voter_id }),
      });
    }

    const aggregateReadUrl = `http://127.0.0.1:${port}/vh/aggregates/point?topic_id=topic-aggregate-read&synthesis_id=synthesis-aggregate-read&epoch=2&point_id=point-readable`;
    const firstRead = await requestJson(aggregateReadUrl);
    expect(firstRead).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: 'topic-aggregate-read',
        synthesis_id: 'synthesis-aggregate-read',
        epoch: 2,
        point_id: 'point-readable',
        row_count: 3,
        aggregate: {
          point_id: 'point-readable',
          agree: 2,
          disagree: 1,
          weight: 3,
          participants: 3,
        },
        snapshot: expect.objectContaining({
          point_id: 'point-readable',
          participants: 1,
        }),
      }),
    });

    const cachedRead = await requestJson(aggregateReadUrl);
    expect(cachedRead).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        cached: true,
        row_count: 3,
        aggregate: expect.objectContaining({
          agree: 2,
          disagree: 1,
          participants: 3,
        }),
      }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/aggregates/voter`, {
      method: 'POST',
      body: {
        ...baseWrite,
        voter_id: 'voter-four',
        node: {
          point_id: 'point-readable',
          agreement: 1,
          weight: 1,
          updated_at: '2026-05-02T00:03:00.000Z',
        },
      },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, voter_id: 'voter-four' }),
    });

    await expect(requestJson(aggregateReadUrl)).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        cached: false,
        row_count: 4,
        aggregate: expect.objectContaining({
          agree: 3,
          disagree: 1,
          participants: 4,
        }),
      }),
    });
  });

  it('reads signed forum threads through the relay fallback endpoint', async () => {
    const { port } = await startRelay(children, tempDirs);
    const thread = {
      id: 'thread-relay-signed',
      schemaVersion: 'hermes-thread-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      title: 'Relay fallback thread',
      content: 'Thread metadata remains readable after reload.',
      author: 'author-relay',
      timestamp: 1778990000000,
      tags: JSON.stringify(['news']),
      upvotes: 0,
      downvotes: 0,
      score: 0,
      topicId: 'topic-relay',
      isHeadline: true,
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/forum/thread`, {
      method: 'POST',
      body: { thread: { ...thread, __thread_json: JSON.stringify({ ...thread, tags: ['news'] }) } },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        thread_id: 'thread-relay-signed',
      }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/forum/thread?thread_id=thread-relay-signed`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          thread_id: 'thread-relay-signed',
          thread: expect.objectContaining({
            id: 'thread-relay-signed',
            title: 'Relay fallback thread',
            isHeadline: true,
          }),
        }),
      });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/forum/thread`))
      .resolves.toMatchObject({
        statusCode: 400,
        body: expect.objectContaining({
          ok: false,
          error: 'thread_id-required',
        }),
      });
  });

  it('validates news story relay fallback endpoint inputs and missing stories', async () => {
    const { port } = await startRelay(children, tempDirs);

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/story`))
      .resolves.toMatchObject({
        statusCode: 400,
        body: expect.objectContaining({
          ok: false,
          error: 'story_id-required',
        }),
      });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/story?story_id=story-missing`))
      .resolves.toMatchObject({
        statusCode: 404,
        body: expect.objectContaining({
          ok: false,
          error: 'news-story-not-found',
          story_id: 'story-missing',
        }),
      });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/latest-index`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          record_count: 0,
          records: {},
        }),
      });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: {},
    })).resolves.toMatchObject({
      statusCode: 400,
      body: expect.objectContaining({
        ok: false,
        error: 'news-synthesis-lifecycle-record-required',
      }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`))
      .resolves.toMatchObject({
        statusCode: 400,
        body: expect.objectContaining({
          ok: false,
          error: 'story_id-required',
        }),
      });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle?story_id=story-missing`))
      .resolves.toMatchObject({
        statusCode: 404,
        body: expect.objectContaining({
          ok: false,
          error: 'news-synthesis-lifecycle-not-found',
          story_id: 'story-missing',
        }),
      });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: {
        record: {
          schemaVersion: 'vh-news-synthesis-lifecycle-v1',
          story_id: 'story-private-lifecycle',
          topic_id: 'topic-private-lifecycle',
          source_set_revision: 'source-set-private',
          source_count: 1,
          canonical_source_count: 1,
          status: 'pending',
          frame_table_state: 'frame_table_pending',
          retryable: false,
          updated_at: 1,
          sessionRef: 'private-session',
        },
      },
    })).resolves.toMatchObject({
      statusCode: 400,
      body: expect.objectContaining({
        ok: false,
        error: 'news-synthesis-lifecycle-record-private-field',
      }),
    });
  });

  it('serves synthesis lifecycle rows from the relay snapshot after restart', async () => {
    const snapshotDir = mkdtempSync(path.join(os.tmpdir(), 'vh-relay-lifecycle-snapshot-test-'));
    tempDirs.add(snapshotDir);
    const gunFile = path.join(snapshotDir, 'data');
    const lifecycleSnapshotFile = path.join(snapshotDir, 'news-synthesis-lifecycle-snapshot.json');
    const env = {
      GUN_FILE: gunFile,
      VH_RELAY_NEWS_LIFECYCLE_SNAPSHOT_FILE: lifecycleSnapshotFile,
    };
    const writer = await startRelay(children, tempDirs, env);
    const record = {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: 'story-lifecycle-snapshot',
      topic_id: 'topic-lifecycle-snapshot',
      source_set_revision: 'source-set-lifecycle-snapshot',
      source_count: 2,
      canonical_source_count: 2,
      status: 'accepted_available',
      retryable: false,
      frame_table_state: 'frame_table_ready',
      synthesis_id: 'synthesis-lifecycle-snapshot',
      epoch: 0,
      updated_at: 1_700_000_000_000,
    };

    await expect(requestJson(`http://127.0.0.1:${writer.port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: { record },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        story_id: record.story_id,
        status: record.status,
      }),
    });

    await new Promise((resolve) => {
      if (writer.child.exitCode !== null) {
        resolve();
        return;
      }
      writer.child.once('exit', resolve);
      writer.child.kill('SIGTERM');
      setTimeout(() => {
        if (writer.child.exitCode === null) writer.child.kill('SIGKILL');
      }, 1_000);
    });
    children.delete(writer.child);
    const reader = await startRelay(children, tempDirs, env);

    await expect(requestJson(
      `http://127.0.0.1:${reader.port}/vh/news/synthesis-lifecycle?story_id=${record.story_id}`,
    )).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        story_id: record.story_id,
        status: record.status,
        frame_table_state: record.frame_table_state,
        record: expect.objectContaining({
          synthesis_id: record.synthesis_id,
        }),
      }),
    });
  });

  it('persists signed news story and index records through the relay fallback writer', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '3',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_LIFECYCLE_REST_READ_TIMEOUT_MS: '500',
    });
    const story = makeRelayNewsStory('story-signed-relay', 1778991000000, [
      {
        source_id: 'ap-topnews',
        publisher: 'AP',
        url: 'https://example.com/signed-relay',
        url_hash: 'signed-relay',
        published_at: 1778991000000,
        title: 'Signed relay story',
      },
    ]);
    const signedFields = {
      _system: null,
      _Signature: null,
      _WriterId: null,
      _IssuedAt: null,
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'system',
      _systemWriterId: 'vh-public-beta-news-system-writer-test',
      _systemIssuedAt: 1778991000100,
      _systemSignature: 'test-signature',
    };
    const storyRecord = {
      __story_bundle_json: JSON.stringify(story),
      story_id: story.story_id,
      created_at: story.created_at,
      schemaVersion: story.schemaVersion,
      ...signedFields,
    };
    const latestRecord = {
      story_id: story.story_id,
      latest_activity_at: story.cluster_window_end,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: story.sources.length,
      canonical_source_count: story.sources.length,
      story_created_at: story.created_at,
      cluster_window_start: story.cluster_window_start,
      ...signedFields,
    };
    const lifecycleRecord = {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: story.sources.length,
      canonical_source_count: story.sources.length,
      status: 'pending',
      frame_table_state: 'frame_table_pending',
      retryable: false,
      updated_at: 1778991000200,
      ...signedFields,
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/story`, {
      method: 'POST',
      body: { record: storyRecord },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id }),
    });
    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/latest-index`, {
      method: 'POST',
      body: { record: latestRecord },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id }),
    });
    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: { record: lifecycleRecord },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id, status: 'pending' }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/story?story_id=${story.story_id}`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          story_id: story.story_id,
          story: expect.objectContaining({
            story_id: story.story_id,
            provenance_hash: story.provenance_hash,
          }),
        }),
      });
    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/latest-index?limit=3&include_root=true`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          records: expect.objectContaining({
            [story.story_id]: expect.objectContaining({
              _systemWriterId: 'vh-public-beta-news-system-writer-test',
              _writerKind: 'system',
              story_id: story.story_id,
            }),
          }),
          story_states: expect.objectContaining({
            [story.story_id]: expect.objectContaining({
              synthesis_state: 'synthesis_pending',
              frame_table_state: 'frame_table_pending',
            }),
          }),
        }),
      });
  });

  it('bounds latest-index relay fallback response shape and omits the root unless requested', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '2',
    });

    const bounded = await requestJson(`http://127.0.0.1:${port}/vh/news/latest-index`);
    expect(bounded).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        record_count: expect.any(Number),
        source_key_count: expect.any(Number),
        truncated: expect.any(Boolean),
        records: expect.any(Object),
      }),
    });
    expect(bounded.body.record_count).toBeLessThanOrEqual(2);
    expect(bounded.body).not.toHaveProperty('root');

    const limited = await requestJson(`http://127.0.0.1:${port}/vh/news/latest-index?limit=1`);
    expect(limited).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        record_count: expect.any(Number),
        records: expect.any(Object),
      }),
    });
    expect(limited.body.record_count).toBeLessThanOrEqual(1);

    const withRoot = await requestJson(`http://127.0.0.1:${port}/vh/news/latest-index?limit=1&include_root=true`);
    expect(withRoot).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        root: expect.any(Object),
      }),
    });
  });

  it('serves bounded hot-index relay fallback rows ordered by hotness', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_HOT_INDEX_REST_MAX_RECORDS: '2',
      VH_RELAY_NEWS_HOT_INDEX_REST_SCAN_RECORDS: '3',
      VH_RELAY_NEWS_HOT_INDEX_REST_ROOT_SCAN_RECORDS: '3',
    });
    const gun = createRelayGunClient(port);
    const hotIndexRoot = gun.get('vh').get('news').get('index').get('hot');
    await putGunValueAndWaitForReadback(hotIndexRoot.get('story-warm'), 0.25);
    await putGunValueAndWaitForReadback(hotIndexRoot.get('story-hot'), 0.91);
    await putGunValueAndWaitForReadback(hotIndexRoot.get('story-cold'), 0.1);

    let hot = null;
    const hotUrl = `http://127.0.0.1:${port}/vh/news/hot-index?limit=2`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      hot = await requestJson(hotUrl);
      if (
        hot.body?.record_count === 2
        && hot.body?.records?.['story-hot']?.hotness === 0.91
        && hot.body?.records?.['story-warm']?.hotness === 0.25
      ) {
        break;
      }
      await delay(100);
    }

    expect(hot).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        record_count: 2,
        source_key_count: 3,
        scanned_key_count: 3,
        truncated: true,
        records: {
          'story-hot': expect.objectContaining({ story_id: 'story-hot', hotness: 0.91 }),
          'story-warm': expect.objectContaining({ story_id: 'story-warm', hotness: 0.25 }),
        },
      }),
    });
    expect(hot.body.records).not.toHaveProperty('story-cold');

    const withRoot = await requestJson(`http://127.0.0.1:${port}/vh/news/hot-index?limit=1&include_root=true`);
    expect(withRoot).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        root: expect.any(Object),
      }),
    });
    gun.off();
  }, 10_000);

  it('accepts daemon hot-index writes with product metadata', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_HOT_INDEX_REST_MAX_RECORDS: '4',
    });
    const story = makeRelayNewsStory('story-hot-product', 200, [
      {
        source_id: 'src-hot-product',
        publisher: 'Hot Product Source',
        url: 'https://example.com/hot-product',
        url_hash: 'hash-hot-product',
        published_at: 190,
        title: 'Hot product story',
      },
    ]);
    await writeRelayHotIndexRecord(port, story.story_id, 0.73, {
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: story.sources.length,
      canonical_source_count: story.sources.length,
      story_created_at: story.created_at,
      cluster_window_start: story.cluster_window_start,
    });

    let hot = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      hot = await requestJson(`http://127.0.0.1:${port}/vh/news/hot-index?limit=4`);
      if (hot.body?.records?.[story.story_id]?.product_state_schema_version === 'vh-news-product-feed-index-v1') {
        break;
      }
      await delay(100);
    }

    expect(hot).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        records: {
          [story.story_id]: expect.objectContaining({
            story_id: story.story_id,
            hotness: 0.73,
            product_state_schema_version: 'vh-news-product-feed-index-v1',
            source_set_revision: story.provenance_hash,
          }),
        },
      }),
    });
  }, 10_000);

  it('derives product hot-index rows from verified latest-index stories when hot root is sparse', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_HOT_INDEX_REST_MAX_RECORDS: '2',
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '2',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '4',
      VH_RELAY_NEWS_INDEX_REST_STORY_FALLBACK: 'true',
    });
    const bundled = makeRelayNewsStory('story-hot-fallback-bundle', 500, [
      {
        source_id: 'src-hot-fallback-a',
        publisher: 'Hot Fallback Source A',
        url: 'https://example.com/hot-fallback-a',
        url_hash: 'hash-hot-fallback-a',
        published_at: 480,
        title: 'Hot fallback A',
      },
      {
        source_id: 'src-hot-fallback-b',
        publisher: 'Hot Fallback Source B',
        url: 'https://example.com/hot-fallback-b',
        url_hash: 'hash-hot-fallback-b',
        published_at: 490,
        title: 'Hot fallback B',
      },
    ]);
    const singleton = makeRelayNewsStory('story-hot-fallback-singleton', 490, [
      {
        source_id: 'src-hot-fallback-singleton',
        publisher: 'Hot Fallback Singleton',
        url: 'https://example.com/hot-fallback-singleton',
        url_hash: 'hash-hot-fallback-singleton',
        published_at: 485,
        title: 'Hot fallback singleton',
      },
    ]);
    await writeRelayNewsStory(port, bundled);
    await writeRelayNewsStory(port, singleton);
    await writeRelayLatestIndexRecord(port, bundled.story_id, bundled.cluster_window_end);
    await writeRelayLatestIndexRecord(port, singleton.story_id, singleton.cluster_window_end);

    let hot = null;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      hot = await requestJson(`http://127.0.0.1:${port}/vh/news/hot-index?limit=2&scan_limit=4`);
      if (
        hot.body?.record_count === 2
        && hot.body?.records?.[bundled.story_id]?.product_state_schema_version === 'vh-news-product-feed-index-v1'
        && hot.body?.records?.[singleton.story_id]?.product_state_schema_version === 'vh-news-product-feed-index-v1'
      ) {
        break;
      }
      await delay(100);
    }

    expect(hot).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        record_count: 2,
        source_key_count: 0,
        latest_fallback: expect.objectContaining({
          attempted: true,
          added_count: 2,
        }),
        records: {
          [bundled.story_id]: expect.objectContaining({
            story_id: bundled.story_id,
            product_state_schema_version: 'vh-news-product-feed-index-v1',
            source_count: 2,
            canonical_source_count: 2,
            source_set_revision: bundled.provenance_hash,
          }),
          [singleton.story_id]: expect.objectContaining({
            story_id: singleton.story_id,
            product_state_schema_version: 'vh-news-product-feed-index-v1',
            source_count: 1,
            canonical_source_count: 1,
            source_set_revision: singleton.provenance_hash,
          }),
        },
      }),
    });
    expect(hot.body.records[bundled.story_id].hotness).toEqual(expect.any(Number));
    expect(hot.body.records[singleton.story_id].hotness).toEqual(expect.any(Number));
  }, 10_000);

  it('bounds stale hot-root scans and still derives product hot rows from latest stories', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_HOT_INDEX_REST_MAX_RECORDS: '2',
      VH_RELAY_NEWS_HOT_INDEX_REST_SCAN_RECORDS: '20',
      VH_RELAY_NEWS_HOT_INDEX_REST_ROOT_SCAN_RECORDS: '1',
      VH_RELAY_NEWS_HOT_INDEX_REST_CHILD_TIMEOUT_MS: '100',
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '2',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '2',
      VH_RELAY_NEWS_INDEX_REST_STORY_FALLBACK: 'true',
    });
    const gun = createRelayGunClient(port);
    try {
      for (let index = 0; index < 4; index += 1) {
        await putGunObjectAndWaitForField(
          gun.get('vh').get('news').get('index').get('hot').get(`story-stale-hot-${index}`),
          { stale_marker: `legacy-${index}` },
          'stale_marker',
          `legacy-${index}`,
        );
      }
      const first = makeRelayNewsStory('story-hot-bounded-first', 600, [
        {
          source_id: 'src-hot-bounded-first',
          publisher: 'Hot Bounded First',
          url: 'https://example.com/hot-bounded-first',
          url_hash: 'hash-hot-bounded-first',
          published_at: 590,
          title: 'Hot bounded first',
        },
      ]);
      const second = makeRelayNewsStory('story-hot-bounded-second', 590, [
        {
          source_id: 'src-hot-bounded-second-a',
          publisher: 'Hot Bounded Second A',
          url: 'https://example.com/hot-bounded-second-a',
          url_hash: 'hash-hot-bounded-second-a',
          published_at: 585,
          title: 'Hot bounded second A',
        },
        {
          source_id: 'src-hot-bounded-second-b',
          publisher: 'Hot Bounded Second B',
          url: 'https://example.com/hot-bounded-second-b',
          url_hash: 'hash-hot-bounded-second-b',
          published_at: 590,
          title: 'Hot bounded second B',
        },
      ]);
      await writeRelayNewsStory(port, first);
      await writeRelayNewsStory(port, second);
      await writeRelayLatestIndexRecord(port, first.story_id, first.cluster_window_end);
      await writeRelayLatestIndexRecord(port, second.story_id, second.cluster_window_end);

      const hot = await requestJson(`http://127.0.0.1:${port}/vh/news/hot-index?limit=2&scan_limit=20`);
      expect(hot).toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          record_count: 2,
          scanned_key_count: expect.any(Number),
          latest_fallback: expect.objectContaining({
            attempted: true,
            added_count: 2,
          }),
          records: {
            [first.story_id]: expect.objectContaining({
              story_id: first.story_id,
              product_state_schema_version: 'vh-news-product-feed-index-v1',
            }),
            [second.story_id]: expect.objectContaining({
              story_id: second.story_id,
              product_state_schema_version: 'vh-news-product-feed-index-v1',
              source_count: 2,
            }),
          },
        }),
      });
      expect(hot.body.scanned_key_count).toBeLessThanOrEqual(1);
    } finally {
      gun.off();
    }
  }, 15_000);

  it('serves older latest-index windows with an exclusive before cursor', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '3',
    });
    const gun = createRelayGunClient(port);
    const latestIndexRoot = gun.get('vh').get('news').get('index').get('latest');
    await putGunValueAndWaitForReadback(latestIndexRoot.get('story-new'), 300);
    await putGunValueAndWaitForReadback(latestIndexRoot.get('story-mid'), 200);
    await putGunValueAndWaitForReadback(latestIndexRoot.get('story-old'), 100);

    let latest = null;
    const latestUrl = `http://127.0.0.1:${port}/vh/news/latest-index?limit=2&before=250&consistency=false`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < 5_000) {
      latest = await requestJson(latestUrl);
      if (
        latest.body?.record_count === 2
        && latest.body?.records?.['story-mid'] === 200
        && latest.body?.records?.['story-old'] === 100
      ) {
        break;
      }
      await delay(100);
    }

    expect(latest).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        before: 250,
        record_count: 2,
        window_source_key_count: 2,
        next_cursor: 100,
        records: {
          'story-mid': 200,
          'story-old': 100,
        },
      }),
    });
    expect(latest.body.records).not.toHaveProperty('story-new');
    gun.off();
  }, 10_000);

  it('serves production-filtered older latest-index windows with composition and story states', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '2',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '6',
      VH_RELAY_NEWS_INDEX_REST_CONCURRENCY: '2',
      VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_INDEX_REST_MAP_FALLBACK: 'true',
    });
    const stories = [
      makeRelayNewsStory('story-new', 300, [
        {
          source_id: 'source-a',
          publisher: 'Source A',
          url: 'https://example.com/new-a',
          url_hash: 'hash-new-a',
          published_at: 290,
          title: 'New A',
        },
        {
          source_id: 'source-b',
          publisher: 'Source B',
          url: 'https://example.com/new-b',
          url_hash: 'hash-new-b',
          published_at: 300,
          title: 'New B',
        },
      ]),
      makeRelayNewsStory('story-mid', 200, [
        {
          source_id: 'source-c',
          publisher: 'Source C',
          url: 'https://example.com/mid',
          url_hash: 'hash-mid',
          published_at: 200,
          title: 'Mid',
        },
      ]),
      makeRelayNewsStory('story-old', 100, [
        {
          source_id: 'source-d',
          publisher: 'Source D',
          url: 'https://example.com/old-a',
          url_hash: 'hash-old-a',
          published_at: 90,
          title: 'Old A',
        },
        {
          source_id: 'source-e',
          publisher: 'Source E',
          url: 'https://example.com/old-b',
          url_hash: 'hash-old-b',
          published_at: 100,
          title: 'Old B',
        },
      ]),
    ];
    for (const story of stories) {
      await writeRelayNewsStory(port, story);
      await writeRelayLatestIndexRecord(port, story.story_id, story.cluster_window_end);
    }

    let firstPage;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      firstPage = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=2&scan_limit=6&include_excluded=true`,
      );
      if (
        firstPage.body?.records?.['story-new']
        && firstPage.body?.records?.['story-mid']
        && firstPage.body?.story_states?.['story-new']
        && firstPage.body?.story_states?.['story-mid']
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(firstPage).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        record_count: 2,
        source_key_count: 3,
        window_source_key_count: 3,
        scanned_key_count: 3,
        truncated: true,
        next_cursor: 200,
        records: expect.objectContaining({
          'story-new': expect.objectContaining({
            story_id: 'story-new',
            product_state_schema_version: 'vh-news-product-feed-index-v1',
            source_count: 2,
          }),
          'story-mid': expect.objectContaining({
            story_id: 'story-mid',
            product_state_schema_version: 'vh-news-product-feed-index-v1',
            source_count: 1,
          }),
        }),
        stories: expect.objectContaining({
          'story-new': expect.objectContaining({
            story_id: 'story-new',
            headline: expect.any(String),
          }),
          'story-mid': expect.objectContaining({
            story_id: 'story-mid',
            headline: expect.any(String),
          }),
        }),
        story_states: expect.objectContaining({
          'story-new': expect.objectContaining({
            synthesis_state: 'synthesis_pending',
            frame_table_state: 'frame_table_pending',
          }),
          'story-mid': expect.objectContaining({
            synthesis_state: 'synthesis_pending',
            frame_table_state: 'frame_table_pending',
          }),
        }),
        composition: expect.objectContaining({
          total_visible: 2,
          singleton_visible: 1,
          multi_source_visible: 1,
          pending_synthesis: 2,
        }),
        repaired_records: expect.arrayContaining([
          expect.objectContaining({
            story_id: 'story-new',
            reason: 'latest_index_product_metadata_missing_from_story_body',
          }),
          expect.objectContaining({
            story_id: 'story-mid',
            reason: 'latest_index_product_metadata_missing_from_story_body',
          }),
        ]),
      }),
    });
    expect(firstPage.body.records).not.toHaveProperty('story-old');

    const secondPage = await requestJson(
      `http://127.0.0.1:${port}/vh/news/latest-index?limit=2&before=${firstPage.body.next_cursor}&scan_limit=6&include_excluded=true`,
    );
    expect(secondPage).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        before: 200,
        record_count: 1,
        source_key_count: 3,
        window_source_key_count: 1,
        next_cursor: 100,
        records: {
          'story-old': expect.objectContaining({
            story_id: 'story-old',
            product_state_schema_version: 'vh-news-product-feed-index-v1',
            source_count: 2,
          }),
        },
        story_states: {
          'story-old': expect.objectContaining({
            synthesis_state: 'synthesis_pending',
            frame_table_state: 'frame_table_pending',
          }),
        },
        composition: expect.objectContaining({
          total_visible: 1,
          singleton_visible: 0,
          multi_source_visible: 1,
          pending_synthesis: 1,
        }),
      }),
    });
    expect(secondPage.body.records).not.toHaveProperty('story-new');
    expect(secondPage.body.records).not.toHaveProperty('story-mid');
  }, 60_000);

  it('backfills a corroborated story into the initial latest-index window without moving the pagination cursor', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '4',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '4',
      VH_RELAY_NEWS_INDEX_REST_CONCURRENCY: '2',
      VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_INDEX_REST_MAP_FALLBACK: 'true',
    });
    const stories = [
      makeRelayNewsStory('story-new-singleton', 400, [
        {
          source_id: 'source-new',
          publisher: 'Source New',
          url: 'https://example.com/new-singleton',
          url_hash: 'hash-new-singleton',
          published_at: 400,
          title: 'New singleton',
        },
      ]),
      makeRelayNewsStory('story-mid-singleton', 300, [
        {
          source_id: 'source-mid',
          publisher: 'Source Mid',
          url: 'https://example.com/mid-singleton',
          url_hash: 'hash-mid-singleton',
          published_at: 300,
          title: 'Mid singleton',
        },
      ]),
      makeRelayNewsStory('story-old-bundle', 200, [
        {
          source_id: 'source-old-a',
          publisher: 'Source Old A',
          url: 'https://example.com/old-bundle-a',
          url_hash: 'hash-old-bundle-a',
          published_at: 190,
          title: 'Old bundle A',
        },
        {
          source_id: 'source-old-b',
          publisher: 'Source Old B',
          url: 'https://example.com/old-bundle-b',
          url_hash: 'hash-old-bundle-b',
          published_at: 200,
          title: 'Old bundle B',
        },
      ]),
    ];
    for (const story of stories) {
      await writeRelayNewsStory(port, story);
      await writeRelayLatestIndexRecord(port, story.story_id, story.cluster_window_end);
    }

    let firstPage;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      firstPage = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=2&scan_limit=4&include_excluded=true`,
      );
      if (
        firstPage.body?.records?.['story-new-singleton']
        && firstPage.body?.records?.['story-mid-singleton']
        && firstPage.body?.records?.['story-old-bundle']
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(firstPage).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        record_count: 3,
        source_key_count: 3,
        truncated: true,
        next_cursor: 300,
        records: expect.objectContaining({
          'story-new-singleton': expect.objectContaining({
            story_id: 'story-new-singleton',
            source_count: 1,
          }),
          'story-mid-singleton': expect.objectContaining({
            story_id: 'story-mid-singleton',
            source_count: 1,
          }),
          'story-old-bundle': expect.objectContaining({
            story_id: 'story-old-bundle',
            source_count: 2,
          }),
        }),
        composition: expect.objectContaining({
          total_visible: 3,
          singleton_visible: 2,
          multi_source_visible: 1,
        }),
        composition_backfill_records: [
          expect.objectContaining({
            story_id: 'story-old-bundle',
            reason: 'freshest_visible_corroborated_story_backfilled_for_mixed_feed_window',
            source_count: 2,
            latest_activity_at: 200,
          }),
        ],
      }),
    });
  }, 60_000);

  it('filters latest-index rows whose story body is unavailable and reports repair evidence', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '4',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '4',
      VH_RELAY_NEWS_INDEX_REST_CONCURRENCY: '2',
      VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_INDEX_REST_MAP_FALLBACK: 'true',
    });
    const goodStory = {
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-good',
      topic_id: 'topic-good',
      headline: 'Good story',
      cluster_window_start: 100,
      cluster_window_end: 200,
      sources: [
        {
          source_id: 'src-good',
          publisher: 'Good Source',
          url: 'https://example.com/good',
          url_hash: 'hash-good',
          published_at: 100,
          title: 'Good story source',
        },
      ],
      cluster_features: {
        entity_keys: ['good'],
        time_bucket: 'tb-good',
        semantic_signature: 'sig-good',
      },
      provenance_hash: 'prov-good',
      created_at: 100,
    };
    await writeRelayNewsStory(port, goodStory);
    await writeRelayLatestIndexRecord(port, 'story-missing', 300);
    await writeRelayLatestIndexRecord(port, 'story-good', 200);

    let storyReadback;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      storyReadback = await requestJson(
        `http://127.0.0.1:${port}/vh/news/story?story_id=story-good`,
      );
      if (storyReadback.body?.story?.story_id === 'story-good') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(storyReadback).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        story: expect.objectContaining({ story_id: 'story-good' }),
      }),
    });

    let latest;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      latest = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=4&scan_limit=4&include_excluded=true`,
      );
      if (latest.body?.records?.['story-good']) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(latest).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        consistency: expect.objectContaining({
          enabled: true,
          mode: 'relay_visible_filter',
          excluded_count: 1,
        }),
        records: expect.objectContaining({
          'story-good': expect.anything(),
        }),
        story_states: expect.objectContaining({
          'story-good': expect.objectContaining({
            synthesis_state: 'synthesis_pending',
            frame_table_state: 'frame_table_pending',
            lifecycle_status: 'pending',
          }),
        }),
        composition: expect.objectContaining({
          total_visible: 1,
          singleton_visible: 1,
          pending_synthesis: 1,
        }),
        excluded_records: [
          expect.objectContaining({
            story_id: 'story-missing',
            reason: 'story_body_missing',
          }),
        ],
        repaired_records: [
          expect.objectContaining({
            story_id: 'story-good',
            reason: 'latest_index_product_metadata_missing_from_story_body',
            latest_activity_at: 200,
          }),
        ],
      }),
    });
    const goodRecord = latest.body.records['story-good'];
    expect(goodRecord).toMatchObject({
      story_id: 'story-good',
      latest_activity_at: 200,
      product_state_schema_version: 'vh-news-product-feed-index-v1',
      topic_id: goodStory.topic_id,
      source_set_revision: goodStory.provenance_hash,
      source_count: 1,
      canonical_source_count: 1,
      story_created_at: 100,
      cluster_window_start: 100,
    });
    expect(latest.body.records).not.toHaveProperty('story-missing');
  }, 30_000);

  it('does not mark stale topic synthesis accepted until lifecycle matches the current story source-set revision', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_CONCURRENCY: '2',
      VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS: '250',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '250',
      VH_RELAY_NEWS_LIFECYCLE_REST_READ_TIMEOUT_MS: '250',
      VH_RELAY_TOPIC_SYNTHESIS_REST_READ_TIMEOUT_MS: '250',
      VH_RELAY_NEWS_INDEX_REST_MAP_FALLBACK: 'true',
    });
    const story = {
      schemaVersion: 'story-bundle-v0',
      story_id: 'story-grown',
      topic_id: 'topic-grown',
      headline: 'Grown story',
      cluster_window_start: 100,
      cluster_window_end: 300,
      sources: [
        { source_id: 'src-a', publisher: 'A', url: 'https://example.com/a', url_hash: 'hash-a', published_at: 100, title: 'Grown story first source' },
        { source_id: 'src-b', publisher: 'B', url: 'https://example.com/b', url_hash: 'hash-b', published_at: 300, title: 'Grown story second source' },
      ],
      cluster_features: {
        entity_keys: ['grown', 'story'],
        time_bucket: 'tb-1',
        semantic_signature: 'sig-grown',
      },
      provenance_hash: 'prov-current',
      created_at: 100,
    };
    const acceptedSynthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: story.topic_id,
      synthesis_id: 'syn-old',
      epoch: 1,
      inputs: { story_bundle_ids: [story.story_id] },
      facts_summary: 'Accepted synthesis from the prior source-set revision.',
      frames: [{
        frame: 'Frame',
        reframe: 'Reframe',
        frame_point_id: 'syn-old:0:frame',
        reframe_point_id: 'syn-old:0:reframe',
      }],
      provenance: {
        candidate_ids: ['cand-old'],
        provider_mix: [{ provider_id: 'remote-analysis', count: 1 }],
      },
      quorum: {
        required: 1,
        received: 1,
        reached_at: 300,
        timed_out: false,
        selection_rule: 'deterministic',
      },
      divergence_metrics: {
        disagreement_score: 0,
        source_dispersion: 1,
        candidate_count: 1,
      },
      warnings: [],
      created_at: 300,
    };
    expect(await requestJson(`http://127.0.0.1:${port}/vh/news/story`, {
      method: 'POST',
      body: {
        record: {
          __story_bundle_json: JSON.stringify(story),
          story_id: story.story_id,
          created_at: story.created_at,
          schemaVersion: story.schemaVersion,
        },
      },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id }),
    });
    expect(await requestJson(`http://127.0.0.1:${port}/vh/news/latest-index`, {
      method: 'POST',
      body: {
        record: {
          story_id: story.story_id,
          latest_activity_at: story.cluster_window_end,
          product_state_schema_version: 'vh-news-product-feed-index-v1',
          topic_id: story.topic_id,
          source_set_revision: story.provenance_hash,
          source_count: 2,
          canonical_source_count: 2,
          story_created_at: story.created_at,
          cluster_window_start: story.cluster_window_start,
        },
      },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id }),
    });
    expect(await requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis`, {
      method: 'POST',
      body: { synthesis: acceptedSynthesis },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: story.topic_id,
        synthesis_id: acceptedSynthesis.synthesis_id,
      }),
    });
    const pendingLifecycle = {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: 2,
      canonical_source_count: 2,
      status: 'pending',
      frame_table_state: 'frame_table_pending',
      retryable: false,
      synthesis_id: 'syn-old',
      epoch: 1,
      updated_at: 301,
    };
    expect(await requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: { record: pendingLifecycle },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id, status: 'pending' }),
    });

    let pending;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      pending = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=3&scan_limit=3&include_excluded=true`,
      );
      if (pending.body?.story_states?.[story.story_id]) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(pending.body.story_states[story.story_id]).toMatchObject({
      synthesis_state: 'synthesis_pending',
      frame_table_state: 'frame_table_pending',
      lifecycle_status: 'pending',
    });
    expect(pending.body.composition).toMatchObject({
      total_visible: 1,
      multi_source_visible: 1,
      pending_synthesis: 1,
      accepted_synthesis_available: 0,
      frame_table_ready: 0,
    });

    const acceptedLifecycle = {
      schemaVersion: 'vh-news-synthesis-lifecycle-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      source_set_revision: story.provenance_hash,
      source_count: 2,
      canonical_source_count: 2,
      status: 'accepted_available',
      frame_table_state: 'frame_table_ready',
      retryable: false,
      synthesis_id: 'syn-old',
      epoch: 1,
      updated_at: 302,
    };
    expect(await requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: { record: acceptedLifecycle },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true, story_id: story.story_id, status: 'accepted_available' }),
    });
    await expect(requestJson(
      `http://127.0.0.1:${port}/vh/news/synthesis-lifecycle?story_id=${story.story_id}`,
    )).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        story_id: story.story_id,
        topic_id: story.topic_id,
        status: 'accepted_available',
        frame_table_state: 'frame_table_ready',
        lifecycle: expect.objectContaining({
          story_id: story.story_id,
          source_set_revision: story.provenance_hash,
          status: 'accepted_available',
        }),
      }),
    });

    let accepted;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      accepted = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=3&scan_limit=3&include_excluded=true`,
      );
      if (accepted.body?.story_states?.[story.story_id]?.synthesis_state === 'accepted_synthesis_available') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(accepted.body.story_states[story.story_id]).toMatchObject({
      synthesis_state: 'accepted_synthesis_available',
      frame_table_state: 'frame_table_ready',
      lifecycle_status: 'accepted_available',
      synthesis_id: 'syn-old',
      epoch: 1,
    });
    expect(accepted.body.composition).toMatchObject({
      total_visible: 1,
      multi_source_visible: 1,
      pending_synthesis: 0,
      accepted_synthesis_available: 1,
      frame_table_ready: 1,
    });
  }, 60_000);

  it('refreshes story synthesis state when serving a preferred latest-index snapshot', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_CONCURRENCY: '2',
      VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_LIFECYCLE_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_LIFECYCLE_FIELD_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_TOPIC_SYNTHESIS_REST_READ_TIMEOUT_MS: '500',
      VH_RELAY_NEWS_INDEX_REST_PREFER_SNAPSHOT: 'true',
      VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES: 'true',
      VH_RELAY_NEWS_INDEX_REST_MAP_FALLBACK: 'true',
    });
    const story = makeRelayNewsStory('story-snapshot-refresh', 400, [
      {
        source_id: 'source-a',
        publisher: 'Source A',
        url: 'https://example.com/snapshot-a',
        url_hash: 'hash-snapshot-a',
        published_at: 390,
        title: 'Snapshot A',
      },
      {
        source_id: 'source-b',
        publisher: 'Source B',
        url: 'https://example.com/snapshot-b',
        url_hash: 'hash-snapshot-b',
        published_at: 400,
        title: 'Snapshot B',
      },
    ]);
    await writeRelayNewsStory(port, story);
    await writeRelayLatestIndexRecord(port, story.story_id, story.cluster_window_end);

    let pending;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      pending = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=3&scan_limit=3`,
      );
      if (pending.body?.story_states?.[story.story_id]?.synthesis_state === 'synthesis_pending') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(pending.body.story_states[story.story_id]).toMatchObject({
      synthesis_state: 'synthesis_pending',
      frame_table_state: 'frame_table_pending',
      lifecycle_status: 'pending',
    });

    const synthesis = {
      schemaVersion: 'topic-synthesis-v2',
      topic_id: story.topic_id,
      synthesis_id: 'syn-snapshot-refresh',
      epoch: 1,
      inputs: { story_bundle_ids: [story.story_id] },
      facts_summary: 'Accepted synthesis became available after the relay persisted a latest-index snapshot.',
      frames: [{
        frame: 'Frame',
        reframe: 'Reframe',
        frame_point_id: 'syn-snapshot-refresh:0:frame',
        reframe_point_id: 'syn-snapshot-refresh:0:reframe',
      }],
      provenance: {
        candidate_ids: ['cand-snapshot-refresh'],
        provider_mix: [{ provider_id: 'remote-analysis', count: 1 }],
      },
      quorum: {
        required: 1,
        received: 1,
        reached_at: 410,
        timed_out: false,
        selection_rule: 'deterministic',
      },
      divergence_metrics: {
        disagreement_score: 0,
        source_dispersion: 1,
        candidate_count: 1,
      },
      warnings: [],
      created_at: 410,
    };
    expect(await requestJson(`http://127.0.0.1:${port}/vh/topics/synthesis`, {
      method: 'POST',
      body: { synthesis },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        topic_id: story.topic_id,
        synthesis_id: synthesis.synthesis_id,
      }),
    });
    expect(await requestJson(`http://127.0.0.1:${port}/vh/news/synthesis-lifecycle`, {
      method: 'POST',
      body: {
        record: {
          schemaVersion: 'vh-news-synthesis-lifecycle-v1',
          story_id: story.story_id,
          topic_id: story.topic_id,
          source_set_revision: story.provenance_hash,
          source_count: 2,
          canonical_source_count: 2,
          status: 'accepted_available',
          frame_table_state: 'frame_table_ready',
          retryable: false,
          synthesis_id: synthesis.synthesis_id,
          epoch: 1,
          updated_at: 411,
        },
      },
    })).toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        story_id: story.story_id,
        status: 'accepted_available',
      }),
    });

    let accepted;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      accepted = await requestJson(
        `http://127.0.0.1:${port}/vh/news/latest-index?limit=3&scan_limit=3`,
      );
      if (accepted.body?.story_states?.[story.story_id]?.synthesis_state === 'accepted_synthesis_available') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(accepted.body.consistency).toMatchObject({
      empty_read_cache: expect.objectContaining({
        served_from: 'preferred_latest_index_snapshot',
      }),
      snapshot_story_state_refresh: expect.objectContaining({
        enabled: true,
        selected_count: 1,
        refreshed_count: 1,
      }),
    });
    expect(accepted.body.story_states[story.story_id]).toMatchObject({
      synthesis_state: 'accepted_synthesis_available',
      frame_table_state: 'frame_table_ready',
      lifecycle_status: 'accepted_available',
      synthesis_id: synthesis.synthesis_id,
      epoch: 1,
    });
    expect(accepted.body.stories[story.story_id]).toMatchObject({
      story_id: story.story_id,
      headline: story.headline,
    });
    expect(accepted.body.composition).toMatchObject({
      total_visible: 1,
      pending_synthesis: 0,
      accepted_synthesis_available: 1,
      frame_table_ready: 1,
    });
  }, 60_000);

  it('persists latest-index snapshots as news write-through evidence before any latest-index read', async () => {
    const snapshotDir = mkdtempSync(path.join(os.tmpdir(), 'vh-relay-write-through-snapshot-test-'));
    tempDirs.add(snapshotDir);
    const snapshotFile = path.join(snapshotDir, 'latest-index-snapshot.json');
    const snapshotEnv = {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_EMPTY_CACHE_TTL_MS: '60000',
      VH_RELAY_NEWS_INDEX_SNAPSHOT_FILE: snapshotFile,
      VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES: 'false',
      VH_RELAY_NEWS_INDEX_SNAPSHOT_REFRESH_STORY_STATES: 'false',
    };
    const { port: writerPort } = await startRelay(children, tempDirs, snapshotEnv);
    const story = makeRelayNewsStory('story-write-through-snapshot', 1778992000000, [
      {
        source_id: 'source-write-through-snapshot-a',
        publisher: 'Write Through Snapshot A',
        url: 'https://example.com/write-through-snapshot-a',
        url_hash: 'hash-write-through-snapshot-a',
        published_at: 1778991999000,
        title: 'Write-through snapshot story A',
      },
      {
        source_id: 'source-write-through-snapshot-b',
        publisher: 'Write Through Snapshot B',
        url: 'https://example.com/write-through-snapshot-b',
        url_hash: 'hash-write-through-snapshot-b',
        published_at: 1778992000000,
        title: 'Write-through snapshot story B',
      },
    ]);

    await writeRelayNewsStory(writerPort, story);
    await writeRelayLatestIndexRecord(writerPort, story.story_id, story.cluster_window_end);

    const { port: snapshotPort } = await startRelay(children, tempDirs, {
      ...snapshotEnv,
      VH_RELAY_NEWS_INDEX_REST_PREFER_SNAPSHOT: 'true',
    });
    await expect(requestJson(`http://127.0.0.1:${snapshotPort}/vh/news/latest-index?limit=1&scan_limit=3`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          record_count: 1,
          consistency: expect.objectContaining({
            empty_read_cache: expect.objectContaining({
              served_from: 'preferred_latest_index_snapshot',
            }),
            latest_index_write_through: expect.objectContaining({
              story_id: story.story_id,
              reason: 'latest_index_write',
              has_record: true,
              has_story: true,
              has_story_state: true,
            }),
          }),
          records: {
            [story.story_id]: expect.objectContaining({
              story_id: story.story_id,
              latest_activity_at: story.cluster_window_end,
            }),
          },
          stories: {
            [story.story_id]: expect.objectContaining({
              story_id: story.story_id,
              sources: expect.arrayContaining([
                expect.objectContaining({ source_id: 'source-write-through-snapshot-a' }),
              ]),
            }),
          },
          story_states: {
            [story.story_id]: expect.objectContaining({
              synthesis_state: 'synthesis_pending',
              frame_table_state: 'frame_table_pending',
            }),
          },
        }),
      });
  }, 30_000);

  it('serves persisted latest-index snapshot stories when the local story body path is sparse', async () => {
    const snapshotDir = mkdtempSync(path.join(os.tmpdir(), 'vh-relay-snapshot-test-'));
    tempDirs.add(snapshotDir);
    const snapshotFile = path.join(snapshotDir, 'latest-index-snapshot.json');
    const snapshotEnv = {
      VH_RELAY_NEWS_INDEX_REST_MAX_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_REST_SCAN_RECORDS: '3',
      VH_RELAY_NEWS_INDEX_STORY_REST_READ_TIMEOUT_MS: '300',
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '300',
      VH_RELAY_NEWS_INDEX_REST_EMPTY_CACHE_TTL_MS: '60000',
      VH_RELAY_NEWS_INDEX_SNAPSHOT_FILE: snapshotFile,
    };
    const { port: writerPort } = await startRelay(children, tempDirs, snapshotEnv);
    const story = makeRelayNewsStory('story-snapshot-body-fallback', 500, [
      {
        source_id: 'source-snapshot-body',
        publisher: 'Snapshot Body Source',
        url: 'https://example.com/snapshot-body',
        url_hash: 'hash-snapshot-body',
        published_at: 490,
        title: 'Snapshot body story',
      },
      {
        source_id: 'source-snapshot-body-b',
        publisher: 'Snapshot Body Source B',
        url: 'https://example.com/snapshot-body-b',
        url_hash: 'hash-snapshot-body-b',
        published_at: 500,
        title: 'Snapshot body story B',
      },
    ]);
    await writeRelayNewsStory(writerPort, story);
    await writeRelayLatestIndexRecord(writerPort, story.story_id, story.cluster_window_end);
    await expect(requestJson(`http://127.0.0.1:${writerPort}/vh/news/latest-index?limit=3&scan_limit=3`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          record_count: 1,
          stories: {
            [story.story_id]: expect.objectContaining({ story_id: story.story_id }),
          },
        }),
      });

    const { port: sparsePort } = await startRelay(children, tempDirs, {
      ...snapshotEnv,
      VH_RELAY_NEWS_INDEX_REST_PREFER_SNAPSHOT: 'true',
      VH_RELAY_NEWS_INDEX_SNAPSHOT_VERIFY_STORY_BODIES: 'true',
    });
    await expect(requestJson(`http://127.0.0.1:${sparsePort}/vh/news/story?story_id=${story.story_id}`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          source: 'latest-index-snapshot',
          story_id: story.story_id,
          story: expect.objectContaining({
            story_id: story.story_id,
            headline: story.headline,
          }),
        }),
      });
    await expect(requestJson(`http://127.0.0.1:${sparsePort}/vh/news/latest-index?limit=1&scan_limit=3`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          record_count: 1,
          consistency: expect.objectContaining({
            empty_read_cache: expect.objectContaining({
              served_from: 'preferred_latest_index_snapshot',
            }),
            snapshot_story_body_readback: expect.objectContaining({
              enabled: true,
              selected_count: 1,
              verified_count: 1,
              dropped_count: 0,
            }),
          }),
          stories: {
            [story.story_id]: expect.objectContaining({
              story_id: story.story_id,
              sources: expect.arrayContaining([
                expect.objectContaining({ source_id: 'source-snapshot-body' }),
              ]),
            }),
          },
        }),
      });
  }, 30_000);

  it('serves scalar-only news story records without waiting for a missing parent node', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_NEWS_STORY_REST_READ_TIMEOUT_MS: '800',
    });
    const gun = createRelayGunClient(port);
    const story = {
      story_id: 'story-scalar-only',
      topic_id: 'topic-scalar-only',
      headline: 'Scalar-only relay story',
    };
    await putGunValueAndWaitForReadback(
      gun.get('vh').get('news').get('stories').get(story.story_id).get('__story_bundle_json'),
      JSON.stringify(story),
    );
    await expect(readGunOnce(
      gun.get('vh').get('news').get('stories').get(story.story_id).get('__story_bundle_json'),
    )).resolves.toBe(JSON.stringify(story));

    const startedAt = Date.now();
    await expect(requestJson(`http://127.0.0.1:${port}/vh/news/story?story_id=${story.story_id}`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          story_id: story.story_id,
          story,
          record: expect.objectContaining({
            __story_bundle_json: JSON.stringify(story),
          }),
        }),
      });
    expect(Date.now() - startedAt).toBeLessThan(800);
    gun.off();
  }, 15_000);

  it('preserves signed forum comment envelopes written through the relay fallback', async () => {
    const { port } = await startRelay(children, tempDirs);
    const threadId = `thread-relay-signed-${port}`;
    const firstCommentId = `comment-relay-signed-${port}`;
    const secondCommentId = `comment-relay-signed-${port}-2`;
    const signedWriteEnvelope = {
      envelopeVersion: 1,
      signatureSuite: 'jcs-ed25519-sha256-v1',
      protocolVersion: 'luma-write-v1',
      profile: 'dev',
      audience: 'vh-forum-comment',
      origin: `http://127.0.0.1:${port}`,
      scheme: 'forum-author-v1',
      publicAuthor: 'author-relay',
      sessionRef: {
        tokenHash: 'token-hash',
        envelopeDigest: 'envelope-digest',
      },
      payload: {
        schemaVersion: 'hermes-comment-v2',
        _protocolVersion: 'luma-public-v1',
        _writerKind: 'luma',
        _authorScheme: 'forum-author-v1',
        id: firstCommentId,
        threadId,
        parentId: null,
        content: 'Relay fallback comment keeps its signed envelope.',
        author: 'author-relay',
        timestamp: 1778990000000,
        stance: 'discuss',
      },
      payloadDigest: 'payload-digest',
      sequence: 1778990000000,
      nonce: 'nonce-relay',
      idempotencyKey: 'idempotency-relay',
      issuedAt: 1778990000000,
      signature: 'signature-relay',
    };
    const comment = {
      ...signedWriteEnvelope.payload,
      upvotes: 0,
      downvotes: 0,
      signedWriteEnvelope,
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/forum/comment`, {
      method: 'POST',
      body: { comment },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        thread_id: threadId,
        comment_id: firstCommentId,
      }),
    });
    const secondSignedWriteEnvelope = {
      ...signedWriteEnvelope,
      payload: {
        ...signedWriteEnvelope.payload,
        id: secondCommentId,
        content: 'Relay fallback comment keeps the compact index append-only.',
        timestamp: 1778990000001,
      },
      payloadDigest: 'payload-digest-2',
      sequence: 1778990000001,
      nonce: 'nonce-relay-2',
      idempotencyKey: 'idempotency-relay-2',
      issuedAt: 1778990000001,
      signature: 'signature-relay-2',
    };
    const secondComment = {
      ...secondSignedWriteEnvelope.payload,
      upvotes: 0,
      downvotes: 0,
      signedWriteEnvelope: secondSignedWriteEnvelope,
    };

    await expect(requestJson(`http://127.0.0.1:${port}/vh/forum/comment`, {
      method: 'POST',
      body: { comment: secondComment },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({
        ok: true,
        thread_id: threadId,
        comment_id: secondCommentId,
      }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/vh/forum/comments?thread_id=${encodeURIComponent(threadId)}`))
      .resolves.toMatchObject({
        statusCode: 200,
        body: expect.objectContaining({
          ok: true,
          thread_id: threadId,
          comment_ids: [firstCommentId, secondCommentId],
          count: 2,
          comments: [
            expect.objectContaining({
              id: firstCommentId,
              signedWriteEnvelope,
            }),
            expect.objectContaining({
              id: secondCommentId,
              signedWriteEnvelope: secondSignedWriteEnvelope,
            }),
          ],
        }),
      });

    const gun = createRelayGunClient(port);
    const stored = await readGunOnce(
      gun.get('vh').get('forum').get('threads').get(threadId).get('comments').get(firstCommentId),
    );
    const storedSecond = await readGunOnce(
      gun.get('vh').get('forum').get('threads').get(threadId).get('comments').get(secondCommentId),
    );
    const indexCurrent = await readGunOnce(
      gun.get('vh').get('forum').get('indexes').get('comment_ids')
        .get(encodeURIComponent(threadId))
        .get('current'),
    );
    const firstIndexEntry = await readGunOnce(
      gun.get('vh').get('forum').get('indexes').get('comment_ids')
        .get(encodeURIComponent(threadId))
        .get('entries')
        .get(firstCommentId),
    );
    const secondIndexEntry = await readGunOnce(
      gun.get('vh').get('forum').get('indexes').get('comment_ids')
        .get(encodeURIComponent(threadId))
        .get('entries')
        .get(secondCommentId),
    );
    gun.off();

    expect(JSON.parse(stored.__comment_json).signedWriteEnvelope).toEqual(signedWriteEnvelope);
    expect(stored.signedWriteEnvelope).toBeUndefined();
    expect(JSON.parse(storedSecond.__comment_json).signedWriteEnvelope).toEqual(secondSignedWriteEnvelope);
    expect(JSON.parse(indexCurrent.idsJson)).toEqual([firstCommentId, secondCommentId]);
    expect(firstIndexEntry.commentId).toBe(firstCommentId);
    expect(secondIndexEntry.commentId).toBe(secondCommentId);
  });

  it('enforces origin allowlist, request rate limits, and body size caps', async () => {
    const { port } = await startRelay(children, tempDirs, {
      VH_RELAY_ALLOWED_ORIGINS: 'https://allowed.example',
      VH_RELAY_HTTP_RATE_LIMIT_PER_MIN: '1',
      VH_RELAY_HTTP_BODY_LIMIT_BYTES: '64',
    });

    await expect(requestJson(`http://127.0.0.1:${port}/healthz`, {
      headers: { origin: 'https://blocked.example' },
    })).resolves.toMatchObject({
      statusCode: 403,
      body: expect.objectContaining({ ok: false, error: 'origin-not-allowed' }),
    });

    await expect(requestJson(`http://127.0.0.1:${port}/healthz`, {
      headers: { origin: 'https://allowed.example' },
    })).resolves.toMatchObject({
      statusCode: 200,
      body: expect.objectContaining({ ok: true }),
    });
    await expect(requestJson(`http://127.0.0.1:${port}/healthz`, {
      headers: { origin: 'https://allowed.example' },
    })).resolves.toMatchObject({
      statusCode: 429,
      body: expect.objectContaining({ ok: false, error: 'rate-limited' }),
    });

    const { port: bodyPort } = await startRelay(children, tempDirs, {
      VH_RELAY_HTTP_BODY_LIMIT_BYTES: '64',
    });
    const oversized = await requestJson(`http://127.0.0.1:${bodyPort}/vh/aggregates/voter`, {
      method: 'POST',
      body: {
        topic_id: 'topic-body',
        synthesis_id: 'synthesis-body',
        epoch: 1,
        voter_id: 'voter-body',
        node: {
          point_id: 'point-body',
          agreement: 1,
          weight: 1,
          updated_at: '2026-05-02T00:00:00.000Z',
          padding: 'x'.repeat(128),
        },
      },
    });
    expect(oversized).toMatchObject({
      statusCode: 413,
      body: expect.objectContaining({ ok: false, error: 'body-too-large' }),
    });
  });
});
