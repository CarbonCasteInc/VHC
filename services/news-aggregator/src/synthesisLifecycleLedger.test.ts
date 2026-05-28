import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import {
  appendSynthesisLifecycleRecord,
  replayableSynthesisLifecycleCandidates,
  synthesisLifecycleRecordFromWorkerResult,
} from './synthesisLifecycleLedger';
import { replaySynthesisLifecycleFromLedger } from './synthesisLifecycleReplay';

const candidate: NewsRuntimeSynthesisCandidate = {
  story_id: 'story-1',
  provider: {
    provider_id: 'remote-analysis',
    model_id: 'gpt-5-nano',
    kind: 'remote',
  },
  request: {
    prompt: 'Prompt',
    model: 'gpt-5-nano',
    max_tokens: 1024,
    temperature: 0.1,
  },
  work_items: [],
};

describe('synthesisLifecycleLedger', () => {
  it('marks retryable returned failures without retrying terminal domain outcomes', () => {
    const retryable = synthesisLifecycleRecordFromWorkerResult({
      candidate,
      now: 100,
      result: { status: 'rejected', storyId: 'story-1', reason: 'relay_failed' },
    });
    const terminal = synthesisLifecycleRecordFromWorkerResult({
      candidate: { ...candidate, story_id: 'story-2' },
      now: 101,
      result: { status: 'rejected', storyId: 'story-2', reason: 'source_text_unavailable' },
    });

    expect(retryable).toMatchObject({
      story_id: 'story-1',
      reason: 'relay_failed',
      retryable: true,
    });
    expect(terminal).toMatchObject({
      story_id: 'story-2',
      reason: 'source_text_unavailable',
      retryable: false,
    });
    expect(replayableSynthesisLifecycleCandidates([retryable, terminal])).toEqual([candidate]);
  });

  it('records latest write skips distinctly from accepted synthesis writes', () => {
    const latestSkipped = synthesisLifecycleRecordFromWorkerResult({
      candidate,
      now: 100,
      result: {
        status: 'written',
        storyId: 'story-1',
        synthesisId: 'synth-1',
        latestStatus: 'skipped',
      },
    });
    const written = synthesisLifecycleRecordFromWorkerResult({
      candidate,
      now: 101,
      result: {
        status: 'written',
        storyId: 'story-1',
        synthesisId: 'synth-2',
        latestStatus: 'written',
      },
    });

    expect(latestSkipped.reason).toBe('latest_write_skipped');
    expect(latestSkipped.retryable).toBe(false);
    expect(written.reason).toBe('synthesis_written');
  });

  it('replays only the latest retryable lifecycle candidate for selected stories', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-synthesis-lifecycle-'));
    const ledgerPath = path.join(tmpDir, 'ledger.jsonl');
    try {
      appendSynthesisLifecycleRecord({
        filePath: ledgerPath,
        record: synthesisLifecycleRecordFromWorkerResult({
          candidate,
          now: 100,
          result: { status: 'rejected', storyId: 'story-1', reason: 'relay_failed' },
        }),
      });
      appendSynthesisLifecycleRecord({
        filePath: ledgerPath,
        record: synthesisLifecycleRecordFromWorkerResult({
          candidate: { ...candidate, story_id: 'story-2' },
          now: 101,
          result: { status: 'rejected', storyId: 'story-2', reason: 'source_text_unavailable' },
        }),
      });
      appendSynthesisLifecycleRecord({
        filePath: ledgerPath,
        record: synthesisLifecycleRecordFromWorkerResult({
          candidate: { ...candidate, request: { ...candidate.request, prompt: 'New prompt' } },
          now: 102,
          result: { status: 'rejected', storyId: 'story-1', reason: 'parse_failed' },
        }),
      });
      const worker = vi.fn(async () => ({ status: 'skipped', storyId: 'story-1', reason: 'no_analysis_sources' }));
      const onWorkerResult = vi.fn();

      const result = await replaySynthesisLifecycleFromLedger({
        ledgerPath,
        storyIds: ['story-1', 'story-2'],
        worker,
        onWorkerResult,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      });

      expect(result).toMatchObject({
        candidates: 1,
        replayed: 1,
        failed: 0,
        story_ids: ['story-1'],
      });
      expect(worker).toHaveBeenCalledWith(expect.objectContaining({
        story_id: 'story-1',
        request: expect.objectContaining({ prompt: 'New prompt' }),
      }));
      expect(onWorkerResult).toHaveBeenCalledTimes(1);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
