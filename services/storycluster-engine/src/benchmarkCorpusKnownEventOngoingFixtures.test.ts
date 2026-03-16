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
      'fixture-known-event-ongoing-eric-adams-dismissal',
      'fixture-known-event-ongoing-mahmoud-khalil',
      'fixture-known-event-ongoing-abrego-garcia',
      'fixture-known-event-ongoing-rumeysa-ozturk',
      'fixture-known-event-ongoing-mohsen-mahdawi',
      'fixture-known-event-ongoing-ras-baraka',
      'fixture-known-event-ongoing-voice-of-america',
      'fixture-known-event-ongoing-harvard-foreign-students',
      'fixture-known-event-ongoing-yunseo-chung',
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
      'known-event-ongoing-adams-doj-vs-hearing',
      'known-event-ongoing-adams-doj-vs-dismissed',
      'known-event-ongoing-adams-hearing-vs-dismissed',
      'known-event-ongoing-khalil-detention-vs-deportation-ruling',
      'known-event-ongoing-abrego-lawsuit-vs-pretrial-detention',
      'known-event-ongoing-ozturk-transfer-vs-return',
      'known-event-ongoing-ozturk-return-vs-release',
      'known-event-ongoing-mahdawi-arrest-vs-hearing',
      'known-event-ongoing-mahdawi-hearing-vs-release',
      'known-event-ongoing-baraka-arrest-vs-hearing',
      'known-event-ongoing-baraka-hearing-vs-lawsuit',
      'known-event-ongoing-voa-firing-vs-dismantling',
      'known-event-ongoing-voa-dismantling-vs-restore-order',
      'known-event-ongoing-voa-restore-order-vs-job-cuts',
      'known-event-ongoing-harvard-ban-vs-extension',
      'known-event-ongoing-harvard-extension-vs-hosting-order',
      'known-event-ongoing-chung-lawsuit-vs-detention-order',
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
        'replay-known-event-eric-adams-dismissal-arc',
        'replay-known-event-mahmoud-khalil-gap-return',
        'replay-known-event-abrego-garcia-gap-return',
        'replay-known-event-rumeysa-ozturk-arc',
        'replay-known-event-mohsen-mahdawi-arc',
        'replay-known-event-ras-baraka-arc',
        'replay-known-event-voice-of-america-arc',
        'replay-known-event-harvard-foreign-students-arc',
        'replay-known-event-yunseo-chung-arc',
      ]),
    );
  });
});
