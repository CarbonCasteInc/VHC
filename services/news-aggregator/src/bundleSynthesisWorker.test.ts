import { describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import type { CandidateSynthesis, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import { createBundleSynthesisWorker } from './bundleSynthesisWorker';

const BUNDLE: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-1',
  topic_id: 'topic-1',
  headline: 'City council approves housing plan',
  summary_hint: 'City officials approved a housing plan after public debate.',
  cluster_window_start: 1700000000000,
  cluster_window_end: 1700000001000,
  sources: [
    {
      source_id: 'source-analysis',
      publisher: 'Local Daily',
      url: 'https://example.com/local',
      url_hash: 'hash-local',
      published_at: 1700000000000,
      title: 'Council approves housing plan',
    },
    {
      source_id: 'source-related',
      publisher: 'Link Only',
      url: 'https://example.com/link-only',
      url_hash: 'hash-link',
      published_at: 1700000000001,
      title: 'Related but unreadable story',
    },
  ],
  primary_sources: [
    {
      source_id: 'source-analysis',
      publisher: 'Local Daily',
      url: 'https://example.com/local',
      url_hash: 'hash-local',
      published_at: 1700000000000,
      title: 'Council approves housing plan',
    },
  ],
  related_links: [
    {
      source_id: 'source-related',
      publisher: 'Link Only',
      url: 'https://example.com/link-only',
      url_hash: 'hash-link',
      published_at: 1700000000001,
      title: 'Related but unreadable story',
    },
  ],
  cluster_features: {
    entity_keys: ['housing'],
    time_bucket: '2026-04-20T12',
    semantic_signature: 'sig-1',
    confidence_score: 0.8,
  },
  provenance_hash: 'prov-1',
  created_at: 1700000002000,
};

const CANDIDATE: NewsRuntimeSynthesisCandidate = {
  story_id: 'story-1',
  provider: {
    provider_id: 'remote-analysis',
    model_id: 'gpt-4o-mini',
    kind: 'remote',
  },
  request: {
    prompt: 'Prompt',
    model: 'gpt-4o-mini',
    max_tokens: 1200,
    temperature: 0.2,
  },
  work_items: [
    {
      story_id: 'story-1',
      topic_id: 'topic-1',
      work_type: 'full-analysis',
      summary_hint: 'Summary',
      requested_at: 1700000000000,
    },
  ],
};

describe('bundleSynthesisWorker', () => {
  it('writes publish-time candidate, epoch synthesis, and guarded latest from accepted StoryBundle', async () => {
    const writtenCandidates: CandidateSynthesis[] = [];
    const writtenSyntheses: TopicSynthesisV2[] = [];
    const relay = vi.fn(async () => ({
      model: 'gpt-4o-mini',
      content: JSON.stringify({
        summary: 'Council members approved a housing plan after public debate.',
        frames: [
          {
            frame: 'The plan will expand needed housing supply.',
            reframe: 'The plan may strain existing neighborhood infrastructure.',
          },
        ],
        source_count: 1,
        source_publishers: ['Local Daily'],
        verification_confidence: 0.8,
      }),
    }));
    const writeLatest = vi.fn(async (_client, synthesis: TopicSynthesisV2, options) => {
      expect(options?.canOverwriteExisting?.({ ...synthesis, synthesis_id: 'manual-synth' }, synthesis)).toBe(false);
      expect(options?.canOverwriteExisting?.({ ...synthesis, synthesis_id: 'news-bundle:old' }, synthesis)).toBe(true);
      return { status: 'written' as const, synthesis, previous: null };
    });

    const worker = createBundleSynthesisWorker({
      client: {} as VennClient,
      now: () => 1700000003000,
      readBundle: async () => BUNDLE,
      readCandidate: vi.fn(async () => null),
      writeCandidate: vi.fn(async (_client, candidate) => {
        writtenCandidates.push(candidate);
        return candidate;
      }),
      writeSynthesis: vi.fn(async (_client, synthesis) => {
        writtenSyntheses.push(synthesis);
        return synthesis;
      }),
      writeLatest,
      relay,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker(CANDIDATE)).resolves.toMatchObject({
      status: 'written',
      latestStatus: 'written',
    });

    expect(relay).toHaveBeenCalledTimes(1);
    const relayPrompt = relay.mock.calls[0]?.[0].prompt;
    expect(relayPrompt).toContain('Local Daily');
    expect(relayPrompt).not.toContain('Link Only');

    expect(writtenCandidates).toHaveLength(1);
    expect(writtenCandidates[0]).toMatchObject({
      topic_id: 'topic-1',
      epoch: 0,
      facts_summary: 'Council members approved a housing plan after public debate.',
      warnings: ['single_source_story_bundle', 'related_links_excluded_from_analysis'],
    });
    expect(writtenCandidates[0]?.candidate_id).toMatch(/^news-bundle:/);

    expect(writtenSyntheses).toHaveLength(1);
    expect(writtenSyntheses[0]).toMatchObject({
      schemaVersion: 'topic-synthesis-v2',
      topic_id: 'topic-1',
      epoch: 0,
      inputs: { story_bundle_ids: ['story-1'] },
      quorum: { required: 1, received: 1 },
      provenance: { provider_mix: [{ provider_id: 'openai', count: 1 }] },
    });
    expect(writtenSyntheses[0]?.frames[0]?.frame_point_id).toMatch(/^synth-point:/);
    expect(writtenSyntheses[0]?.synthesis_id).toMatch(/^news-bundle:story-1:/);
    expect(writeLatest).toHaveBeenCalledTimes(1);
  });

  it('recovers synthesis writes from duplicate candidates before spending a model call', async () => {
    const relay = vi.fn();
    const writtenSyntheses: TopicSynthesisV2[] = [];
    const existingCandidate = {
      candidate_id: 'news-bundle:existing',
      topic_id: 'topic-1',
      epoch: 0,
      critique_notes: [],
      facts_summary: 'Existing summary',
      frames: [{ frame: 'Existing frame', reframe: 'Existing reframe' }],
      warnings: [],
      divergence_hints: [],
      provider: { provider_id: 'openai', model_id: 'gpt-4o-mini', kind: 'remote' },
      created_at: 1700000003000,
    } satisfies CandidateSynthesis;

    const worker = createBundleSynthesisWorker({
      client: {} as VennClient,
      readBundle: async () => BUNDLE,
      readCandidate: vi.fn(async () => existingCandidate),
      writeSynthesis: vi.fn(async (_client, synthesis) => {
        writtenSyntheses.push(synthesis);
        return synthesis;
      }),
      writeLatest: vi.fn(async (_client, synthesis) => ({ status: 'written' as const, synthesis, previous: null })),
      relay,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker(CANDIDATE)).resolves.toMatchObject({
      status: 'written',
      storyId: 'story-1',
      latestStatus: 'written',
    });
    expect(relay).not.toHaveBeenCalled();
    expect(writtenSyntheses).toHaveLength(1);
    expect(writtenSyntheses[0]).toMatchObject({
      facts_summary: 'Existing summary',
      provenance: { candidate_ids: [expect.stringMatching(/^news-bundle:/)] },
    });
  });

  it('scopes idempotency to the configured model', async () => {
    const candidateIds: string[] = [];
    const existingCandidate = {
      candidate_id: 'news-bundle:existing',
      topic_id: 'topic-1',
      epoch: 0,
      critique_notes: [],
      facts_summary: 'Existing summary',
      frames: [],
      warnings: [],
      divergence_hints: [],
      provider: { provider_id: 'openai', model_id: 'gpt-4o-mini', kind: 'remote' },
      created_at: 1700000003000,
    } satisfies CandidateSynthesis;
    const readCandidate = vi.fn(
      async (_client: VennClient, _topicId: string, _epoch: number, candidateId: string) => {
        candidateIds.push(candidateId);
        return existingCandidate;
      },
    );

    await createBundleSynthesisWorker({
      client: {} as VennClient,
      model: 'gpt-4o-mini',
      readBundle: async () => BUNDLE,
      readCandidate,
      writeSynthesis: vi.fn(async (_client, synthesis) => synthesis),
      writeLatest: vi.fn(async (_client, synthesis) => ({ status: 'written' as const, synthesis, previous: null })),
      relay: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })(CANDIDATE);
    await createBundleSynthesisWorker({
      client: {} as VennClient,
      model: 'gpt-5.2-mini',
      readBundle: async () => BUNDLE,
      readCandidate,
      writeSynthesis: vi.fn(async (_client, synthesis) => synthesis),
      writeLatest: vi.fn(async (_client, synthesis) => ({ status: 'written' as const, synthesis, previous: null })),
      relay: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })(CANDIDATE);

    expect(candidateIds).toHaveLength(2);
    expect(candidateIds[0]).not.toBe(candidateIds[1]);
  });

  it('rejects generated output that widens analysis source count', async () => {
    const worker = createBundleSynthesisWorker({
      client: {} as VennClient,
      readBundle: async () => BUNDLE,
      readCandidate: vi.fn(async () => null),
      relay: vi.fn(async () => ({
        model: 'gpt-4o-mini',
        content: JSON.stringify({
          summary: 'Summary.',
          frames: [{ frame: 'One side supports the plan.', reframe: 'Another side questions the plan.' }],
          source_count: 2,
          source_publishers: ['Local Daily', 'Link Only'],
          verification_confidence: 0.8,
        }),
      })),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker(CANDIDATE)).resolves.toEqual({
      status: 'rejected',
      storyId: 'story-1',
      reason: 'source_count_mismatch',
    });
  });
});
