import { describe, expect, it, vi } from 'vitest';
import type { TopicSynthesisV2 } from '@vh/data-model';

const hasForbiddenSynthesisPayloadFieldsMock = vi.fn<
  (payload: unknown) => boolean
>();
const writeTopicSynthesisMock = vi.fn<
  (client: unknown, synthesis: unknown) => Promise<TopicSynthesisV2>
>();

vi.mock('@vh/gun-client', () => ({
  hasForbiddenSynthesisPayloadFields: (payload: unknown) =>
    hasForbiddenSynthesisPayloadFieldsMock(payload),
  writeTopicSynthesis: (client: unknown, synthesis: unknown) =>
    writeTopicSynthesisMock(client, synthesis),
}));

import {
  validatePipelineOutput,
  persistSynthesisOutput,
  type PipelineBridgeDeps,
} from '../pipelineBridge';

// ── Fixtures ───────────────────────────────────────────────────────

const NOW = 1_700_000_000_000;

function validSynthesis(
  overrides?: Partial<TopicSynthesisV2>,
): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-1',
    epoch: 1,
    synthesis_id: 'synth-1',
    inputs: {
      story_bundle_ids: ['story-1'],
      topic_digest_ids: ['digest-1'],
      topic_seed_id: 'seed-1',
    },
    quorum: {
      required: 3,
      received: 3,
      reached_at: NOW,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: 'Summary text',
    frames: [{ frame: 'Frame', reframe: 'Reframe' }],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0.1,
      source_dispersion: 0.5,
      candidate_count: 3,
    },
    provenance: {
      candidate_ids: ['c1', 'c2', 'c3'],
      provider_mix: [{ provider_id: 'prov-1', count: 3 }],
    },
    created_at: NOW,
    ...overrides,
  };
}

function makeDeps(
  overrides?: Partial<PipelineBridgeDeps>,
): PipelineBridgeDeps {
  return {
    resolveClient: () => null,
    setTopicSynthesis: vi.fn(),
    ...overrides,
  };
}

// ── validatePipelineOutput ─────────────────────────────────────────

describe('validatePipelineOutput', () => {
  beforeEach(() => {
    hasForbiddenSynthesisPayloadFieldsMock.mockReturnValue(false);
    writeTopicSynthesisMock.mockReset();
  });

  it('accepts valid synthesis', () => {
    const result = validatePipelineOutput(validSynthesis());
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.synthesis.topic_id).toBe('topic-1');
    }
  });

  it('rejects output with forbidden fields', () => {
    hasForbiddenSynthesisPayloadFieldsMock.mockReturnValue(true);
    const result = validatePipelineOutput(validSynthesis());
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('forbidden');
    }
  });

  it('rejects invalid schema', () => {
    const result = validatePipelineOutput({ schemaVersion: 'wrong' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain('Schema validation failed');
    }
  });
});

// ── persistSynthesisOutput ─────────────────────────────────────────

describe('persistSynthesisOutput', () => {
  beforeEach(() => {
    hasForbiddenSynthesisPayloadFieldsMock.mockReturnValue(false);
    writeTopicSynthesisMock.mockReset();
  });

  it('updates store with valid output', async () => {
    const setTopicSynthesis = vi.fn();
    const deps = makeDeps({ setTopicSynthesis });
    const synthesis = validSynthesis();

    const result = await persistSynthesisOutput(deps, synthesis);

    expect(result.ok).toBe(true);
    expect(setTopicSynthesis).toHaveBeenCalledWith(
      'topic-1',
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
  });

  it('rejects forbidden payload', async () => {
    hasForbiddenSynthesisPayloadFieldsMock.mockReturnValue(true);
    const deps = makeDeps();

    const result = await persistSynthesisOutput(deps, validSynthesis());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('forbidden');
  });

  it('rejects invalid schema', async () => {
    const deps = makeDeps();
    const result = await persistSynthesisOutput(deps, {
      schemaVersion: 'wrong',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Schema validation failed');
  });

  it('reports when no Gun client available', async () => {
    const deps = makeDeps({ resolveClient: () => null });
    const result = await persistSynthesisOutput(deps, validSynthesis());
    expect(result.ok).toBe(true);
    expect(result.reason).toContain('no Gun client');
  });

  it('writes to Gun mesh when client available', async () => {
    const mockClient = { mesh: {} } as any;
    const synthesis = validSynthesis();
    writeTopicSynthesisMock.mockResolvedValue(synthesis);

    const deps = makeDeps({ resolveClient: () => mockClient });
    const result = await persistSynthesisOutput(deps, synthesis);

    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(writeTopicSynthesisMock).toHaveBeenCalledWith(
      mockClient,
      expect.objectContaining({ topic_id: 'topic-1' }),
    );
  });

  it('handles Gun write failure gracefully', async () => {
    const mockClient = { mesh: {} } as any;
    writeTopicSynthesisMock.mockRejectedValue(new Error('Network error'));

    const deps = makeDeps({ resolveClient: () => mockClient });
    const result = await persistSynthesisOutput(deps, validSynthesis());

    expect(result.ok).toBe(true);
    expect(result.reason).toContain('mesh write failed');
    expect(result.reason).toContain('Network error');
  });

  it('handles non-Error Gun write failure gracefully', async () => {
    const mockClient = { mesh: {} } as any;
    writeTopicSynthesisMock.mockRejectedValue('string error');

    const deps = makeDeps({ resolveClient: () => mockClient });
    const result = await persistSynthesisOutput(deps, validSynthesis());

    expect(result.ok).toBe(true);
    expect(result.reason).toContain('Gun write failed');
  });
});

// ── Import for beforeEach ──────────────────────────────────────────
import { beforeEach } from 'vitest';
