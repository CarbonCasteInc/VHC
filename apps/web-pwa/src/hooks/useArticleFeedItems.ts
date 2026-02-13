/**
 * useArticleFeedItems — converts published HermesDocuments into FeedItem format.
 *
 * Feature-gated: only returns items when both VITE_FEED_V2_ENABLED
 * and VITE_HERMES_DOCS_ENABLED are true.
 *
 * This hook bridges the hermesDocs store (w2b) with the discovery feed (team-c).
 */

import { useMemo } from 'react';
import type { FeedItem } from '@vh/data-model';
import type { HermesDocument } from '@vh/data-model';
import { useDocsStore } from '../store/hermesDocs';

/** Convert a published HermesDocument to a FeedItem. */
export function docToFeedItem(doc: HermesDocument): FeedItem {
  return {
    topic_id: doc.publishedArticleId ?? doc.id,
    kind: 'ARTICLE',
    title: doc.title,
    created_at: doc.publishedAt ?? doc.createdAt,
    latest_activity_at: doc.lastModifiedAt,
    hotness: 0,
    eye: 0,
    lightbulb: 0,
    comments: 0,
  };
}

/** Read the feed V2 feature flag. */
function isFeedV2Enabled(): boolean {
  /* v8 ignore next 2 -- browser runtime resolves import.meta differently */
  const viteValue = (
    import.meta as unknown as { env?: { VITE_FEED_V2_ENABLED?: string } }
  ).env?.VITE_FEED_V2_ENABLED;
  /* v8 ignore next 4 -- browser runtime may not expose process */
  const nodeValue =
    typeof process !== 'undefined'
      ? process.env?.VITE_FEED_V2_ENABLED
      : undefined;
  /* v8 ignore next 1 -- ?? fallback to viteValue only reachable in-browser (no process.env) */
  return (nodeValue ?? viteValue) === 'true';
}

const EMPTY_ITEMS: ReadonlyArray<FeedItem> = [];

/**
 * Returns published articles as FeedItem[] for integration with the discovery feed.
 * Returns empty array when feature flags are off.
 */
export function useArticleFeedItems(): ReadonlyArray<FeedItem> {
  const feedEnabled = isFeedV2Enabled();
  const { enabled: docsEnabled, listPublished } = useDocsStore();

  return useMemo(() => {
    if (!feedEnabled || !docsEnabled) return EMPTY_ITEMS;
    return listPublished().map(docToFeedItem);
  }, [feedEnabled, docsEnabled, listPublished]);
}
