/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import {
  analysisMeshInternal,
  readMeshAnalysis,
  writeMeshAnalysis,
} from './useAnalysisMesh';
import { readLatestAnalysis, writeAnalysis } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../../store/clientResolver';

vi.mock('@vh/gun-client', () => ({
  readLatestAnalysis: vi.fn(),
  writeAnalysis: vi.fn(),
}));

vi.mock('../../store/clientResolver', () => ({
  resolveClientFromAppStore: vi.fn(),
}));

const mockReadLatestAnalysis = vi.mocked(readLatestAnalysis);
const mockWriteAnalysis = vi.mocked(writeAnalysis);
const mockResolveClientFromAppStore = vi.mocked(resolveClientFromAppStore);

const NOW = 1_700_000_000_000;

function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-news-1',
    topic_id: 'news-1',
    headline: 'City council votes on transit plan',
    summary_hint: 'Transit vote split council members along budget priorities.',
    cluster_window_start: NOW - 7_200_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'src-1',
        publisher: 'Local Paper',
        url: 'https://example.com/news-1',
        url_hash: 'hash-1',
        published_at: NOW - 3_600_000,
        title: 'City council votes on transit plan',
      },
    ],
    cluster_features: {
      entity_keys: ['city-council', 'transit'],
      time_bucket: '2026-02-16T10',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'prov-1',
    created_at: NOW - 3_600_000,
    ...overrides,
  };
}

function makeSynthesis(overrides: Partial<NewsCardAnalysisSynthesis> = {}): NewsCardAnalysisSynthesis {
  return {
    summary: 'Balanced summary synthesized from sources.',
    frames: [
      {
        frame: 'Frame A',
        reframe: 'Reframe A',
      },
    ],
    analyses: [
      {
        source_id: 'src-1',
        publisher: 'Local Paper',
        url: 'https://example.com/news-1',
        summary: 'Source summary.',
        biases: ['Bias A'],
        counterpoints: ['Counterpoint A'],
        biasClaimQuotes: ['Quote A'],
        justifyBiasClaims: ['Justification A'],
        provider_id: 'openai',
        model_id: 'gpt-5.3-codex',
      },
    ],
    ...overrides,
  };
}

describe('useAnalysisMesh', () => {
  beforeEach(() => {
    mockReadLatestAnalysis.mockReset();
    mockWriteAnalysis.mockReset();
    mockResolveClientFromAppStore.mockReset();
    mockResolveClientFromAppStore.mockReturnValue({} as any);
  });

  it('returns null when no client is available', async () => {
    mockResolveClientFromAppStore.mockReturnValue(null);

    await expect(readMeshAnalysis(makeStoryBundle(), 'model:default')).resolves.toBeNull();
    expect(mockReadLatestAnalysis).not.toHaveBeenCalled();
  });

  it('returns null when mesh analysis is missing or mismatched', async () => {
    const story = makeStoryBundle();

    mockReadLatestAnalysis.mockResolvedValueOnce(null as any);
    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();

    mockReadLatestAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: 'different',
      analysisKey: 'a1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
      summary: 'x',
      frames: [{ frame: 'f', reframe: 'r' }],
      analyses: [],
      provider: { provider_id: 'p', model: 'm' },
      created_at: '2026-02-18T22:00:00.000Z',
    } as any);
    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();

    mockReadLatestAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: story.provenance_hash,
      analysisKey: 'a1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:other',
      summary: 'x',
      frames: [{ frame: 'f', reframe: 'r' }],
      analyses: [],
      provider: { provider_id: 'p', model: 'm' },
      created_at: '2026-02-18T22:00:00.000Z',
    } as any);
    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();
  });

  it('returns converted synthesis when mesh artifact matches story and model scope', async () => {
    const story = makeStoryBundle();
    mockReadLatestAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: story.provenance_hash,
      analysisKey: 'a1',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
      summary: 'Mesh summary',
      frames: [{ frame: 'Mesh frame', reframe: 'Mesh reframe' }],
      analyses: [
        {
          source_id: 'src-1',
          publisher: 'Local Paper',
          url: 'https://example.com/news-1',
          summary: 'Mesh source summary',
          biases: ['Bias A'],
          counterpoints: ['Counterpoint A'],
          biasClaimQuotes: ['Quote A'],
          justifyBiasClaims: ['Justification A'],
          provider_id: 'openai',
          model_id: 'gpt-5.3-codex',
        },
      ],
      provider: { provider_id: 'openai', model: 'gpt-5.3-codex' },
      created_at: '2026-02-18T22:00:00.000Z',
    } as any);

    await expect(readMeshAnalysis(story, 'model:default')).resolves.toEqual({
      summary: 'Mesh summary',
      frames: [{ frame: 'Mesh frame', reframe: 'Mesh reframe' }],
      analyses: [
        {
          source_id: 'src-1',
          publisher: 'Local Paper',
          url: 'https://example.com/news-1',
          summary: 'Mesh source summary',
          biases: ['Bias A'],
          counterpoints: ['Counterpoint A'],
          biasClaimQuotes: ['Quote A'],
          justifyBiasClaims: ['Justification A'],
          provider_id: 'openai',
          model_id: 'gpt-5.3-codex',
        },
      ],
    });
  });

  it('returns null on mesh read errors', async () => {
    mockReadLatestAnalysis.mockRejectedValueOnce(new Error('mesh down'));

    await expect(readMeshAnalysis(makeStoryBundle(), 'model:default')).resolves.toBeNull();
  });

  it('writes normalized artifact to mesh when client is available', async () => {
    const story = makeStoryBundle();
    const synthesis = makeSynthesis();

    await writeMeshAnalysis(story, synthesis, 'model:default');

    expect(mockWriteAnalysis).toHaveBeenCalledTimes(1);
    const [, artifact] = mockWriteAnalysis.mock.calls[0];

    expect(artifact).toMatchObject({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: story.provenance_hash,
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
      summary: synthesis.summary,
    });
    expect((artifact as any).analysisKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('does not write when client is missing and swallows write failures', async () => {
    const story = makeStoryBundle();
    const synthesis = makeSynthesis();

    mockResolveClientFromAppStore.mockReturnValueOnce(null);
    await writeMeshAnalysis(story, synthesis, 'model:default');
    expect(mockWriteAnalysis).not.toHaveBeenCalled();

    mockResolveClientFromAppStore.mockReturnValue({} as any);
    mockWriteAnalysis.mockRejectedValueOnce(new Error('write failed'));
    await expect(writeMeshAnalysis(story, synthesis, 'model:default')).resolves.toBeUndefined();
  });

  it('normalizes sparse synthesis fields while building artifacts', async () => {
    const story = makeStoryBundle();
    const synthesis = makeSynthesis({
      summary: '   ',
      frames: [{ frame: '   ', reframe: '' }],
      analyses: [
        {
          source_id: '   ',
          publisher: '',
          url: '',
          summary: '',
          biases: ['  '],
          counterpoints: [''],
          biasClaimQuotes: [''],
          justifyBiasClaims: [''],
          provider_id: '  ',
          model_id: '',
        },
      ],
    });

    const artifact = await analysisMeshInternal.toArtifact(story, synthesis, 'model:default');

    expect(artifact.summary).toBe('Summary unavailable.');
    expect(artifact.frames).toEqual([
      { frame: 'Frame unavailable.', reframe: 'Reframe unavailable.' },
    ]);
    expect(artifact.analyses[0]).toMatchObject({
      source_id: story.story_id,
      publisher: 'Unknown publisher',
      url: 'https://example.invalid/analysis',
      summary: 'Summary unavailable.',
      biases: [],
      counterpoints: [],
      biasClaimQuotes: [],
      justifyBiasClaims: [],
    });
    expect(artifact.provider).toEqual({
      provider_id: 'unknown-provider',
      model: 'unknown-model',
      timestamp: artifact.provider.timestamp,
    });
  });

  it('derives distinct analysis keys when model scope changes', async () => {
    const story = makeStoryBundle();
    const synthesis = makeSynthesis();

    const defaultModelArtifact = await analysisMeshInternal.toArtifact(story, synthesis, 'model:default');
    const overriddenModelArtifact = await analysisMeshInternal.toArtifact(story, synthesis, 'model:gpt-4o');

    expect(defaultModelArtifact.analysisKey).not.toBe(overriddenModelArtifact.analysisKey);
  });
});
