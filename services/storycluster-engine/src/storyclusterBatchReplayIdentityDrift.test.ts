import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import type { StoryClusterBundle, StoryClusterInputDocument } from './contracts';
import { runStoryClusterStagePipeline } from './stageRunner';
import { createDeterministicTestModelProvider } from './testModelProvider';

function makeClock(start = 1_713_900_000_000): () => number {
  let tick = start;
  return () => {
    tick += 5;
    return tick;
  };
}

function makeDoc(
  docId: string,
  sourceId: string,
  urlHash: string,
  title: string,
  summary: string,
  publishedAt: number,
  entityKeys: string[],
): StoryClusterInputDocument {
  return {
    doc_id: docId,
    source_id: sourceId,
    publisher: sourceId,
    title,
    summary,
    published_at: publishedAt,
    url: `https://example.com/${sourceId}/${urlHash}`,
    canonical_url: `https://example.com/${sourceId}/${urlHash}`,
    url_hash: urlHash,
    entity_keys: entityKeys,
  };
}

function findBundleBySourceKeys(response: { bundles: StoryClusterBundle[] }, expectedKeys: readonly string[]): StoryClusterBundle {
  const target = [...expectedKeys].sort();
  const bundle = response.bundles.find((candidate) => {
    const keys = candidate.sources.map((source) => `${source.source_id}:${source.url_hash}`).sort();
    return keys.length === target.length && keys.every((key, index) => key === target[index]);
  });
  expect(bundle).toBeDefined();
  return bundle!;
}

describe('StoryCluster batch replay identity anchoring', () => {
  it('keeps repeated Cuba singleton coverage on the same story id when fresh batch topology changes', async () => {
    const topicId = 'topic-live-batch-replay';
    const provider = createDeterministicTestModelProvider();

    const minimal = await runStoryClusterStagePipeline(
      {
        topic_id: topicId,
        documents: [
          makeDoc(
            'cuba-10',
            'nbc-politics',
            '07f8408a',
            "Cuba's deputy foreign minister says it is preparing for possible U.S. 'military aggression'",
            'Cuba says it is preparing for possible U.S. military aggression after Trump remarks escalated tensions.',
            100,
            ['cuba_us_military_aggression'],
          ),
        ],
      },
      { clock: makeClock(), modelProvider: provider, store: new MemoryClusterStore() },
    );

    const crowded = await runStoryClusterStagePipeline(
      {
        topic_id: topicId,
        documents: [
          makeDoc(
            'a-blackout-01',
            'bbc-general',
            'eb2bbf6e',
            'National blackout hits Cuba for second time in a week',
            'A nationwide blackout has hit Cuba for the second time in a week after a grid failure.',
            90,
            ['cuba_blackout_grid_failure'],
          ),
          makeDoc(
            'b-mueller-01',
            'bbc-us-canada',
            '6ef5fdc8',
            'Robert Mueller, ex-FBI chief who led Trump-Russia investigation, dies at 81',
            'Robert Mueller, former FBI director and Trump-Russia special counsel, has died at 81.',
            95,
            ['robert_mueller_obituary'],
          ),
          makeDoc(
            'cuba-10',
            'nbc-politics',
            '07f8408a',
            "Cuba's deputy foreign minister says it is preparing for possible U.S. 'military aggression'",
            'Cuba says it is preparing for possible U.S. military aggression after Trump remarks escalated tensions.',
            100,
            ['cuba_us_military_aggression'],
          ),
        ],
      },
      { clock: makeClock(1_713_900_010_000), modelProvider: provider, store: new MemoryClusterStore() },
    );

    const minimalCuba = findBundleBySourceKeys(minimal, ['nbc-politics:07f8408a']);
    const crowdedCuba = findBundleBySourceKeys(crowded, ['nbc-politics:07f8408a']);

    expect(minimalCuba.headline).toBe(crowdedCuba.headline);
    expect(minimalCuba.primary_sources).toHaveLength(1);
    expect(crowdedCuba.primary_sources).toHaveLength(1);
    expect(minimalCuba.story_id).toBe(crowdedCuba.story_id);
  });

  it('keeps the airport episode anchored while source coverage grows in a fresh crowded batch', async () => {
    const topicId = 'topic-live-batch-replay';
    const provider = createDeterministicTestModelProvider();
    const anchorAirportKeys = ['cbs-politics:bc734304'];
    const grownAirportKeys = ['cbs-politics:bc734304', 'guardian-us:86a83b99'];

    const minimal = await runStoryClusterStagePipeline(
      {
        topic_id: topicId,
        documents: [
          makeDoc(
            'airport-cbs-10',
            'cbs-politics',
            'bc734304',
            'Trump says ICE agents will assist TSA at airports as delays worsen',
            'Trump says ICE agents will assist TSA at airports as delays worsen while staffing shortages continue.',
            100,
            ['ice_tsa_airports'],
          ),
        ],
      },
      { clock: makeClock(1_713_900_020_000), modelProvider: provider, store: new MemoryClusterStore() },
    );

    const crowded = await runStoryClusterStagePipeline(
      {
        topic_id: topicId,
        documents: [
          makeDoc(
            'a-blackout-02',
            'bbc-general',
            'eb2bbf6e',
            'National blackout hits Cuba for second time in a week',
            'A nationwide blackout has hit Cuba for the second time in a week after a grid failure.',
            90,
            ['cuba_blackout_grid_failure'],
          ),
          makeDoc(
            'b-mueller-02',
            'bbc-us-canada',
            '6ef5fdc8',
            'Robert Mueller, ex-FBI chief who led Trump-Russia investigation, dies at 81',
            'Robert Mueller, former FBI director and Trump-Russia special counsel, has died at 81.',
            95,
            ['robert_mueller_obituary'],
          ),
          makeDoc(
            'airport-cbs-10',
            'cbs-politics',
            'bc734304',
            'Trump says ICE agents will assist TSA at airports as delays worsen',
            'Trump says ICE agents will assist TSA at airports as delays worsen while staffing shortages continue.',
            100,
            ['ice_tsa_airports'],
          ),
          makeDoc(
            'airport-guardian-20',
            'guardian-us',
            '86a83b99',
            'ICE agents will be deployed to US airports on Monday to ease long lines',
            'ICE agents will be deployed to U.S. airports on Monday to ease long lines as TSA delays worsen.',
            105,
            ['ice_tsa_airports'],
          ),
        ],
      },
      { clock: makeClock(1_713_900_030_000), modelProvider: provider, store: new MemoryClusterStore() },
    );

    const minimalAirport = findBundleBySourceKeys(minimal, anchorAirportKeys);
    const crowdedAirport = findBundleBySourceKeys(crowded, grownAirportKeys);

    expect(minimalAirport.primary_sources.map((source) => source.source_id).sort()).toEqual(['cbs-politics']);
    expect(crowdedAirport.primary_sources.map((source) => source.source_id).sort()).toEqual(['cbs-politics', 'guardian-us']);
    expect(minimalAirport.story_id).toBe(crowdedAirport.story_id);
  });
});
