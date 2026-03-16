import { describe, expect, it } from 'vitest';
import { STORYCLUSTER_BENCHMARK_CORPUS } from './benchmarkCorpus';
import {
  STORYCLUSTER_KNOWN_EVENT_FIXTURE_DATASETS,
  STORYCLUSTER_KNOWN_EVENT_PAIR_EXPECTATIONS,
} from './benchmarkCorpusKnownEventFixtures';
import { STORYCLUSTER_REPLAY_SCENARIOS } from './benchmarkCorpusReplays';

describe('known-event benchmark corpus fixtures', () => {
  it('adds the real-article known-event datasets and pair expectations into the default corpus', () => {
    expect(STORYCLUSTER_KNOWN_EVENT_FIXTURE_DATASETS.map((dataset) => dataset.dataset_id)).toEqual([
      'fixture-known-event-live-public-pairs',
    ]);
    expect(STORYCLUSTER_KNOWN_EVENT_PAIR_EXPECTATIONS.map((pair) => pair.case_id)).toEqual([
      'known-event-extortion-bundle',
      'known-event-flag-burn-bundle',
      'known-event-prank-bundle',
      'known-event-white-house-facility-vs-flag-burn',
      'known-event-white-house-facility-vs-extortion',
    ]);
    expect(STORYCLUSTER_BENCHMARK_CORPUS.fixtureDatasets).toEqual(
      expect.arrayContaining(STORYCLUSTER_KNOWN_EVENT_FIXTURE_DATASETS),
    );
    expect(STORYCLUSTER_BENCHMARK_CORPUS.pairExpectations).toEqual(
      expect.arrayContaining(STORYCLUSTER_KNOWN_EVENT_PAIR_EXPECTATIONS),
    );
  });

  it('registers the real-article known-event replay scenarios in the default replay corpus', () => {
    expect(STORYCLUSTER_REPLAY_SCENARIOS.map((scenario) => scenario.scenario_id)).toEqual(
      expect.arrayContaining([
        'replay-known-event-extortion-gap-return',
        'replay-known-event-flag-burn-shadow-return',
        'replay-known-event-prank-source-growth',
      ]),
    );
  });
});
