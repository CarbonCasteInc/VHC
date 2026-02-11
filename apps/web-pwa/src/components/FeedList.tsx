import React, { useEffect, useMemo, useRef } from 'react';
import { useFeedStore } from '../hooks/useFeedStore';
import { useDiscoveryFeed } from '../hooks/useDiscoveryFeed';
import FeedShell from './feed/FeedShell';
import HeadlineCard from './HeadlineCard';

function isFeedV2Enabled(): boolean {
  const viteValue = (import.meta as unknown as { env?: { VITE_FEED_V2_ENABLED?: string } })
    .env?.VITE_FEED_V2_ENABLED;
  const nodeValue = typeof process !== 'undefined' ? process.env?.VITE_FEED_V2_ENABLED : undefined;
  return (nodeValue ?? viteValue) === 'true';
}

const LegacyFeedList: React.FC = () => {
  const { items, hydrate, loadMore, hasMore, loading } = useFeedStore();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const itemData = useMemo(() => items, [items]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      if (!hasMore || loading) return;
      const { scrollTop, clientHeight, scrollHeight } = el;
      if (scrollTop + clientHeight >= scrollHeight - 200) {
        loadMore();
      }
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [hasMore, loadMore, loading]);

  if (items.length === 0) {
    return <p className="text-sm text-slate-400">No stories yet.</p>;
  }

  return (
    <div ref={containerRef} className="h-[80vh] w-full space-y-3 overflow-y-auto px-1">
      {itemData.map((item) => (
        <HeadlineCard key={item.id} item={item} />
      ))}
    </div>
  );
};

const DiscoveryFeedList: React.FC = () => {
  const feedResult = useDiscoveryFeed();
  return <FeedShell feedResult={feedResult} />;
};

export const FeedList: React.FC = () => {
  return isFeedV2Enabled() ? <DiscoveryFeedList /> : <LegacyFeedList />;
};

export default FeedList;
