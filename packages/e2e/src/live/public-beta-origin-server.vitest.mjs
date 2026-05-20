import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPublicBetaOriginServer } from '../../../../tools/scripts/public-beta-origin-server.mjs';

const cleanup = [];
const PUBLIC_CSP_CONNECT_SRC = "'self' https://venn.carboncaste.io https://gun-a.carboncaste.io https://gun-b.carboncaste.io https://gun-c.carboncaste.io wss://gun-a.carboncaste.io wss://gun-b.carboncaste.io wss://gun-c.carboncaste.io";

afterEach(async () => {
  while (cleanup.length > 0) {
    const item = cleanup.pop();
    if (typeof item === 'function') await item();
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function makeStaticRoot() {
  const root = await mkdtemp(join(tmpdir(), 'vh-origin-test-'));
  await mkdir(join(root, 'assets'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="connect-src localhost:*"></head><body><main id="root"></main></body></html>',
  );
  await writeFile(join(root, 'assets', 'app.js'), 'console.log("vh");');
  await writeFile(join(root, 'mesh-peer-config.json'), JSON.stringify({ payload: { peers: [] } }));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function startOrigin(options) {
  const server = await startPublicBetaOriginServer({
    host: '127.0.0.1',
    port: 0,
    ...options,
  });
  cleanup.push(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

describe('public beta origin server', () => {
  it('serves built app assets, SPA fallback, and signed peer config with strict CSP', async () => {
    const staticDir = await makeStaticRoot();
    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const root = await fetch(`${origin}/`);
    const rootHtml = await root.text();
    expect(root.status).toBe(200);
    expect(root.headers.get('content-security-policy')).toContain(
      `connect-src ${PUBLIC_CSP_CONNECT_SRC}`,
    );
    expect(rootHtml).toContain('<main id="root">');
    expect(rootHtml).toContain(`connect-src ${PUBLIC_CSP_CONNECT_SRC}`);
    expect(rootHtml).not.toContain('localhost:*');

    const asset = await fetch(`${origin}/assets/app.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');

    const fallback = await fetch(`${origin}/stories/current`);
    expect(fallback.status).toBe(200);
    expect(await fallback.text()).toContain('<main id="root">');

    const peerConfig = await fetch(`${origin}/mesh-peer-config.json`);
    expect(peerConfig.status).toBe(200);
    expect(await peerConfig.json()).toEqual({ payload: { peers: [] } });
  });

  it('reverse-proxies analysis and article-text routes without exposing a wildcard CSP', async () => {
    const staticDir = await makeStaticRoot();
    const upstream = createServer((req, res) => {
      if (req.url?.startsWith('/api/analyze/health')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, upstream: 'reachable' }));
        return;
      }
      if (req.url?.startsWith('/article-text')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ text: 'Readable article text' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const upstreamUrl = await listen(upstream);
    cleanup.push(() => new Promise((resolve) => upstream.close(resolve)));

    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      analysisTarget: upstreamUrl,
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const health = await fetch(`${origin}/api/analyze/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, upstream: 'reachable' });

    const article = await fetch(`${origin}/article-text?url=https%3A%2F%2Fexample.com%2Fa`);
    expect(article.status).toBe(200);
    expect(await article.json()).toEqual({ text: 'Readable article text' });

    const root = await fetch(`${origin}/`);
    expect(root.headers.get('content-security-policy')).not.toContain('*');
  });

  it('reverse-proxies exact relay read/write fallbacks through the same origin', async () => {
    const staticDir = await makeStaticRoot();
    const relayRequests = [];
    const relay = createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      relayRequests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        thread_id: 'thread-1',
        comment_id: 'comment-1',
      }));
    });
    const relayUrl = await listen(relay);
    cleanup.push(() => new Promise((resolve) => relay.close(resolve)));

    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      relayTarget: relayUrl,
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const response = await fetch(`${origin}/vh/forum/comment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vh-relay-device-pub': 'device-pub',
      },
      body: JSON.stringify({ comment: { id: 'comment-1', threadId: 'thread-1' } }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, comment_id: 'comment-1' });
    expect(relayRequests).toHaveLength(1);
    expect(relayRequests[0]).toMatchObject({
      method: 'POST',
      url: '/vh/forum/comment',
      body: JSON.stringify({ comment: { id: 'comment-1', threadId: 'thread-1' } }),
    });
    expect(relayRequests[0].headers['x-vh-relay-device-pub']).toBe('device-pub');

    const synthesis = await fetch(`${origin}/vh/topics/synthesis?topic_id=topic-1`);
    expect(synthesis.status).toBe(200);
    expect(await synthesis.json()).toMatchObject({ ok: true, thread_id: 'thread-1' });
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/topics/synthesis?topic_id=topic-1',
    });

    const comments = await fetch(`${origin}/vh/forum/comments?thread_id=thread-1`);
    expect(comments.status).toBe(200);
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/forum/comments?thread_id=thread-1',
    });

    const threadRead = await fetch(`${origin}/vh/forum/thread?thread_id=thread-1`);
    expect(threadRead.status).toBe(200);
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/forum/thread?thread_id=thread-1',
    });

    const storyRead = await fetch(`${origin}/vh/news/story?story_id=story-1`);
    expect(storyRead.status).toBe(200);
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/news/story?story_id=story-1',
    });

    const latestIndexRead = await fetch(`${origin}/vh/news/latest-index`);
    expect(latestIndexRead.status).toBe(200);
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/news/latest-index',
    });

    const aggregateRead = await fetch(`${origin}/vh/aggregates/point?topic_id=topic-1&synthesis_id=synth-1&epoch=0&point_id=point-1`);
    expect(aggregateRead.status).toBe(200);
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/aggregates/point?topic_id=topic-1&synthesis_id=synth-1&epoch=0&point_id=point-1',
    });

    const forbidden = await fetch(`${origin}/vh/forum/comment`);
    expect(forbidden.status).toBe(405);
    const forbiddenCommentsPost = await fetch(`${origin}/vh/forum/comments`, { method: 'POST' });
    expect(forbiddenCommentsPost.status).toBe(405);
    const forbiddenStoryPost = await fetch(`${origin}/vh/news/story`, { method: 'POST' });
    expect(forbiddenStoryPost.status).toBe(405);
    const forbiddenLatestIndexPost = await fetch(`${origin}/vh/news/latest-index`, { method: 'POST' });
    expect(forbiddenLatestIndexPost.status).toBe(405);
    const forbiddenAggregatePost = await fetch(`${origin}/vh/aggregates/point`, { method: 'POST' });
    expect(forbiddenAggregatePost.status).toBe(405);

    const root = await fetch(`${origin}/`);
    expect(root.headers.get('content-security-policy')).toContain(
      `connect-src ${PUBLIC_CSP_CONNECT_SRC}`,
    );
  });

  it('fans aggregate reads and writes across configured public relay targets', async () => {
    const staticDir = await makeStaticRoot();
    const relayRequests = [];
    const relayUrls = [];
    const aggregateParticipants = [1, 9, 3];
    for (let index = 0; index < aggregateParticipants.length; index += 1) {
      const relay = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        relayRequests.push({
          index,
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.method === 'GET' && req.url?.startsWith('/vh/aggregates/point')) {
          const participants = aggregateParticipants[index];
          res.end(JSON.stringify({
            ok: true,
            aggregate: {
              point_id: 'point-1',
              agree: participants,
              disagree: 0,
              weight: participants,
              participants,
            },
            row_count: participants,
          }));
          return;
        }
        res.end(JSON.stringify({
          ok: true,
          topic_id: 'topic-1',
          synthesis_id: 'synth-1',
          epoch: 0,
          voter_id: 'voter-1',
          point_id: 'point-1',
          relay_index: index,
        }));
      });
      relayUrls.push(await listen(relay));
      cleanup.push(() => new Promise((resolve) => relay.close(resolve)));
    }

    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      relayTargets: relayUrls,
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const aggregateRead = await fetch(`${origin}/vh/aggregates/point?topic_id=topic-1&synthesis_id=synth-1&epoch=0&point_id=point-1`);
    expect(aggregateRead.status).toBe(200);
    expect(await aggregateRead.json()).toMatchObject({
      ok: true,
      aggregate: {
        point_id: 'point-1',
        agree: 9,
        participants: 9,
      },
      row_count: 9,
    });
    expect(relayRequests.filter((request) => request.method === 'GET')).toHaveLength(3);

    const writeBody = JSON.stringify({
      topic_id: 'topic-1',
      synthesis_id: 'synth-1',
      epoch: 0,
      voter_id: 'voter-1',
      node: { point_id: 'point-1', agreement: 1, weight: 1, updated_at: new Date(0).toISOString() },
    });
    const aggregateWrite = await fetch(`${origin}/vh/aggregates/voter`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vh-relay-device-pub': 'device-pub',
      },
      body: writeBody,
    });
    expect(aggregateWrite.status).toBe(200);
    expect(await aggregateWrite.json()).toMatchObject({ ok: true, voter_id: 'voter-1', point_id: 'point-1' });
    const writeRequests = relayRequests.filter((request) => request.method === 'POST');
    expect(writeRequests).toHaveLength(3);
    expect(writeRequests.map((request) => request.body)).toEqual([writeBody, writeBody, writeBody]);
    expect(writeRequests.every((request) => request.headers['x-vh-relay-device-pub'] === 'device-pub')).toBe(true);
  });

  it('bounds relay proxy calls so browser-aborted readbacks do not saturate the public origin', async () => {
    const staticDir = await makeStaticRoot();
    const relay = createServer((_req, _res) => {
      // Intentionally hold the response open; the origin should apply its
      // relay-specific timeout instead of keeping the Cloudflare stream alive.
    });
    const relayUrl = await listen(relay);
    cleanup.push(() => new Promise((resolve) => relay.close(resolve)));

    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      relayTarget: relayUrl,
      relayProxyTimeoutMs: 25,
      proxyTimeoutMs: 60_000,
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const startedAt = Date.now();
    const response = await fetch(`${origin}/vh/forum/comments?thread_id=thread-1`);
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ ok: false, error: 'Upstream request timed out' });
    expect(elapsedMs).toBeLessThan(2_000);
  });

  it('survives a client disconnect while streaming a static response', async () => {
    const staticDir = await makeStaticRoot();
    const largeBody = `<!doctype html><title>Venn</title><main>${'x'.repeat(512_000)}</main>`;
    await writeFile(join(staticDir, 'index.html'), largeBody);
    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });
    const { hostname, port } = new URL(origin);

    await new Promise((resolve, reject) => {
      const socket = connect(Number(port), hostname);
      socket.once('error', reject);
      socket.once('connect', () => {
        socket.write('GET / HTTP/1.1\r\nHost: vh-public-origin.local\r\nConnection: close\r\n\r\n');
      });
      socket.once('data', () => {
        socket.destroy();
        resolve();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    const health = await fetch(`${origin}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, service: 'vh-public-beta-origin' });
  });
});
