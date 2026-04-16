import React, { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StorylineGroup } from '@vh/data-model';
import { useDiscoveryStore } from '../../store/discovery';

export interface StorylineFocusPanelProps {
  readonly storyline: StorylineGroup;
  readonly visibleStoryCount: number;
  readonly selectedStoryId?: string | null;
  readonly onBack?: () => void;
  readonly onClear: () => void;
  readonly onOpenStory?: (storyId: string) => void;
}

interface StorylineArchiveItem {
  readonly storyId: string;
  readonly title: string;
  readonly latestActivityAt: number;
  readonly canonical: boolean;
}

function formatStoryCount(count: number): string {
  return `${count} ${count === 1 ? 'story' : 'stories'}`;
}

function normalizeStorylineId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeStoryId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function storylineArchiveItems(
  items: ReadonlyArray<FeedItem>,
  storyline: StorylineGroup,
): StorylineArchiveItem[] {
  const storylineId = normalizeStorylineId(storyline.storyline_id);
  if (!storylineId) {
    return [];
  }

  const archiveItems = items
    .filter(
      (item) =>
        item.kind === 'NEWS_STORY' &&
        normalizeStorylineId(item.storyline_id) === storylineId &&
        normalizeStoryId(item.story_id),
    )
    .map((item) => ({
      storyId: normalizeStoryId(item.story_id)!,
      title: item.title,
      latestActivityAt: item.latest_activity_at,
      canonical: normalizeStoryId(item.story_id) === storyline.canonical_story_id,
    }))
    .sort((left, right) => {
      if (left.canonical !== right.canonical) {
        return left.canonical ? -1 : 1;
      }
      return (
        right.latestActivityAt - left.latestActivityAt ||
        left.storyId.localeCompare(right.storyId)
      );
    });

  return archiveItems;
}

function jumpToStory(
  doc: Document | undefined,
  storyId: string,
): boolean {
  if (!doc) {
    return false;
  }

  const target = doc.querySelector<HTMLElement>(`[data-story-id="${storyId}"]`);
  if (!target) {
    return false;
  }

  target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  target.focus({ preventScroll: true });
  return true;
}

export const StorylineFocusPanel: React.FC<StorylineFocusPanelProps> = ({
  storyline,
  visibleStoryCount,
  selectedStoryId = null,
  onBack,
  onClear,
  onOpenStory,
}) => {
  const discoveryItems = useStore(useDiscoveryStore, (state) => state.items);
  const archiveItems = useMemo(
    () => storylineArchiveItems(discoveryItems, storyline),
    [discoveryItems, storyline],
  );

  const handleJumpToStory = useCallback((storyId: string) => {
    /* v8 ignore next -- browser-only component; SSR guard is defensive only */
    jumpToStory(typeof document === 'undefined' ? undefined : document, storyId);
  }, []);

  const handleOpenStory = useCallback(
    (storyId: string) => {
      if (onOpenStory) {
        onOpenStory(storyId);
        return;
      }

      handleJumpToStory(storyId);
    },
    [handleJumpToStory, onOpenStory],
  );

  return (
    <section
      data-testid={`storyline-focus-panel-${storyline.storyline_id}`}
      className="space-y-4 rounded-[2rem] border border-white/75 bg-white/84 p-5 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.32)] backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/70"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500 dark:text-slate-400">
            Storyline focus
          </p>
          <h2 className="text-xl text-slate-950 dark:text-white">{storyline.headline}</h2>
          <p
            className="text-sm text-slate-600 dark:text-slate-300"
            data-testid={`storyline-focus-count-${storyline.storyline_id}`}
          >
            Showing {formatStoryCount(visibleStoryCount)} from this storyline in the feed.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              className="rounded-full border border-slate-300/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              onClick={onBack}
              data-testid={`storyline-focus-back-${storyline.storyline_id}`}
            >
              ← Back
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-full border border-slate-300/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:bg-white dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            onClick={onClear}
            data-testid={`storyline-focus-clear-${storyline.storyline_id}`}
          >
            Clear storyline
          </button>
        </div>
      </div>

      {storyline.related_coverage.length > 0 && (
        <div className="space-y-2 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/80">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Related coverage
          </h3>
          <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-200">
            {storyline.related_coverage.map((entry) => (
              <li key={`${entry.source_id}|${entry.url}`}>
                <span className="font-medium text-slate-900 dark:text-white">{entry.publisher}:</span>{' '}
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900 dark:decoration-slate-600 dark:hover:text-white"
                >
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {archiveItems.length > 0 && (
        <div
          className="space-y-3 rounded-[1.5rem] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/80"
          data-testid={`storyline-archive-${storyline.storyline_id}`}
        >
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-400">
            Storyline archive
          </h3>
          <ul className="space-y-2">
            {archiveItems.map((entry) => (
              <li
                key={entry.storyId}
                className="flex items-center justify-between gap-3 rounded-[1.25rem] border border-white/90 bg-white/90 px-3 py-3 shadow-sm shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-950/80"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{entry.title}</p>
                  {entry.canonical ? (
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700"
                      data-testid={`storyline-archive-canonical-${entry.storyId}`}
                    >
                      Canonical event bundle
                    </p>
                  ) : null}
                  {entry.storyId === selectedStoryId ? (
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700"
                      data-testid={`storyline-archive-selected-${entry.storyId}`}
                    >
                      Focused in feed
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="shrink-0 rounded-full border border-slate-300/80 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  onClick={() => handleOpenStory(entry.storyId)}
                  data-testid={`storyline-archive-jump-${entry.storyId}`}
                >
                  {entry.storyId === selectedStoryId ? 'View story' : 'Open story'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
};

export const storylineFocusPanelInternal = {
  normalizeStorylineId,
  normalizeStoryId,
  storylineArchiveItems,
  jumpToStory,
};

export default StorylineFocusPanel;
