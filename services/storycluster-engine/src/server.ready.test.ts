import { describe, expect, it } from 'vitest';
import { createStoryClusterServer, serverInternal } from './server';

function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('storycluster server readiness', () => {
  it('serves readiness and method guards', async () => {
    const server = createStoryClusterServer({
      store: {
        loadTopic: () => ({ schema_version: 'storycluster-state-v1', topic_id: 'topic', next_cluster_seq: 1, clusters: [] }),
        saveTopic: () => undefined,
        readiness: () => ({ ok: false, detail: 'disk-offline' }),
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 4310;

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    const readyJson = await readJson(ready);
    expect(ready.status).toBe(503);
    expect(readyJson.detail).toBe('disk-offline');

    const method = await fetch(`http://127.0.0.1:${port}/ready`, { method: 'POST' });
    expect(method.status).toBe(405);
    expect(serverInternal.isReadyPath('/ready')).toBe(true);
    expect(serverInternal.isReadyPath('/api/ready')).toBe(true);
    expect(serverInternal.isReadyPath('/cluster')).toBe(false);

    server.close();
  });

  it('returns 200 from readiness when the store is healthy', async () => {
    const server = createStoryClusterServer({
      store: {
        loadTopic: () => ({ schema_version: 'storycluster-state-v1', topic_id: 'topic', next_cluster_seq: 1, clusters: [] }),
        saveTopic: () => undefined,
        readiness: () => ({ ok: true, detail: 'memory-store' }),
      },
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 4310;

    const ready = await fetch(`http://127.0.0.1:${port}/api/ready`);
    expect(ready.status).toBe(200);
    server.close();
  });

  it('uses the default store when no store override is provided', async () => {
    process.env.VITEST = 'true';
    const server = createStoryClusterServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 4310;

    const ready = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(ready.status).toBe(200);
    server.close();
  });
});
