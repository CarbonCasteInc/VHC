import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeStoryHotness,
  writeNewsHotIndexEntry,
  writeNewsLatestIndexEntry,
  type VennClient,
} from '@vh/gun-client';
import type { StoryBundle } from '@vh/data-model';
import {
  createBundleSynthesisEnrichmentFromEnv,
  isTruthyFlag,
  shouldEnableBundleSynthesisFromEnv,
} from './bundleSynthesisDaemonConfig';

const workerConfigs: Array<Record<string, any>> = [];

vi.mock('@vh/gun-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vh/gun-client')>();
  return {
    ...actual,
    computeStoryHotness: vi.fn(() => 0.625),
    writeNewsHotIndexEntry: vi.fn(async () => 0.625),
    writeNewsLatestIndexEntry: vi.fn(async () => undefined),
  };
});

vi.mock('./bundleSynthesisWorker', () => ({
  createBundleSynthesisWorker: vi.fn((config: Record<string, any>) => {
    workerConfigs.push(config);
    return vi.fn();
  }),
}));

const STORY: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-ready',
  topic_id: 'topic-ready',
  headline: 'Ready story',
  cluster_window_start: 100,
  cluster_window_end: 200,
  sources: [{
    source_id: 'source-1',
    publisher: 'Publisher One',
    url: 'https://example.com/ready',
    url_hash: 'hash-ready',
    title: 'Ready story',
  }],
  cluster_features: {
    entity_keys: ['ready-story'],
    time_bucket: '2026-05-31T01',
    semantic_signature: 'sig-ready',
  },
  provenance_hash: 'prov-ready',
  created_at: 100,
};

describe('bundleSynthesisDaemonConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    workerConfigs.length = 0;
  });

  it('parses truthy feature flags conservatively', () => {
    expect(isTruthyFlag(undefined)).toBe(false);
    expect(isTruthyFlag('false')).toBe(false);
    expect(isTruthyFlag('0')).toBe(false);
    expect(isTruthyFlag('true')).toBe(true);
    expect(isTruthyFlag('yes')).toBe(true);
  });

  it('auto-enables bundle synthesis when a synthesis credential is configured', () => {
    expect(shouldEnableBundleSynthesisFromEnv()).toBe(false);

    vi.stubEnv('ANALYSIS_RELAY_API_KEY', 'analysis-relay-key');
    expect(shouldEnableBundleSynthesisFromEnv()).toBe(true);

    vi.stubEnv('VH_BUNDLE_SYNTHESIS_ENABLED', 'false');
    expect(shouldEnableBundleSynthesisFromEnv()).toBe(false);
  });

  it('does not create enrichment when bundle synthesis is disabled', () => {
    expect(createBundleSynthesisEnrichmentFromEnv({} as VennClient)).toEqual({});
  });

  it('creates enrichment from an existing analysis relay credential without requiring the legacy master switch', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.stubEnv('ANALYSIS_RELAY_API_KEY', 'analysis-relay-key');

    const enrichment = createBundleSynthesisEnrichmentFromEnv({} as VennClient, logger);

    expect(typeof enrichment.enrichmentWorker).toBe('function');
    expect(workerConfigs).toHaveLength(1);
    expect(workerConfigs[0]?.model).toBe('gpt-4o-mini');
  });

  it('wires bundle synthesis worker and bounded queue options when enabled', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_ENABLED', 'true');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_QUEUE_DEPTH', '7');
    vi.stubEnv('VH_DAEMON_FEED_ARTIFACT_ROOT', '/tmp/vh-artifacts');

    const enrichment = createBundleSynthesisEnrichmentFromEnv({} as VennClient, logger);

    expect(typeof enrichment.enrichmentWorker).toBe('function');
    expect(enrichment.enrichmentQueueOptions?.maxDepth).toBe(7);
    expect(enrichment.enrichmentQueueOptions?.persistenceDir).toBe('/tmp/vh-artifacts/bundle-synthesis-queue');

    enrichment.enrichmentQueueOptions?.onDrop?.(
      {
        story_id: 'story-1',
        provider: { provider_id: 'remote-analysis', model_id: 'gpt-4o-mini', kind: 'remote' },
        request: { prompt: 'Prompt', model: 'gpt-4o-mini', max_tokens: 1200, temperature: 0.2 },
        work_items: [],
      },
      { reason: 'queue_full', maxDepth: 7 },
    );

    expect(logger.warn).toHaveBeenCalledWith(
      '[vh:bundle-synthesis] queue full; candidate dead-lettered for replay',
      { story_id: 'story-1', max_depth: 7 },
    );
  });

  it('can wire explicit relay REST synthesis writers for public daemon deployments', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_ENABLED', 'true');
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_WRITE_RELAY_REST', 'true');
    vi.stubEnv('VH_RELAY_DAEMON_TOKEN', 'relay-token');

    createBundleSynthesisEnrichmentFromEnv(
      { config: { peers: ['wss://gun-a.example.test/gun'] } } as VennClient,
      logger,
    );

    expect(workerConfigs).toHaveLength(1);
    expect(typeof workerConfigs[0]?.writeSynthesis).toBe('function');
    expect(typeof workerConfigs[0]?.writeLatest).toBe('function');
    expect(typeof workerConfigs[0]?.writeLifecycle).toBe('function');
  });

  it('publishes accepted stories with product metadata on latest and hot indexes', async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const runWrite = vi.fn(async <T,>(_writeClass: string, _attrs: Record<string, unknown>, task: () => Promise<T>) =>
      task(),
    );
    vi.stubEnv('VH_BUNDLE_SYNTHESIS_ENABLED', 'true');

    createBundleSynthesisEnrichmentFromEnv({ id: 'publish-client' } as VennClient, logger, { runWrite });

    const publishReadyStory = workerConfigs[0]?.publishReadyStory;
    expect(typeof publishReadyStory).toBe('function');

    await publishReadyStory({ id: 'publish-client' } as VennClient, STORY, { synthesis_id: 'synth-1' });

    expect(writeNewsLatestIndexEntry).toHaveBeenCalledWith(
      { id: 'publish-client' },
      STORY.story_id,
      STORY.cluster_window_end,
      STORY,
    );
    expect(computeStoryHotness).toHaveBeenCalledWith(STORY);
    expect(writeNewsHotIndexEntry).toHaveBeenCalledWith(
      { id: 'publish-client' },
      STORY.story_id,
      0.625,
      STORY,
    );
    expect(runWrite.mock.calls.map((call) => call[0])).toEqual(['news_latest_index', 'news_hot_index']);
  });
});
