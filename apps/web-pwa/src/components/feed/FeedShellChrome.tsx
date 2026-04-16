import React from 'react';
import type { FilterChip, SortMode } from '@vh/data-model';
import { FilterChips } from './FilterChips';
import { SortControls } from './SortControls';

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
  readonly selectedStorylineId: string | null;
  readonly totalItems: number;
  readonly newsCount: number;
  readonly topicCount: number;
  readonly focusedStoryCount: number;
  readonly refreshing: boolean;
  readonly hasDeferredUpdates: boolean;
  onFilterSelect: (filter: FilterChip) => void;
  onSortSelect: (mode: SortMode) => void;
  onRefresh: () => void;
  onApplyDeferredFeed: () => void;
}

export const FeedShellChrome: React.FC<FeedShellChromeProps> = ({
  filter,
  sortMode,
  selectedStorylineId,
  totalItems,
  newsCount,
  topicCount,
  focusedStoryCount,
  refreshing,
  hasDeferredUpdates,
  onFilterSelect,
  onSortSelect,
  onRefresh,
  onApplyDeferredFeed,
}) => {
  const activeFilterLabel = FILTER_LABELS[filter];
  const activeSortLabel = SORT_LABELS[sortMode];

  return (
    <>
      <section
        data-testid="feed-shell-masthead"
        className="relative overflow-hidden rounded-[2.25rem] border border-white/70 bg-white/84 p-6 shadow-[0_28px_70px_-40px_rgba(15,23,42,0.45)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70 sm:p-7"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.14),transparent_34%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.12),transparent_24%)] dark:bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.24),transparent_36%),radial-gradient(circle_at_top_right,rgba(56,189,248,0.18),transparent_24%)]" />
        <div className="relative space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-slate-500 dark:text-slate-400">
                Main Feed
              </p>
              <div className="space-y-2">
                <h1 className="text-4xl leading-none text-slate-950 dark:text-white sm:text-[3.5rem]">
                  For You
                </h1>
                <p className="max-w-2xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
                  A news-first home feed that reads clean like Apple News, scrolls fast like X,
                  and opens every story or topic into summary, frame / reframe, and live replies.
                </p>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 self-start rounded-full border border-slate-200/80 bg-white/85 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
              <span>{selectedStorylineId ? 'Storyline Focus' : 'Personalized Home'}</span>
              <span className="text-slate-300 dark:text-slate-600">/</span>
              <span>{activeSortLabel}</span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <FeedMetricCard
              label="Live Items"
              value={String(totalItems)}
              detail={`${newsCount} news · ${topicCount} topics`}
            />
            <FeedMetricCard
              label="Surface"
              value={activeFilterLabel}
              detail={selectedStorylineId ? 'Focused storyline mode' : 'Blended home feed'}
            />
            <FeedMetricCard
              label="Context"
              value={selectedStorylineId ? 'Focused' : 'Open'}
              detail={
                selectedStorylineId
                  ? `${focusedStoryCount} visible coverage items`
                  : 'Open any card for summary, frames, and replies'
              }
            />
          </div>
        </div>
      </section>

      <div className="sticky top-[6.25rem] z-30">
        <div className="rounded-[1.75rem] border border-white/70 bg-white/82 p-3 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.32)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/75">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <FilterChips active={filter} onSelect={onFilterSelect} />
            <div className="flex flex-wrap items-center gap-3">
              <SortControls active={sortMode} onSelect={onSortSelect} />
              <button
                type="button"
                onClick={onRefresh}
                data-testid="feed-refresh-button"
                className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
              >
                {refreshing ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>
          </div>
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

interface FeedMetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

const FeedMetricCard: React.FC<FeedMetricCardProps> = ({ label, value, detail }) => (
  <div className="rounded-[1.5rem] border border-white/75 bg-white/82 px-4 py-4 shadow-sm shadow-slate-900/5 dark:border-slate-700/70 dark:bg-slate-900/70">
    <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-slate-500 dark:text-slate-400">
      {label}
    </p>
    <p className="mt-2 text-2xl leading-none text-slate-950 dark:text-white">{value}</p>
    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{detail}</p>
  </div>
);
