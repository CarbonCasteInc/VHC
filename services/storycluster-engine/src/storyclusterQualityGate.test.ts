import { describe, expect, it } from 'vitest';
import { MemoryClusterStore } from './clusterStore';
import { coherenceAuditInternal, runStoryClusterCoherenceAudit, type StoryClusterCoherenceAuditDataset, type StoryClusterCoherenceAuditItem, type StoryClusterCoherenceDatasetResult } from './coherenceAudit';
import { runStoryClusterRemoteContract, type StoryClusterRemoteBundle } from './remoteContract';

function makeItem(
  expectedEventId: string,
  sourceId: string,
  title: string,
  urlHash: string,
  publishedAt: number,
  overrides: Partial<StoryClusterCoherenceAuditItem> = {},
): StoryClusterCoherenceAuditItem {
  return {
    expected_event_id: expectedEventId,
    sourceId,
    publisher: overrides.publisher ?? sourceId.toUpperCase(),
    url: overrides.url ?? `https://example.com/${urlHash}`,
    canonicalUrl: overrides.canonicalUrl ?? `https://example.com/${urlHash}`,
    title,
    publishedAt,
    summary: overrides.summary ?? `${title} summary.`,
    url_hash: overrides.url_hash ?? urlHash,
    image_hash: overrides.image_hash,
    language: overrides.language ?? 'en',
    translation_applied: overrides.translation_applied ?? false,
    entity_keys: overrides.entity_keys ?? [expectedEventId],
    cluster_text: overrides.cluster_text,
  };
}

const FIXTURE_DATASETS: StoryClusterCoherenceAuditDataset[] = [
  {
    dataset_id: 'fixture-multilingual-port-market',
    topic_id: 'fixture-multilingual-port-market',
    items: [
      makeItem('port_attack', 'wire-a', 'Port attack disrupts terminals overnight', 'a1', 1_710_100_000_000),
      makeItem('port_attack', 'wire-b', 'Officials say recovery talks begin Friday after port attack', 'a2', 1_710_100_020_000),
      makeItem('port_attack', 'wire-c', 'El gobierno confirmó nuevas sanciones tras el ataque al puerto', 'a3', 1_710_100_040_000, { language: 'es' }),
      makeItem('market_reaction', 'wire-d', 'Stocks slide after Tehran strike rattles insurers', 'b1', 1_710_100_060_000),
      makeItem('market_reaction', 'wire-e', 'Brokers revise shipping forecasts after the regional strike', 'b2', 1_710_100_080_000),
      makeItem('evacuation_updates', 'wire-f', 'Evacuation routes reopen after the refinery fire', 'c1', 1_710_100_090_000),
      makeItem('evacuation_updates', 'wire-g', 'Officials say refinery fire shelters stay open overnight', 'c2', 1_710_100_095_000),
      makeItem('diplomatic_followup', 'wire-h', 'Diplomatic talks resume after the sanctions dispute', 'd1', 1_710_100_120_000),
      makeItem('diplomatic_followup', 'wire-i', 'Summit aides prepare another round of sanctions talks', 'd2', 1_710_100_140_000),
    ],
  },
  {
    dataset_id: 'fixture-same-topic-trap-separation',
    topic_id: 'fixture-same-topic-trap-separation',
    items: [
      makeItem('market_aftershock', 'wire-j', 'Stocks slide after the overnight strike jolts shipping insurers', 'h1', 1_710_300_000_000),
      makeItem('market_aftershock', 'wire-k', 'Brokers cut shipping forecasts as markets absorb the strike', 'h2', 1_710_300_020_000),
      makeItem('opinion_commentary', 'desk-l', 'Opinion: how to think clearly before forming views on the conflict', 'i1', 1_710_300_040_000),
      makeItem('ceasefire_vote', 'wire-m', 'Parliament schedules a ceasefire vote after the weekend attacks', 'j1', 1_710_300_060_000),
      makeItem('ceasefire_vote', 'wire-n', 'Coalition leaders whip support ahead of the ceasefire vote', 'j2', 1_710_300_080_000),
      makeItem('protest_crackdown', 'wire-o', 'Police detain protest leaders after the capital march turns violent', 'k1', 1_710_300_100_000),
      makeItem('protest_crackdown', 'wire-p', 'Capital courts review charges after protest arrests', 'k2', 1_710_300_120_000),
    ],
  },
  {
    dataset_id: 'fixture-liveblog-contamination',
    topic_id: 'fixture-liveblog-contamination',
    items: [
      makeItem('liveblog_port_attack', 'live-a', 'Live updates: port attack response minute by minute', 'l1', 1_710_400_000_000, { publisher: 'Live Desk', summary: 'Live updates and wire snippets from the port attack response.' }),
      makeItem('liveblog_port_attack', 'live-b', 'Live blog: emergency crews respond at the port overnight', 'l2', 1_710_400_010_000, { publisher: 'Live Desk', summary: 'Rolling live coverage from the port attack response.' }),
      makeItem('ceasefire_vote', 'wire-q', 'Parliament schedules a ceasefire vote after the attacks', 'l3', 1_710_400_030_000),
      makeItem('ceasefire_vote', 'wire-r', 'Coalition whips support before the ceasefire vote', 'l4', 1_710_400_050_000),
      makeItem('explainer_recap', 'desk-s', 'Explainer: what the weekend attacks mean for regional diplomacy', 'l5', 1_710_400_070_000),
    ],
  },
  {
    dataset_id: 'fixture-entity-overlap-distinct',
    topic_id: 'fixture-entity-overlap-distinct',
    items: [
      makeItem('capital_budget', 'wire-t', 'Capital council approves the budget after an overnight session', 'm1', 1_710_500_000_000, { entity_keys: ['capital_budget', 'capital'] }),
      makeItem('capital_budget', 'wire-u', 'Mayor signs the new capital budget after the council vote', 'm2', 1_710_500_020_000, { entity_keys: ['capital_budget', 'capital'] }),
      makeItem('capital_protest', 'wire-v', 'Capital police detain march organizers after protest clashes', 'm3', 1_710_500_040_000, { entity_keys: ['capital_protest', 'capital'] }),
      makeItem('capital_protest', 'wire-w', 'Capital courts review charges after protest arrests', 'm4', 1_710_500_060_000, { entity_keys: ['capital_protest', 'capital'] }),
    ],
  },
  {
    dataset_id: 'fixture-recap-vs-breaking',
    topic_id: 'fixture-recap-vs-breaking',
    items: [
      makeItem('relief_convoy', 'wire-x', 'Relief convoy reaches the border crossing before dawn', 'n1', 1_710_600_000_000),
      makeItem('relief_convoy', 'wire-y', 'Aid groups confirm the convoy crossed before sunrise', 'n2', 1_710_600_020_000),
      makeItem('policy_recap', 'desk-z', 'Recap: how governments argued over border aid access this week', 'n3', 1_710_600_050_000),
      makeItem('policy_recap', 'desk-aa', 'Explainer recap: the policy fight behind the border aid dispute', 'n4', 1_710_600_070_000),
    ],
  },
  {
    dataset_id: 'fixture-geo-similar-distinct',
    topic_id: 'fixture-geo-similar-distinct',
    items: [
      makeItem('osaka_quake_response', 'wire-ab', 'Osaka rescue teams clear roads after the quake', 'o1', 1_710_700_000_000, { entity_keys: ['osaka_quake_response', 'osaka'] }),
      makeItem('osaka_quake_response', 'wire-ac', 'After the quake, Osaka officials reopen key roads', 'o2', 1_710_700_020_000, { entity_keys: ['osaka_quake_response', 'osaka'] }),
      makeItem('osaka_drill', 'wire-ad', 'Osaka hospitals run a citywide earthquake drill', 'o3', 1_710_700_050_000, { entity_keys: ['osaka_drill', 'osaka'] }),
      makeItem('osaka_drill', 'wire-ae', 'City officials review the Osaka emergency drill results', 'o4', 1_710_700_070_000, { entity_keys: ['osaka_drill', 'osaka'] }),
    ],
  },
  {
    dataset_id: 'fixture-image-reuse-distinct',
    topic_id: 'fixture-image-reuse-distinct',
    items: [
      makeItem('port_attack', 'wire-af', 'Port attack disrupts container traffic overnight', 'p1', 1_710_800_000_000, { image_hash: 'shared-image' }),
      makeItem('port_attack', 'wire-ag', 'Recovery talks begin after the port attack', 'p2', 1_710_800_020_000, { image_hash: 'shared-image' }),
      makeItem('protest_crackdown', 'wire-ah', 'Police detain protest leaders after the capital march', 'p3', 1_710_800_040_000, { image_hash: 'shared-image' }),
      makeItem('protest_crackdown', 'wire-ai', 'Capital courts review charges after protest arrests', 'p4', 1_710_800_060_000, { image_hash: 'shared-image' }),
    ],
  },
  {
    dataset_id: 'fixture-url-canonical-drift',
    topic_id: 'fixture-url-canonical-drift',
    items: [
      makeItem('ship_delays', 'wire-aj', 'Shipping delays deepen after the overnight strike', 'q1', 1_710_900_000_000, { canonicalUrl: 'https://example.com/shipping-live' }),
      makeItem('ship_delays', 'wire-ak', 'Carriers warn of longer shipping delays after the strike', 'q2', 1_710_900_020_000, { canonicalUrl: 'https://example.com/shipping-live' }),
      makeItem('ship_delays', 'wire-al', 'Insurers warn delays will continue after the port attack', 'q3', 1_710_900_040_000, { canonicalUrl: 'https://example.com/shipping-followup' }),
      makeItem('fuel_spike', 'wire-am', 'Fuel prices jump as traders price in the conflict risk', 'q4', 1_710_900_070_000),
      makeItem('fuel_spike', 'wire-an', 'Energy desks raise price forecasts after the overnight strike', 'q5', 1_710_900_090_000),
    ],
  },
  {
    dataset_id: 'fixture-sparse-singletons',
    topic_id: 'fixture-sparse-singletons',
    items: [
      makeItem('bridge_closure', 'wire-ao', 'Authorities close the bridge after a structural alarm', 'r1', 1_711_000_000_000),
      makeItem('wildfire_evacuation', 'wire-ap', 'Wildfire evacuation orders expand overnight', 'r2', 1_711_000_030_000),
      makeItem('trade_vote', 'wire-aq', 'Lawmakers delay the trade vote after procedural objections', 'r3', 1_711_000_060_000),
    ],
  },
];

const REPLAY_SCENARIOS = [
  {
    scenario_id: 'replay-port-attack-expansion',
    topic_id: 'replay-port-attack-expansion',
    ticks: [
      [
        makeItem('port_attack', 'replay-a', 'Port attack disrupts terminals overnight', 'ra1', 1_712_000_000_000),
        makeItem('port_attack', 'replay-b', 'Officials say recovery talks begin Friday after port attack', 'ra2', 1_712_000_020_000),
      ],
      [
        makeItem('port_attack', 'replay-c', 'El gobierno confirmó nuevas sanciones tras el ataque al puerto', 'ra3', 1_712_000_040_000, { language: 'es' }),
      ],
      [
        makeItem('port_attack', 'replay-d', 'Insurers warn delays will continue after port attack', 'ra4', 1_712_000_060_000),
      ],
    ],
  },
  {
    scenario_id: 'replay-market-opinion-separation',
    topic_id: 'replay-market-opinion-separation',
    ticks: [
      [
        makeItem('market_aftershock', 'replay-e', 'Stocks slide after the overnight strike jolts shipping insurers', 'rb1', 1_712_100_000_000),
        makeItem('market_aftershock', 'replay-f', 'Brokers cut shipping forecasts as markets absorb the strike', 'rb2', 1_712_100_020_000),
      ],
      [
        makeItem('opinion_commentary', 'replay-g', 'Opinion: how to think clearly before forming views on the conflict', 'rb3', 1_712_100_040_000),
      ],
      [
        makeItem('market_aftershock', 'replay-h', 'Insurers hedge against prolonged shipping disruption after the strike', 'rb4', 1_712_100_060_000),
      ],
    ],
  },
  {
    scenario_id: 'replay-ceasefire-protest-separation',
    topic_id: 'replay-ceasefire-protest-separation',
    ticks: [
      [
        makeItem('ceasefire_vote', 'replay-i', 'Parliament schedules a ceasefire vote after the weekend attacks', 'rc1', 1_712_200_000_000),
        makeItem('ceasefire_vote', 'replay-j', 'Coalition leaders whip support ahead of the ceasefire vote', 'rc2', 1_712_200_020_000),
      ],
      [
        makeItem('protest_crackdown', 'replay-k', 'Police detain protest leaders after the capital march turns violent', 'rc3', 1_712_200_040_000),
        makeItem('protest_crackdown', 'replay-l', 'Capital courts review charges after protest arrests', 'rc4', 1_712_200_060_000),
      ],
      [
        makeItem('ceasefire_vote', 'replay-m', 'Lawmakers prepare final amendments before the ceasefire vote', 'rc5', 1_712_200_080_000),
      ],
    ],
  },
];

function toRemoteItems(items: readonly StoryClusterCoherenceAuditItem[]) {
  return items.map(({ expected_event_id: _expectedEventId, ...item }) => item);
}

function bundleFromCluster(cluster: {
  story_id: string;
  created_at: number;
  cluster_window_start: number;
  cluster_window_end: number;
  headline: string;
  summary_hint: string;
  semantic_signature: string;
  primary_language: string;
  translation_applied: boolean;
  source_documents: Array<{
    source_id: string;
    publisher: string;
    canonical_url: string;
    url_hash: string;
    published_at: number;
    title: string;
  }>;
  entity_scores: Record<string, number>;
}): StoryClusterRemoteBundle {
  const sources = cluster.source_documents
    .map((source) => ({
      source_id: source.source_id,
      publisher: source.publisher,
      url: source.canonical_url,
      url_hash: source.url_hash,
      published_at: source.published_at,
      title: source.title,
    }))
    .sort((left, right) => `${left.source_id}:${left.url_hash}`.localeCompare(`${right.source_id}:${right.url_hash}`));
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: cluster.story_id,
    topic_id: cluster.story_id,
    headline: cluster.headline,
    summary_hint: cluster.summary_hint,
    cluster_window_start: cluster.cluster_window_start,
    cluster_window_end: cluster.cluster_window_end,
    sources,
    cluster_features: {
      entity_keys: Object.keys(cluster.entity_scores).sort(),
      time_bucket: new Date(cluster.cluster_window_end).toISOString().slice(0, 13),
      semantic_signature: cluster.semantic_signature,
      coverage_score: sources.length,
      velocity_score: sources.length,
      confidence_score: 1,
      primary_language: cluster.primary_language,
      translation_applied: cluster.translation_applied,
    },
    provenance_hash: cluster.story_id,
    created_at: cluster.created_at,
  };
}

function eventIdsForBundle(
  bundle: StoryClusterRemoteBundle,
  expectedByKey: Map<string, string>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const source of bundle.sources) {
    const eventId = expectedByKey.get(coherenceAuditInternal.sourceEventKey({
      source_id: source.source_id,
      url_hash: source.url_hash,
    }));
    if (!eventId) {
      continue;
    }
    counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
  }
  return counts;
}

function eventStoryIdsFromBundles(
  bundles: readonly StoryClusterRemoteBundle[],
  expectedByKey: Map<string, string>,
): Map<string, Set<string>> {
  const mapping = new Map<string, Set<string>>();
  for (const bundle of bundles) {
    for (const [eventId] of eventIdsForBundle(bundle, expectedByKey)) {
      const stories = mapping.get(eventId) ?? new Set<string>();
      stories.add(bundle.story_id);
      mapping.set(eventId, stories);
    }
  }
  return mapping;
}

function singleStoryId(stories: Set<string> | undefined): string | null {
  if (!stories || stories.size !== 1) {
    return null;
  }
  return [...stories][0] ?? null;
}

function aggregateResults(results: readonly StoryClusterCoherenceDatasetResult[]) {
  return {
    max_contamination_rate: Math.max(...results.map((result) => result.contamination_rate)),
    max_fragmentation_rate: Math.max(...results.map((result) => result.fragmentation_rate)),
    avg_coherence_score: Number((
      results.reduce((total, result) => total + result.coherence_score, 0) / Math.max(1, results.length)
    ).toFixed(6)),
    dataset_count: results.length,
    failed_dataset_ids: results.filter((result) => !result.pass).map((result) => result.dataset_id),
  };
}

describe('StoryCluster quality gate', () => {
  it('passes the expanded fixture benchmark suite', async () => {
    const report = await runStoryClusterCoherenceAudit(FIXTURE_DATASETS, {
      now: () => 1_713_000_000_000,
      thresholds: {
        max_contamination_rate: 0.02,
        max_fragmentation_rate: 0.05,
        min_coherence_score: 0.93,
      },
      contractRunner: (payload) =>
        runStoryClusterRemoteContract(payload, {
          store: new MemoryClusterStore(),
          clock: () => 1_713_000_000_000,
        }),
    });

    expect(report.overall.pass).toBe(true);
    expect(report.dataset_count).toBe(FIXTURE_DATASETS.length);
    expect(report.overall.max_contamination_rate).toBeLessThanOrEqual(0.02);
    expect(report.overall.max_fragmentation_rate).toBeLessThanOrEqual(0.05);
    expect(report.overall.avg_coherence_score).toBeGreaterThanOrEqual(0.93);

    console.log(JSON.stringify({
      benchmark: 'fixture-suite',
      overall: report.overall,
      datasets: report.datasets.map((dataset) => ({
        dataset_id: dataset.dataset_id,
        total_docs: dataset.total_docs,
        total_bundles: dataset.total_bundles,
        contamination_rate: dataset.contamination_rate,
        fragmentation_rate: dataset.fragmentation_rate,
        coherence_score: dataset.coherence_score,
      })),
    }, null, 2));
  });

  it('passes replay thresholds and preserves story identity across ticks', async () => {
    const replayResults: StoryClusterCoherenceDatasetResult[] = [];
    let persistenceObservations = 0;
    let persistenceRetained = 0;

    for (const scenario of REPLAY_SCENARIOS) {
      const store = new MemoryClusterStore();
      const expectedByKey = new Map<string, string>();
      const previousStoryByEvent = new Map<string, string | null>();

      for (let tickIndex = 0; tickIndex < scenario.ticks.length; tickIndex += 1) {
        const tick = scenario.ticks[tickIndex]!;
        tick.forEach((item) => {
          expectedByKey.set(coherenceAuditInternal.itemEventKey(item), item.expected_event_id);
        });

        await runStoryClusterRemoteContract(
          {
            topic_id: scenario.topic_id,
            items: toRemoteItems(tick),
          },
          {
            store,
            clock: () => 1_714_000_000_000 + tickIndex * 1_000,
          },
        );

        const state = store.loadTopic(scenario.topic_id);
        const bundles = state.clusters.map(bundleFromCluster);
        const currentStoryIds = eventStoryIdsFromBundles(bundles, expectedByKey);

        for (const [eventId, storyIds] of currentStoryIds) {
          const previous = previousStoryByEvent.get(eventId);
          const current = singleStoryId(storyIds);
          if (previous !== undefined) {
            persistenceObservations += 1;
            if (previous !== null && current !== null && previous === current) {
              persistenceRetained += 1;
            }
          }
          previousStoryByEvent.set(eventId, current);
        }
      }

      const finalState = store.loadTopic(scenario.topic_id);
      replayResults.push(
        coherenceAuditInternal.computeDatasetResult(
          {
            dataset_id: scenario.scenario_id,
            topic_id: scenario.topic_id,
            items: scenario.ticks.flat(),
          },
          {
            bundles: finalState.clusters.map(bundleFromCluster),
            telemetry: coherenceAuditInternal.createEmptyTelemetry(scenario.topic_id),
          },
          {
            max_contamination_rate: 0.05,
            max_fragmentation_rate: 0.08,
            min_coherence_score: 0.88,
          },
        ),
      );
    }

    const persistenceRate = Number((persistenceRetained / Math.max(1, persistenceObservations)).toFixed(6));
    const aggregate = aggregateResults(replayResults);

    expect(aggregate.failed_dataset_ids).toEqual([]);
    expect(aggregate.max_contamination_rate).toBeLessThanOrEqual(0.05);
    expect(aggregate.max_fragmentation_rate).toBeLessThanOrEqual(0.08);
    expect(aggregate.avg_coherence_score).toBeGreaterThanOrEqual(0.88);
    expect(persistenceRate).toBeGreaterThanOrEqual(0.99);

    console.log(JSON.stringify({
      benchmark: 'replay-suite',
      aggregate,
      persistence_rate: persistenceRate,
      persistence_observations: persistenceObservations,
      persistence_retained: persistenceRetained,
      datasets: replayResults.map((dataset) => ({
        dataset_id: dataset.dataset_id,
        contamination_rate: dataset.contamination_rate,
        fragmentation_rate: dataset.fragmentation_rate,
        coherence_score: dataset.coherence_score,
      })),
    }, null, 2));
  });
});
