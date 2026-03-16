import type { StoryClusterCoherenceThresholds } from './coherenceAudit';
import {
  STORYCLUSTER_FIXTURE_DATASETS,
  STORYCLUSTER_FIXTURE_PAIR_EXPECTATIONS,
  type StoryClusterBenchmarkPairExpectation,
} from './benchmarkCorpusFixtures';
import {
  STORYCLUSTER_KNOWN_EVENT_FIXTURE_DATASETS,
  STORYCLUSTER_KNOWN_EVENT_PAIR_EXPECTATIONS,
} from './benchmarkCorpusKnownEventFixtures';
import {
  STORYCLUSTER_KNOWN_EVENT_ONGOING_FIXTURE_DATASETS,
  STORYCLUSTER_KNOWN_EVENT_ONGOING_PAIR_EXPECTATIONS,
} from './benchmarkCorpusKnownEventOngoingFixtures';
import { STORYCLUSTER_REPLAY_SCENARIOS } from './benchmarkCorpusReplays';

export interface StoryClusterBenchmarkCorpus {
  fixtureThresholds: StoryClusterCoherenceThresholds;
  replayThresholds: StoryClusterCoherenceThresholds;
  fixtureDatasets: typeof STORYCLUSTER_FIXTURE_DATASETS;
  replayScenarios: typeof STORYCLUSTER_REPLAY_SCENARIOS;
  pairExpectations: readonly StoryClusterBenchmarkPairExpectation[];
}

export const STORYCLUSTER_BENCHMARK_CORPUS: StoryClusterBenchmarkCorpus = {
  fixtureThresholds: {
    max_contamination_rate: 0.02,
    max_fragmentation_rate: 0.05,
    min_coherence_score: 0.93,
  },
  replayThresholds: {
    max_contamination_rate: 0.05,
    max_fragmentation_rate: 0.08,
    min_coherence_score: 0.88,
  },
  fixtureDatasets: [
    ...STORYCLUSTER_FIXTURE_DATASETS,
    ...STORYCLUSTER_KNOWN_EVENT_FIXTURE_DATASETS,
    ...STORYCLUSTER_KNOWN_EVENT_ONGOING_FIXTURE_DATASETS,
  ],
  replayScenarios: STORYCLUSTER_REPLAY_SCENARIOS,
  pairExpectations: [
    ...STORYCLUSTER_FIXTURE_PAIR_EXPECTATIONS,
    ...STORYCLUSTER_KNOWN_EVENT_PAIR_EXPECTATIONS,
    ...STORYCLUSTER_KNOWN_EVENT_ONGOING_PAIR_EXPECTATIONS,
  ],
};
