import { describe, expect, it } from 'vitest';
import {
  remoteContractInternal,
  runStoryClusterRemoteContract,
  type StoryClusterRemoteRequest,
} from './remoteContract';

const BASE_REQUEST: StoryClusterRemoteRequest = {
  topic_id: 'topic-world',
  reference_now_ms: 1_710_000_050_000,
  items: [
    {
      sourceId: 'wire-a',
      publisher: 'Wire A',
      url: 'https://example.com/a',
      canonicalUrl: 'https://example.com/a',
      title: 'Breaking: Port attack triggers alerts',
      publishedAt: 1_710_000_000_000,
      summary: 'Authorities respond in the first hour',
      url_hash: 'hash-a',
      language: 'en',
      translation_applied: false,
      entity_keys: ['Port', 'Alerts'],
    },
    {
      sourceId: 'wire-a',
      publisher: 'Wire A',
      url: 'https://example.com/b',
      canonicalUrl: 'https://example.com/b',
      title: 'Analysis: Shipping routes disrupted',
      publishedAt: 1_710_000_020_000,
      summary: 'Analysts estimate delays',
      url_hash: 'hash-a',
      language: 'fr',
      translation_applied: true,
      entity_keys: [],
    },
    {
      sourceId: 'wire-c',
      publisher: 'Wire C',
      url: 'https://example.com/c',
      canonicalUrl: 'https://example.com/canonical-c',
      title: 'Opinion: Officials debate response',
      publishedAt: 1_710_000_030_000,
      summary: 'Critics demand faster coordination',
      url_hash: 'hash-c',
      entity_keys: ['Officials'],
    },
  ],
};

describe('runStoryClusterRemoteContract', () => {
  it('projects remote request payload into deterministic StoryBundle-shaped response', () => {
    const response = runStoryClusterRemoteContract(BASE_REQUEST, {
      now: () => 1_710_000_099_000,
    });

    expect(response.telemetry.topic_id).toBe('topic-world');
    expect(response.telemetry.request_doc_count).toBe(3);
    expect(response.telemetry.stage_count).toBe(11);

    expect(response.bundles.length).toBeGreaterThan(0);
    for (const bundle of response.bundles) {
      expect(bundle.schemaVersion).toBe('story-bundle-v0');
      expect(bundle.topic_id).toBe(remoteContractInternal.deriveNewsTopicId(bundle.story_id));
      expect(bundle.topic_id).toMatch(/^[a-f0-9]{64}$/);
      expect(bundle.sources.length).toBeGreaterThan(0);
      expect(bundle.cluster_features.entity_keys.length).toBeGreaterThan(0);
      expect(bundle.cluster_features.time_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
      expect(bundle.cluster_features.semantic_signature).toMatch(/^[a-f0-9]+$/);
      expect(bundle.cluster_features.coverage_score).toBeGreaterThanOrEqual(0);
      expect(bundle.cluster_features.coverage_score).toBeLessThanOrEqual(1);
      expect(bundle.cluster_features.velocity_score).toBeGreaterThanOrEqual(0);
      expect(bundle.cluster_features.velocity_score).toBeLessThanOrEqual(1);
      expect(bundle.cluster_features.confidence_score).toBeGreaterThanOrEqual(0);
      expect(bundle.cluster_features.confidence_score).toBeLessThanOrEqual(1);
      expect(bundle.provenance_hash).toMatch(/^[a-f0-9]+$/);
    }

    const hasTranslation = response.bundles.some(
      (bundle) => bundle.cluster_features.translation_applied === true,
    );
    expect(hasTranslation).toBe(true);

    const firstSourceUrl = response.bundles.flatMap((bundle) => bundle.sources.map((source) => source.url))[0];
    expect(firstSourceUrl).toContain('https://example.com/');
  });

  it('falls back to normalized headline tokens when entity keys are missing', () => {
    const response = runStoryClusterRemoteContract(
      {
        topic_id: 'topic-no-entities',
        items: [
          {
            sourceId: 'wire-z',
            publisher: 'Wire Z',
            url: 'https://example.com/z',
            canonicalUrl: 'https://example.com/z',
            title: 'General bulletin from agencies overnight',
            publishedAt: 10,
            url_hash: 'hash-z',
            entity_keys: [],
          },
        ],
      },
      { now: () => 10 },
    );

    expect(response.bundles).toHaveLength(1);
    expect(response.bundles[0]?.cluster_features.entity_keys).toEqual([
      'agencies',
      'bulletin',
      'from',
      'general',
      'overnight',
    ]);
  });

  it('covers helper internals for string parsing and fallback reference-now behavior', () => {
    const normalized = remoteContractInternal.normalizeRequest(
      {
        topic_id: 'topic-internal',
        items: [
          {
            sourceId: 'wire-a',
            publisher: 'Wire A',
            url: 'https://example.com/a',
            title: 'Headline',
            canonicalUrl: '   ',
            summary: '   ',
            publishedAt: undefined,
            url_hash: 'hash-a',
            entity_keys: ['  KEY  ', ''],
          },
        ],
      },
      42,
    );

    expect(normalized.reference_now_ms).toBe(42);
    expect(normalized.items[0]?.canonicalUrl).toBe('https://example.com/a');
    expect(normalized.items[0]?.summary).toBeUndefined();
    expect(normalized.items[0]?.entity_keys).toEqual(['key']);

    expect(remoteContractInternal.buildDocId(normalized.items[0]!, 5)).toBe('wire-a:hash-a:5');
    expect(remoteContractInternal.buildTimeBucket(1_710_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(remoteContractInternal.deriveNewsTopicId('story-1')).toBe(
      '55c2855fd1ea9425d3f10ae6b6746f12114fa8bdb929931f85c4ee102bc3a660',
    );

    const defaultEntityKeys = remoteContractInternal.deriveEntityKeys(
      {
        schemaVersion: 'story-bundle-v0',
        story_id: 'story-1',
        topic_id: 'topic-internal',
        headline: '***',
        summary_hint: undefined,
        cluster_window_start: 1,
        cluster_window_end: 2,
        sources: [],
        cluster_features: {
          entity_keys: ['general'],
          time_bucket: '1970-01-01T00',
          semantic_signature: 'abc',
          coverage_score: 0,
          velocity_score: 0,
          confidence_score: 0,
        },
        provenance_hash: 'abc',
        created_at: 1,
      },
      [],
    );
    expect(defaultEntityKeys).toEqual(['general']);

    expect(remoteContractInternal.readOptionalString({ key: 1 }, 'key')).toBeUndefined();
    expect(remoteContractInternal.readOptionalString({ key: '  ok  ' }, 'key')).toBe('ok');

    expect(remoteContractInternal.readOptionalPublishedAt({ publishedAt: null }, 'payload.items[0]')).toBeUndefined();

    const implicitNow = runStoryClusterRemoteContract({
      topic_id: 'topic-implicit-now',
      items: [
        {
          sourceId: 'wire-k',
          publisher: 'Wire K',
          url: 'https://example.com/k',
          canonicalUrl: 'https://example.com/k',
          title: 'General update from agencies overnight',
          url_hash: 'hash-k',
          entity_keys: ['agencies'],
        },
      ],
    });
    expect(implicitNow.telemetry.generated_at_ms).toBeGreaterThan(0);
  });

  it('fails closed on invalid payload shapes', () => {
    expect(() => runStoryClusterRemoteContract('nope')).toThrow(
      'storycluster remote payload must be an object',
    );

    expect(() =>
      runStoryClusterRemoteContract({
        topic_id: 'topic-world',
        items: 'nope',
      }),
    ).toThrow('payload.items must be an array');

    expect(() =>
      runStoryClusterRemoteContract({
        topic_id: 'topic-world',
        items: [{
          sourceId: 'wire-a',
          publisher: 'Wire A',
          url: 'https://example.com/a',
          title: 'Headline',
          url_hash: 'hash-a',
          entity_keys: [123],
        }],
      }),
    ).toThrow('payload.items[0].entity_keys[0] must be a string');

    expect(() =>
      runStoryClusterRemoteContract({
        topic_id: 'topic-world',
        items: [{
          sourceId: 'wire-a',
          publisher: 'Wire A',
          url: 'https://example.com/a',
          title: 'Headline',
          publishedAt: -5,
          url_hash: 'hash-a',
          entity_keys: [],
        }],
      }),
    ).toThrow('payload.items[0].publishedAt must be a non-negative finite number when provided');

    expect(() =>
      runStoryClusterRemoteContract({
        topic_id: 'topic-world',
        items: [1],
      }),
    ).toThrow('payload.items[0] must be an object');

    expect(() => remoteContractInternal.asRecord([], 'bad record')).toThrow('bad record');
    expect(() => remoteContractInternal.readEntityKeys({ entity_keys: 'bad' }, 'payload.items[0]')).toThrow(
      'payload.items[0].entity_keys must be an array',
    );
    expect(() => remoteContractInternal.readRequiredString({ topic_id: '' }, 'topic_id', 'payload')).toThrow(
      'payload.topic_id must be a non-empty string',
    );
    expect(() => remoteContractInternal.readOptionalPublishedAt({ publishedAt: -1 }, 'payload.items[0]')).toThrow(
      'payload.items[0].publishedAt must be a non-negative finite number when provided',
    );
  });
});
