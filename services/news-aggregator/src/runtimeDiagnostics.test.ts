import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NewsRuntimeTickSummary } from '@vh/ai-engine';
import { createRuntimeDiagnosticRecorder, resolveRuntimeDiagnosticsPath } from './runtimeDiagnostics';

function summary(tickSequence: number): NewsRuntimeTickSummary {
  return {
    schemaVersion: 'vh-news-runtime-tick-summary-v1',
    tick_sequence: tickSequence,
    first_tick: tickSequence === 1,
    status: 'completed',
    skipped: false,
    no_write: true,
    started_at: new Date(1_700_000_000_000 + tickSequence).toISOString(),
    completed_at: new Date(1_700_000_001_000 + tickSequence).toISOString(),
    duration_ms: 1_000,
    poll_interval_ms: 60_000,
    feed_source_count: 1,
    published_bundle_limit: 24,
    ingested_item_count: 3,
    normalized_item_count: 2,
    clustered_bundle_count: 1,
    clustered_storyline_count: 0,
    selected_bundle_count: 1,
    selected_singleton_bundle_count: 1,
    selected_multi_source_bundle_count: 0,
    publication_ineligible_bundle_count: 0,
    raw_write_attempted_count: 0,
    raw_write_suppressed_count: 1,
    raw_wrote_count: 0,
    raw_write_failed_count: 0,
    storyline_write_attempted_count: 0,
    storyline_write_suppressed_count: 0,
    storyline_wrote_count: 0,
    storyline_write_failed_count: 0,
    stale_story_remove_attempted_count: 0,
    stale_story_remove_suppressed_count: 0,
    stale_story_removed_count: 0,
    stale_story_remove_failed_count: 0,
    stale_storyline_remove_attempted_count: 0,
    stale_storyline_remove_suppressed_count: 0,
    stale_storyline_removed_count: 0,
    stale_storyline_remove_failed_count: 0,
    synthesis_candidate_enqueued_count: 0,
    synthesis_candidate_suppressed_count: 1,
    nonfatal_prewrite_failure_count: 0,
    last_stage: 'completed',
    first_selected_story_ids: ['story-1'],
  };
}

describe('runtime diagnostics recorder', () => {
  it('writes a bounded atomic diagnostic snapshot', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-'));
    try {
      const filePath = resolveRuntimeDiagnosticsPath({ artifactRoot: root });
      const recorder = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: 'run-1',
        noWrite: true,
        maxSummaries: 2,
      });

      await recorder(summary(1));
      await recorder(summary(2));
      await recorder(summary(3));

      const parsed = JSON.parse(await readFile(filePath, 'utf8')) as {
        schemaVersion: string;
        runId: string;
        noWrite: boolean;
        latest: NewsRuntimeTickSummary;
        summaries: NewsRuntimeTickSummary[];
      };

      expect(parsed.schemaVersion).toBe('vh-news-runtime-diagnostics-v1');
      expect(parsed.runId).toBe('run-1');
      expect(parsed.noWrite).toBe(true);
      expect(parsed.latest.tick_sequence).toBe(3);
      expect(parsed.summaries.map((item) => item.tick_sequence)).toEqual([2, 3]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
