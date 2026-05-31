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
        host: 'venn.carboncaste.io',
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
    expect(relayRequests[0].headers.host).not.toBe('venn.carboncaste.io');

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

    const hotIndexRead = await fetch(`${origin}/vh/news/hot-index`);
    expect(hotIndexRead.status).toBe(200);
    expect(relayRequests.at(-1)).toMatchObject({
      method: 'GET',
      url: '/vh/news/hot-index',
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
    const forbiddenHotIndexPost = await fetch(`${origin}/vh/news/hot-index`, { method: 'POST' });
    expect(forbiddenHotIndexPost.status).toBe(405);
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

  it('serves public news and synthesis read fallbacks from the first usable configured relay target', async () => {
    const staticDir = await makeStaticRoot();
    const relayRequests = [];
    const relayUrls = [];
    for (let index = 0; index < 3; index += 1) {
      const relay = createServer(async (req, res) => {
        relayRequests.push({
          index,
          method: req.method,
          url: req.url,
        });
        if (index === 0) {
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        if (req.url?.startsWith('/vh/news/latest-index')) {
          const records = index === 1
            ? { 'story-a': { timestamp: 1 } }
            : { 'story-a': { timestamp: 1 }, 'story-b': { timestamp: 2 } };
          res.end(JSON.stringify({ ok: true, relay_index: index, records }));
          return;
        }
        if (req.url?.startsWith('/vh/news/hot-index')) {
          const records = index === 1
            ? { 'story-hot-a': { hotness: 0.91 } }
            : {
                'story-hot-a': { hotness: 0.91 },
                'story-hot-b': { hotness: 0.62 },
              };
          res.end(JSON.stringify({ ok: true, relay_index: index, records }));
          return;
        }
        if (req.url?.startsWith('/vh/news/story')) {
          res.end(JSON.stringify({
            ok: true,
            relay_index: index,
            story: { story_id: `story-from-relay-${index}` },
          }));
          return;
        }
        if (req.url?.startsWith('/vh/topics/synthesis')) {
          res.end(JSON.stringify({
            ok: true,
            relay_index: index,
            record: { topic_id: `topic-from-relay-${index}` },
          }));
          return;
        }
        res.writeHead(404);
        res.end();
      });
      relayUrls.push(await listen(relay));
      cleanup.push(() => new Promise((resolve) => relay.close(resolve)));
    }

    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      relayTargets: relayUrls,
      relayFanoutTimeoutMs: 25,
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const latestIndex = await fetch(`${origin}/vh/news/latest-index?limit=80`);
    expect(latestIndex.status).toBe(200);
    expect(await latestIndex.json()).toMatchObject({
      ok: true,
      relay_index: 1,
      records: {
        'story-a': { timestamp: 1 },
      },
    });

    const hotIndex = await fetch(`${origin}/vh/news/hot-index?limit=80`);
    expect(hotIndex.status).toBe(200);
    expect(await hotIndex.json()).toMatchObject({
      ok: true,
      relay_index: 1,
      records: {
        'story-hot-a': { hotness: 0.91 },
      },
    });

    const story = await fetch(`${origin}/vh/news/story?story_id=story-a`);
    expect(story.status).toBe(200);
    expect(await story.json()).toMatchObject({
      ok: true,
      relay_index: 1,
      story: { story_id: 'story-from-relay-1' },
    });

    const synthesis = await fetch(`${origin}/vh/topics/synthesis?topic_id=topic-a`);
    expect(synthesis.status).toBe(200);
    expect(await synthesis.json()).toMatchObject({
      ok: true,
      relay_index: 1,
      record: { topic_id: 'topic-from-relay-1' },
    });

    expect(relayRequests.filter((request) => request.url?.startsWith('/vh/news/latest-index'))).toHaveLength(2);
    expect(relayRequests.filter((request) => request.url?.startsWith('/vh/news/hot-index'))).toHaveLength(2);
    expect(relayRequests.filter((request) => request.url?.startsWith('/vh/news/story'))).toHaveLength(2);
    expect(relayRequests.filter((request) => request.url?.startsWith('/vh/topics/synthesis'))).toHaveLength(2);
  });

  it('caps public news fanout read latency separately from slower full relay fanout', async () => {
    const staticDir = await makeStaticRoot();
    const fastRelay = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url?.startsWith('/vh/news/latest-index')) {
        res.end(JSON.stringify({
          ok: true,
          relay_index: 0,
          records: {
            'story-fast': { timestamp: 100 },
          },
          composition: {
            total_visible: 1,
            singleton_visible: 0,
            multi_source_visible: 1,
            max_source_count: 2,
            freshness_age_ms: 0,
          },
        }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    });
    const slowRelay = createServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          relay_index: 1,
          records: {
            'story-slow': { timestamp: 200 },
          },
        }));
      }, 250);
    });
    const relayTargets = [
      await listen(fastRelay),
      await listen(slowRelay),
    ];
    cleanup.push(() => new Promise((resolve) => fastRelay.close(resolve)));
    cleanup.push(() => new Promise((resolve) => slowRelay.close(resolve)));

    const origin = await startOrigin({
      staticDir,
      peerConfigPath: join(staticDir, 'mesh-peer-config.json'),
      relayTargets,
      relayFanoutTimeoutMs: 1_000,
      relayNewsFanoutTimeoutMs: 25,
      cspConnectSrc: PUBLIC_CSP_CONNECT_SRC,
    });

    const startedAt = Date.now();
    const latestIndex = await fetch(`${origin}/vh/news/latest-index?limit=1`);
    const elapsedMs = Date.now() - startedAt;

    expect(latestIndex.status).toBe(200);
    expect(elapsedMs).toBeLessThan(500);
    expect(await latestIndex.json()).toMatchObject({
      ok: true,
      relay_index: 0,
      records: {
        'story-fast': { timestamp: 100 },
      },
    });
  });

  it('prefers mixed public news feed responses over singleton-only relay windows', async () => {
    const staticDir = await makeStaticRoot();
    const relayRequests = [];
    const relayUrls = [];
    const relayPayloads = [
      {
        ok: true,
        relay_index: 0,
        records: Object.fromEntries(Array.from({ length: 12 }, (_value, index) => [
          `story-singleton-${index}`,
          { story_id: `story-singleton-${index}`, source_count: 1, latest_activity_at: 1000 - index },
        ])),
        composition: {
          total_visible: 12,
          singleton_visible: 12,
          multi_source_visible: 0,
          max_source_count: 1,
          freshness_age_ms: 1_000,
        },
      },
      {
        ok: true,
        relay_index: 1,
        records: {
          'story-singleton-fresh': { story_id: 'story-singleton-fresh', source_count: 1, latest_activity_at: 1001 },
          'story-corroborated': { story_id: 'story-corroborated', source_count: 3, latest_activity_at: 990 },
        },
        composition: {
          total_visible: 2,
          singleton_visible: 1,
          multi_source_visible: 1,
          max_source_count: 3,
          freshness_age_ms: 1_500,
        },
      },
      {
        ok: true,
        relay_index: 2,
        records: {},
        composition: {
          total_visible: 0,
          singleton_visible: 0,
          multi_source_visible: 0,
          max_source_count: 0,
          freshness_age_ms: null,
        },
      },
    ];
    for (let index = 0; index < relayPayloads.length; index += 1) {
      const relay = createServer((_req, res) => {
        relayRequests.push(index);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(relayPayloads[index]));
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

    const latestIndex = await fetch(`${origin}/vh/news/latest-index?limit=12`);
    expect(latestIndex.status).toBe(200);
    expect(await latestIndex.json()).toMatchObject({
      ok: true,
      relay_index: 1,
      records: {
        'story-corroborated': {
          story_id: 'story-corroborated',
          source_count: 3,
        },
      },
      composition: {
        total_visible: 2,
        multi_source_visible: 1,
      },
    });
    expect(relayRequests).toHaveLength(2);
  });

  it('fans forum comment reads and writes across configured public relay targets', async () => {
    const staticDir = await makeStaticRoot();
    const relayRequests = [];
    const relayUrls = [];
    const commentCounts = [0, 2, 1];
    for (let index = 0; index < commentCounts.length; index += 1) {
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
        if (req.method === 'GET' && req.url?.startsWith('/vh/forum/comments')) {
          res.end(JSON.stringify({
            ok: true,
            thread_id: 'thread-1',
            comments: Array.from({ length: commentCounts[index] }, (_value, commentIndex) => ({
              id: `comment-${index}-${commentIndex}`,
              threadId: 'thread-1',
              author: 'user',
              body: `comment ${index}-${commentIndex}`,
              timestamp: commentIndex,
            })),
          }));
          return;
        }
        res.end(JSON.stringify({
          ok: true,
          thread_id: 'thread-1',
          comment_id: 'comment-1',
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

    const comments = await fetch(`${origin}/vh/forum/comments?thread_id=thread-1`);
    expect(comments.status).toBe(200);
    const commentsPayload = await comments.json();
    expect(commentsPayload).toMatchObject({ ok: true, thread_id: 'thread-1' });
    expect(commentsPayload.comments).toHaveLength(2);
    expect(relayRequests.filter((request) => request.method === 'GET')).toHaveLength(3);

    const commentBody = JSON.stringify({ comment: { id: 'comment-1', threadId: 'thread-1' } });
    const write = await fetch(`${origin}/vh/forum/comment`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vh-relay-device-pub': 'device-pub',
      },
      body: commentBody,
    });
    expect(write.status).toBe(200);
    expect(await write.json()).toMatchObject({ ok: true, comment_id: 'comment-1' });
    const writeRequests = relayRequests.filter((request) => request.method === 'POST');
    expect(writeRequests).toHaveLength(3);
    expect(writeRequests.map((request) => request.body)).toEqual([commentBody, commentBody, commentBody]);
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
