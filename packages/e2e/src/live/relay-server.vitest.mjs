import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';

const gunRequire = createRequire('/Users/bldt/Desktop/VHC/VHC/packages/gun-client/package.json');
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
  const child = spawn('node', ['/Users/bldt/Desktop/VHC/VHC/infra/relay/server.js'], {
    cwd: '/Users/bldt/Desktop/VHC/VHC',
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
