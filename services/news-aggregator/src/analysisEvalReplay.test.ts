import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopicSynthesisV2 } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import {
  loadAcceptedAnalysisEvalSyntheses,
  replayAcceptedAnalysisEvalSyntheses,
  resolveAnalysisEvalReplayArtifactDirFromEnv,
} from './analysisEvalReplay';

function synthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-1',
    epoch: 0,
    synthesis_id: 'synthesis-1',
    inputs: { story_bundle_ids: ['story-1'] },
    quorum: {
      required: 1,
      received: 1,
      reached_at: 100,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: 'Fact summary.',
    frames: [
      {
        frame: 'Frame',
        reframe: 'Reframe',
        frame_point_id: 'synth-point:synthesis-1:0:frame',
        reframe_point_id: 'synth-point:synthesis-1:0:reframe',
      },
    ],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0,
      source_dispersion: 0,
      candidate_count: 1,
    },
    provenance: {
      candidate_ids: ['candidate-1'],
      provider_mix: [{ provider_id: 'openai', count: 1 }],
    },
    created_at: 100,
    ...overrides,
  };
}

function writeArtifact(root: string, name: string, artifact: unknown): void {
  const artifactDir = path.join(root, 'artifacts');
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(path.join(artifactDir, name), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
}

describe('analysisEvalReplay', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads the latest accepted synthesis per topic from eval artifacts', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-analysis-eval-replay-'));
    try {
      writeArtifact(tmpDir, 'old.json', {
        lifecycle_status: 'accepted',
        captured_at: 100,
        story: { story_id: 'story-old' },
        final_accepted_synthesis: synthesis({ synthesis_id: 'synthesis-old', created_at: 100 }),
      });
      writeArtifact(tmpDir, 'new.json', {
        lifecycle_status: 'accepted',
        captured_at: 200,
        story: { story_id: 'story-new' },
        final_accepted_synthesis: synthesis({ synthesis_id: 'synthesis-new', created_at: 200 }),
      });
      writeArtifact(tmpDir, 'rejected.json', {
        lifecycle_status: 'rejected',
        final_accepted_synthesis: synthesis({ topic_id: 'topic-rejected' }),
      });

      const entries = await loadAcceptedAnalysisEvalSyntheses(tmpDir, {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      });

      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        story_id: 'story-new',
        synthesis: {
          synthesis_id: 'synthesis-new',
        },
      });
    } finally {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it('replays missing accepted syntheses and skips already-current topics', async () => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'vh-analysis-eval-write-'));
    try {
      const missing = synthesis({ topic_id: 'topic-missing', synthesis_id: 'synthesis-missing' });
      const current = synthesis({ topic_id: 'topic-current', synthesis_id: 'synthesis-current' });
      writeArtifact(tmpDir, 'missing.json', {
        lifecycle_status: 'accepted',
        captured_at: 100,
        story: { story_id: 'story-missing' },
        final_accepted_synthesis: missing,
      });
      writeArtifact(tmpDir, 'current.json', {
        lifecycle_status: 'accepted',
        captured_at: 100,
        story: { story_id: 'story-current' },
        final_accepted_synthesis: current,
      });

      const writeSynthesis = vi.fn(async (_client: VennClient, next: unknown) => next as TopicSynthesisV2);
      const runWrite = vi.fn(async <T,>(_className: string, _attrs: Record<string, unknown>, task: () => Promise<T>) =>
        task(),
      );
      const result = await replayAcceptedAnalysisEvalSyntheses({
        client: {} as VennClient,
        artifactDir: tmpDir,
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        readLatest: vi.fn(async (_client, topicId) => (topicId === 'topic-current' ? current : null)),
        writeSynthesis,
        runWrite,
      });

      expect(result).toEqual({
        candidates: 2,
        written: 1,
        already_current: 1,
        failed: 0,
      });
      expect(writeSynthesis).toHaveBeenCalledWith({}, missing);
      expect(runWrite).toHaveBeenCalledWith(
        'analysis_eval_replay',
        expect.objectContaining({ topic_id: 'topic-missing', synthesis_id: 'synthesis-missing' }),
        expect.any(Function),
      );
    } finally {
      rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  it('resolves replay env only when replay or eval artifacts are enabled', () => {
    expect(resolveAnalysisEvalReplayArtifactDirFromEnv()).toBeNull();

    vi.stubEnv('VH_ANALYSIS_EVAL_REPLAY_ON_START', 'true');
    vi.stubEnv('VH_ANALYSIS_EVAL_ARTIFACT_DIR', '/tmp/vh-artifacts');

    expect(resolveAnalysisEvalReplayArtifactDirFromEnv()).toBe('/tmp/vh-artifacts');
  });
});
