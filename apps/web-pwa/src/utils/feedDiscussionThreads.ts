import type { FeedItem, StoryBundle } from '@vh/data-model';
import type { HermesThread } from '@vh/types';

function normalizeToken(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeUrl(url: string | undefined): string | null {
  const normalized = normalizeToken(url);
  if (!normalized) {
    return null;
  }

  try {
    return new URL(normalized).toString();
  } catch {
    return normalized;
  }
}

function pickThread(candidates: ReadonlyArray<HermesThread>): HermesThread | null {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    const headlineDelta = Number(Boolean(right.isHeadline)) - Number(Boolean(left.isHeadline));
    if (headlineDelta !== 0) {
      return headlineDelta;
    }

    return right.timestamp - left.timestamp;
  })[0]!;
}

export function resolveTopicThread(
  threads: Iterable<HermesThread>,
  topicId: string,
): HermesThread | null {
  const normalizedTopicId = normalizeToken(topicId);
  if (!normalizedTopicId) {
    return null;
  }

  return pickThread(
    Array.from(threads).filter(
      (thread) =>
        normalizeToken(thread.topicId) === normalizedTopicId || normalizeToken(thread.id) === normalizedTopicId,
    ),
  );
}

export function resolveStoryDiscussionThread(
  threads: Iterable<HermesThread>,
  item: FeedItem,
  story: StoryBundle | null,
): HermesThread | null {
  const topicId = normalizeToken(item.topic_id);
  const storyId = normalizeToken(story?.story_id) ?? normalizeStoryId(item.story_id);
  const sourceUrlSet = new Set(
    (story?.sources ?? [])
      .map((source) => normalizeUrl(source.url))
      .filter((url): url is string => url !== null),
  );
  const sourceHashSet = new Set(
    (story?.sources ?? [])
      .map((source) => normalizeToken(source.url_hash))
      .filter((hash): hash is string => hash !== null),
  );

  return pickThread(
    Array.from(threads).filter((thread) => {
      const threadTopicId = normalizeToken(thread.topicId);
      const threadSourceSynthesisId = normalizeToken(thread.sourceSynthesisId);
      const threadSourceAnalysisId = normalizeToken(thread.sourceAnalysisId);
      const threadUrlHash = normalizeToken(thread.urlHash);
      const threadSourceUrl = normalizeUrl(thread.sourceUrl);

      return (
        (topicId !== null && threadTopicId === topicId) ||
        (storyId !== null && threadSourceSynthesisId === storyId) ||
        (storyId !== null && threadSourceAnalysisId === storyId) ||
        (threadSourceSynthesisId !== null && sourceHashSet.has(threadSourceSynthesisId)) ||
        (threadSourceAnalysisId !== null && sourceHashSet.has(threadSourceAnalysisId)) ||
        (threadUrlHash !== null && sourceHashSet.has(threadUrlHash)) ||
        (threadSourceUrl !== null && sourceUrlSet.has(threadSourceUrl))
      );
    }),
  );
}

export function getPrimaryStorySource(story: StoryBundle | null): {
  readonly publisher: string;
  readonly title: string;
  readonly url: string;
  readonly urlHash: string;
} | null {
  const source = story?.sources[0];
  if (!source) {
    return null;
  }

  return {
    publisher: source.publisher,
    title: source.title,
    url: source.url,
    urlHash: source.url_hash,
  };
}

function normalizeStoryId(storyId: string | undefined): string | null {
  return normalizeToken(storyId);
}
