import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { StoryClusterRemoteEngine } from '../../../packages/ai-engine/src/clusterEngine';
import { createStoryClusterServer } from './server';

afterEach(() => {
  // explicit hook placeholder for future stubs
});

describe('storycluster-engine remote invocation contract', () => {
  it('is consumable by ai-engine StoryClusterRemoteEngine (daemon production path contract)', async () => {
    const server = createStoryClusterServer({
      authToken: 'contract-token',
      now: () => 1_710_000_099_000,
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    try {
      const address = server.address() as AddressInfo;
      const endpointUrl = `http://127.0.0.1:${address.port}/cluster`;
      const healthUrl = `http://127.0.0.1:${address.port}/health`;

      const healthResponse = await fetch(healthUrl, {
        headers: {
          authorization: 'Bearer contract-token',
        },
      });
      expect(healthResponse.status).toBe(200);

      const remoteEngine = new StoryClusterRemoteEngine({
        endpointUrl,
        headers: {
          authorization: 'Bearer contract-token',
        },
        timeoutMs: 1000,
      });

      const bundles = await remoteEngine.clusterBatch({
        topicId: 'topic-contract',
        items: [
          {
            sourceId: 'wire-a',
            publisher: 'Wire A',
            url: 'https://example.com/a',
            canonicalUrl: 'https://example.com/a',
            title: 'Breaking: Port attack triggers alerts',
            publishedAt: 1_710_000_000_000,
            summary: 'Authorities respond in the first hour',
            author: 'Desk',
            url_hash: 'hash-a',
            image_hash: 'img-a',
            language: 'en',
            translation_applied: false,
            cluster_text: 'port attack triggers alerts',
            entity_keys: ['port', 'alerts'],
          },
        ],
      });

      expect(bundles).toHaveLength(1);
      expect(bundles[0]?.schemaVersion).toBe('story-bundle-v0');
      expect(bundles[0]?.topic_id).toBe('topic-contract');
      expect(bundles[0]?.sources).toHaveLength(1);
      expect(bundles[0]?.cluster_features.entity_keys.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
