import type { Page } from '@playwright/test';
import type { LiveSemanticAuditBundleLike } from './daemonFirstFeedSemanticAuditTypes';

async function readStoreStories(
  page: Page,
): Promise<LiveSemanticAuditBundleLike[]> {
  return page.evaluate(() => {
    const newsStore = (window as {
      __VH_NEWS_STORE__?: {
        getState?: () => {
          stories?: Array<LiveSemanticAuditBundleLike>;
        };
      };
    }).__VH_NEWS_STORE__;
    return newsStore?.getState?.().stories ?? [];
  });
}

async function readDomStoryIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="news-card-headline-"]'),
    )
      .map((node) => node.getAttribute('data-story-id')?.trim() ?? '')
      .filter((storyId) => storyId.length > 0),
  );
}

export async function readAuditableBundles(
  page: Page,
  options?: { readonly restrictToDomStoryIds?: boolean },
): Promise<LiveSemanticAuditBundleLike[]> {
  const [stories, domStoryIds] = await Promise.all([readStoreStories(page), readDomStoryIds(page)]);
  const order = new Map(domStoryIds.map((storyId, index) => [storyId, index]));
  const auditable = stories.filter((story) => (story.primary_sources?.length ?? story.sources.length) >= 2);

  if (options?.restrictToDomStoryIds) {
    return auditable
      .filter((story) => order.has(story.story_id))
      .sort((left, right) => (order.get(left.story_id) ?? 0) - (order.get(right.story_id) ?? 0));
  }

  return [...auditable].sort((left, right) => {
    const leftOrder = order.get(left.story_id);
    const rightOrder = order.get(right.story_id);
    if (leftOrder !== undefined && rightOrder !== undefined) {
      return leftOrder - rightOrder;
    }
    if (leftOrder !== undefined) {
      return -1;
    }
    if (rightOrder !== undefined) {
      return 1;
    }
    return 0;
  });
}

export async function readVisibleAuditableBundles(
  page: Page,
): Promise<LiveSemanticAuditBundleLike[]> {
  return readAuditableBundles(page, { restrictToDomStoryIds: true });
}
