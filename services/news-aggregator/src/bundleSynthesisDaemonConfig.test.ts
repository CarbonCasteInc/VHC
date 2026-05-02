import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VennClient } from '@vh/gun-client';
import {
  createBundleSynthesisEnrichmentFromEnv,
  isTruthyFlag,
} from './bundleSynthesisDaemonConfig';

describe('bundleSynthesisDaemonConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses truthy feature flags conservatively', () => {
    expect(isTruthyFlag(undefined)).toBe(false);
    expect(isTruthyFlag('false')).toBe(false);
    expect(isTruthyFlag('0')).toBe(false);
    expect(isTruthyFlag('true')).toBe(true);
    expect(isTruthyFlag('yes')).toBe(true);
  });

  it('does not create enrichment when bundle synthesis is disabled', () => {
    expect(createBundleSynthesisEnrichmentFromEnv({} as VennClient)).toEqual({});
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
});
