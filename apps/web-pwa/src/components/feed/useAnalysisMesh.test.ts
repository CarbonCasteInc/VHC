/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type { NewsCardAnalysisSynthesis } from './newsCardAnalysis';
import {
  analysisMeshInternal,
  readMeshAnalysis,
  writeMeshAnalysis,
} from './useAnalysisMesh';
import { readAnalysis, readLatestAnalysis, writeAnalysis } from '@vh/gun-client';
import { resolveClientFromAppStore } from '../../store/clientResolver';

vi.mock('@vh/gun-client', () => ({
  readAnalysis: vi.fn(),
  readLatestAnalysis: vi.fn(),
  writeAnalysis: vi.fn(),
}));

vi.mock('../../store/clientResolver', () => ({
  resolveClientFromAppStore: vi.fn(),
}));

const mockReadAnalysis = vi.mocked(readAnalysis);
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
    mockReadAnalysis.mockReset();
    mockReadLatestAnalysis.mockReset();
    mockWriteAnalysis.mockReset();
    mockResolveClientFromAppStore.mockReset();
    mockResolveClientFromAppStore.mockReturnValue({} as any);
  });

  it('returns null when no client is available', async () => {
    mockResolveClientFromAppStore.mockReturnValue(null);

    await expect(readMeshAnalysis(makeStoryBundle(), 'model:default')).resolves.toBeNull();
    expect(mockReadAnalysis).not.toHaveBeenCalled();
    expect(mockReadLatestAnalysis).not.toHaveBeenCalled();
  });

  it('reads by derived key first and skips latest-pointer fallback on direct hit', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const story = makeStoryBundle();

    mockReadAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: story.provenance_hash,
      analysisKey: 'derived-key',
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

    expect(mockReadAnalysis).toHaveBeenCalledTimes(1);
    expect(mockReadLatestAnalysis).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh]',
      expect.objectContaining({
        story_id: story.story_id,
        read_path: 'derived-key',
      }),
    );
  });

  it('falls back to latest pointer when derived-key read misses', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const story = makeStoryBundle();

    mockReadAnalysis.mockResolvedValueOnce(null);
    mockReadLatestAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: story.provenance_hash,
      analysisKey: 'latest-a',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
      summary: 'Fallback summary A',
      frames: [{ frame: 'frame A', reframe: 'reframe A' }],
      analyses: [],
      provider: { provider_id: 'p', model: 'm' },
      created_at: '2026-02-18T22:00:00.000Z',
    } as any);

    await expect(readMeshAnalysis(story, 'model:default')).resolves.toMatchObject({
      summary: 'Fallback summary A',
    });

    expect(mockReadLatestAnalysis).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh]',
      expect.objectContaining({
        story_id: story.story_id,
        read_path: 'latest-pointer',
      }),
    );
  });

  it('returns null without fallback when derived-key hit fails model scope validation', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const story = makeStoryBundle();

    mockReadAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: story.provenance_hash,
      analysisKey: 'derived-key',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:other',
      summary: 'Wrong model scope',
      frames: [{ frame: 'f', reframe: 'r' }],
      analyses: [],
      provider: { provider_id: 'p', model: 'm' },
      created_at: '2026-02-18T22:00:00.000Z',
    } as any);

    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();

    expect(mockReadLatestAnalysis).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh]',
      expect.objectContaining({
        story_id: story.story_id,
        read_path: 'derived-key-invalid',
      }),
    );
  });

  it('returns null without fallback when derived-key hit fails provenance validation', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const story = makeStoryBundle();

    mockReadAnalysis.mockResolvedValueOnce({
      schemaVersion: 'story-analysis-v1',
      story_id: story.story_id,
      topic_id: story.topic_id,
      provenance_hash: 'different',
      analysisKey: 'derived-key',
      pipeline_version: 'news-card-analysis-v1',
      model_scope: 'model:default',
      summary: 'Wrong provenance',
      frames: [{ frame: 'f', reframe: 'r' }],
      analyses: [],
      provider: { provider_id: 'p', model: 'm' },
      created_at: '2026-02-18T22:00:00.000Z',
    } as any);

    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();

    expect(mockReadLatestAnalysis).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh]',
      expect.objectContaining({
        story_id: story.story_id,
        read_path: 'derived-key-invalid',
      }),
    );
  });

  it('returns null on fallback miss/mismatch and emits miss telemetry', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const story = makeStoryBundle();

    mockReadAnalysis
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    mockReadLatestAnalysis
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        schemaVersion: 'story-analysis-v1',
        story_id: story.story_id,
        topic_id: story.topic_id,
        provenance_hash: 'different',
        analysisKey: 'latest-mismatch-prov',
        pipeline_version: 'news-card-analysis-v1',
        model_scope: 'model:default',
        summary: 'Mismatch provenance',
        frames: [{ frame: 'f', reframe: 'r' }],
        analyses: [],
        provider: { provider_id: 'p', model: 'm' },
        created_at: '2026-02-18T22:00:00.000Z',
      } as any)
      .mockResolvedValueOnce({
        schemaVersion: 'story-analysis-v1',
        story_id: story.story_id,
        topic_id: story.topic_id,
        provenance_hash: story.provenance_hash,
        analysisKey: 'latest-mismatch-model',
        pipeline_version: 'news-card-analysis-v1',
        model_scope: 'model:other',
        summary: 'Mismatch model',
        frames: [{ frame: 'f', reframe: 'r' }],
        analyses: [],
        provider: { provider_id: 'p', model: 'm' },
        created_at: '2026-02-18T22:00:00.000Z',
      } as any);

    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();
    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();
    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();

    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh]',
      expect.objectContaining({
        story_id: story.story_id,
        read_path: 'miss',
      }),
    );
  });

  it('returns null on mesh read errors', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const story = makeStoryBundle();
    mockReadAnalysis.mockRejectedValueOnce(new Error('mesh down'));

    await expect(readMeshAnalysis(story, 'model:default')).resolves.toBeNull();
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh]',
      expect.objectContaining({
        story_id: story.story_id,
        read_path: 'miss',
      }),
    );
    expect(warnSpy).toHaveBeenCalledWith('[vh:analysis:mesh] read failed', expect.any(Error));
  });

  it('writes normalized artifact to mesh when client is available', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
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
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh-write]',
      expect.objectContaining({
        source: 'news-card',
        event: 'mesh_write_success',
        story_id: story.story_id,
      }),
    );
    infoSpy.mockRestore();
  });

  it('emits telemetry when client is unavailable or write fails', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const story = makeStoryBundle();
    const synthesis = makeSynthesis();

    mockResolveClientFromAppStore.mockReturnValueOnce(null);
    await writeMeshAnalysis(story, synthesis, 'model:default');
    expect(mockWriteAnalysis).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh-write]',
      expect.objectContaining({
        source: 'news-card',
        event: 'mesh_write_skipped',
        reason: 'client_unavailable',
      }),
    );

    mockResolveClientFromAppStore.mockReturnValue({} as any);
    mockWriteAnalysis.mockRejectedValueOnce(new Error('write failed'));
    await expect(writeMeshAnalysis(story, synthesis, 'model:default')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      '[vh:analysis:mesh-write]',
      expect.objectContaining({
        source: 'news-card',
        event: 'mesh_write_failed',
        error: 'write failed',
      }),
    );
    infoSpy.mockRestore();
    warnSpy.mockRestore();
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
