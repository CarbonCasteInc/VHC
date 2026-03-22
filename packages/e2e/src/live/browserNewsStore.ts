import type { Page } from '@playwright/test';
import type {
  LiveSemanticAuditBundleLike,
  RetainedSourceEvidenceSnapshot,
  SemanticAuditStoreSnapshot,
} from './daemonFirstFeedSemanticAuditTypes';

export interface AuditableBundleDiagnostics {
  readonly storyCount: number;
  readonly auditableCount: number;
  readonly topStoryIds: ReadonlyArray<string>;
  readonly topAuditableStoryIds: ReadonlyArray<string>;
}

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

function sourceEventKey(source: { source_id: string; url_hash: string }): string {
  return `${source.source_id}::${source.url_hash}`;
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

export async function refreshNewsStoreLatest(page: Page, limit: number): Promise<void> {
  await page.evaluate(async (refreshLimit: number) => {
    const newsStore = (window as {
      __VH_NEWS_STORE__?: { getState?: () => { refreshLatest?: (limit?: number) => Promise<void> } };
    }).__VH_NEWS_STORE__;
    await newsStore?.getState?.().refreshLatest?.(refreshLimit);
  }, limit);
}

export async function readAuditableBundleDiagnostics(
  page: Page,
): Promise<AuditableBundleDiagnostics> {
  const stories = await readStoreStories(page);
  const auditable = stories.filter((story) => (story.primary_sources?.length ?? story.sources.length) >= 2);
  return {
    storyCount: stories.length,
    auditableCount: auditable.length,
    topStoryIds: stories.slice(0, 5).map((story) => story.story_id),
    topAuditableStoryIds: auditable.slice(0, 5).map((story) => story.story_id),
  };
}

export async function readSemanticAuditStoreSnapshot(
  page: Page,
): Promise<SemanticAuditStoreSnapshot> {
  const [stories, domStoryIds] = await Promise.all([readStoreStories(page), readDomStoryIds(page)]);
  const visibleStoryIds = domStoryIds.filter((storyId, index, values) => values.indexOf(storyId) === index);
  const visibleStoryIdSet = new Set(visibleStoryIds);
  const auditableStories = stories.filter(
    (story) => (story.primary_sources?.length ?? story.sources.length) >= 2,
  );

  return {
    story_count: stories.length,
    auditable_count: auditableStories.length,
    visible_story_ids: visibleStoryIds,
    top_story_ids: stories.slice(0, 5).map((story) => story.story_id),
    top_auditable_story_ids: auditableStories.slice(0, 5).map((story) => story.story_id),
    stories: stories.map((story) => ({
      story_id: story.story_id,
      topic_id: story.topic_id,
      headline: story.headline,
      source_count: story.sources.length,
      primary_source_count: story.primary_sources?.length ?? story.sources.length,
      secondary_asset_count: story.secondary_assets?.length ?? 0,
      is_auditable: (story.primary_sources?.length ?? story.sources.length) >= 2,
      is_dom_visible: visibleStoryIdSet.has(story.story_id),
    })),
  };
}

export async function readRetainedSourceEvidenceSnapshot(
  page: Page,
): Promise<RetainedSourceEvidenceSnapshot> {
  const [stories, domStoryIds] = await Promise.all([readStoreStories(page), readDomStoryIds(page)]);
  const visibleStoryIds = domStoryIds.filter((storyId, index, values) => values.indexOf(storyId) === index);
  const visibleStoryIdSet = new Set(visibleStoryIds);
  const auditableStories = stories.filter(
    (story) => (story.primary_sources?.length ?? story.sources.length) >= 2,
  );
  const retainedBySource = new Map();

  for (const story of stories) {
    const sourceRoles = new Map<string, Set<'source' | 'primary_source' | 'secondary_asset'>>();
    const sourceByKey = new Map<string, LiveSemanticAuditBundleLike['sources'][number]>();
    const markRole = (
      sources: ReadonlyArray<LiveSemanticAuditBundleLike['sources'][number]> | undefined,
      role: 'source' | 'primary_source' | 'secondary_asset',
    ) => {
      for (const source of sources ?? []) {
        const key = sourceEventKey(source);
        const roles = sourceRoles.get(key) ?? new Set();
        roles.add(role);
        sourceRoles.set(key, roles);
        if (!sourceByKey.has(key)) {
          sourceByKey.set(key, source);
        }
      }
    };

    markRole(story.sources, 'source');
    markRole(story.primary_sources, 'primary_source');
    markRole(story.secondary_assets, 'secondary_asset');

    for (const [key, roles] of sourceRoles.entries()) {
      const source = sourceByKey.get(key);
      if (!source) {
        continue;
      }
      const existing = retainedBySource.get(key) ?? {
        source_id: source.source_id,
        publisher: source.publisher,
        url: source.url,
        url_hash: source.url_hash,
        published_at: source.published_at,
        title: source.title,
        observations: [],
      };

      existing.observations.push({
        story_id: story.story_id,
        topic_id: story.topic_id,
        headline: story.headline,
        source_count: story.sources.length,
        primary_source_count: story.primary_sources?.length ?? story.sources.length,
        secondary_asset_count: story.secondary_assets?.length ?? 0,
        is_auditable: (story.primary_sources?.length ?? story.sources.length) >= 2,
        is_dom_visible: visibleStoryIdSet.has(story.story_id),
        source_roles: [...roles].sort(),
      });

      retainedBySource.set(key, existing);
    }
  }

  const sources = [...retainedBySource.values()]
    .map((entry) => ({
      ...entry,
      observations: [...entry.observations].sort((left, right) =>
        left.story_id.localeCompare(right.story_id)),
    }))
    .sort((left, right) =>
      left.source_id.localeCompare(right.source_id)
      || left.url_hash.localeCompare(right.url_hash));

  return {
    schemaVersion: 'daemon-feed-retained-source-evidence-v1',
    generatedAt: new Date().toISOString(),
    story_count: stories.length,
    auditable_count: auditableStories.length,
    visible_story_ids: visibleStoryIds,
    top_story_ids: stories.slice(0, 5).map((story) => story.story_id),
    top_auditable_story_ids: auditableStories.slice(0, 5).map((story) => story.story_id),
    source_count: sources.length,
    sources,
  };
}
