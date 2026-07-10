import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeTickSummary } from '@vh/ai-engine';
import { createRuntimeDiagnosticRecorder, resolveRuntimeDiagnosticsPath } from './runtimeDiagnostics';

function summary(
  tickSequence: number,
  overrides: Partial<NewsRuntimeTickSummary> = {},
): NewsRuntimeTickSummary {
  return {
    schemaVersion: 'vh-news-runtime-tick-summary-v1',
    tick_sequence: tickSequence,
    first_tick: tickSequence === 1,
    status: 'completed',
    skipped: false,
    no_write: false,
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
    first_raw_written_story_ids: [],
    ...overrides,
  };
}

async function readSnapshot(filePath: string): Promise<DaemonRuntimeDiagnosticSnapshotForTest> {
  return JSON.parse(await readFile(filePath, 'utf8')) as DaemonRuntimeDiagnosticSnapshotForTest;
}

interface DaemonRuntimeDiagnosticSnapshotForTest {
  schemaVersion: string;
  runId: string | null;
  noWrite: boolean;
  latest: NewsRuntimeTickSummary;
  summaries: NewsRuntimeTickSummary[];
}

describe('runtime diagnostics recorder', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

      await recorder(summary(1, { no_write: true }));
      await recorder(summary(2, { no_write: true }));
      await recorder(summary(3, { no_write: true }));

      const parsed = await readSnapshot(filePath);

      expect(parsed.schemaVersion).toBe('vh-news-runtime-diagnostics-v1');
      expect(parsed.runId).toBe('run-1');
      expect(parsed.noWrite).toBe(true);
      expect(parsed.latest.tick_sequence).toBe(3);
      expect(parsed.summaries.map((item) => item.tick_sequence)).toEqual([2, 3]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resets retained summaries when a new process run id starts at tick one', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-restart-'));
    try {
      const filePath = resolveRuntimeDiagnosticsPath({ artifactRoot: root });
      const oldRun = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: 'run-old',
        maxSummaries: 2,
      });
      await oldRun(summary(298));
      await oldRun(summary(299));

      const newRun = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: 'run-new',
        maxSummaries: 2,
      });
      await newRun(summary(1));
      await newRun(summary(2));

      const parsed = await readSnapshot(filePath);
      expect(parsed.runId).toBe('run-new');
      expect(parsed.latest.tick_sequence).toBe(2);
      expect(parsed.summaries.map((item) => item.tick_sequence)).toEqual([1, 2]);
      expect(parsed.summaries.some((item) => item.tick_sequence >= 298)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves same-run bounded ordering and tick-sequence dedupe across recorder instances', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-same-run-'));
    try {
      const filePath = resolveRuntimeDiagnosticsPath({ artifactRoot: root });
      const first = createRuntimeDiagnosticRecorder({ artifactRoot: root, runId: 'run-1', maxSummaries: 3 });
      await first(summary(1));
      await first(summary(2));

      const resumed = createRuntimeDiagnosticRecorder({ artifactRoot: root, runId: 'run-1', maxSummaries: 3 });
      await resumed(summary(2, { status: 'failed', last_stage: 'failed' }));
      await resumed(summary(3));
      await resumed(summary(4));

      const parsed = await readSnapshot(filePath);
      expect(parsed.summaries.map((item) => item.tick_sequence)).toEqual([2, 3, 4]);
      expect(parsed.summaries.find((item) => item.tick_sequence === 2)?.status).toBe('failed');
      expect(parsed.latest.tick_sequence).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resets retained summaries when the same run id crosses from no-write to live mode', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-write-mode-'));
    try {
      const filePath = resolveRuntimeDiagnosticsPath({ artifactRoot: root });
      const noWriteRun = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: 'run-reused',
        noWrite: true,
      });
      await noWriteRun(summary(98, { no_write: true }));
      await noWriteRun(summary(99, { no_write: true }));

      const liveRun = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: 'run-reused',
        noWrite: false,
      });
      await liveRun(summary(1, { no_write: false }));
      await liveRun(summary(2, { no_write: false }));

      const parsed = await readSnapshot(filePath);
      expect(parsed.runId).toBe('run-reused');
      expect(parsed.noWrite).toBe(false);
      expect(parsed.latest.tick_sequence).toBe(2);
      expect(parsed.summaries.map((item) => item.tick_sequence)).toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    ['missing', undefined, null],
    ['null', null, ''],
    ['blank', '   ', null],
    ['different', 'legacy-run', ''],
  ])('does not relabel %s legacy run history when the current run id is unavailable', async (
    _label,
    legacyRunId,
    currentRunId,
  ) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-legacy-'));
    try {
      const filePath = resolveRuntimeDiagnosticsPath({ artifactRoot: root });
      await writeFile(filePath, `${JSON.stringify({
        schemaVersion: 'vh-news-runtime-diagnostics-v1',
        generatedAt: new Date().toISOString(),
        ...(legacyRunId === undefined ? {} : { runId: legacyRunId }),
        noWrite: false,
        maxSummaries: 50,
        latest: summary(299),
        summaries: [summary(298), summary(299)],
      })}\n`, 'utf8');

      const recorder = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: currentRunId,
        maxSummaries: 2,
      });
      await recorder(summary(1));
      await recorder(summary(2));

      const parsed = await readSnapshot(filePath);
      expect(parsed.runId).toBeNull();
      expect(parsed.summaries.map((item) => item.tick_sequence)).toEqual([1, 2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('uses the environment only for undefined run ids while null and blank stay missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-run-id-tristate-'));
    try {
      vi.stubEnv('VH_DAEMON_FEED_RUN_ID', 'run-from-env');
      const envRoot = path.join(root, 'env');
      const nullRoot = path.join(root, 'null');
      const blankRoot = path.join(root, 'blank');

      await createRuntimeDiagnosticRecorder({ artifactRoot: envRoot })(summary(1));
      await createRuntimeDiagnosticRecorder({ artifactRoot: nullRoot, runId: null })(summary(1));
      await createRuntimeDiagnosticRecorder({ artifactRoot: blankRoot, runId: '   ' })(summary(1));

      expect((await readSnapshot(resolveRuntimeDiagnosticsPath({ artifactRoot: envRoot }))).runId)
        .toBe('run-from-env');
      expect((await readSnapshot(resolveRuntimeDiagnosticsPath({ artifactRoot: nullRoot }))).runId)
        .toBeNull();
      expect((await readSnapshot(resolveRuntimeDiagnosticsPath({ artifactRoot: blankRoot }))).runId)
        .toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the diagnostic write atomic before advancing in-process retention', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'vh-runtime-diag-atomic-'));
    try {
      const filePath = resolveRuntimeDiagnosticsPath({ artifactRoot: root });
      const renameCalls: Array<[string, string]> = [];
      let failRename = true;
      const recorder = createRuntimeDiagnosticRecorder({
        artifactRoot: root,
        runId: 'run-atomic',
        renameFile: async (from, to) => {
          renameCalls.push([String(from), String(to)]);
          if (failRename) {
            failRename = false;
            throw new Error('simulated atomic rename failure');
          }
          await rename(from, to);
        },
      });

      await expect(recorder(summary(1))).rejects.toThrow('simulated atomic rename failure');
      await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
      await recorder(summary(2));

      expect(renameCalls).toHaveLength(2);
      expect(renameCalls[0]?.[0]).toMatch(/\.news-runtime-diagnostics\.json\.tmp-/);
      expect(renameCalls[0]?.[1]).toBe(filePath);
      expect((await readSnapshot(filePath)).summaries.map((item) => item.tick_sequence)).toEqual([2]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
