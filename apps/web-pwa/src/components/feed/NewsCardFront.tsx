import React from 'react';
import type { FeedItem, StoryBundle } from '@vh/data-model';
import { useFeedEngagementMetrics } from '../../hooks/useFeedEngagementMetrics';
import { FeedEngagement } from './FeedEngagement';
import { SourceBadgeRow } from './SourceBadgeRow';
import type { NewsCardMediaAsset } from './NewsCardBack';
import { formatHotness } from './newsCardModel';

interface NewsCardFrontProps {
  readonly item: FeedItem;
  readonly storyId: string | null;
  readonly heroImage: NewsCardMediaAsset | null;
  readonly galleryImages: ReadonlyArray<NewsCardMediaAsset>;
  readonly sourceSurfaceLabel: string;
  readonly hasLiveThread: boolean;
  readonly isExpanded: boolean;
  readonly displaySources: ReadonlyArray<StoryBundle['sources'][number]>;
  readonly summaryPreview: string;
  readonly storylineHeadline: string | null;
  readonly createdAt: string;
  readonly latestActivity: string;
  readonly onToggle: () => void;
  readonly onOpenDetail: () => void;
  readonly onStorylineFocus: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export const NewsCardFront: React.FC<NewsCardFrontProps> = ({
  item,
  storyId,
  heroImage,
  galleryImages,
  sourceSurfaceLabel,
  hasLiveThread,
  isExpanded,
  displaySources,
  summaryPreview,
  storylineHeadline,
  createdAt,
  latestActivity,
  onToggle,
  onOpenDetail,
  onStorylineFocus,
}) => {
  const engagement = useFeedEngagementMetrics({
    topicId: item.topic_id,
    eye: item.eye,
    lightbulb: item.lightbulb,
    comments: item.comments,
  });

  return (
    <section data-testid={`news-card-front-${item.topic_id}`} data-story-id={storyId ?? undefined}>
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-sky-900 dark:bg-sky-950/60 dark:text-sky-100">
            News
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {sourceSurfaceLabel}
          </span>
          {hasLiveThread && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
              Live thread
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="hidden rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:inline-flex"
            style={{ color: 'var(--headline-card-muted)' }}
            data-testid={`news-card-hotness-${item.topic_id}`}
          >
            Hotness {formatHotness(item.hotness)}
          </span>
          <button
            type="button"
            className="rounded-full border border-slate-200/80 bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={onToggle}
            data-testid={`news-card-toggle-${item.topic_id}`}
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </header>

      <div className={heroImage ? 'grid gap-3 md:grid-cols-[minmax(0,1fr)_8.5rem]' : undefined}>
        <div className="min-w-0">
          <button
            type="button"
            className="text-left text-[1.18rem] leading-[1.1] text-slate-950 underline-offset-2 transition group-hover:text-slate-700 hover:underline dark:text-white dark:group-hover:text-slate-100 sm:text-[1.32rem]"
            style={{ color: 'var(--headline-card-text)' }}
            data-testid={`news-card-headline-${item.topic_id}`}
            data-story-id={storyId ?? undefined}
            onClick={onOpenDetail}
          >
            {item.title}
          </button>
          {displaySources.length > 0 && (
            <SourceBadgeRow
              sources={displaySources.map((source) => ({
                source_id: source.source_id,
                publisher: source.publisher,
                url: source.url,
              }))}
            />
          )}
          {!isExpanded && (
            <p className="mt-1.5 line-clamp-1 max-w-2xl text-[13px] leading-5 text-slate-600 dark:text-slate-300">
              {summaryPreview}
            </p>
          )}
        </div>

        {heroImage && (
          <div className="md:order-last" data-testid={`news-card-hero-${item.topic_id}`}>
            <div className="relative overflow-hidden rounded-[1.1rem] border border-slate-200/80 bg-slate-100 shadow-sm shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900/80">
              <img
                src={heroImage.imageUrl}
                alt={`${heroImage.publisher}: ${heroImage.title}`}
                className="h-24 w-full object-cover transition duration-200 group-hover:scale-[1.01] md:h-28"
                data-testid={`news-card-hero-image-${item.topic_id}`}
              />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/80 via-slate-950/35 to-transparent p-2">
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="rounded-full bg-white/92 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-900">
                    {heroImage.publisher}
                  </span>
                  {galleryImages.length > 0 && (
                    <span className="rounded-full bg-slate-950/70 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white">
                      +{galleryImages.length}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2.5 border-t border-slate-200/80 pt-2.5 dark:border-slate-800">
        <p className="sr-only">
          Created {createdAt} • Updated {latestActivity}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FeedEngagement
            topicId={item.topic_id}
            eye={engagement.eye}
            lightbulb={engagement.lightbulb}
            comments={engagement.comments}
            className="mt-0"
            compact
          />
          {storylineHeadline && (
            <button
              type="button"
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-slate-200/80 bg-slate-50/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.11em] text-slate-600 transition hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              style={{ color: 'var(--headline-card-muted)' }}
              data-testid={`news-card-storyline-${item.topic_id}`}
              onClick={onStorylineFocus}
            >
              Storyline{' '}
              <span className="truncate normal-case tracking-normal text-slate-500 dark:text-slate-400">
                {storylineHeadline}
              </span>
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
