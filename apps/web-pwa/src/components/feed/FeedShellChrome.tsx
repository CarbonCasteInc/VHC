import React, { useEffect, useState } from 'react';
import type { FeedPersonalizationConfig, FilterChip, SortMode } from '@vh/data-model';
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';
import { FilterChips } from './FilterChips';
import { SortControls } from './SortControls';

export const FEED_ORIENTATION_STORAGE_KEY = 'vh_feed_orientation_seen_v1';

const FILTER_LABELS: Record<FilterChip, string> = {
  ALL: 'All',
  NEWS: 'News',
  TOPICS: 'Topics',
  SOCIAL: 'Social',
  ARTICLES: 'Articles',
};

const SORT_LABELS: Record<SortMode, string> = {
  LATEST: 'Latest',
  HOTTEST: 'Hottest',
  MY_ACTIVITY: 'My Activity',
};

interface FeedShellChromeProps {
  readonly filter: FilterChip;
  readonly sortMode: SortMode;
  readonly personalization: FeedPersonalizationConfig;
  readonly availableCategories: ReadonlyArray<string>;
  readonly availableTopics: ReadonlyArray<string>;
  readonly selectedStorylineId: string | null;
  readonly totalItems: number;
  readonly newsCount: number;
  readonly topicCount: number;
  readonly focusedStoryCount: number;
  readonly refreshing: boolean;
  readonly hasDeferredUpdates: boolean;
  onFilterSelect: (filter: FilterChip) => void;
  onSortSelect: (mode: SortMode) => void;
  onPreferredCategoryToggle: (category: string) => void;
  onMutedCategoryToggle: (category: string) => void;
  onPreferredTopicToggle: (topic: string) => void;
  onMutedTopicToggle: (topic: string) => void;
  onRefresh: () => void;
  onApplyDeferredFeed: () => void;
}

function normalizePreference(value: string): string {
  return value.trim().toLowerCase();
}

function includesPreference(values: ReadonlyArray<string>, value: string): boolean {
  const target = normalizePreference(value);
  return values.some((entry) => normalizePreference(entry) === target);
}

export const FeedShellChrome: React.FC<FeedShellChromeProps> = ({
  filter,
  sortMode,
  personalization,
  availableCategories,
  availableTopics,
  selectedStorylineId,
  totalItems,
  newsCount,
  topicCount,
  focusedStoryCount,
  refreshing,
  hasDeferredUpdates,
  onFilterSelect,
  onSortSelect,
  onPreferredCategoryToggle,
  onMutedCategoryToggle,
  onPreferredTopicToggle,
  onMutedTopicToggle,
  onRefresh,
  onApplyDeferredFeed,
}) => {
  const activeFilterLabel = FILTER_LABELS[filter];
  const activeSortLabel = SORT_LABELS[sortMode];
  const [showOrientation, setShowOrientation] = useState(false);

  useEffect(() => {
    if (safeGetItem(FEED_ORIENTATION_STORAGE_KEY) === 'true') {
      return;
    }
    setShowOrientation(true);
  }, []);

  useEffect(() => {
    if (!showOrientation) {
      return;
    }

    const timer = window.setTimeout(() => {
      safeSetItem(FEED_ORIENTATION_STORAGE_KEY, 'true');
    }, 0);

    return () => window.clearTimeout(timer);
  }, [showOrientation]);

  const dismissOrientation = () => {
    safeSetItem(FEED_ORIENTATION_STORAGE_KEY, 'true');
    setShowOrientation(false);
  };

  return (
    <>
      {showOrientation && (
        <section
          data-testid="feed-orientation-card"
          className="relative overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/84 p-4 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.35)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_34%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.1),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.2),transparent_36%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.16),transparent_24%)]" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
                For You
              </p>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700 dark:text-slate-200">
                Your home feed blends clustered news and active topic conversations. Open any card for synthesis,
                frame / reframe, and live replies.
              </p>
            </div>
            <button
              type="button"
              className="self-start rounded-full border border-slate-200/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={dismissOrientation}
            >
              Dismiss
            </button>
          </div>
        </section>
      )}

      <div className="sticky top-[5rem] z-30" data-testid="feed-shell-chrome">
        <div className="rounded-[1.35rem] border border-white/70 bg-white/86 p-2 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.34)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/78">
          <div className="mb-2 flex flex-col gap-2 border-b border-slate-200/70 pb-2 dark:border-slate-800 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
                Main feed
              </p>
              <p
                className="truncate text-[11px] font-medium text-slate-600 dark:text-slate-300"
                data-testid="feed-shell-status"
              >
                {totalItems} live · {newsCount} news · {topicCount} topics
              </p>
            </div>
            <div
              className="inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/85 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300"
              data-testid="feed-shell-mode"
            >
              <span>{selectedStorylineId ? 'Storyline focus' : activeFilterLabel}</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span>{activeSortLabel}</span>
              {selectedStorylineId && (
                <>
                  <span className="text-slate-300 dark:text-slate-600">/</span>
                  <span>{focusedStoryCount} items</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <FilterChips active={filter} onSelect={onFilterSelect} />
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SortControls active={sortMode} onSelect={onSortSelect} />
              <button
                type="button"
                onClick={onRefresh}
                data-testid="feed-refresh-button"
                className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
          {(availableCategories.length > 0 || availableTopics.length > 0) && (
            <div
              className="mt-2 border-t border-slate-200/70 pt-2 dark:border-slate-800"
              data-testid="feed-tuning-controls"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  Tune feed
                </p>
              </div>
              {availableCategories.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1.5" data-testid="feed-category-tuning">
                  {availableCategories.map((category) => {
                    const preferred = includesPreference(
                      personalization.preferredCategories,
                      category,
                    );
                    const muted = includesPreference(personalization.mutedCategories, category);
                    return (
                      <div
                        key={category}
                        className="inline-flex overflow-hidden rounded-full border border-slate-200/80 bg-white/85 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
                      >
                        <button
                          type="button"
                          aria-pressed={preferred}
                          aria-label={`Prefer ${category} category`}
                          className={`px-2 py-1 transition ${
                            preferred
                              ? 'bg-emerald-700 text-white dark:bg-emerald-400 dark:text-emerald-950'
                              : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-100'
                          }`}
                          onClick={() => onPreferredCategoryToggle(category)}
                        >
                          Prefer {category}
                        </button>
                        <button
                          type="button"
                          aria-pressed={muted}
                          aria-label={`Mute ${category} category`}
                          className={`border-l border-slate-200/80 px-2 py-1 transition dark:border-slate-700 ${
                            muted
                              ? 'bg-rose-700 text-white dark:bg-rose-400 dark:text-rose-950'
                              : 'text-slate-600 hover:bg-rose-50 hover:text-rose-800 dark:text-slate-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-100'
                          }`}
                          onClick={() => onMutedCategoryToggle(category)}
                        >
                          Mute
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              {availableTopics.length > 0 && (
                <div className="flex flex-wrap gap-1.5" data-testid="feed-topic-tuning">
                  {availableTopics.map((topic) => {
                    const preferred = includesPreference(personalization.preferredTopics, topic);
                    const muted = includesPreference(personalization.mutedTopics, topic);
                    return (
                      <div
                        key={topic}
                        className="inline-flex overflow-hidden rounded-full border border-slate-200/80 bg-white/85 text-[10px] font-semibold uppercase tracking-[0.12em] shadow-sm dark:border-slate-700 dark:bg-slate-900/80"
                      >
                        <button
                          type="button"
                          aria-pressed={preferred}
                          aria-label={`Follow ${topic} topic`}
                          className={`px-2 py-1 transition ${
                            preferred
                              ? 'bg-emerald-700 text-white dark:bg-emerald-400 dark:text-emerald-950'
                              : 'text-slate-600 hover:bg-emerald-50 hover:text-emerald-800 dark:text-slate-300 dark:hover:bg-emerald-950/50 dark:hover:text-emerald-100'
                          }`}
                          onClick={() => onPreferredTopicToggle(topic)}
                        >
                          Follow {topic}
                        </button>
                        <button
                          type="button"
                          aria-pressed={muted}
                          aria-label={`Mute ${topic} topic`}
                          className={`border-l border-slate-200/80 px-2 py-1 transition dark:border-slate-700 ${
                            muted
                              ? 'bg-rose-700 text-white dark:bg-rose-400 dark:text-rose-950'
                              : 'text-slate-600 hover:bg-rose-50 hover:text-rose-800 dark:text-slate-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-100'
                          }`}
                          onClick={() => onMutedTopicToggle(topic)}
                        >
                          Mute
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {hasDeferredUpdates && (
        <div
          data-testid="feed-refresh-prompt"
          className="rounded-[1.5rem] border border-sky-200/80 bg-sky-50/90 px-4 py-3 text-sm text-sky-900 shadow-sm shadow-sky-900/5 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-100"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p>Fresh cards are ready. Pull to refresh or load the updated feed now.</p>
            <button
              type="button"
              className="rounded-full border border-sky-300/80 bg-white/90 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-sky-900 transition hover:bg-white dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-100"
              onClick={onApplyDeferredFeed}
            >
              Load now
            </button>
          </div>
        </div>
      )}
    </>
  );
};
