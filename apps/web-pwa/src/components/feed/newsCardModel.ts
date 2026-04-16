import type { FeedItem, StoryBundle } from '@vh/data-model';
import { isLikelyVideoSourceEntry } from '@vh/ai-engine';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import type { NewsCardMediaAsset } from './NewsCardBack';
import { normalizeStoryId } from '../../utils/feedItemIdentity';

export function normalizeStorylineHeadline(headline: string | undefined): string | null {
  const normalized = headline?.trim();
  return normalized ? normalized : null;
}

export function formatIsoTimestamp(timestampMs: number): string {
  return Number.isFinite(timestampMs) && timestampMs >= 0 ? new Date(timestampMs).toISOString() : 'unknown';
}

export function formatHotness(hotness: number): string {
  return Number.isFinite(hotness) ? hotness.toFixed(2) : '0.00';
}

export function previewText(value: string, maxLength = 210): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function resolveSingletonVideoSource(
  story: StoryBundle | null,
): { publisher: string; title: string; url: string } | null {
  if (!story || story.sources.length !== 1) {
    return null;
  }

  const source = story.sources[0]!;
  if (!isLikelyVideoSourceEntry({ url: source.url, title: source.title })) {
    return null;
  }

  return {
    publisher: source.publisher,
    title: source.title,
    url: source.url,
  };
}

export function resolveStoryBundle(
  stories: ReadonlyArray<StoryBundle>,
  item: FeedItem,
): StoryBundle | null {
  const normalizedStoryId = normalizeStoryId(item.story_id);
  if (normalizedStoryId) {
    const byStoryId = stories.find((s) => s.story_id === normalizedStoryId);
    if (byStoryId) {
      return byStoryId;
    }
  }

  const normalizedTitle = item.title.trim();
  const sameTopicHeadline = stories.find(
    (s) => s.topic_id === item.topic_id && s.headline.trim() === normalizedTitle,
  );
  if (sameTopicHeadline) return sameTopicHeadline;
  return stories.find((s) => s.headline.trim() === normalizedTitle) ?? null;
}

export function resolveAnalysisProviderModel(
  story: NewsCardAnalysisSynthesis | null,
): string | null {
  if (!story || story.analyses.length === 0) return null;
  const withModel = story.analyses.find((e) => (e.model_id ?? '').trim().length > 0);
  if (withModel?.model_id) return withModel.model_id;
  const withProvider = story.analyses.find((e) => (e.provider_id ?? '').trim().length > 0);
  return withProvider?.provider_id ?? null;
}

export function resolveDisplaySources(
  story: StoryBundle | null,
): ReadonlyArray<StoryBundle['sources'][number]> {
  if (!story) {
    return [];
  }

  return story.primary_sources ?? story.sources;
}

export function mergeRelatedLinks(
  story: StoryBundle | null,
  analysis: NewsCardAnalysisSynthesis | null,
): ReadonlyArray<{
  source_id: string;
  publisher: string;
  title: string;
  url: string;
}> {
  const entries = [
    ...(story?.related_links ?? []),
    ...(analysis?.relatedLinks ?? []),
  ];
  const deduped = new Map<string, {
    source_id: string;
    publisher: string;
    title: string;
    url: string;
  }>();

  for (const entry of entries) {
    const key = `${entry.source_id}|${entry.url}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()];
}

export function resolveStoryMedia(
  story: StoryBundle | null,
): {
  heroImage: NewsCardMediaAsset | null;
  galleryImages: ReadonlyArray<NewsCardMediaAsset>;
} {
  if (!story) {
    return {
      heroImage: null,
      galleryImages: [],
    };
  }

  const orderedSources = [
    ...(story.primary_sources ?? story.sources),
    ...(story.secondary_assets ?? []),
    ...story.sources,
  ];

  const deduped = new Map<string, NewsCardMediaAsset>();
  for (const source of orderedSources) {
    const imageUrl = source.imageUrl?.trim();
    if (!imageUrl || deduped.has(imageUrl)) {
      continue;
    }
    deduped.set(imageUrl, {
      sourceId: source.source_id,
      publisher: source.publisher,
      title: source.title,
      url: source.url,
      imageUrl,
    });
  }

  const assets = [...deduped.values()];
  return {
    heroImage: assets[0] ?? null,
    galleryImages: assets.slice(1),
  };
}
