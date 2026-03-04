import type { StoryBundle } from '@vh/data-model';

export const NEWS_STORE_TYPES_VERSION = 'storycluster-pr5-hot-index-v1';

export function getNewsStoreTypesVersion(): string {
  return NEWS_STORE_TYPES_VERSION;
}

export interface NewsState {
  /** Story bundles keyed and sorted for feed consumption. */
  readonly stories: ReadonlyArray<StoryBundle>;

  /** Latest index from mesh: story_id -> latest_activity_at. */
  readonly latestIndex: Readonly<Record<string, number>>;

  /** Hot index from mesh: story_id -> deterministic hotness score. */
  readonly hotIndex: Readonly<Record<string, number>>;

  /** Whether real-time hydration has been attached. */
  readonly hydrated: boolean;

  /** Loading state for manual refresh. */
  readonly loading: boolean;

  /** Last refresh error. */
  readonly error: string | null;

  setStories(stories: StoryBundle[]): void;
  upsertStory(story: StoryBundle): void;
  setLatestIndex(index: Record<string, number>): void;
  upsertLatestIndex(storyId: string, createdAt: number): void;
  setHotIndex(index: Record<string, number>): void;
  upsertHotIndex(storyId: string, hotness: number): void;
  refreshLatest(limit?: number): Promise<void>;
  startHydration(): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export interface NewsDeps {
  resolveClient: () => import('@vh/gun-client').VennClient | null;
}
