import React from 'react';
import type { FeedItem } from '@vh/data-model';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';
import { FilterChips } from './FilterChips';
import { SortControls } from './SortControls';

export interface FeedShellProps {
  /** Discovery feed hook result (injected for testability). */
  readonly feedResult: UseDiscoveryFeedResult;
}

/**
 * Shell container for the V2 discovery feed.
 * Composes FilterChips + SortControls + feed item list.
 *
 * This component is mounted only when VITE_FEED_V2_ENABLED is on (C-5).
 * It does NOT gate itself — the flag guard lives in the page/route layer.
 *
 * Spec: docs/specs/spec-topic-discovery-ranking-v0.md §2
 */
export const FeedShell: React.FC<FeedShellProps> = ({ feedResult }) => {
  const { feed, filter, sortMode, loading, error, setFilter, setSortMode } =
    feedResult;

  return (
    <div className="flex flex-col gap-4" data-testid="feed-shell">
      {/* Controls row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <FilterChips active={filter} onSelect={setFilter} />
        <SortControls active={sortMode} onSelect={setSortMode} />
      </div>

      {/* Feed content area */}
      <FeedContent feed={feed} loading={loading} error={error} />
    </div>
  );
};

// ---- Internal sub-components ----

interface FeedContentProps {
  readonly feed: ReadonlyArray<FeedItem>;
  readonly loading: boolean;
  readonly error: string | null;
}

const FeedContent: React.FC<FeedContentProps> = ({ feed, loading, error }) => {
  if (error) {
    return (
      <div
        role="alert"
        data-testid="feed-error"
        className="rounded bg-red-50 p-3 text-sm text-red-700"
      >
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div
        data-testid="feed-loading"
        className="py-8 text-center text-sm text-slate-400"
      >
        Loading feed…
      </div>
    );
  }

  if (feed.length === 0) {
    return (
      <div
        data-testid="feed-empty"
        className="py-8 text-center text-sm text-slate-400"
      >
        No items to show.
      </div>
    );
  }

  return (
    <ul data-testid="feed-list" className="space-y-3">
      {feed.map((item) => (
        <FeedItemRow key={item.topic_id} item={item} />
      ))}
    </ul>
  );
};

// ---- Placeholder item row (C-4 will replace with real cards) ----

interface FeedItemRowProps {
  readonly item: FeedItem;
}

const FeedItemRow: React.FC<FeedItemRowProps> = ({ item }) => {
  return (
    <li
      data-testid={`feed-item-${item.topic_id}`}
      className="rounded border border-slate-200 p-3"
    >
      <span className="text-sm font-medium">{item.title}</span>
      <span className="ml-2 text-xs text-slate-400">{item.kind}</span>
    </li>
  );
};

export default FeedShell;
