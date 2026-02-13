import { describe, expect, it, vi } from 'vitest';
import { HydrationBarrier } from './sync/barrier';
import type { TopologyGuard } from './topology';
import type { VennClient } from './index';
import {
  getArticleChain,
  getDocKeysChain,
  getDocsChain,
  getDocsOpsChain,
  getUserDocsChain
} from './docsAdapters';

function createMockChain() {
  const chain: any = {};
  chain.once = vi.fn((cb?: (data: unknown) => void) => cb?.({}));
  chain.put = vi.fn((_value: any, cb?: (ack?: any) => void) => cb?.({}));
  chain.get = vi.fn(() => chain);
  return chain;
}

function createClient(chain: any, userChain: any, guard: TopologyGuard): VennClient {
  const barrier = new HydrationBarrier();
  barrier.markReady();
  return {
    gun: { get: vi.fn(() => chain), user: vi.fn(() => userChain) } as any,
    mesh: chain,
    hydrationBarrier: barrier,
    topologyGuard: guard,
    config: { peers: [] },
    storage: {} as any,
    user: {} as any,
    chat: {} as any,
    outbox: {} as any,
    sessionReady: true,
    markSessionReady: vi.fn(),
    linkDevice: vi.fn(),
    shutdown: vi.fn()
  };
}

describe('docsAdapters', () => {
  describe('getUserDocsChain', () => {
    it('builds user docs chain with correct path guard', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'alice-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docsChain = getUserDocsChain(client);
      await docsChain.get('doc-1').put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~alice-pub/hermes/docs/doc-1/',
        expect.anything()
      );
    });

    it('uses "unknown" pub when user is not authenticated', async () => {
      const chain = createMockChain();
      const userChain = createMockChain();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docsChain = getUserDocsChain(client);
      await docsChain.put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~unknown/hermes/docs/',
        expect.anything()
      );
    });

    it('uses "unknown" pub for getDocsChain when unauthenticated', async () => {
      const chain = createMockChain();
      const userChain = createMockChain();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docChain = getDocsChain(client, 'doc-unauth');
      await docChain.put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~unknown/hermes/docs/doc-unauth/',
        expect.anything()
      );
    });

    it('uses "unknown" pub for getDocsOpsChain when unauthenticated', async () => {
      const chain = createMockChain();
      const userChain = createMockChain();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const opsChain = getDocsOpsChain(client, 'doc-unauth');
      await opsChain.put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~unknown/docs/doc-unauth/ops/',
        expect.anything()
      );
    });

    it('uses "unknown" pub for getDocKeysChain when unauthenticated', async () => {
      const chain = createMockChain();
      const userChain = createMockChain();
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const keysChain = getDocKeysChain(client, 'doc-unauth');
      await keysChain.put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~unknown/hermes/docKeys/doc-unauth/',
        expect.anything()
      );
    });
  });

  describe('getDocsChain', () => {
    it('builds single doc chain with correct path guard', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'bob-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docChain = getDocsChain(client, 'doc-xyz');
      await docChain.put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~bob-pub/hermes/docs/doc-xyz/',
        expect.anything()
      );
    });

    it('tracks nested path through get()', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'bob-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docChain = getDocsChain(client, 'doc-xyz');
      await docChain.get('metadata').put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~bob-pub/hermes/docs/doc-xyz/metadata/',
        expect.anything()
      );
    });
  });

  describe('getDocsOpsChain', () => {
    it('builds ops chain with correct path guard', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'carol-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const opsChain = getDocsOpsChain(client, 'doc-123');
      await opsChain.get('op-1').put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~carol-pub/docs/doc-123/ops/op-1/',
        expect.anything()
      );
    });
  });

  describe('getDocKeysChain', () => {
    it('builds doc keys chain with correct path guard', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'dave-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const keysChain = getDocKeysChain(client, 'doc-456');
      await keysChain.get('collab-key-1').put({ __encrypted: true } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        '~dave-pub/hermes/docKeys/doc-456/collab-key-1/',
        expect.anything()
      );
    });
  });

  describe('getArticleChain', () => {
    it('builds article chain with correct public path guard', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'eve-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const articleChain = getArticleChain(client, 'topic-abc', 'article-def');
      await articleChain.put({ title: 'Published Article' } as any);

      expect(guard.validateWrite).toHaveBeenCalledWith(
        'vh/topics/topic-abc/articles/article-def/',
        expect.anything()
      );
    });

    it('uses mesh root for public article paths (not user chain)', async () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'eve-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      getArticleChain(client, 'topic-1', 'art-1');

      // mesh.get('topics') is called through the chain mock
      expect(chain.get).toHaveBeenCalledWith('topics');
    });
  });

  describe('read operations', () => {
    it('getUserDocsChain supports once() for reading', () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'frank-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docsChain = getUserDocsChain(client);
      const callback = vi.fn();
      docsChain.once(callback);

      // The guarded chain delegates once() to the underlying user chain
      expect(userChain.once).toHaveBeenCalled();
    });

    it('getDocsChain supports once() for reading document', () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'grace-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const docChain = getDocsChain(client, 'doc-read');
      const callback = vi.fn();
      docChain.once(callback);

      // The guarded chain delegates once() to the underlying user chain
      expect(userChain.once).toHaveBeenCalled();
    });

    it('getDocsOpsChain supports once() for reading ops', () => {
      const chain = createMockChain();
      const userChain = Object.assign(createMockChain(), { is: { pub: 'henry-pub' } });
      const guard = { validateWrite: vi.fn() } as unknown as TopologyGuard;
      const client = createClient(chain, userChain, guard);

      const opsChain = getDocsOpsChain(client, 'doc-ops-read');
      const callback = vi.fn();
      opsChain.once(callback);

      // The guarded chain delegates once() to the underlying user chain
      expect(userChain.once).toHaveBeenCalled();
    });
  });
});
