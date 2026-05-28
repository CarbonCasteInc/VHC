import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import type { BundleSynthesisWorkerResult } from './bundleSynthesisWorker';
import type { LoggerLike } from './daemonUtils';

export type SynthesisLifecycleReason =
  | 'story_missing'
  | 'no_analysis_sources'
  | 'source_text_unavailable'
  | 'source_analysis_failed'
  | 'relay_failed'
  | 'parse_failed'
  | 'source_count_mismatch'
  | 'candidate_write_failed'
  | 'epoch_write_failed'
  | 'latest_write_skipped'
  | 'latest_write_failed'
  | 'synthesis_written';

export interface SynthesisLifecycleRecord {
  readonly schemaVersion: 'vh-news-synthesis-lifecycle-v1';
  readonly recorded_at: number;
  readonly story_id: string;
  readonly status: BundleSynthesisWorkerResult['status'];
  readonly reason: SynthesisLifecycleReason;
  readonly retryable: boolean;
  readonly synthesis_id?: string;
  readonly latest_status?: 'written' | 'skipped';
  readonly candidate: NewsRuntimeSynthesisCandidate;
}

const RETRYABLE_REASONS = new Set<SynthesisLifecycleReason>([
  'relay_failed',
  'parse_failed',
  'candidate_write_failed',
  'epoch_write_failed',
  'latest_write_failed',
]);

export function isRetryableSynthesisLifecycleReason(reason: SynthesisLifecycleReason): boolean {
  return RETRYABLE_REASONS.has(reason);
}

export function synthesisLifecycleRecordFromWorkerResult(input: {
  readonly candidate: NewsRuntimeSynthesisCandidate;
  readonly result: BundleSynthesisWorkerResult;
  readonly now: number;
}): SynthesisLifecycleRecord {
  const reason: SynthesisLifecycleReason = input.result.status === 'written'
    ? input.result.latestStatus === 'skipped'
      ? 'latest_write_skipped'
      : 'synthesis_written'
    : input.result.reason;

  return {
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    recorded_at: input.now,
    story_id: input.result.storyId || input.candidate.story_id,
    status: input.result.status,
    reason,
    retryable: isRetryableSynthesisLifecycleReason(reason),
    ...(input.result.status === 'written' ? {
      synthesis_id: input.result.synthesisId,
      latest_status: input.result.latestStatus,
    } : {}),
    candidate: input.candidate,
  };
}

export function appendSynthesisLifecycleRecord(input: {
  readonly filePath: string;
  readonly record: SynthesisLifecycleRecord;
  readonly logger?: LoggerLike;
}): void {
  try {
    mkdirSync(path.dirname(input.filePath), { recursive: true });
    appendFileSync(input.filePath, `${JSON.stringify(input.record)}\n`, 'utf8');
  } catch (error) {
    input.logger?.warn('[vh:bundle-synthesis] lifecycle ledger write failed', {
      file: input.filePath,
      story_id: input.record.story_id,
      error,
    });
  }
}

export function readSynthesisLifecycleRecords(
  filePath: string,
  logger: LoggerLike = console,
): SynthesisLifecycleRecord[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) {
    return [];
  }
  const records: SynthesisLifecycleRecord[] = [];
  for (const line of content.split('\n')) {
    try {
      const parsed = JSON.parse(line) as SynthesisLifecycleRecord;
      if (parsed.schemaVersion === 'vh-news-synthesis-lifecycle-v1' && parsed.story_id) {
        records.push(parsed);
      }
    } catch (error) {
      logger.warn('[vh:bundle-synthesis] lifecycle ledger parse failed', { file: filePath, error });
    }
  }
  return records;
}

export function replayableSynthesisLifecycleCandidates(
  records: readonly SynthesisLifecycleRecord[],
  storyIds?: readonly string[],
): NewsRuntimeSynthesisCandidate[] {
  const filter = storyIds && storyIds.length > 0 ? new Set(storyIds) : null;
  const latestByStory = new Map<string, SynthesisLifecycleRecord>();
  for (const record of records) {
    if (filter && !filter.has(record.story_id)) {
      continue;
    }
    const existing = latestByStory.get(record.story_id);
    if (!existing || record.recorded_at >= existing.recorded_at) {
      latestByStory.set(record.story_id, record);
    }
  }
  return [...latestByStory.values()]
    .filter((record) => record.retryable)
    .map((record) => record.candidate);
}
