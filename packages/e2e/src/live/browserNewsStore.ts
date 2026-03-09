import type { Page } from '@playwright/test';
import type { LiveSemanticAuditBundleLike } from './daemonFirstFeedSemanticAuditTypes';

export async function readVisibleAuditableBundles(
  page: Page,
): Promise<LiveSemanticAuditBundleLike[]> {
  return page.evaluate(() => {
    const visibleStoryIds = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="news-card-headline-"]'),
    )
      .map((node) => node.getAttribute('data-story-id')?.trim() ?? '')
      .filter((storyId) => storyId.length > 0);
    const order = new Map(visibleStoryIds.map((storyId, index) => [storyId, index]));
    const newsStore = (window as {
      __VH_NEWS_STORE__?: {
        getState?: () => {
          stories?: Array<LiveSemanticAuditBundleLike>;
        };
      };
    }).__VH_NEWS_STORE__;
    const stories = newsStore?.getState?.().stories ?? [];
    return stories
      .filter((story) => order.has(story.story_id))
      .filter((story) => (story.primary_sources?.length ?? story.sources.length) >= 2)
      .sort((left, right) => (order.get(left.story_id) ?? 0) - (order.get(right.story_id) ?? 0));
  });
}
