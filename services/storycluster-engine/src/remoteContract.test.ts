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
        imageUrl: 'https://example.com/a.jpg',
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
    expect(bundle.sources[0]?.imageUrl).toBe('https://example.com/a.jpg');
    expect(bundle.primary_sources).toHaveLength(1);
    expect(bundle.primary_sources?.[0]?.imageUrl).toBe('https://example.com/a.jpg');
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

  it('returns the full topic snapshot after a follow-up tick adds a disjoint story', async () => {
    const store = new MemoryClusterStore();
    await runStoryClusterRemoteContract({
      topic_id: 'topic-snapshot',
      items: [
        {
          sourceId: 'wire-a',
          publisher: 'Reuters',
          url: 'https://example.com/a',
          canonicalUrl: 'https://example.com/a',
          imageUrl: 'https://example.com/a.jpg',
          title: 'Port attack disrupts terminals overnight',
          publishedAt: 100,
          summary: 'Officials say recovery talks begin Friday.',
          url_hash: 'hash-a',
          entity_keys: ['port_attack'],
        },
      ],
    }, { clock: () => 200, store });

    const second = await runStoryClusterRemoteContract({
      topic_id: 'topic-snapshot',
      items: [
        {
          sourceId: 'wire-b',
          publisher: 'AP',
          url: 'https://example.com/b',
          canonicalUrl: 'https://example.com/b',
          title: 'Capitol transit resumes after morning evacuation',
          publishedAt: 300,
          summary: 'Train service resumed after the evacuation was lifted.',
          url_hash: 'hash-b',
          entity_keys: ['capitol_evacuation'],
        },
      ],
    }, { clock: () => 400, store });

    expect(second.bundles).toHaveLength(2);
    expect(second.bundles.map((bundle) => bundle.primary_sources?.[0]?.source_id)).toEqual([
      'wire-a',
      'wire-b',
    ]);
    expect(second.bundles[0]?.primary_sources?.[0]?.imageUrl).toBe('https://example.com/a.jpg');
  });

  it('keeps singleton stories in the topic snapshot and upgrades them when later matching sources arrive', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterRemoteContract({
      topic_id: 'topic-singleton-growth',
      items: [
        {
          sourceId: 'wire-a',
          publisher: 'Reuters',
          url: 'https://example.com/port-a',
          canonicalUrl: 'https://example.com/port-a',
          title: 'Port attack disrupts terminals overnight',
          publishedAt: 100,
          summary: 'Officials say recovery talks begin Friday.',
          url_hash: 'hash-port-a',
          entity_keys: ['port_attack'],
        },
        {
          sourceId: 'metro-a',
          publisher: 'Metro Daily',
          url: 'https://example.com/transit-a',
          canonicalUrl: 'https://example.com/transit-a',
          title: 'Capitol transit resumes after morning evacuation',
          publishedAt: 105,
          summary: 'Train service resumed after the evacuation was lifted.',
          url_hash: 'hash-transit-a',
          entity_keys: ['capitol_evacuation'],
        },
      ],
    }, { clock: () => 200, store });

    const portStoryId = first.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'wire-a'),
    )?.story_id;
    const transitStoryId = first.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'metro-a'),
    )?.story_id;
    expect(portStoryId).toBeTruthy();
    expect(transitStoryId).toBeTruthy();
    expect(portStoryId).not.toBe(transitStoryId);

    const second = await runStoryClusterRemoteContract({
      topic_id: 'topic-singleton-growth',
      items: [
        {
          sourceId: 'wire-b',
          publisher: 'AP',
          url: 'https://example.com/port-b',
          canonicalUrl: 'https://example.com/port-b',
          title: 'Officials say recovery talks begin Friday after port attack',
          publishedAt: 130,
          summary: 'Recovery talks begin Friday after the port attack.',
          url_hash: 'hash-port-b',
          entity_keys: ['port_attack'],
        },
      ],
    }, { clock: () => 300, store });

    const portBundle = second.bundles.find((bundle) => bundle.story_id === portStoryId);
    const transitBundle = second.bundles.find((bundle) => bundle.story_id === transitStoryId);
    expect(portBundle?.sources.map((source) => source.source_id)).toEqual(['wire-a', 'wire-b']);
    expect(transitBundle?.sources.map((source) => source.source_id)).toEqual(['metro-a']);
  });

  it('upgrades a public singleton when later San Diego mosque shooting coverage arrives', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [{
        sourceId: 'guardian-us',
        publisher: 'The Guardian',
        url: 'https://example.com/guardian-mosque',
        canonicalUrl: 'https://example.com/guardian-mosque',
        title: 'Five people, including two suspects, killed in shooting at San Diego’s largest mosque',
        publishedAt: 1_779_186_385_000,
        summary: 'Teenage suspects died from self-inflicted gunshot wounds as officials investigated the shooting at the Islamic Center of San Diego as a hate crime.',
        url_hash: 'guardian-mosque',
        entity_keys: ['mosque', 'shooting', 'diego', 'hate', 'crime'],
      }],
    }, { clock: () => 1_779_186_400_000, store });
    const firstStoryId = first.bundles[0]?.story_id;

    const second = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [{
        sourceId: 'bbc-us-canada',
        publisher: 'BBC',
        url: 'https://example.com/bbc-mosque',
        canonicalUrl: 'https://example.com/bbc-mosque',
        title: 'Teen suspects fatally shoot three in suspected hate crime at San Diego mosque',
        publishedAt: 1_779_174_475_000,
        summary: 'Investigators said the alleged attackers were aged 17 and 18 and left a note containing generalized hate rhetoric.',
        url_hash: 'bbc-mosque',
        entity_keys: ['teen', 'suspects', 'shoot', 'hate', 'crime', 'mosque', 'diego'],
      }],
    }, { clock: () => 1_779_186_500_000, store });

    const upgraded = second.bundles.find((bundle) => bundle.story_id === firstStoryId);
    expect(upgraded?.sources.map((source) => source.source_id).sort()).toEqual(['bbc-us-canada', 'guardian-us']);
  });

  it('keeps cross-fetch public-health outbreak response singletons separate without a concrete shared action', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [{
        sourceId: 'cbs-politics',
        publisher: 'CBS',
        url: 'https://example.com/cbs-ebola',
        canonicalUrl: 'https://example.com/cbs-ebola',
        title: 'U.S. announces Ebola-related travel restrictions amid outbreak in Congo, Uganda',
        publishedAt: 1_779_183_061_000,
        summary: 'The administration restricted some travelers who had been in Congo, South Sudan or Uganda amid the Ebola outbreak.',
        url_hash: 'cbs-ebola',
        entity_keys: ['ebola', 'outbreak', 'congo', 'uganda', 'travel', 'restrictions'],
      }],
    }, { clock: () => 1_779_183_100_000, store });
    const firstStoryId = first.bundles[0]?.story_id;

    const second = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [{
        sourceId: 'channelnewsasia-latest',
        publisher: 'CNA',
        url: 'https://example.com/cna-ebola',
        canonicalUrl: 'https://example.com/cna-ebola',
        title: 'Singapore steps up health measures after Ebola outbreak in DR Congo, Uganda',
        publishedAt: 1_779_188_400_000,
        summary: 'Health advisories were put in place at all points of entry for travelers after the Ebola outbreak in DR Congo and Uganda.',
        url_hash: 'cna-ebola',
        entity_keys: ['ebola', 'outbreak', 'congo', 'uganda', 'singapore', 'health', 'measures'],
      }],
    }, { clock: () => 1_779_188_500_000, store });

    const originalSingleton = second.bundles.find((bundle) => bundle.story_id === firstStoryId);
    const cnaSingleton = second.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'channelnewsasia-latest'));
    expect(originalSingleton?.sources.map((source) => source.source_id)).toEqual(['cbs-politics']);
    expect(cnaSingleton?.sources.map((source) => source.source_id)).toEqual(['channelnewsasia-latest']);
    expect(second.bundles.some((bundle) =>
      bundle.sources.some((source) => source.source_id === 'cbs-politics') &&
      bundle.sources.some((source) => source.source_id === 'channelnewsasia-latest'))).toBe(false);
  });

  it('upgrades a public singleton when later matching Ebola travel-restriction coverage arrives', async () => {
    const store = new MemoryClusterStore();
    const first = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [{
        sourceId: 'cbs-politics',
        publisher: 'CBS',
        url: 'https://example.com/cbs-ebola',
        canonicalUrl: 'https://example.com/cbs-ebola',
        title: 'U.S. announces Ebola-related travel restrictions amid outbreak in Congo, Uganda',
        publishedAt: 1_779_183_061_000,
        summary: 'The administration restricted some travelers who had been in Congo, South Sudan or Uganda amid the Ebola outbreak.',
        url_hash: 'cbs-ebola',
        entity_keys: ['ebola', 'outbreak', 'congo', 'uganda', 'travel', 'restrictions'],
      }],
    }, { clock: () => 1_779_183_100_000, store });
    const firstStoryId = first.bundles[0]?.story_id;

    const second = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [{
        sourceId: 'ap-health',
        publisher: 'AP',
        url: 'https://example.com/ap-ebola-travel',
        canonicalUrl: 'https://example.com/ap-ebola-travel',
        title: 'United States adds Ebola travel restrictions after Congo and Uganda outbreak',
        publishedAt: 1_779_183_461_000,
        summary: 'U.S. officials restricted travelers after the Ebola outbreak in Congo and Uganda.',
        url_hash: 'ap-ebola-travel',
        entity_keys: ['ebola', 'outbreak', 'congo', 'uganda', 'travel', 'restrictions'],
      }],
    }, { clock: () => 1_779_183_500_000, store });

    const upgraded = second.bundles.find((bundle) => bundle.story_id === firstStoryId);
    expect(upgraded?.sources.map((source) => source.source_id).sort()).toEqual(['ap-health', 'cbs-politics']);
  });

  it('bundles same-batch public-live San Diego mosque shooting coverage', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [
        {
          sourceId: 'npr-news',
          publisher: 'NPR',
          url: 'https://example.com/npr-mosque',
          canonicalUrl: 'https://example.com/npr-mosque',
          title: 'California mosque shooting leaves 5 dead. And, judge dismisses Trump’s IRS lawsuit',
          publishedAt: 1_779_190_418_000,
          summary: 'San Diego authorities are investigating a deadly shooting at a mosque as a hate crime.',
          url_hash: 'npr-mosque',
          entity_keys: ['california', 'mosque', 'shooting', 'san_diego'],
        },
        {
          sourceId: 'bbc-general',
          publisher: 'BBC',
          url: 'https://example.com/bbc-mosque',
          canonicalUrl: 'https://example.com/bbc-mosque',
          title: 'Father-of-8 security guard hailed as hero in San Diego mosque shooting',
          publishedAt: 1_779_193_848_000,
          summary: 'Amin Abdullah, one of three men killed in the attack, is said to have saved lives in the shooting.',
          url_hash: 'bbc-mosque',
          entity_keys: ['san_diego', 'mosque', 'shooting', 'killed'],
        },
      ],
    }, { clock: () => 1_779_194_000_000, store: new MemoryClusterStore() });

    const mosqueBundle = response.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'npr-news'));
    expect(mosqueBundle?.sources.map((source) => source.source_id).sort()).toEqual(['bbc-general', 'npr-news']);
  });

  it('publishes same-batch public-health outbreak responses as singletons when concrete actions differ', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [
        {
          sourceId: 'cbs-politics',
          publisher: 'CBS',
          url: 'https://example.com/cbs-ebola',
          canonicalUrl: 'https://example.com/cbs-ebola',
          title: 'U.S. announces Ebola-related travel restrictions amid outbreak in Congo, Uganda',
          publishedAt: 1_779_183_061_000,
          summary: 'The administration restricted some travelers who had been in Congo, South Sudan or Uganda amid the Ebola outbreak.',
          url_hash: 'cbs-ebola',
          entity_keys: ['ebola', 'outbreak', 'congo', 'uganda', 'travel', 'restrictions'],
        },
        {
          sourceId: 'bbc-general',
          publisher: 'BBC',
          url: 'https://example.com/bbc-ebola',
          canonicalUrl: 'https://example.com/bbc-ebola',
          title: "'Ebola has tortured us': Fear as outbreak spreads faster than first thought",
          publishedAt: 1_779_193_447_000,
          summary: 'Hundreds of cases are suspected in central Africa but experts fear the actual number may be much higher.',
          url_hash: 'bbc-ebola',
          entity_keys: ['ebola', 'outbreak', 'central_africa'],
        },
        {
          sourceId: 'channelnewsasia-latest',
          publisher: 'CNA',
          url: 'https://example.com/cna-ebola',
          canonicalUrl: 'https://example.com/cna-ebola',
          title: 'Singapore steps up health measures after Ebola outbreak in DR Congo, Uganda',
          publishedAt: 1_779_188_400_000,
          summary: 'Health advisories were put in place at all points of entry for travelers after the Ebola outbreak in DR Congo and Uganda.',
          url_hash: 'cna-ebola',
          entity_keys: ['ebola', 'outbreak', 'congo', 'uganda', 'singapore', 'health', 'measures'],
        },
      ],
    }, { clock: () => 1_779_194_000_000, store: new MemoryClusterStore() });

    const travelBundle = response.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'cbs-politics'));
    const broadBundle = response.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'bbc-general'));
    const healthBundle = response.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'channelnewsasia-latest'));
    expect(travelBundle?.sources.map((source) => source.source_id)).toEqual(['cbs-politics']);
    expect(broadBundle?.sources.map((source) => source.source_id)).toEqual(['bbc-general']);
    expect(healthBundle?.sources.map((source) => source.source_id)).toEqual(['channelnewsasia-latest']);
    expect(response.bundles.some((bundle) =>
      bundle.sources.some((source) => source.source_id === 'cbs-politics') &&
      bundle.sources.some((source) => source.source_id === 'channelnewsasia-latest'))).toBe(false);
  });

  it('publishes same-batch Supreme Court stories as singletons when legal issues differ', async () => {
    const response = await runStoryClusterRemoteContract({
      topic_id: 'topic-public-live',
      items: [
        {
          sourceId: 'ap-politics',
          publisher: 'AP',
          url: 'https://example.com/native-voting-rights',
          canonicalUrl: 'https://example.com/native-voting-rights',
          title: 'Supreme Court sends closely watched Native American voting rights decision back to lower court',
          publishedAt: 1_779_201_800_000,
          summary: 'The justices sent a Native American voting rights dispute back to a lower court.',
          url_hash: 'native-voting-rights',
          entity_keys: ['supreme_court', 'court', 'native_american_voting_rights', 'voting_rights', 'native_american'],
        },
        {
          sourceId: 'scotusblog-main',
          publisher: 'SCOTUSblog',
          url: 'https://example.com/sex-discrimination-case',
          canonicalUrl: 'https://example.com/sex-discrimination-case',
          title: 'Court to hear sex discrimination case case next term',
          publishedAt: 1_779_201_900_000,
          summary: 'The Supreme Court agreed to hear a sex discrimination case next term. Plus, the court sent two Voting Rights Act cases back to lower courts.',
          url_hash: 'sex-discrimination-case',
          entity_keys: ['supreme_court', 'court', 'sex_discrimination', 'sex_discrimination_case', 'voting_rights'],
        },
      ],
    }, { clock: () => 1_779_202_000_000, store: new MemoryClusterStore() });

    const votingRightsBundle = response.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'ap-politics'));
    const sexDiscriminationBundle = response.bundles.find((bundle) =>
      bundle.sources.some((source) => source.source_id === 'scotusblog-main'));
    expect(votingRightsBundle?.sources.map((source) => source.source_id)).toEqual(['ap-politics']);
    expect(sexDiscriminationBundle?.sources.map((source) => source.source_id)).toEqual(['scotusblog-main']);
    expect(response.bundles.some((bundle) =>
      bundle.sources.some((source) => source.source_id === 'ap-politics') &&
      bundle.sources.some((source) => source.source_id === 'scotusblog-main'))).toBe(false);
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
          imageUrl: 'https://example.com/article.jpg',
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
          imageUrl: 'https://example.com/video.jpg',
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
    expect(response.bundles[0]?.primary_sources?.[0]?.imageUrl).toBe('https://example.com/article.jpg');
    expect(response.bundles[0]?.secondary_assets?.map((source) => source.source_id)).toEqual(['cbs-video']);
    expect(response.bundles[0]?.secondary_assets?.[0]?.imageUrl).toBe('https://example.com/video.jpg');
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
