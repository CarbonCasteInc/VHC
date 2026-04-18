import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CandidateSynthesis, TopicSynthesisV2 } from '@vh/data-model';
import type { NewsRuntimeSynthesisCandidate, StoryBundle } from '@vh/ai-engine';
import { createBundleSynthesisWorker } from './bundleSynthesisWorker';
import type { BundleSynthesisWorkerDeps } from './bundleSynthesisWorker';

const writeTopicSynthesisMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vh/gun-client')>();
  return {
    ...actual,
    writeTopicSynthesis: writeTopicSynthesisMock,
  };
});

const NOW = 1_700_000_000_000;

function makeCandidate(overrides: Partial<NewsRuntimeSynthesisCandidate> = {}): NewsRuntimeSynthesisCandidate {
  return {
    story_id: 'story-1',
    provider: {
      provider_id: 'remote-analysis',
      model_id: 'gpt-4o-mini',
      kind: 'remote',
    },
    request: {
      prompt: 'headline',
      model: 'gpt-4o-mini',
      max_tokens: 1200,
      temperature: 0.3,
    },
    work_items: [
      {
        story_id: 'story-1',
        topic_id: 'wrong-topic',
        work_type: 'full-analysis',
        summary_hint: 'headline',
        requested_at: NOW,
      },
    ],
    ...overrides,
  };
}

function makeBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-1',
    topic_id: 'topic-from-bundle',
    headline: 'Markets rally after policy announcement',
    summary_hint: 'Markets rallied after a policy announcement.',
    cluster_window_start: NOW - 3_600_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'fox-latest',
        publisher: 'Fox News',
        title: 'Markets surge on policy news',
        url: 'https://example.com/fox',
        url_hash: 'hash-1',
        published_at: NOW - 2_000,
      },
      {
        source_id: 'bbc-general',
        publisher: 'BBC News',
        title: 'Global markets up on policy shift',
        url: 'https://example.com/bbc',
        url_hash: 'hash-2',
        published_at: NOW - 1_000,
      },
      {
        source_id: 'guardian-us',
        publisher: 'The Guardian',
        title: 'Policy drives market gains',
        url: 'https://example.com/guardian',
        url_hash: 'hash-3',
        published_at: NOW,
      },
    ],
    cluster_features: {
      entity_keys: ['markets', 'policy'],
      time_bucket: '2026-04-17T21',
      semantic_signature: 'sig-markets',
      confidence_score: 0.82,
    },
    provenance_hash: 'prov-a',
    created_at: NOW,
    ...overrides,
  };
}

function validRaw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: 'Markets rallied after a policy announcement.',
    frames: [
      {
        frame: 'The policy will boost economic growth.',
        reframe: 'Short-term gains may mask structural risks.',
      },
      {
        frame: 'Officials should move quickly to preserve momentum.',
        reframe: 'Officials should slow down until safeguards are clear.',
      },
    ],
    source_count: 3,
    source_publishers: ['Ghost Publisher'],
    verification_confidence: 0.82,
    ...overrides,
  });
}

function makeDeps(overrides: Partial<BundleSynthesisWorkerDeps> = {}) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const deps: BundleSynthesisWorkerDeps = {
    client: { id: 'client' } as any,
    readStoryBundle: vi.fn().mockResolvedValue(makeBundle()) as any,
    readTopicEpochCandidate: vi.fn().mockResolvedValue(null) as any,
    writeTopicEpochCandidate: vi.fn(async (_client, candidate) => candidate as CandidateSynthesis) as any,
    writeTopicEpochSynthesis: vi.fn(async (_client, synthesis) => synthesis as TopicSynthesisV2) as any,
    writeTopicLatestSynthesisIfNotDowngrade: vi.fn(async () => ({ written: true as const })) as any,
    relay: vi.fn().mockResolvedValue(validRaw()),
    modelId: 'gpt-4o-mini',
    now: vi.fn(() => NOW),
    logger,
    ...overrides,
  };
  return { deps, logger };
}

describe('bundle synthesis worker', () => {
  afterEach(() => {
    expect(writeTopicSynthesisMock).not.toHaveBeenCalled();
    writeTopicSynthesisMock.mockClear();
  });

  it('writes candidate, epoch synthesis, and latest on the happy path', async () => {
    const { deps, logger } = makeDeps();

    await createBundleSynthesisWorker(deps)(makeCandidate());

    expect(deps.readStoryBundle).toHaveBeenCalledWith(deps.client, 'story-1');
    expect(deps.writeTopicEpochCandidate).toHaveBeenCalledTimes(1);
    expect(deps.writeTopicEpochSynthesis).toHaveBeenCalledTimes(1);
    expect(deps.writeTopicLatestSynthesisIfNotDowngrade).toHaveBeenCalledTimes(1);

    const candidatePayload = vi.mocked(deps.writeTopicEpochCandidate).mock.calls[0]![1] as CandidateSynthesis;
    const synthesisPayload = vi.mocked(deps.writeTopicEpochSynthesis).mock.calls[0]![1] as TopicSynthesisV2;

    expect(candidatePayload.topic_id).toBe('topic-from-bundle');
    expect(candidatePayload.candidate_id).toMatch(/^news-bundle:[a-f0-9]{64}$/);
    expect(synthesisPayload.topic_id).toBe('topic-from-bundle');
    expect(synthesisPayload.epoch).toBe(0);
    expect(synthesisPayload.synthesis_id).toBe('news-bundle:story-1:prov-a');
    expect(synthesisPayload.quorum).toMatchObject({ required: 1, received: 1 });
    expect(logger.info).toHaveBeenCalledWith(
      '[vh:bundle-synth] done',
      expect.objectContaining({
        story_id: 'story-1',
        topic_id: 'topic-from-bundle',
        publishers: ['BBC News', 'Fox News', 'The Guardian'],
        latest_written: true,
      }),
    );
  });

  it('skips missing bundles without relay or writes', async () => {
    const { deps, logger } = makeDeps({
      readStoryBundle: vi.fn().mockResolvedValue(null) as any,
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    expect(deps.relay).not.toHaveBeenCalled();
    expect(deps.writeTopicEpochCandidate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:bundle-synth] bundle_missing',
      expect.objectContaining({ story_id: 'story-1' }),
    );
  });

  it('uses bundle topic id and ignores candidate work item topic id', async () => {
    const { deps } = makeDeps({
      readStoryBundle: vi.fn().mockResolvedValue(makeBundle({ topic_id: 'correct-topic' })) as any,
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    const candidatePayload = vi.mocked(deps.writeTopicEpochCandidate).mock.calls[0]![1] as CandidateSynthesis;
    const synthesisPayload = vi.mocked(deps.writeTopicEpochSynthesis).mock.calls[0]![1] as TopicSynthesisV2;
    expect(candidatePayload.topic_id).toBe('correct-topic');
    expect(synthesisPayload.topic_id).toBe('correct-topic');
  });

  it('derives provenance-sensitive candidate ids and idempotently skips existing candidates', async () => {
    const { deps } = makeDeps();
    const worker = createBundleSynthesisWorker(deps);

    await worker(makeCandidate());
    const first = vi.mocked(deps.writeTopicEpochCandidate).mock.calls[0]![1] as CandidateSynthesis;

    vi.mocked(deps.readStoryBundle).mockResolvedValueOnce(makeBundle({ provenance_hash: 'prov-b' }) as any);
    await worker(makeCandidate());
    const second = vi.mocked(deps.writeTopicEpochCandidate).mock.calls[1]![1] as CandidateSynthesis;

    expect(second.candidate_id).not.toBe(first.candidate_id);

    const { deps: skipDeps, logger } = makeDeps({
      readTopicEpochCandidate: vi.fn().mockResolvedValue(first) as any,
    });
    await createBundleSynthesisWorker(skipDeps)(makeCandidate());

    expect(skipDeps.relay).not.toHaveBeenCalled();
    expect(skipDeps.writeTopicEpochCandidate).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      '[vh:bundle-synth] idempotent_skip',
      expect.objectContaining({ candidate_id: first.candidate_id }),
    );
  });

  it('rejects source-count mismatches and keeps bundle publishers as telemetry truth', async () => {
    const { deps, logger } = makeDeps({
      relay: vi.fn().mockResolvedValue(validRaw({ source_count: 1 })),
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    expect(deps.writeTopicEpochCandidate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:bundle-synth] source_count_mismatch',
      expect.objectContaining({ parsed_source_count: 1, actual_source_count: 3 }),
    );

    const { deps: okDeps, logger: okLogger } = makeDeps({
      relay: vi.fn().mockResolvedValue(
        validRaw({ source_count: 3, source_publishers: ['Fake1', 'Fake2', 'Fake3'] }),
      ),
    });
    await createBundleSynthesisWorker(okDeps)(makeCandidate());

    expect(okLogger.info).toHaveBeenCalledWith(
      '[vh:bundle-synth] done',
      expect.objectContaining({
        publishers: ['BBC News', 'Fox News', 'The Guardian'],
      }),
    );
  });

  it('adds single-source warnings from bundle reality', async () => {
    const bundle = makeBundle({ sources: [makeBundle().sources[0]!] });
    const { deps } = makeDeps({
      readStoryBundle: vi.fn().mockResolvedValue(bundle) as any,
      relay: vi.fn().mockResolvedValue(validRaw({ source_count: 1 })),
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    const candidatePayload = vi.mocked(deps.writeTopicEpochCandidate).mock.calls[0]![1] as CandidateSynthesis;
    const synthesisPayload = vi.mocked(deps.writeTopicEpochSynthesis).mock.calls[0]![1] as TopicSynthesisV2;
    expect(candidatePayload.warnings).toEqual(['single-source-only']);
    expect(synthesisPayload.warnings).toEqual(['single-source-only']);
  });

  it('contains relay failures locally and emits typed telemetry', async () => {
    const abortError = new Error('operation aborted by timeout');
    abortError.name = 'AbortError';
    const { deps, logger } = makeDeps({
      relay: vi.fn().mockRejectedValue(abortError),
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    expect(deps.writeTopicEpochCandidate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:bundle-synth] relay_timeout',
      expect.objectContaining({ error_message: 'operation aborted by timeout' }),
    );

    const { deps: failedDeps, logger: failedLogger } = makeDeps({
      relay: vi.fn().mockRejectedValue('HTTP 500: server error'),
    });
    await createBundleSynthesisWorker(failedDeps)(makeCandidate());

    expect(failedDeps.writeTopicEpochCandidate).not.toHaveBeenCalled();
    expect(failedLogger.warn).toHaveBeenCalledWith(
      '[vh:bundle-synth] relay_failed',
      expect.objectContaining({ error_message: 'HTTP 500: server error' }),
    );
  });

  it('rejects parse failures without writing and accepts final_refined payloads', async () => {
    const { deps, logger } = makeDeps({
      relay: vi.fn().mockResolvedValue('not json at all'),
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    expect(deps.writeTopicEpochCandidate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:bundle-synth] parse_failed',
      expect.objectContaining({ parse_error_code: 'NO_JSON_OBJECT_FOUND' }),
    );

    const { deps: placeholderDeps } = makeDeps({
      relay: vi.fn().mockResolvedValue(
        validRaw({
          frames: [
            { frame: 'N/A', reframe: 'N/A' },
            { frame: 'No clear bias detected', reframe: 'Frame unavailable.' },
          ],
        }),
      ),
    });
    await createBundleSynthesisWorker(placeholderDeps)(makeCandidate());
    expect(placeholderDeps.writeTopicEpochCandidate).not.toHaveBeenCalled();

    const { deps: wrappedDeps } = makeDeps({
      relay: vi.fn().mockResolvedValue(JSON.stringify({ final_refined: JSON.parse(validRaw()) })),
    });
    await createBundleSynthesisWorker(wrappedDeps)(makeCandidate());
    expect(wrappedDeps.writeTopicEpochCandidate).toHaveBeenCalledTimes(1);
  });

  it('threads latest-write skip reasons while still writing epoch synthesis', async () => {
    for (const reason of [
      'downgrade_existing_epoch',
      'downgrade_existing_quorum',
      'ownership_guard_rejected',
    ] as const) {
      const { deps, logger } = makeDeps({
        writeTopicLatestSynthesisIfNotDowngrade: vi.fn(async () => ({
          written: false as const,
          reason,
        })) as any,
      });

      await createBundleSynthesisWorker(deps)(makeCandidate());

      expect(deps.writeTopicEpochSynthesis).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        '[vh:bundle-synth] latest_skipped',
        expect.objectContaining({ reason }),
      );
    }
  });

  it('trims parsed model strings before writing', async () => {
    const { deps } = makeDeps({
      relay: vi.fn().mockResolvedValue(
        validRaw({
          summary: '  Trimmed summary.  ',
          frames: [
            {
              frame: '  Trimmed frame.  ',
              reframe: '  Trimmed reframe.  ',
            },
            {
              frame: 'Second frame.',
              reframe: 'Second reframe.',
            },
          ],
        }),
      ),
    });

    await createBundleSynthesisWorker(deps)(makeCandidate());

    const candidatePayload = vi.mocked(deps.writeTopicEpochCandidate).mock.calls[0]![1] as CandidateSynthesis;
    const synthesisPayload = vi.mocked(deps.writeTopicEpochSynthesis).mock.calls[0]![1] as TopicSynthesisV2;
    expect(candidatePayload.facts_summary).toBe('Trimmed summary.');
    expect(candidatePayload.frames[0]).toEqual({
      frame: 'Trimmed frame.',
      reframe: 'Trimmed reframe.',
    });
    expect(synthesisPayload.facts_summary).toBe('Trimmed summary.');
  });
});
