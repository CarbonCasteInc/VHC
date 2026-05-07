/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocPublishLinkSchema } from '@vh/data-model';
import {
  createDocsStore,
  createMockHermesDocsStore,
  defaultRandomId,
  type DocsDeps,
  type DocsState,
} from './hermesDocs';
import { useDiscoveryStore } from './discovery';
import { useAppStore } from './index';
import type { StoreApi, UseBoundStore } from 'zustand';

vi.mock('@vh/identity-vault', () => ({
  signWithStoredDelegationSigningKey: vi.fn(async () => 'test-delegation-signature')
}));

// ── Helpers ───────────────────────────────────────────────────────────

let counter = 0;
const TEST_PRINCIPAL_NULLIFIER = 'test-principal-nullifier';
const fakeIdentity = {
  handle: 'test-handle',
  session: {
    token: 'test-session-token',
    nullifier: TEST_PRINCIPAL_NULLIFIER,
    trustScore: 1,
    scaledTrustScore: 9000,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_086_400_000,
  },
};
const fakeDeps: Partial<DocsDeps> = {
  now: () => 1_700_000_000_000 + counter++,
  randomId: () => `id-${counter++}`,
  owner: () => 'test-owner',
  identity: () => fakeIdentity as any,
  publishBack: () => {},
};

function makeStore(enabled = true): UseBoundStore<StoreApi<DocsState>> {
  counter = 0;
  return createDocsStore(fakeDeps, enabled);
}

function createRuntimeClientRecorder() {
  const writes = new Map<string, unknown>();

  const makeNode = (segments: string[]): any => ({
    get(key: string) {
      return makeNode([...segments, key]);
    },
    once(callback: (value: unknown) => void) {
      callback(undefined);
    },
    put(value: unknown, callback?: (ack?: { err?: string }) => void) {
      writes.set(segments.join('/'), value);
      callback?.({});
      return Promise.resolve();
    },
  });

  const client = {
    mesh: {
      get(scope: string) {
        return makeNode(['vh', scope]);
      },
    },
    hydrationBarrier: {
      ready: true,
      prepare: vi.fn().mockResolvedValue(undefined),
    },
    topologyGuard: {
      validateWrite: vi.fn(),
    },
  } as any;

  return { client, writes };
}

beforeEach(() => {
  counter = 0;
  useDiscoveryStore.getState().reset();
  useAppStore.setState({ client: null });
});

afterEach(() => {
  useDiscoveryStore.getState().reset();
  useAppStore.setState({ client: null });
});

// ── Schema validation ─────────────────────────────────────────────────

describe('hermesDocs store – createDraft', () => {
  it('creates a valid HermesDocument from reply text', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('Hello world');
    expect(doc).not.toBeNull();
    expect(doc!.encryptedContent).toBe('Hello world');
    expect(doc!.type).toBe('article');
    expect(doc!.schemaVersion).toBe('hermes-document-v0');
    expect(doc!.owner).toBe('test-owner');
    expect(doc!.collaborators).toEqual([]);
    expect(doc!.title).toBe('Untitled');
  });

  it('populates source context fields', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('content', {
      sourceTopicId: 'topic-1',
      sourceSynthesisId: 'synth-1',
      sourceEpoch: 42,
      sourceThreadId: 'thread-1',
    });
    expect(doc).not.toBeNull();
    expect(doc!.sourceTopicId).toBe('topic-1');
    expect(doc!.sourceSynthesisId).toBe('synth-1');
    expect(doc!.sourceEpoch).toBe(42);
    expect(doc!.sourceThreadId).toBe('thread-1');
  });

  it('stores draft in documents map', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('stored');
    expect(store.getState().documents.size).toBe(1);
    expect(store.getState().documents.get(doc!.id)).toEqual(doc);
  });

  it('does not set publishedAt or publishedArticleId on create', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('private draft');
    expect(doc!.publishedAt).toBeUndefined();
    expect(doc!.publishedArticleId).toBeUndefined();
  });
});

// ── CRUD operations ───────────────────────────────────────────────────

describe('hermesDocs store – saveDraft', () => {
  it('updates title and content', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('initial');
    store.getState().saveDraft(doc!.id, {
      title: 'My Article',
      encryptedContent: 'updated content',
    });
    const saved = store.getState().getDraft(doc!.id);
    expect(saved!.title).toBe('My Article');
    expect(saved!.encryptedContent).toBe('updated content');
  });

  it('updates type', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('initial');
    store.getState().saveDraft(doc!.id, { type: 'proposal' });
    expect(store.getState().getDraft(doc!.id)!.type).toBe('proposal');
  });

  it('updates lastModifiedAt on save', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('initial');
    const createdAt = doc!.lastModifiedAt;
    store.getState().saveDraft(doc!.id, { title: 'updated' });
    expect(store.getState().getDraft(doc!.id)!.lastModifiedAt).toBeGreaterThan(createdAt);
  });

  it('does not save to a non-existent docId', () => {
    const store = makeStore();
    store.getState().saveDraft('non-existent', { title: 'nope' });
    expect(store.getState().documents.size).toBe(0);
  });

  it('does not allow saving a published document', async () => {
    const store = makeStore();
    const doc = store.getState().createDraft('pub');
    await store.getState().publishArticle(doc!.id);
    const beforeSave = store.getState().getDraft(doc!.id)!.title;
    store.getState().saveDraft(doc!.id, { title: 'changed' });
    expect(store.getState().getDraft(doc!.id)!.title).toBe(beforeSave);
  });
});

describe('hermesDocs store – publishArticle', () => {
  it('sets publishedAt and publishedArticleId', async () => {
    const store = makeStore();
    const doc = store.getState().createDraft('to publish');
    await store.getState().publishArticle(doc!.id);
    const published = store.getState().getDraft(doc!.id);
    expect(published!.publishedAt).toBeGreaterThan(0);
    expect(published!.publishedArticleId).toBeTruthy();
  });

  it('wires full DocPublishLink contract and publish-back payloads', async () => {
    const publishBack = vi.fn();
    const store = createDocsStore({
      ...fakeDeps,
      publishBack,
    }, true);
    const doc = store.getState().createDraft('contract body', {
      sourceTopicId: 'topic-1',
      sourceSynthesisId: 'synth-1',
      sourceEpoch: 7,
      sourceThreadId: 'thread-1',
    });
    store.getState().saveDraft(doc!.id, { title: 'Linked Article' });

    await store.getState().publishArticle(doc!.id);

    expect(publishBack).toHaveBeenCalledTimes(1);
    const artifacts = publishBack.mock.calls[0][0];
    const link = DocPublishLinkSchema.parse(artifacts.link);

    expect(link).toMatchObject({
      docId: doc!.id,
      topicId: 'topic-1',
      synthesisId: 'synth-1',
      epoch: 7,
      threadId: 'thread-1',
    });
    expect(artifacts.forumThread).toBeUndefined();
    expect(artifacts.forumPost).toMatchObject({
      schemaVersion: 'hermes-post-v1',
      _protocolVersion: 'luma-public-v1',
      _writerKind: 'luma',
      _authorScheme: 'forum-author-v1',
      threadId: 'thread-1',
      topicId: 'topic-1',
      type: 'article',
      articleRefId: link.articleId,
      author: expect.stringMatching(/^[0-9a-f]{64}$/),
      signedWriteEnvelope: expect.objectContaining({
        audience: 'vh-forum-post',
        scheme: 'forum-author-v1',
        publicAuthor: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(artifacts.forumPost.author).not.toBe(TEST_PRINCIPAL_NULLIFIER);
    expect(artifacts.forumPost.author).not.toBe(doc!.owner);
    expect(artifacts.discoveryItem).toMatchObject({
      topic_id: link.articleId,
      kind: 'ARTICLE',
      title: 'Linked Article',
      created_at: link.publishedAt,
    });

    const published = store.getState().getDraft(doc!.id)!;
    expect(published.sourceTopicId).toBe(link.topicId);
    expect(published.sourceSynthesisId).toBe(link.synthesisId);
    expect(published.sourceEpoch).toBe(link.epoch);
    expect(published.sourceThreadId).toBe(link.threadId);
    expect(published.publishedArticleId).toBe(link.articleId);
    expect(published.publishedAt).toBe(link.publishedAt);
  });

  it('creates a deterministic forum thread payload when sourceThreadId is absent', async () => {
    const publishBack = vi.fn();
    const store = createDocsStore({
      ...fakeDeps,
      publishBack,
    }, true);
    const doc = store.getState().createDraft('deterministic', {
      sourceTopicId: 'topic-without-thread',
      sourceSynthesisId: 'synth-without-thread',
      sourceEpoch: 9,
    });

    await store.getState().publishArticle(doc!.id);

    const artifacts = publishBack.mock.calls[0][0];
    const expectedThreadId = `article-thread-${doc!.id}`;
    expect(artifacts.link.threadId).toBe(expectedThreadId);
    expect(artifacts.forumThread?.id).toBe(expectedThreadId);
    expect(artifacts.forumThread?.schemaVersion).toBe('hermes-thread-v1');
    expect(artifacts.forumThread?.sourceEpoch).toBe(9);
    expect(artifacts.forumThread?.signedWriteEnvelope.audience).toBe('vh-forum-thread');
    expect(artifacts.forumPost.threadId).toBe(expectedThreadId);
  });

  it('fails closed through the default identity accessor when no active identity exists', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const publishBack = vi.fn();
      const store = createDocsStore({
        now: () => 1_700_000_000_000,
        randomId: () => 'default-identity-doc',
        owner: () => 'default-identity-owner',
        publishBack,
      }, true);
      const doc = store.getState().createDraft('unsigned default identity publish');

      await expect(store.getState().publishArticle(doc!.id)).resolves.toBe(false);

      expect(publishBack).not.toHaveBeenCalled();
      expect(store.getState().getDraft(doc!.id)!.publishedAt).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('writes forum publish payloads and discovery ARTICLE item on default runtime path', async () => {
    const { client, writes } = createRuntimeClientRecorder();
    useAppStore.setState({ client });
    expect(useAppStore.getState().client).toBe(client);

    let idCounter = 0;
    const store = createDocsStore({
      now: () => 1_700_000_000_000,
      randomId: () => `runtime-${++idCounter}`,
      owner: () => 'runtime-owner',
      identity: () => fakeIdentity as any,
    }, true);

    const doc = store.getState().createDraft('runtime payload');
    store.getState().saveDraft(doc!.id, { title: 'Runtime Linked Article' });
    await store.getState().publishArticle(doc!.id);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const published = store.getState().getDraft(doc!.id)!;
    const expectedThreadId = `article-thread-${doc!.id}`;
    const expectedPostPath = `vh/forum/threads/${expectedThreadId}/posts/post-${published.publishedArticleId}`;

    expect(writes.get(`vh/forum/threads/${expectedThreadId}`)).toEqual(
      expect.objectContaining({
        id: expectedThreadId,
        schemaVersion: 'hermes-thread-v1',
        _writerKind: 'luma',
        signedWriteEnvelope: expect.objectContaining({ audience: 'vh-forum-thread' }),
      }),
    );
    expect(writes.get(expectedPostPath)).toEqual(
      expect.objectContaining({
        schemaVersion: 'hermes-post-v1',
        _writerKind: 'luma',
        threadId: expectedThreadId,
        type: 'article',
        articleRefId: published.publishedArticleId,
        author: expect.stringMatching(/^[0-9a-f]{64}$/),
        signedWriteEnvelope: expect.objectContaining({ audience: 'vh-forum-post' }),
      }),
    );
    expect(useDiscoveryStore.getState().items).toContainEqual(
      expect.objectContaining({
        topic_id: published.publishedArticleId,
        kind: 'ARTICLE',
        title: 'Runtime Linked Article',
      }),
    );
  });

  it('does not double-publish', async () => {
    const store = makeStore();
    const doc = store.getState().createDraft('once');
    await store.getState().publishArticle(doc!.id);
    const firstPublished = store.getState().getDraft(doc!.id)!;
    await store.getState().publishArticle(doc!.id);
    const secondPublished = store.getState().getDraft(doc!.id)!;
    expect(firstPublished.publishedAt).toBe(secondPublished.publishedAt);
    expect(firstPublished.publishedArticleId).toBe(secondPublished.publishedArticleId);
  });

  it('no-ops for non-existent docId', async () => {
    const store = makeStore();
    await store.getState().publishArticle('ghost');
    expect(store.getState().documents.size).toBe(0);
  });

  it('fails closed without an active identity and does not mark the document published', async () => {
    const publishBack = vi.fn();
    const store = createDocsStore({
      ...fakeDeps,
      identity: () => null,
      publishBack,
    }, true);
    const doc = store.getState().createDraft('unsigned publish');

    await expect(store.getState().publishArticle(doc!.id)).resolves.toBe(false);

    expect(publishBack).not.toHaveBeenCalled();
    expect(store.getState().getDraft(doc!.id)!.publishedAt).toBeUndefined();
    expect(store.getState().getDraft(doc!.id)!.publishedArticleId).toBeUndefined();
  });
});

describe('hermesDocs store – listPublished', () => {
  it('returns only published documents', async () => {
    const store = makeStore();
    const doc1 = store.getState().createDraft('draft1');
    const doc2 = store.getState().createDraft('draft2');
    await store.getState().publishArticle(doc1!.id);
    const published = store.getState().listPublished();
    expect(published).toHaveLength(1);
    expect(published[0].id).toBe(doc1!.id);
  });

  it('returns empty when no documents are published', () => {
    const store = makeStore();
    store.getState().createDraft('a');
    store.getState().createDraft('b');
    expect(store.getState().listPublished()).toHaveLength(0);
  });

  it('returns all published documents', async () => {
    const store = makeStore();
    const doc1 = store.getState().createDraft('a');
    const doc2 = store.getState().createDraft('b');
    const doc3 = store.getState().createDraft('c');
    await store.getState().publishArticle(doc1!.id);
    await store.getState().publishArticle(doc3!.id);
    const published = store.getState().listPublished();
    expect(published).toHaveLength(2);
    expect(published.map((d) => d.id)).toContain(doc1!.id);
    expect(published.map((d) => d.id)).toContain(doc3!.id);
  });

  it('returns empty array when store is empty', () => {
    const store = makeStore();
    expect(store.getState().listPublished()).toHaveLength(0);
  });
});

describe('hermesDocs store – getDraft / listDrafts', () => {
  it('getDraft returns undefined for missing id', () => {
    const store = makeStore();
    expect(store.getState().getDraft('nope')).toBeUndefined();
  });

  it('listDrafts excludes published documents', async () => {
    const store = makeStore();
    const doc1 = store.getState().createDraft('draft1');
    const doc2 = store.getState().createDraft('draft2');
    await store.getState().publishArticle(doc1!.id);
    const drafts = store.getState().listDrafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(doc2!.id);
  });

  it('listDrafts returns all unpublished documents', () => {
    const store = makeStore();
    store.getState().createDraft('a');
    store.getState().createDraft('b');
    store.getState().createDraft('c');
    expect(store.getState().listDrafts()).toHaveLength(3);
  });
});

// ── Draft privacy ─────────────────────────────────────────────────────

describe('hermesDocs store – draft privacy', () => {
  it('createDraft has no publish side effects', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('secret');
    expect(doc!.publishedAt).toBeUndefined();
    expect(doc!.publishedArticleId).toBeUndefined();
  });

  it('saveDraft has no publish side effects', () => {
    const store = makeStore();
    const doc = store.getState().createDraft('secret');
    store.getState().saveDraft(doc!.id, { title: 'still private' });
    const saved = store.getState().getDraft(doc!.id);
    expect(saved!.publishedAt).toBeUndefined();
    expect(saved!.publishedArticleId).toBeUndefined();
  });
});

// ── Feature flag ──────────────────────────────────────────────────────

describe('hermesDocs store – flag off', () => {
  it('createDraft returns null when disabled', () => {
    const store = makeStore(false);
    expect(store.getState().createDraft('nope')).toBeNull();
    expect(store.getState().documents.size).toBe(0);
  });

  it('saveDraft is no-op when disabled', () => {
    const store = createDocsStore(fakeDeps, true);
    const doc = store.getState().createDraft('x');
    // Create a disabled store with same data
    const disabled = makeStore(false);
    disabled.getState().saveDraft(doc!.id, { title: 'y' });
    expect(disabled.getState().documents.size).toBe(0);
  });

  it('publishArticle is no-op when disabled', async () => {
    const store = makeStore(false);
    await store.getState().publishArticle('anything');
    expect(store.getState().documents.size).toBe(0);
  });

  it('enabled flag is false', () => {
    const store = makeStore(false);
    expect(store.getState().enabled).toBe(false);
  });

  it('enabled flag is true when force-enabled', () => {
    const store = makeStore(true);
    expect(store.getState().enabled).toBe(true);
  });
});

// ── Mock factory ──────────────────────────────────────────────────────

describe('hermesDocs store – defaultRandomId path', () => {
  it('uses built-in randomId when no override provided (crypto available)', () => {
    const store = createDocsStore({ now: () => 1_700_000_000_000, owner: () => 'o' }, true);
    const doc = store.getState().createDraft('text');
    expect(doc).not.toBeNull();
    expect(doc!.id).toBeTruthy();
    expect(typeof doc!.id).toBe('string');
  });

  it('exercises defaultRandomId directly', () => {
    const result = defaultRandomId();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('uses default deps when no overrides at all', () => {
    const store = createDocsStore(undefined, true);
    const doc = store.getState().createDraft('text');
    expect(doc).not.toBeNull();
    expect(doc!.owner).toBe('anonymous');
  });
});

describe('createMockHermesDocsStore', () => {
  it('creates an enabled store', () => {
    const store = createMockHermesDocsStore();
    expect(store.getState().enabled).toBe(true);
  });

  it('supports full CRUD cycle', async () => {
    const store = createMockHermesDocsStore({ identity: () => fakeIdentity as any });
    const doc = store.getState().createDraft('mock content');
    expect(doc).not.toBeNull();
    expect(doc!.owner).toBe('mock-owner');

    store.getState().saveDraft(doc!.id, { title: 'Mock Title' });
    expect(store.getState().getDraft(doc!.id)!.title).toBe('Mock Title');

    await store.getState().publishArticle(doc!.id);
    expect(store.getState().getDraft(doc!.id)!.publishedAt).toBeGreaterThan(0);
  });

  it('publishArticle catches publishBack errors gracefully', async () => {
    const publishBack = vi.fn(() => {
      throw new Error('runtime write failed');
    });
    const store = createMockHermesDocsStore({ identity: () => fakeIdentity as any, publishBack });
    store.getState().createDraft('text');
    const docs = Array.from(store.getState().documents.values());
    const docId = docs[0].id;

    // Should not reject — error is caught internally
    await expect(store.getState().publishArticle(docId)).resolves.toBe(true);
    expect(publishBack).toHaveBeenCalledTimes(1);
    // doc is now published despite publishBack error (state updated before publishBack call)
    const published = store.getState().documents.get(docId);
    expect(published!.publishedAt).not.toBeNull();
  });

  it('exports correctly', () => {
    expect(typeof createMockHermesDocsStore).toBe('function');
  });

  it('accepts custom deps', () => {
    const store = createMockHermesDocsStore({
      owner: () => 'custom-owner',
    });
    const doc = store.getState().createDraft('text');
    expect(doc!.owner).toBe('custom-owner');
  });

  it('uses the default mock-store identity accessor and fails closed without identity', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const publishBack = vi.fn();
      const store = createMockHermesDocsStore({ publishBack });
      const doc = store.getState().createDraft('mock unsigned');

      await expect(store.getState().publishArticle(doc!.id)).resolves.toBe(false);

      expect(publishBack).not.toHaveBeenCalled();
      expect(store.getState().getDraft(doc!.id)!.publishedAt).toBeUndefined();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
