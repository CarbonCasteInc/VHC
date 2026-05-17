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

    const gun = Gun({
      peers: [`http://127.0.0.1:${port}/gun`],
      localStorage: false,
      radisk: false,
    });
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

  it('preserves signed forum comment envelopes written through the relay fallback', async () => {
    const { port } = await startRelay(children, tempDirs);
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
        id: 'comment-relay-signed',
        threadId: 'thread-relay-signed',
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
        thread_id: 'thread-relay-signed',
        comment_id: 'comment-relay-signed',
      }),
    });

    const gun = Gun({
      peers: [`http://127.0.0.1:${port}/gun`],
      localStorage: false,
      radisk: false,
    });
    const stored = await readGunOnce(
      gun.get('vh').get('forum').get('threads').get('thread-relay-signed').get('comments').get('comment-relay-signed'),
    );
    gun.off();

    expect(JSON.parse(stored.__comment_json).signedWriteEnvelope).toEqual(signedWriteEnvelope);
    expect(stored.signedWriteEnvelope).toBeUndefined();
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
