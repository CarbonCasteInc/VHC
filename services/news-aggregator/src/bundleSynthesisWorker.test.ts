import { describe, expect, it, vi } from 'vitest';
import type { NewsRuntimeSynthesisCandidate } from '@vh/ai-engine';
import type { CandidateSynthesis, StoryBundle, TopicSynthesisV2 } from '@vh/data-model';
import type { VennClient } from '@vh/gun-client';
import type { AnalysisEvalArtifact } from './analysisEvalArtifacts';
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

function makeArticleText(text = 'Council approved a housing plan after hours of public testimony.'): {
  url: string;
  urlHash: string;
  contentHash: string;
  sourceDomain: string;
  title: string;
  text: string;
  extractionMethod: 'article-extractor';
  cacheHit: 'none';
  attempts: number;
  fetchedAt: number;
  quality: { charCount: number; wordCount: number; sentenceCount: number; score: number };
} {
  return {
    url: 'https://example.com/local',
    urlHash: 'hash-local',
    contentHash: 'content-hash-local',
    sourceDomain: 'example.com',
    title: 'Council approves housing plan',
    text,
    extractionMethod: 'article-extractor',
    cacheHit: 'none',
    attempts: 1,
    fetchedAt: 1700000002500,
    quality: { charCount: text.length, wordCount: 9, sentenceCount: 1, score: 0.9 },
  };
}

function articleAnalysisPayload() {
  return {
    key_facts: ['Council approved a housing plan after public testimony.'],
    summary: 'Council approved a housing plan after public testimony.',
    bias_claim_quote: ['public testimony'],
    justify_bias_claim: ['The quote shows the approval followed public input.'],
    biases: ['No clear bias detected'],
    counterpoints: ['N/A'],
    confidence: 0.86,
    perspectives: [
      {
        frame: 'The plan will expand needed housing supply.',
        reframe: 'The plan may strain existing neighborhood infrastructure.',
      },
    ],
  };
}

function bundleSynthesisPayload(sourceCount = 1) {
  return {
    key_facts: ['Council approved a housing plan after public testimony.'],
    summary: 'Council approved a housing plan after public testimony.',
    frame_reframe_table: [
      {
        frame: 'The plan will expand needed housing supply.',
        reframe: 'The plan may strain existing neighborhood infrastructure.',
      },
    ],
    source_count: sourceCount,
    warnings: [],
    synthesis_ready: true,
  };
}

function makeArticleTextService() {
  return {
    extract: vi.fn(async () => makeArticleText()),
  };
}

function auditedCandidate(overrides: Partial<CandidateSynthesis> = {}): CandidateSynthesis {
  return {
    candidate_id: 'news-bundle:existing',
    topic_id: 'topic-1',
    epoch: 0,
    critique_notes: [],
    key_facts: ['Council approved a housing plan after public testimony.'],
    facts_summary: 'Existing summary',
    frames: [{ frame: 'Existing frame', reframe: 'Existing reframe' }],
    source_analyses: [
      {
        source_id: 'source-analysis',
        publisher: 'Local Daily',
        title: 'Council approves housing plan',
        url: 'https://example.com/local',
        url_hash: 'hash-local',
        key_facts: ['Council approved a housing plan after public testimony.'],
        summary: 'Council approved a housing plan after public testimony.',
        bias_claim_quote: ['public testimony'],
        justify_bias_claim: ['The quote shows the approval followed public input.'],
        biases: ['No clear bias detected'],
        counterpoints: ['N/A'],
        perspectives: [
          {
            frame: 'The plan will expand needed housing supply.',
            reframe: 'The plan may strain existing neighborhood infrastructure.',
          },
        ],
        confidence: 0.86,
        analyzed_at: 1700000003000,
        provider: { provider_id: 'openai', model_id: 'gpt-4o-mini', kind: 'remote' },
      },
    ],
    warnings: [],
    divergence_hints: [],
    provider: { provider_id: 'openai', model_id: 'gpt-4o-mini', kind: 'remote' },
    created_at: 1700000003000,
    ...overrides,
  };
}

function legacyCandidateWithoutAudit(): CandidateSynthesis {
  return {
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
  };
}

describe('bundleSynthesisWorker', () => {
  it('writes publish-time candidate, epoch synthesis, and guarded latest from accepted StoryBundle', async () => {
    const writtenCandidates: CandidateSynthesis[] = [];
    const writtenSyntheses: TopicSynthesisV2[] = [];
    const artifacts: AnalysisEvalArtifact[] = [];
    const articleTextService = makeArticleTextService();
    const relay = vi.fn(async ({ prompt }: { prompt: string }) => ({
      model: 'gpt-4o-mini',
      content: JSON.stringify(
        prompt.includes('--- ARTICLE START ---')
          ? articleAnalysisPayload()
          : bundleSynthesisPayload(),
      ),
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
      analysisEvalArtifactWriter: {
        write: vi.fn(async (artifact) => {
          artifacts.push(artifact);
        }),
      },
      articleTextService,
      relay,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker(CANDIDATE)).resolves.toMatchObject({
      status: 'written',
      latestStatus: 'written',
    });

    expect(articleTextService.extract).toHaveBeenCalledWith('https://example.com/local');
    expect(relay).toHaveBeenCalledTimes(2);
    const articlePrompt = relay.mock.calls[0]?.[0].prompt;
    const synthesisPrompt = relay.mock.calls[1]?.[0].prompt;
    expect(articlePrompt).toContain('Council approved a housing plan');
    expect(synthesisPrompt).toContain('Local Daily');
    expect(synthesisPrompt).toContain('key_facts');
    expect(synthesisPrompt).not.toContain('Link Only');

    expect(writtenCandidates).toHaveLength(1);
    expect(writtenCandidates[0]).toMatchObject({
      topic_id: 'topic-1',
      epoch: 0,
      key_facts: ['Council approved a housing plan after public testimony.'],
      facts_summary: 'Council approved a housing plan after public testimony.',
      warnings: ['single_source_story_bundle', 'related_links_excluded_from_analysis'],
    });
    expect(writtenCandidates[0]?.candidate_id).toMatch(/^news-bundle:/);
    expect(writtenCandidates[0]?.source_analyses?.[0]).toMatchObject({
      source_id: 'source-analysis',
      justify_bias_claim: ['The quote shows the approval followed public input.'],
    });

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
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      schema_version: 'analysis-eval-artifact-v1',
      lifecycle_status: 'accepted',
      usage_policy: {
        label_status: 'weak_label_unreviewed',
        training_state: 'not_training_ready',
        raw_article_text_training_use: 'requires_rights_review',
      },
      request: {
        model: 'gpt-4o-mini',
        temperature: 0.2,
        pipeline_version: 'news-bundle-v2-fulltext',
      },
      story: {
        story_id: 'story-1',
        topic_id: 'topic-1',
        story_kind: 'bundle',
        analysis_kind: 'singleton',
        analysis_source_ids: ['source-analysis'],
        readable_source_ids: ['source-analysis'],
        analyzed_source_ids: ['source-analysis'],
      },
      generated: {
        facts: ['Council approved a housing plan after public testimony.'],
        summary: 'Council approved a housing plan after public testimony.',
        frame_reframe_table: [
          {
            frame: 'The plan will expand needed housing supply.',
            reframe: 'The plan may strain existing neighborhood infrastructure.',
          },
        ],
      },
      human_review: {
        status: 'unreviewed',
        human_edits: [],
        human_approvals: [],
        human_rejections: [],
        user_facing_corrections: [],
      },
    });
    expect(artifacts[0]?.source_articles[0]).toMatchObject({
      source: { source_id: 'source-analysis', url: 'https://example.com/local' },
      extraction: {
        raw_extracted_article_text: 'Council approved a housing plan after hours of public testimony.',
        extraction_method: 'article-extractor',
        extraction_version: 'article-text-v1',
      },
    });
    expect(artifacts[0]?.source_articles[0]?.article_analysis.request.prompt).toContain('--- ARTICLE START ---');
    expect(artifacts[0]?.bundle_synthesis.request?.prompt).toContain('Eligible sources: 1');
    expect(artifacts[0]?.candidate_synthesis?.candidate_id).toMatch(/^news-bundle:/);
    expect(artifacts[0]?.final_accepted_synthesis?.schemaVersion).toBe('topic-synthesis-v2');
    expect(artifacts[0]?.validator_failures).toEqual([]);
  });

  it('recovers synthesis writes from duplicate candidates before spending a model call', async () => {
    const relay = vi.fn();
    const writtenSyntheses: TopicSynthesisV2[] = [];
    const articleTextService = makeArticleTextService();
    const existingCandidate = auditedCandidate();

    const worker = createBundleSynthesisWorker({
      client: {} as VennClient,
      readBundle: async () => BUNDLE,
      readCandidate: vi.fn(async () => existingCandidate),
      articleTextService,
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
    expect(articleTextService.extract).toHaveBeenCalledTimes(1);
    expect(writtenSyntheses).toHaveLength(1);
    expect(writtenSyntheses[0]).toMatchObject({
      facts_summary: 'Existing summary',
      provenance: { candidate_ids: [expect.stringMatching(/^news-bundle:/)] },
    });
  });

  it('scopes idempotency to the configured model', async () => {
    const candidateIds: string[] = [];
    const existingCandidate = auditedCandidate();
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
      articleTextService: makeArticleTextService(),
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
      articleTextService: makeArticleTextService(),
      writeSynthesis: vi.fn(async (_client, synthesis) => synthesis),
      writeLatest: vi.fn(async (_client, synthesis) => ({ status: 'written' as const, synthesis, previous: null })),
      relay: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })(CANDIDATE);

    expect(candidateIds).toHaveLength(2);
    expect(candidateIds[0]).not.toBe(candidateIds[1]);
  });

  it('regenerates duplicate candidates that are missing hidden source-audit data', async () => {
    const writtenCandidates: CandidateSynthesis[] = [];
    const articleTextService = makeArticleTextService();
    const relay = vi.fn(async ({ prompt }: { prompt: string }) => ({
      model: 'gpt-4o-mini',
      content: JSON.stringify(
        prompt.includes('--- ARTICLE START ---')
          ? articleAnalysisPayload()
          : bundleSynthesisPayload(),
      ),
    }));

    const worker = createBundleSynthesisWorker({
      client: {} as VennClient,
      readBundle: async () => BUNDLE,
      readCandidate: vi.fn(async () => legacyCandidateWithoutAudit()),
      articleTextService,
      writeCandidate: vi.fn(async (_client, candidate) => {
        writtenCandidates.push(candidate);
        return candidate;
      }),
      writeSynthesis: vi.fn(async (_client, synthesis) => synthesis),
      writeLatest: vi.fn(async (_client, synthesis) => ({ status: 'written' as const, synthesis, previous: null })),
      relay,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker(CANDIDATE)).resolves.toMatchObject({
      status: 'written',
      storyId: 'story-1',
    });
    expect(relay).toHaveBeenCalledTimes(2);
    expect(writtenCandidates[0]?.source_analyses?.[0]?.justify_bias_claim).toEqual([
      'The quote shows the approval followed public input.',
    ]);
  });

  it('rejects generated output that widens analysis source count', async () => {
    const artifacts: AnalysisEvalArtifact[] = [];
    const worker = createBundleSynthesisWorker({
      client: {} as VennClient,
      readBundle: async () => BUNDLE,
      readCandidate: vi.fn(async () => null),
      articleTextService: makeArticleTextService(),
      relay: vi.fn(async ({ prompt }: { prompt: string }) => ({
        model: 'gpt-4o-mini',
        content: JSON.stringify(
          prompt.includes('--- ARTICLE START ---')
            ? articleAnalysisPayload()
            : bundleSynthesisPayload(2),
        ),
      })),
      analysisEvalArtifactWriter: {
        write: vi.fn(async (artifact) => {
          artifacts.push(artifact);
        }),
      },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(worker(CANDIDATE)).resolves.toEqual({
      status: 'rejected',
      storyId: 'story-1',
      reason: 'source_count_mismatch',
    });
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({
      lifecycle_status: 'rejected',
      rejection_reason: 'source_count_mismatch',
      story: {
        story_id: 'story-1',
        analyzed_source_ids: ['source-analysis'],
      },
      usage_policy: {
        training_state: 'not_training_ready',
      },
    });
    expect(artifacts[0]?.validator_failures[0]).toMatchObject({
      stage: 'bundle_synthesis_source_count',
      code: 'source_count_mismatch',
    });
    expect(artifacts[0]?.bundle_synthesis.response?.content).toContain('"source_count":2');
    expect(artifacts[0]?.source_articles[0]?.extraction.raw_extracted_article_text).toContain('Council approved');
  });
});
