import { StoryBundleSchema, type StoryBundle } from '@vh/data-model';
import {
  buildNewsSynthesisLifecycleRecord,
  computeStoryHotness,
  readNewsLatestIndexProductRecord,
  readNewsStory,
  readNewsStoryIds,
  readNewsStoryRepairCandidate,
  readNewsSynthesisLifecycleStatus,
  writeNewsHotIndexEntry,
  writeNewsLatestIndexEntry,
  writeNewsStory,
  writeNewsSynthesisLifecycleStatus,
  type NewsLatestIndexEntryRecord,
  type NewsSynthesisLifecycleRecord,
  type VennClient,
} from '@vh/gun-client';

interface LoggerLike {
  info(message?: unknown, ...optionalParams: unknown[]): void;
  warn(message?: unknown, ...optionalParams: unknown[]): void;
}

const DEFAULT_INCOMPLETE_LIFECYCLE_REFRESH_MS = 60 * 60 * 1000;
const INCOMPLETE_LIFECYCLE_STATUSES = new Set<NewsSynthesisLifecycleRecord['status']>([
  'pending',
  'retryable_failure',
]);
export const PRODUCT_FEED_REPAIR_WRITE_LANE_CONCURRENCY = {
  product_feed_repair_story: 1,
  product_feed_repair_latest_index: 1,
  product_feed_repair_hot_index: 1,
  product_feed_repair_lifecycle: 1,
} as const;
export type ProductFeedRepairWriteClass = keyof typeof PRODUCT_FEED_REPAIR_WRITE_LANE_CONCURRENCY;
export type ProductFeedRepairRunWrite = <T>(
  writeClass: ProductFeedRepairWriteClass,
  attributes: Record<string, unknown>,
  task: () => Promise<T>,
) => Promise<T>;

export interface ProductFeedReconciliationFailure {
  readonly story_id: string;
  readonly reason: string;
}

export interface ProductFeedReconciliationResult {
  readonly sampled: number;
  readonly eligible: number;
  readonly singleton_eligible: number;
  readonly multi_source_eligible: number;
  readonly skipped_invalid_story: number;
  readonly repaired_story_body: number;
  readonly repaired_latest_index: number;
  readonly repaired_hot_index: number;
  readonly repaired_lifecycle: number;
  readonly refreshed_incomplete_lifecycle: number;
  readonly preserved_lifecycle: number;
  readonly failures: readonly ProductFeedReconciliationFailure[];
}

export interface ProductFeedReconcilerDependencies {
  readonly readStoryIds?: typeof readNewsStoryIds;
  readonly readLatestIndexEntry?: typeof readNewsLatestIndexProductRecord;
  readonly readStory?: typeof readNewsStory;
  readonly readStoryRepairCandidate?: typeof readNewsStoryRepairCandidate;
  readonly readLifecycle?: typeof readNewsSynthesisLifecycleStatus;
  readonly writeStory?: typeof writeNewsStory;
  readonly writeLatestIndexEntry?: typeof writeNewsLatestIndexEntry;
  readonly writeHotIndexEntry?: typeof writeNewsHotIndexEntry;
  readonly writeLifecycle?: typeof writeNewsSynthesisLifecycleStatus;
  readonly computeHotness?: typeof computeStoryHotness;
}

export interface ProductFeedReconcilerOptions {
  readonly sampleLimit?: number;
  readonly incompleteLifecycleRefreshMs?: number;
  readonly now?: () => number;
  readonly logger?: LoggerLike;
  readonly dependencies?: ProductFeedReconcilerDependencies;
  readonly runWrite?: ProductFeedRepairRunWrite;
}

function normalizeSampleLimit(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1000;
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

function normalizePositiveMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

function lifecycleNeedsIncompleteRefresh(
  lifecycle: NewsSynthesisLifecycleRecord | null,
  story: StoryBundle,
  nowMs: number,
  refreshMs: number,
): boolean {
  if (
    !lifecycle
    || lifecycle.story_id !== story.story_id
    || lifecycle.source_set_revision !== story.provenance_hash
    || !INCOMPLETE_LIFECYCLE_STATUSES.has(lifecycle.status)
  ) {
    return false;
  }
  const updatedAt = Number(lifecycle.updated_at);
  return !Number.isFinite(updatedAt)
    || updatedAt <= 0
    || Math.max(0, Math.floor(nowMs - updatedAt)) > refreshMs;
}

export async function reconcileProductFeedFromRawStories(
  client: VennClient,
  options: ProductFeedReconcilerOptions = {},
): Promise<ProductFeedReconciliationResult> {
  const dependencies = options.dependencies ?? {};
  const readStoryIds = dependencies.readStoryIds ?? readNewsStoryIds;
  const readLatestIndexEntry = dependencies.readLatestIndexEntry ?? readNewsLatestIndexProductRecord;
  const readStory = dependencies.readStory ?? readNewsStory;
  const readStoryRepairCandidate = dependencies.readStoryRepairCandidate ?? readNewsStoryRepairCandidate;
  const readLifecycle = dependencies.readLifecycle ?? readNewsSynthesisLifecycleStatus;
  const writeStory = dependencies.writeStory ?? writeNewsStory;
  const writeLatestIndex = dependencies.writeLatestIndexEntry ?? writeNewsLatestIndexEntry;
  const writeHotIndex = dependencies.writeHotIndexEntry ?? writeNewsHotIndexEntry;
  const writeLifecycle = dependencies.writeLifecycle ?? writeNewsSynthesisLifecycleStatus;
  const computeHotness = dependencies.computeHotness ?? computeStoryHotness;
  const runWrite: ProductFeedRepairRunWrite = options.runWrite ?? ((_writeClass, _attributes, task) => task());
  const now = options.now ?? Date.now;
  const logger = options.logger ?? console;
  const sampleLimit = normalizeSampleLimit(options.sampleLimit);
  const incompleteLifecycleRefreshMs = normalizePositiveMs(
    options.incompleteLifecycleRefreshMs ?? DEFAULT_INCOMPLETE_LIFECYCLE_REFRESH_MS,
    DEFAULT_INCOMPLETE_LIFECYCLE_REFRESH_MS,
  );

  const storyIds = await readStoryIds(client, { limit: sampleLimit });

  let eligible = 0;
  let singletonEligible = 0;
  let multiSourceEligible = 0;
  let skippedInvalidStory = 0;
  let repairedStoryBody = 0;
  let repairedLatestIndex = 0;
  let repairedHotIndex = 0;
  let repairedLifecycle = 0;
  let refreshedIncompleteLifecycle = 0;
  let preservedLifecycle = 0;
  const failures: ProductFeedReconciliationFailure[] = [];

  for (const storyId of storyIds.slice(0, sampleLimit)) {
    try {
      let story = await readStory(client, storyId);
      if (!isEligibleRawStory(story)) {
        const repairCandidate = await readStoryRepairCandidate(client, storyId).catch(() => null);
        if (!isEligibleRawStory(repairCandidate)) {
          skippedInvalidStory += 1;
          continue;
        }
        const rewritten = await runWrite(
          'product_feed_repair_story',
          { story_id: storyId, operation: 'repair_story_body' },
          () => writeStory(client, repairCandidate),
        );
        story = isEligibleRawStory(rewritten) ? rewritten : repairCandidate;
        repairedStoryBody += 1;
      }
      eligible += 1;
      if (canonicalSourceCount(story) > 1) {
        multiSourceEligible += 1;
      } else {
        singletonEligible += 1;
      }

      const latestIndexRecord = await readLatestIndexEntry(client, story.story_id).catch(() => null);
      if (latestIndexNeedsRepair(latestIndexRecord, story)) {
        await runWrite(
          'product_feed_repair_latest_index',
          { story_id: story.story_id, topic_id: story.topic_id },
          () => writeLatestIndex(client, story.story_id, story.cluster_window_end, story),
        );
        repairedLatestIndex += 1;
      }

      // Refresh hot rows even when a legacy scalar exists so story-backed
      // product metadata stays in parity with the latest index.
      await runWrite(
        'product_feed_repair_hot_index',
        { story_id: story.story_id, topic_id: story.topic_id },
        () => writeHotIndex(client, story.story_id, computeHotness(story, now()), story),
      );
      repairedHotIndex += 1;

      const lifecycle = await readLifecycle(client, story.story_id).catch(() => null);
      if (lifecycleNeedsPendingRepair(lifecycle, story)) {
        await runWrite(
          'product_feed_repair_lifecycle',
          { story_id: story.story_id, status: 'pending' },
          () => writeLifecycle(client, buildNewsSynthesisLifecycleRecord({
            story,
            status: 'pending',
            frameTableState: 'frame_table_pending',
            updatedAt: now(),
          })),
        );
        repairedLifecycle += 1;
      } else if (lifecycle && lifecycleNeedsIncompleteRefresh(lifecycle, story, now(), incompleteLifecycleRefreshMs)) {
        await runWrite(
          'product_feed_repair_lifecycle',
          { story_id: story.story_id, status: lifecycle.status },
          () => writeLifecycle(client, buildNewsSynthesisLifecycleRecord({
            story,
            status: lifecycle.status,
            frameTableState: lifecycle.frame_table_state,
            retryable: lifecycle.retryable,
            reason: lifecycle.reason ?? 'product_feed_reconciled_incomplete_lifecycle',
            updatedAt: now(),
          })),
        );
        refreshedIncompleteLifecycle += 1;
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
    singleton_eligible: singletonEligible,
    multi_source_eligible: multiSourceEligible,
    skipped_invalid_story: skippedInvalidStory,
    repaired_story_body: repairedStoryBody,
    repaired_latest_index: repairedLatestIndex,
    repaired_hot_index: repairedHotIndex,
    repaired_lifecycle: repairedLifecycle,
    refreshed_incomplete_lifecycle: refreshedIncompleteLifecycle,
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
