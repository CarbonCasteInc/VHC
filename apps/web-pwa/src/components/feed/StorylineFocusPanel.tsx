import React, { useCallback, useMemo } from 'react';
import { useStore } from 'zustand';
import type { FeedItem, StorylineGroup } from '@vh/data-model';
import { useDiscoveryStore } from '../../store/discovery';

export interface StorylineFocusPanelProps {
  readonly storyline: StorylineGroup;
  readonly visibleStoryCount: number;
  readonly onBack?: () => void;
  readonly onClear: () => void;
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
  onBack,
  onClear,
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

  return (
    <section
      data-testid={`storyline-focus-panel-${storyline.storyline_id}`}
      className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Storyline focus
          </p>
          <h2 className="text-sm font-semibold text-slate-900">{storyline.headline}</h2>
          <p
            className="text-xs text-slate-600"
            data-testid={`storyline-focus-count-${storyline.storyline_id}`}
          >
            Showing {formatStoryCount(visibleStoryCount)} from this storyline in the feed.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onBack ? (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
              onClick={onBack}
              data-testid={`storyline-focus-back-${storyline.storyline_id}`}
            >
              ← Back
            </button>
          ) : null}
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-white"
            onClick={onClear}
            data-testid={`storyline-focus-clear-${storyline.storyline_id}`}
          >
            Clear storyline
          </button>
        </div>
      </div>

      {storyline.related_coverage.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Related coverage
          </h3>
          <ul className="space-y-1 text-sm text-slate-700">
            {storyline.related_coverage.map((entry) => (
              <li key={`${entry.source_id}|${entry.url}`}>
                <span className="font-medium text-slate-900">{entry.publisher}:</span>{' '}
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-slate-300 underline-offset-2 hover:text-slate-900"
                >
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {archiveItems.length > 0 && (
        <div className="space-y-2" data-testid={`storyline-archive-${storyline.storyline_id}`}>
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            Storyline archive
          </h3>
          <ul className="space-y-2">
            {archiveItems.map((entry) => (
              <li
                key={entry.storyId}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium text-slate-900">{entry.title}</p>
                  {entry.canonical ? (
                    <p
                      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-700"
                      data-testid={`storyline-archive-canonical-${entry.storyId}`}
                    >
                      Canonical event bundle
                    </p>
                  ) : null}
                </div>

                <button
                  type="button"
                  className="shrink-0 rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  onClick={() => handleJumpToStory(entry.storyId)}
                  data-testid={`storyline-archive-jump-${entry.storyId}`}
                >
                  Jump to story
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
