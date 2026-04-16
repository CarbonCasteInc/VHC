import { useEffect, useMemo, useRef, useState } from 'react';
import { useSentimentState } from './useSentimentState';

const VIEW_DELAY_MS = 5_000;

/**
 * Marks a piece of content as viewed after the user has both spent time
 * on the page (5s) and interacted via scroll. Returns a boolean flag.
 */
export function useViewTracking(itemId: string, enabled = true): boolean {
  const recordRead = useSentimentState((s) => s.recordRead);
  const [hasViewed, setHasViewed] = useState(false);
  const timerDone = useRef(false);
  const scrolled = useRef(false);
  const recorded = useRef(false);

  const isBrowser = useMemo(() => typeof window !== 'undefined', []);

  useEffect(() => {
    timerDone.current = false;
    scrolled.current = false;
    recorded.current = false;
    setHasViewed(false);
  }, [itemId]);

  useEffect(() => {
    if (!enabled || !isBrowser || recorded.current) return;

    const onScroll = () => {
      scrolled.current = true;
      if (timerDone.current && !recorded.current) {
        recorded.current = true;
        recordRead(itemId);
        setHasViewed(true);
      }
    };

    const timer = window.setTimeout(() => {
      timerDone.current = true;
      if (scrolled.current && !recorded.current) {
        recorded.current = true;
        recordRead(itemId);
        setHasViewed(true);
      }
    }, VIEW_DELAY_MS);

    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(timer);
    };
  }, [enabled, isBrowser, itemId, recordRead]);

  return hasViewed;
}

export default useViewTracking;
