import React, { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useStoryRemoval, type UseStoryRemovalOptions } from './useStoryRemoval';
import { RemovalIndicator } from './RemovalIndicator';
import { NewsCard } from './NewsCard';

export interface NewsCardWithRemovalProps {
  readonly item: FeedItem;
  readonly removalOptions?: UseStoryRemovalOptions;
}

function resolveStoryBundle(
  stories: ReadonlyArray<StoryBundle>,
  item: FeedItem,
): StoryBundle | null {
  const normalizedTitle = item.title.trim();
  return (
    stories.find((s) => s.topic_id === item.topic_id && s.headline.trim() === normalizedTitle) ??
    stories.find((s) => s.headline.trim() === normalizedTitle) ??
    null
  );
}

function firstSourceUrlHash(story: StoryBundle | null): string | undefined {
  const first = story?.sources[0];
  if (!first) return undefined;
  return first.url_hash || undefined;
}

/**
 * Wrapper around NewsCard that checks removal status via Gun mesh.
 * If the story's primary source is marked as removed, shows a brief
 * RemovalIndicator then hides the card entirely.
 */
export const NewsCardWithRemoval: React.FC<NewsCardWithRemovalProps> = ({
  item,
  removalOptions,
}) => {
  const stories = useStore(useNewsStore, (s) => s.stories);
  const story = useMemo(() => resolveStoryBundle(stories, item), [stories, item]);
  const urlHash = useMemo(() => firstSourceUrlHash(story), [story]);

  const { isRemoved, removalReason } = useStoryRemoval(urlHash, removalOptions);
  const [dismissed, setDismissed] = useState(false);

  // Reset dismissed state if removal status changes
  useEffect(() => {
    if (!isRemoved) setDismissed(false);
  }, [isRemoved]);

  if (isRemoved && dismissed) return null;

  if (isRemoved) {
    return (
      <RemovalIndicator
        reason={removalReason ?? 'extraction-failed-permanently'}
        onDismiss={() => setDismissed(true)}
      />
    );
  }

  return <NewsCard item={item} />;
};

export default NewsCardWithRemoval;
