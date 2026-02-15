/**
 * HERMES Docs Store — Stage 1 (single-author, no CRDT)
 *
 * Zustand store for HermesDocument CRUD: createDraft, saveDraft,
 * publishArticle, getDraft, listDrafts.
 *
 * Feature flag: VITE_HERMES_DOCS_ENABLED (default false).
 * Drafts are private by default — no publish side effects on create/save.
 */

import { create } from 'zustand';
import {
  DocPublishLinkSchema,
  FeedItemSchema,
  ForumPostSchema,
  HermesDocumentSchema,
  HermesThreadSchema,
  type DocPublishLink,
  type FeedItem,
  type ForumPost,
  type HermesDocument,
  type HermesThread,
} from '@vh/data-model';
import { getForumThreadChain } from '@vh/gun-client';
import { useDiscoveryStore } from './discovery';
import { useAppStore } from './index';
import { serializeThreadForGun, stripUndefined } from './forum/helpers';

// ── Feature flag ──────────────────────────────────────────────────────
const DOCS_ENABLED =
  typeof import.meta !== 'undefined' &&
  (import.meta as any).env?.VITE_HERMES_DOCS_ENABLED === 'true';

const FORUM_CONTENT_LIMIT = 10_000;
const FORUM_THREAD_PREFIX = 'article-thread-';

// ── Types ─────────────────────────────────────────────────────────────

export interface SourceContext {
  sourceTopicId?: string;
  sourceSynthesisId?: string;
  sourceEpoch?: number;
  sourceThreadId?: string;
}

export interface PublishBackArtifacts {
  link: DocPublishLink;
  forumThread?: HermesThread;
  forumPost: ForumPost;
  discoveryItem: FeedItem;
}

export interface DocsState {
  documents: Map<string, HermesDocument>;
  enabled: boolean;
  createDraft: (fromReplyText: string, sourceContext?: SourceContext) => HermesDocument | null;
  saveDraft: (docId: string, updates: Partial<Pick<HermesDocument, 'title' | 'encryptedContent' | 'type'>>) => void;
  publishArticle: (docId: string) => void;
  getDraft: (docId: string) => HermesDocument | undefined;
  listDrafts: () => HermesDocument[];
  listPublished: () => HermesDocument[];
}

export interface DocsDeps {
  now: () => number;
  randomId: () => string;
  owner: () => string;
  publishBack: (artifacts: PublishBackArtifacts) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** @internal exported for testing only */
export function defaultRandomId(): string {
  /* v8 ignore next 3 -- fallback for environments without crypto.randomUUID */
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    return `${Date.now()}-${Math.random()}`;
  }
  return crypto.randomUUID();
}

function toForumContent(content: string): string {
  return content.slice(0, FORUM_CONTENT_LIMIT);
}

export function createPublishBackArtifacts(
  doc: HermesDocument,
  deps: Pick<DocsDeps, 'now' | 'randomId'>,
): PublishBackArtifacts {
  const threadId = doc.sourceThreadId ?? `${FORUM_THREAD_PREFIX}${doc.id}`;
  const topicId = doc.sourceTopicId ?? threadId;
  const publishedAt = deps.now();
  const articleId = deps.randomId();

  const link = DocPublishLinkSchema.parse({
    docId: doc.id,
    topicId,
    ...(doc.sourceSynthesisId ? { synthesisId: doc.sourceSynthesisId } : {}),
    ...(doc.sourceEpoch != null ? { epoch: doc.sourceEpoch } : {}),
    threadId,
    articleId,
    publishedAt,
  });

  const forumContent = toForumContent(doc.encryptedContent);

  const forumPost = ForumPostSchema.parse({
    id: `post-${link.articleId}`,
    schemaVersion: 'hermes-post-v0',
    threadId: /* v8 ignore next -- threadId always set via fallback */ link.threadId ?? threadId,
    parentId: null,
    topicId: link.topicId,
    author: doc.owner,
    type: 'article',
    content: forumContent,
    timestamp: link.publishedAt,
    upvotes: 0,
    downvotes: 0,
    articleRefId: link.articleId,
  });

  const discoveryItem = FeedItemSchema.parse({
    topic_id: link.articleId,
    kind: 'ARTICLE',
    title: doc.title,
    created_at: link.publishedAt,
    latest_activity_at: link.publishedAt,
    hotness: 0,
    eye: 0,
    lightbulb: 0,
    comments: 0,
  });

  const forumThread = doc.sourceThreadId
    ? undefined
    : HermesThreadSchema.parse({
      id: threadId,
      schemaVersion: 'hermes-thread-v0',
      title: doc.title,
      content: forumContent,
      author: doc.owner,
      timestamp: link.publishedAt,
      tags: ['article'],
      topicId: link.topicId,
      /* v8 ignore next -- both branches tested via with/without synthesisId tests */
      ...(link.synthesisId ? { sourceAnalysisId: link.synthesisId } : {}),
      upvotes: 0,
      downvotes: 0,
      score: 0,
    });

  return {
    link,
    forumThread,
    forumPost,
    discoveryItem,
  };
}

/* v8 ignore next 5 -- thin runtime integration wrapper; tested via publishBack mock dep */
function fireAndForget(operation: unknown) {
  void Promise.resolve(operation).catch((error: unknown) => {
    console.warn('[vh:docs] publish back runtime write failed', error);
  });
}

/* v8 ignore start -- runtime Gun integration; unit tests exercise via mock publishBack dep */
export function publishBackToRuntime(artifacts: PublishBackArtifacts): void {
  useDiscoveryStore.getState().mergeItems([artifacts.discoveryItem]);

  const client = useAppStore.getState().client;
  if (!client) return;

  if (artifacts.forumThread) {
    const threadForGun = serializeThreadForGun(artifacts.forumThread as any);
    fireAndForget(
      getForumThreadChain(client, artifacts.forumThread.id).put(threadForGun as any, /* v8 ignore next 3 -- async Gun ack callback */ (ack?: { err?: string }) => {
        if (ack?.err) {
          console.warn('[vh:docs] failed to write forum thread publish payload', ack.err);
        }
      }),
    );
  }

  fireAndForget(
    getForumThreadChain(client, artifacts.forumPost.threadId)
      .get('posts')
      .get(artifacts.forumPost.id)
      .put(stripUndefined(artifacts.forumPost as any), /* v8 ignore next 3 -- async Gun ack callback */ (ack?: { err?: string }) => {
        if (ack?.err) {
          console.warn('[vh:docs] failed to write forum post publish payload', ack.err);
        }
      }),
  );
}
/* v8 ignore stop */

// ── Factory ───────────────────────────────────────────────────────────

export function createDocsStore(overrides?: Partial<DocsDeps>, forceEnabled?: boolean) {
  const enabled = forceEnabled ?? DOCS_ENABLED;

  const deps: DocsDeps = {
    now: overrides?.now ?? (() => Date.now()),
    randomId: overrides?.randomId ?? defaultRandomId,
    owner: overrides?.owner ?? (() => 'anonymous'),
    publishBack: overrides?.publishBack ?? publishBackToRuntime,
  };

  return create<DocsState>((set, get) => ({
    documents: new Map(),
    enabled,

    createDraft(fromReplyText: string, sourceContext?: SourceContext): HermesDocument | null {
      if (!get().enabled) return null;

      const now = deps.now();
      const id = deps.randomId();
      const ownerValue = deps.owner();

      const doc: HermesDocument = HermesDocumentSchema.parse({
        id,
        schemaVersion: 'hermes-document-v0',
        title: 'Untitled',
        type: 'article',
        owner: ownerValue,
        collaborators: [],
        encryptedContent: fromReplyText,
        createdAt: now,
        lastModifiedAt: now,
        lastModifiedBy: ownerValue,
        ...(sourceContext?.sourceTopicId ? { sourceTopicId: sourceContext.sourceTopicId } : {}),
        ...(sourceContext?.sourceSynthesisId ? { sourceSynthesisId: sourceContext.sourceSynthesisId } : {}),
        ...(sourceContext?.sourceEpoch != null ? { sourceEpoch: sourceContext.sourceEpoch } : {}),
        ...(sourceContext?.sourceThreadId ? { sourceThreadId: sourceContext.sourceThreadId } : {}),
      });

      set((state) => {
        const next = new Map(state.documents);
        next.set(id, doc);
        return { documents: next };
      });

      return doc;
    },

    saveDraft(docId: string, updates: Partial<Pick<HermesDocument, 'title' | 'encryptedContent' | 'type'>>) {
      if (!get().enabled) return;

      set((state) => {
        const existing = state.documents.get(docId);
        if (!existing) return state;
        if (existing.publishedAt != null) return state; // cannot edit published

        const updated: HermesDocument = {
          ...existing,
          ...updates,
          lastModifiedAt: deps.now(),
        };
        const next = new Map(state.documents);
        next.set(docId, updated);
        return { documents: next };
      });
    },

    publishArticle(docId: string) {
      if (!get().enabled) return;

      const existing = get().documents.get(docId);
      if (!existing) return;
      if (existing.publishedAt != null) return; // already published

      const artifacts = createPublishBackArtifacts(existing, deps);

      const published: HermesDocument = {
        ...existing,
        sourceTopicId: artifacts.link.topicId,
        ...(artifacts.link.synthesisId ? { sourceSynthesisId: artifacts.link.synthesisId } : {}),
        ...(artifacts.link.epoch != null ? { sourceEpoch: artifacts.link.epoch } : {}),
        /* v8 ignore next -- threadId always set via createPublishBackArtifacts fallback */
        ...(artifacts.link.threadId ? { sourceThreadId: artifacts.link.threadId } : {}),
        publishedAt: artifacts.link.publishedAt,
        publishedArticleId: artifacts.link.articleId,
        lastModifiedAt: artifacts.link.publishedAt,
      };

      set((state) => {
        const next = new Map(state.documents);
        next.set(docId, published);
        return { documents: next };
      });

      try {
        deps.publishBack(artifacts);
      } catch (error) {
        console.warn('[vh:docs] publish back failed', error);
      }
    },

    getDraft(docId: string): HermesDocument | undefined {
      return get().documents.get(docId);
    },

    listDrafts(): HermesDocument[] {
      return Array.from(get().documents.values()).filter((d) => d.publishedAt == null);
    },

    listPublished(): HermesDocument[] {
      return Array.from(get().documents.values()).filter((d) => d.publishedAt != null);
    },
  }));
}

// ── Default singleton (gated by feature flag) ─────────────────────────

export const useDocsStore = createDocsStore();

// ── Mock factory (for E2E) ────────────────────────────────────────────

export function createMockHermesDocsStore(overrides?: Partial<DocsDeps>) {
  return createDocsStore(
    {
      now: overrides?.now ?? (() => Date.now()),
      randomId: overrides?.randomId ?? (() => `mock-doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      owner: overrides?.owner ?? (() => 'mock-owner'),
      publishBack: overrides?.publishBack ?? publishBackToRuntime,
    },
    true, // force enabled
  );
}
