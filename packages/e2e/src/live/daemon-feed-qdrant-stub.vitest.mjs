import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { startQdrantStubServer } from './daemon-feed-qdrant-stub.mjs';

const servers = [];

async function startServer() {
  const server = startQdrantStubServer({ port: 0 });
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function request(baseUrl, pathname, init) {
  const response = await fetch(`${baseUrl}${pathname}`, init);
  return {
    status: response.status,
    body: await response.json(),
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0, servers.length).map((server) => new Promise((resolve) => {
    server.close(() => resolve());
  })));
});

describe('daemon-feed-qdrant-stub', () => {
  it('creates collections and reports ready state', async () => {
    const baseUrl = await startServer();
    await expect(request(baseUrl, '/readyz')).resolves.toMatchObject({
      status: 200,
      body: { status: 'ok' },
    });
    await expect(request(baseUrl, '/collections/demo')).resolves.toMatchObject({
      status: 404,
    });
    await expect(request(baseUrl, '/collections/demo', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 3, distance: 'Cosine' } }),
    })).resolves.toMatchObject({
      status: 200,
      body: { status: 'ok', result: true },
    });
    await expect(request(baseUrl, '/collections/demo')).resolves.toMatchObject({
      status: 200,
      body: { status: 'ok', result: { status: 'green', vectors_count: 0 } },
    });
  });

  it('supports upsert, topic search, scroll, and delete flows', async () => {
    const baseUrl = await startServer();
    await request(baseUrl, '/collections/demo', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ vectors: { size: 3, distance: 'Cosine' } }),
    });

    await request(baseUrl, '/collections/demo/points', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        points: [
          {
            id: 'point-a',
            vector: [1, 0, 0],
            payload: { story_id: 'story-a', topic_id: 'topic-1' },
          },
          {
            id: 'point-b',
            vector: [0.8, 0.2, 0],
            payload: { story_id: 'story-b', topic_id: 'topic-1' },
          },
          {
            id: 'point-c',
            vector: [0, 1, 0],
            payload: { story_id: 'story-c', topic_id: 'topic-2' },
          },
        ],
      }),
    });

    await expect(request(baseUrl, '/collections/demo/points/search/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        searches: [{
          vector: [1, 0, 0],
          limit: 2,
          filter: { must: [{ key: 'topic_id', match: { value: 'topic-1' } }] },
        }],
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: {
        status: 'ok',
        result: [[
          { payload: { story_id: 'story-a', topic_id: 'topic-1' } },
          { payload: { story_id: 'story-b', topic_id: 'topic-1' } },
        ]],
      },
    });

    await expect(request(baseUrl, '/collections/demo/points/scroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 1,
        filter: { must: [{ key: 'topic_id', match: { value: 'topic-1' } }] },
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: {
        status: 'ok',
        result: {
          points: [{ id: 'point-a' }],
          next_page_offset: 1,
        },
      },
    });

    await request(baseUrl, '/collections/demo/points/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ points: ['point-b'] }),
    });

    await expect(request(baseUrl, '/collections/demo/points/scroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        limit: 8,
        filter: { must: [{ key: 'topic_id', match: { value: 'topic-1' } }] },
      }),
    })).resolves.toMatchObject({
      status: 200,
      body: {
        status: 'ok',
        result: {
          points: [{ id: 'point-a' }],
          next_page_offset: null,
        },
      },
    });
  });
});
