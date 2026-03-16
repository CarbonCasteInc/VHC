import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { remoteContractInternal, runStoryClusterRemoteContract } from './remoteContract';

function makePayload(entityKeys: string[] = ['port_attack']) {
  return {
    topic_id: 'topic-news',
    items: [
      {
        sourceId: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        canonicalUrl: 'https://example.com/a',
        title: 'Port attack disrupts terminals overnight',
        publishedAt: 100,
        summary: 'Officials say recovery talks begin Friday.',
        url_hash: 'hash-a',
        language: 'en',
        translation_applied: false,
        entity_keys: entityKeys,
      },
    ],
  };
}

describe('runStoryClusterRemoteContract', () => {
  it('projects a remote request into StoryBundle-shaped output', async () => {
    const response = await runStoryClusterRemoteContract(makePayload(), {
      clock: () => 1_700_000_000_000,
      store: new MemoryClusterStore(),
    });

    expect(response.bundles).toHaveLength(1);
    const bundle = response.bundles[0]!;
    expect(bundle.schemaVersion).toBe('story-bundle-v0');
    expect(bundle.topic_id).toBe(remoteContractInternal.deriveNewsTopicId(bundle.story_id));
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.primary_sources).toHaveLength(1);
    expect(bundle.secondary_assets).toEqual([]);
    expect(bundle.storyline_id).toBeUndefined();
    expect(response.storylines).toEqual([]);
    expect(bundle.cluster_features.entity_keys).toContain('port_attack');
    expect(bundle.cluster_features.time_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(bundle.created_at).toBe(bundle.cluster_window_start);
  });

  it('falls back to headline-derived entity keys when none are supplied', async () => {
    const response = await runStoryClusterRemoteContract(makePayload([]), {
      clock: () => 1_700_000_000_000,
      store: new MemoryClusterStore(),
    });

    expect(response.bundles[0]?.cluster_features.entity_keys).toEqual(
      expect.arrayContaining(['attack', 'disrupts', 'overnight', 'port', 'terminals']),
    );
  });

  it('preserves accumulated source coverage across follow-up ticks', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterRemoteContract({
      topic_id: 'topic-persist',
      items: [
        {
          sourceId: 'wire-a',
          publisher: 'Reuters',
          url: 'https://example.com/a',
          canonicalUrl: 'https://example.com/a',
          title: 'Port attack disrupts terminals overnight',
          publishedAt: 100,
          summary: 'Officials say recovery talks begin Friday.',
          url_hash: 'hash-a',
          entity_keys: ['port_attack'],
        },
        {
          sourceId: 'wire-b',
          publisher: 'AP',
          url: 'https://example.com/b',
          canonicalUrl: 'https://example.com/b',
          title: 'Officials say recovery talks begin Friday after port attack',
          publishedAt: 110,
          summary: 'Recovery talks begin Friday after the port attack.',
          url_hash: 'hash-b',
          entity_keys: ['port_attack'],
        },
      ],
    }, { clock: () => 200, store });

    const second = await runStoryClusterRemoteContract({
      topic_id: 'topic-persist',
      items: [
        {
          sourceId: 'wire-c',
          publisher: 'Bloomberg',
          url: 'https://example.com/c',
          canonicalUrl: 'https://example.com/c',
          title: 'Insurers warn delays will continue after port attack',
          publishedAt: 130,
          summary: 'Insurers warn delays will continue after the port attack.',
          url_hash: 'hash-c',
          entity_keys: ['port_attack'],
        },
      ],
    }, { clock: () => 300, store });

    expect(second.bundles[0]?.story_id).toBe(first.bundles[0]?.story_id);
    expect(second.bundles[0]?.sources.map((source) => source.source_id)).toEqual(['wire-a', 'wire-b', 'wire-c']);
  });

  it('projects same-publisher derivative assets into secondary assets only', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-assets',
      items: [
        {
          sourceId: 'cbs-article',
          publisher: 'CBS',
          url: 'https://example.com/article',
          canonicalUrl: 'https://example.com/article',
          title: 'Jan. 6 plaque honoring police officers displayed at the Capitol after delay',
          publishedAt: 100,
          summary: 'The plaque was installed after a delay.',
          url_hash: 'hash-article',
          entity_keys: ['jan6_plaque_display'],
        },
        {
          sourceId: 'cbs-video',
          publisher: 'CBS',
          url: 'https://example.com/video/plaque',
          canonicalUrl: 'https://example.com/video/plaque',
          title: 'Video: Jan. 6 plaque honoring police officers displayed at the Capitol',
          publishedAt: 110,
          summary: undefined,
          url_hash: 'hash-video',
          entity_keys: ['jan6_plaque_display'],
        },
      ],
    }, { clock: () => 200, store: new MemoryClusterStore() });

    expect(response.bundles[0]?.sources.map((source) => source.source_id)).toEqual(['cbs-article']);
    expect(response.bundles[0]?.primary_sources?.map((source) => source.source_id)).toEqual(['cbs-article']);
    expect(response.bundles[0]?.secondary_assets?.map((source) => source.source_id)).toEqual(['cbs-video']);
  });

  it('publishes storyline groups for related coverage without widening canonical bundle membership', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-storyline',
      items: [
        {
          sourceId: 'wire-a',
          publisher: 'Reuters',
          url: 'https://example.com/article',
          canonicalUrl: 'https://example.com/article',
          title: 'Port attack disrupts terminals overnight',
          publishedAt: 100,
          summary: 'Officials say recovery talks begin Friday.',
          url_hash: 'hash-article',
          entity_keys: ['port_attack'],
        },
        {
          sourceId: 'guardian-roundup',
          publisher: 'The Guardian',
          url: 'https://example.com/roundup',
          canonicalUrl: 'https://example.com/roundup',
          title: 'Explainer: latest port attack developments at a glance',
          publishedAt: 120,
          summary: 'A recap of the wider fallout.',
          url_hash: 'hash-roundup',
          entity_keys: ['port_attack'],
          coverage_role: 'related',
        },
      ],
    }, { clock: () => 200, store: new MemoryClusterStore() });

    expect(response.bundles[0]?.primary_sources?.map((source) => source.source_id)).toEqual(['wire-a']);
    expect(response.bundles[0]?.storyline_id).toBeTruthy();
    expect(response.storylines).toHaveLength(1);
    expect(response.storylines[0]?.storyline_id).toBe(response.bundles[0]?.storyline_id);
    expect(response.storylines[0]?.related_coverage.map((source) => source.source_id)).toEqual(['guardian-roundup']);
  });

  it('preserves explicit related coverage overrides from the remote request', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-explicit-related',
      items: [
        {
          sourceId: 'ap-powell-news',
          publisher: 'AP News',
          url: 'https://example.com/powell-news',
          canonicalUrl: 'https://example.com/powell-news',
          title: 'Judge quashes subpoenas in Powell probe',
          publishedAt: 100,
          summary: 'A judge quashed the subpoenas in the Powell probe.',
          url_hash: 'hash-news',
          entity_keys: ['fed_powell_subpoena_episode'],
        },
        {
          sourceId: 'pbs-powell-explainer',
          publisher: 'PBS News',
          url: 'https://example.com/powell-explainer',
          canonicalUrl: 'https://example.com/powell-explainer',
          title: 'What the Powell subpoena fight means',
          publishedAt: 110,
          summary: 'An explainer on the wider Powell subpoena dispute.',
          url_hash: 'hash-explainer',
          entity_keys: ['fed_powell_subpoena_episode'],
          coverage_role: 'related',
        },
      ],
    }, { clock: () => 200, store: new MemoryClusterStore() });

    expect(response.bundles[0]?.primary_sources?.map((source) => source.source_id)).toEqual(['ap-powell-news']);
    expect(response.bundles[0]?.secondary_assets).toEqual([]);
    expect(response.storylines[0]?.related_coverage.map((source) => source.source_id)).toEqual(['pbs-powell-explainer']);
  });

  it('covers helper internals and fallback reference-now behavior', () => {
    const normalized = remoteContractInternal.normalizeRequest(makePayload(), 200);
    expect(normalized.reference_now_ms).toBe(100);
    expect(remoteContractInternal.buildDocId(normalized.items[0]!, 5)).toBe('wire-a:hash-a:5');
    expect(remoteContractInternal.buildTimeBucket(1_710_000_000_000)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
    expect(remoteContractInternal.deriveEntityKeys('General bulletin from agencies overnight', [])).toEqual(
      expect.arrayContaining(['agencies', 'bulletin', 'general', 'overnight']),
    );
    expect(remoteContractInternal.readOptionalString({ key: 1 }, 'key')).toBeUndefined();
    expect(remoteContractInternal.readOptionalString({ key: '  ok  ' }, 'key')).toBe('ok');
    expect(remoteContractInternal.readCoverageRole({ coverage_role: 'related' }, 'payload.items[0]')).toBe('related');
    expect(remoteContractInternal.readOptionalPublishedAt({ publishedAt: null }, 'payload.items[0]')).toBeUndefined();

    const noPublished = remoteContractInternal.normalizeRequest({
      topic_id: 'topic-news',
      items: [{
        sourceId: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        title: 'Headline',
        url_hash: 'hash-a',
        entity_keys: [],
      }],
    }, 222);
    expect(noPublished.reference_now_ms).toBe(222);
    expect(noPublished.items[0]?.canonicalUrl).toBe('https://example.com/a');
  });

  it('fails closed on invalid payload shapes', async () => {
    expect(() => remoteContractInternal.asRecord([], 'bad record')).toThrow('bad record');
    expect(() => remoteContractInternal.readEntityKeys({ entity_keys: 'bad' }, 'payload.items[0]')).toThrow('payload.items[0].entity_keys must be an array');
    expect(() => remoteContractInternal.readCoverageRole({ coverage_role: 'bad' }, 'payload.items[0]')).toThrow('payload.items[0].coverage_role must be canonical or related when provided');
    expect(() => remoteContractInternal.readRequiredString({ topic_id: '' }, 'topic_id', 'payload')).toThrow('payload.topic_id must be a non-empty string');
    expect(() => remoteContractInternal.readOptionalPublishedAt({ publishedAt: -1 }, 'payload.items[0]')).toThrow('payload.items[0].publishedAt must be a non-negative finite number when provided');
    await expect(
      runStoryClusterRemoteContract({ topic_id: 'topic-news', items: 'bad-items' }, { store: new MemoryClusterStore() }),
    ).rejects.toThrow('payload.items must be an array');
    await expect(
      runStoryClusterRemoteContract({
        topic_id: 'topic-news',
        items: [{
          sourceId: 'wire-a',
          publisher: 'Reuters',
          url: 'https://example.com/a',
          title: 'Headline',
          canonicalUrl: 'https://example.com/a',
          url_hash: 'hash-a',
          entity_keys: [123],
        }],
      }, { store: new MemoryClusterStore() }),
    ).rejects.toThrow('payload.items[0].entity_keys[0] must be a string');
  });

  it('falls back to reference-now timestamps and computed time buckets', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-news',
      items: [{
        sourceId: 'wire-a',
        publisher: 'Reuters',
        url: 'https://example.com/a',
        title: 'Headline',
        url_hash: 'hash-a',
        entity_keys: [],
      }],
    }, { clock: () => 555, store: new MemoryClusterStore() });

    expect(response.bundles[0]?.sources[0]?.published_at).toBe(555);
    expect(response.bundles[0]?.cluster_window_start).toBe(555);
    expect(response.bundles[0]?.cluster_features.time_bucket).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}$/);
  });
});
