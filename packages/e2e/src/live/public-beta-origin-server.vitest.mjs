import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startPublicBetaOriginServer } from '../../../../tools/scripts/public-beta-origin-server.mjs';

const cleanup = [];

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
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Venn</title><main id="root"></main>');
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
      cspConnectSrc: "'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io",
    });

    const root = await fetch(`${origin}/`);
    expect(root.status).toBe(200);
    expect(root.headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io",
    );
    expect(await root.text()).toContain('<main id="root">');

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
      cspConnectSrc: "'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io",
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
      cspConnectSrc: "'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io",
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
    const forbiddenAggregatePost = await fetch(`${origin}/vh/aggregates/point`, { method: 'POST' });
    expect(forbiddenAggregatePost.status).toBe(405);

    const root = await fetch(`${origin}/`);
    expect(root.headers.get('content-security-policy')).toContain(
      "connect-src 'self' https://venn.carboncaste.io wss://gun-a.carboncaste.io",
    );
  });
});
