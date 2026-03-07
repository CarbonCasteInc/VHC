import { afterEach, describe, expect, it } from 'vitest';
import { StoryClusterRemoteEngine } from '../../../packages/ai-engine/src/clusterEngine';
import { MemoryClusterStore } from './clusterStore';
import { startStoryClusterServer } from './server';

let server: ReturnType<typeof startStoryClusterServer> | null = null;

afterEach(() => {
  server?.close();
  server = null;
});

describe('storycluster-engine remote invocation contract', () => {
  it('is consumable by ai-engine StoryClusterRemoteEngine', async () => {
    server = startStoryClusterServer({ host: '127.0.0.1', port: 0, authToken: 'token-1', store: new MemoryClusterStore() });
    await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 4310;

    const engine = new StoryClusterRemoteEngine({
      endpointUrl: `http://127.0.0.1:${port}/cluster`,
      timeoutMs: 3000,
      headers: { authorization: 'Bearer token-1' },
    });

    const bundles = await engine.clusterBatch({
      topicId: 'topic-news',
      items: [{
        sourceId: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        canonicalUrl: 'https://example.com/a',
        title: 'Port attack disrupts terminals overnight',
        publishedAt: 100,
        summary: 'Officials say recovery talks begin Friday.',
        url_hash: 'hash-a',
        entity_keys: ['port_attack'],
      }],
    });

    expect(bundles).toHaveLength(1);
    expect(bundles[0]?.topic_id).toMatch(/^[a-f0-9]{64}$/);
  });
});
