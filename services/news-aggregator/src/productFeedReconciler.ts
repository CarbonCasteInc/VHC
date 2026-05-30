import { StoryBundleSchema, type StoryBundle } from '@vh/data-model';
import {
  buildNewsSynthesisLifecycleRecord,
  computeStoryHotness,
  readNewsLatestIndexProductRecord,
  readNewsStory,
  readNewsStoryIds,
  readNewsSynthesisLifecycleStatus,
  writeNewsHotIndexEntry,
  writeNewsLatestIndexEntry,
  writeNewsSynthesisLifecycleStatus,
  type NewsLatestIndexEntryRecord,
  type NewsSynthesisLifecycleRecord,
  type VennClient,
} from '@vh/gun-client';

interface LoggerLike {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface ProductFeedReconciliationFailure {
  readonly story_id: string;
  readonly reason: string;
}

export interface ProductFeedReconciliationResult {
  readonly sampled: number;
  readonly eligible: number;
  readonly skipped_invalid_story: number;
  readonly repaired_latest_index: number;
  readonly repaired_hot_index: number;
  readonly repaired_lifecycle: number;
  readonly preserved_lifecycle: number;
  readonly failures: readonly ProductFeedReconciliationFailure[];
}

export interface ProductFeedReconcilerDependencies {
  readonly readStoryIds?: typeof readNewsStoryIds;
  readonly readLatestIndexEntry?: typeof readNewsLatestIndexProductRecord;
  readonly readStory?: typeof readNewsStory;
  readonly readLifecycle?: typeof readNewsSynthesisLifecycleStatus;
  readonly writeLatestIndexEntry?: typeof writeNewsLatestIndexEntry;
  readonly writeHotIndexEntry?: typeof writeNewsHotIndexEntry;
  readonly writeLifecycle?: typeof writeNewsSynthesisLifecycleStatus;
  readonly computeHotness?: typeof computeStoryHotness;
}

export interface ProductFeedReconcilerOptions {
  readonly sampleLimit?: number;
  readonly now?: () => number;
  readonly logger?: LoggerLike;
  readonly dependencies?: ProductFeedReconcilerDependencies;
}

function normalizeSampleLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 240;
}

function isEligibleRawStory(story: StoryBundle | null): story is StoryBundle {
  if (!story) return false;
  const parsed = StoryBundleSchema.safeParse(story);
  return Boolean(
    parsed.success
      && story.story_id
      && story.topic_id
      && story.headline
      && Array.isArray(story.sources)
      && story.sources.length > 0,
  );
}

function canonicalSourceCount(story: StoryBundle): number {
  return (story.primary_sources ?? story.sources).length;
}

function latestIndexNeedsRepair(record: NewsLatestIndexEntryRecord | null, story: StoryBundle): boolean {
  const expectedLatestActivityAt = Math.max(0, Math.floor(story.cluster_window_end));
  const expectedCreatedAt = Math.max(0, Math.floor(story.created_at));
  const expectedClusterWindowStart = Math.max(0, Math.floor(story.cluster_window_start));
  return !record
    || record.story_id !== story.story_id
    || record.latest_activity_at !== expectedLatestActivityAt
    || record.product_state_schema_version !== 'vh-news-product-feed-index-v1'
    || record.topic_id !== story.topic_id
    || record.source_set_revision !== story.provenance_hash
    || record.source_count !== story.sources.length
    || record.canonical_source_count !== canonicalSourceCount(story)
    || record.story_created_at !== expectedCreatedAt
    || record.cluster_window_start !== expectedClusterWindowStart;
}

function lifecycleNeedsPendingRepair(
  lifecycle: NewsSynthesisLifecycleRecord | null,
  story: StoryBundle,
): boolean {
  return !lifecycle || lifecycle.source_set_revision !== story.provenance_hash;
}

export async function reconcileProductFeedFromRawStories(
  client: VennClient,
  options: ProductFeedReconcilerOptions = {},
): Promise<ProductFeedReconciliationResult> {
  const dependencies = options.dependencies ?? {};
  const readStoryIds = dependencies.readStoryIds ?? readNewsStoryIds;
  const readLatestIndexEntry = dependencies.readLatestIndexEntry ?? readNewsLatestIndexProductRecord;
  const readStory = dependencies.readStory ?? readNewsStory;
  const readLifecycle = dependencies.readLifecycle ?? readNewsSynthesisLifecycleStatus;
  const writeLatestIndex = dependencies.writeLatestIndexEntry ?? writeNewsLatestIndexEntry;
  const writeHotIndex = dependencies.writeHotIndexEntry ?? writeNewsHotIndexEntry;
  const writeLifecycle = dependencies.writeLifecycle ?? writeNewsSynthesisLifecycleStatus;
  const computeHotness = dependencies.computeHotness ?? computeStoryHotness;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const sampleLimit = normalizeSampleLimit(options.sampleLimit);

  const storyIds = await readStoryIds(client, { limit: sampleLimit });

  let eligible = 0;
  let skippedInvalidStory = 0;
  let repairedLatestIndex = 0;
  let repairedHotIndex = 0;
  let repairedLifecycle = 0;
  let preservedLifecycle = 0;
  const failures: ProductFeedReconciliationFailure[] = [];

  for (const storyId of storyIds.slice(0, sampleLimit)) {
    try {
      const story = await readStory(client, storyId);
      if (!isEligibleRawStory(story)) {
        skippedInvalidStory += 1;
        continue;
      }
      eligible += 1;

      const latestIndexRecord = await readLatestIndexEntry(client, story.story_id).catch(() => null);
      if (latestIndexNeedsRepair(latestIndexRecord, story)) {
        await writeLatestIndex(client, story.story_id, story.cluster_window_end, story);
        repairedLatestIndex += 1;
      }

      // Refresh hot rows even when a legacy scalar exists so story-backed
      // product metadata stays in parity with the latest index.
      await writeHotIndex(client, story.story_id, computeHotness(story, now()), story);
      repairedHotIndex += 1;

      const lifecycle = await readLifecycle(client, story.story_id).catch(() => null);
      if (lifecycleNeedsPendingRepair(lifecycle, story)) {
        await writeLifecycle(client, buildNewsSynthesisLifecycleRecord({
          story,
          status: 'pending',
          frameTableState: 'frame_table_pending',
          updatedAt: now(),
        }));
        repairedLifecycle += 1;
      } else {
        preservedLifecycle += 1;
      }
    } catch (error) {
      failures.push({
        story_id: storyId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const result: ProductFeedReconciliationResult = {
    sampled: storyIds.length,
    eligible,
    skipped_invalid_story: skippedInvalidStory,
    repaired_latest_index: repairedLatestIndex,
    repaired_hot_index: repairedHotIndex,
    repaired_lifecycle: repairedLifecycle,
    preserved_lifecycle: preservedLifecycle,
    failures,
  };

  const logPayload = {
    ...result,
    failures: failures.slice(0, 10),
  };
  if (failures.length > 0) {
    logger.warn('[vh:news-daemon] product feed reconciliation completed with failures', logPayload);
  } else {
    logger.info('[vh:news-daemon] product feed reconciliation complete', logPayload);
  }

  return result;
}
