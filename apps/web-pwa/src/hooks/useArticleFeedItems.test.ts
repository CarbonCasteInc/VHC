/* @vitest-environment jsdom */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { docToFeedItem, useArticleFeedItems } from './useArticleFeedItems';
import type { HermesDocument } from '@vh/data-model';

// ── Mock data ─────────────────────────────────────────────────────────

const publishedDoc: HermesDocument = {
  id: 'doc-1',
  schemaVersion: 'hermes-document-v0',
  title: 'Published Article',
  type: 'article',
  owner: 'alice',
  collaborators: [],
  encryptedContent: 'Article body text.',
  createdAt: 1_700_000_000_000,
  lastModifiedAt: 1_700_000_002_000,
  lastModifiedBy: 'alice',
  publishedAt: 1_700_000_001_000,
  publishedArticleId: 'pub-article-1',
};

const draftDoc: HermesDocument = {
  id: 'doc-2',
  schemaVersion: 'hermes-document-v0',
  title: 'Draft Article',
  type: 'draft',
  owner: 'bob',
  collaborators: [],
  encryptedContent: 'Draft content.',
  createdAt: 1_700_000_000_000,
  lastModifiedAt: 1_700_000_000_000,
  lastModifiedBy: 'bob',
};

// ── Mock store ────────────────────────────────────────────────────────

let mockEnabled = true;
let mockPublished: HermesDocument[] = [];

vi.mock('../store/hermesDocs', () => ({
  useDocsStore: (selector?: any) => {
    const state = {
      enabled: mockEnabled,
      listPublished: () => mockPublished,
      documents: new Map(),
      createDraft: vi.fn(),
      saveDraft: vi.fn(),
      publishArticle: vi.fn(),
      getDraft: vi.fn(),
      listDrafts: vi.fn(() => []),
    };
    return selector ? selector(state) : state;
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────

describe('docToFeedItem', () => {
  it('converts a published document to FeedItem', () => {
    const item = docToFeedItem(publishedDoc);
    expect(item.topic_id).toBe('pub-article-1');
    expect(item.kind).toBe('ARTICLE');
    expect(item.title).toBe('Published Article');
    expect(item.created_at).toBe(1_700_000_001_000);
    expect(item.latest_activity_at).toBe(1_700_000_002_000);
    expect(item.hotness).toBe(0);
    expect(item.eye).toBe(0);
    expect(item.lightbulb).toBe(0);
    expect(item.comments).toBe(0);
  });

  it('falls back to doc.id when publishedArticleId is missing', () => {
    const item = docToFeedItem(draftDoc);
    expect(item.topic_id).toBe('doc-2');
  });

  it('falls back to createdAt when publishedAt is missing', () => {
    const item = docToFeedItem(draftDoc);
    expect(item.created_at).toBe(1_700_000_000_000);
  });
});

describe('useArticleFeedItems', () => {
  beforeEach(() => {
    mockEnabled = true;
    mockPublished = [];
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns empty array when no published articles', () => {
    mockPublished = [];
    const { result } = renderHook(() => useArticleFeedItems());
    expect(result.current).toEqual([]);
  });

  it('returns feed items for published articles', () => {
    mockPublished = [publishedDoc];
    const { result } = renderHook(() => useArticleFeedItems());
    expect(result.current).toHaveLength(1);
    expect(result.current[0].kind).toBe('ARTICLE');
    expect(result.current[0].title).toBe('Published Article');
  });

  it('returns empty array when VITE_FEED_V2_ENABLED is false', () => {
    vi.stubEnv('VITE_FEED_V2_ENABLED', 'false');
    mockPublished = [publishedDoc];
    const { result } = renderHook(() => useArticleFeedItems());
    expect(result.current).toEqual([]);
  });

  it('returns empty array when docs store is disabled', () => {
    mockEnabled = false;
    mockPublished = [publishedDoc];
    const { result } = renderHook(() => useArticleFeedItems());
    expect(result.current).toEqual([]);
  });

  it('returns multiple articles', () => {
    const secondDoc: HermesDocument = {
      ...publishedDoc,
      id: 'doc-3',
      title: 'Second Article',
      publishedArticleId: 'pub-article-2',
    };
    mockPublished = [publishedDoc, secondDoc];
    const { result } = renderHook(() => useArticleFeedItems());
    expect(result.current).toHaveLength(2);
    expect(result.current[0].title).toBe('Published Article');
    expect(result.current[1].title).toBe('Second Article');
  });
});
