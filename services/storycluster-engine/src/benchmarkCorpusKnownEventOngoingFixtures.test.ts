import { describe, expect, it } from 'vitest';
import { STORYCLUSTER_BENCHMARK_CORPUS } from './benchmarkCorpus';
import {
  STORYCLUSTER_KNOWN_EVENT_ONGOING_FIXTURE_DATASETS,
  STORYCLUSTER_KNOWN_EVENT_ONGOING_PAIR_EXPECTATIONS,
} from './benchmarkCorpusKnownEventOngoingFixtures';
import { STORYCLUSTER_REPLAY_SCENARIOS } from './benchmarkCorpusReplays';

describe('known-event ongoing benchmark corpus fixtures', () => {
  it('adds the real-article ongoing-event datasets and pair expectations into the default corpus', () => {
    expect(STORYCLUSTER_KNOWN_EVENT_ONGOING_FIXTURE_DATASETS.map((dataset) => dataset.dataset_id)).toEqual([
      'fixture-known-event-ongoing-kennedy-center',
      'fixture-known-event-ongoing-fed-powell',
      'fixture-known-event-ongoing-flag-burn-order-fallout',
      'fixture-known-event-ongoing-teacher-prank-fallout',
      'fixture-known-event-ongoing-fani-willis-fallout',
    ]);
    expect(STORYCLUSTER_KNOWN_EVENT_ONGOING_PAIR_EXPECTATIONS.map((pair) => pair.case_id)).toEqual([
      'known-event-ongoing-kennedy-closure-staff-cuts',
      'known-event-ongoing-kennedy-staff-cuts-grenell-step-down',
      'known-event-ongoing-kennedy-grenell-board-showdown',
      'known-event-ongoing-kennedy-interview-vs-board',
      'known-event-ongoing-fed-subpoena-backlash',
      'known-event-ongoing-fed-subpoena-quash',
      'known-event-ongoing-fed-backlash-quash',
      'known-event-ongoing-fed-explainer-vs-quash',
      'known-event-ongoing-flag-ban-vs-dismissal',
      'known-event-ongoing-prank-charge-vs-dismissal',
      'known-event-ongoing-willis-fees-vs-bills',
      'known-event-ongoing-willis-bills-vs-wade-hearing',
      'known-event-ongoing-willis-fees-vs-wade-hearing',
    ]);
    expect(STORYCLUSTER_BENCHMARK_CORPUS.fixtureDatasets).toEqual(
      expect.arrayContaining(STORYCLUSTER_KNOWN_EVENT_ONGOING_FIXTURE_DATASETS),
    );
    expect(STORYCLUSTER_BENCHMARK_CORPUS.pairExpectations).toEqual(
      expect.arrayContaining(STORYCLUSTER_KNOWN_EVENT_ONGOING_PAIR_EXPECTATIONS),
    );
  });

  it('registers the real-article ongoing-event replay scenarios in the default replay corpus', () => {
    expect(STORYCLUSTER_REPLAY_SCENARIOS.map((scenario) => scenario.scenario_id)).toEqual(
      expect.arrayContaining([
        'replay-known-event-kennedy-center-ongoing-arc',
        'replay-known-event-fed-powell-gap-return',
        'replay-known-event-flag-burn-order-gap-return',
        'replay-known-event-teacher-prank-charge-drop',
        'replay-known-event-fani-willis-postdismissal-arc',
      ]),
    );
  });
});
