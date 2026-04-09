import type { FeedItem } from '@vh/data-model';

function normalizeToken(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizedTitleToken(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function normalizeStoryId(storyId: string | undefined): string | null {
  return normalizeToken(storyId);
}

export function getFeedItemKey(item: FeedItem): string {
  if (item.kind === 'NEWS_STORY') {
    const storyId = normalizeStoryId(item.story_id);
    if (storyId) {
      return ['NEWS_STORY', storyId].join('|');
    }

    return ['NEWS_STORY', item.topic_id, normalizedTitleToken(item.title)].join('|');
  }

  return [item.kind, item.topic_id].join('|');
}

export function getFeedItemDetailId(item: FeedItem): string {
  switch (item.kind) {
    case 'NEWS_STORY': {
      const storyId = normalizeStoryId(item.story_id);
      return storyId
        ? `news:${storyId}`
        : `news:${item.topic_id}:${normalizedTitleToken(item.title)}`;
    }
    case 'USER_TOPIC':
      return `topic:${item.topic_id}`;
    case 'SOCIAL_NOTIFICATION':
      return `social:${item.topic_id}`;
    case 'ARTICLE':
      return `article:${item.topic_id}`;
    case 'ACTION_RECEIPT':
      return `receipt:${item.topic_id}`;
  }
}

export function getFeedItemTestIdSuffix(item: FeedItem): string {
  return normalizeStoryId(item.story_id) ?? item.topic_id;
}

export function feedItemMatchesDetailId(item: FeedItem, detailId: string): boolean {
  return getFeedItemDetailId(item) === detailId;
}
