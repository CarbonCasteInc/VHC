import type { StoryClusterReplayScenario } from './benchmarkCorpusReplays';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';

export const STORYCLUSTER_REPLAY_LONG_WINDOW_SCENARIOS: StoryClusterReplayScenario[] = [
  {
    scenario_id: 'replay-harbor-fire-double-shadow-return',
    topic_id: 'replay-harbor-fire-double-shadow-return',
    ticks: [
      [
        makeBenchmarkItem(
          'harbor_fire_double_shadow',
          'replay-gap-double-a',
          'Chemical fire at harbor terminal triggers midnight evacuations',
          'ri1',
          1_712_176_100_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'pipeline_blast_shadow',
          'replay-gap-double-b',
          'Pipeline blast disrupts refinery fuel shipments',
          'ri2',
          1_712_176_120_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_double_shadow',
          'replay-gap-double-c',
          'Inspectors return to harbor terminal after fire is contained',
          'ri3',
          1_712_176_140_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'rail_closure_shadow',
          'replay-gap-double-d',
          'Freight rail closure slows chemical deliveries inland',
          'ri4',
          1_712_176_160_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_double_shadow',
          'replay-gap-double-e',
          'Harbor terminal crews reopen docks after fire cleanup',
          'ri5',
          1_712_176_180_000,
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-harbor-fire-triple-shadow-return',
    topic_id: 'replay-harbor-fire-triple-shadow-return',
    ticks: [
      [
        makeBenchmarkItem(
          'harbor_fire_triple_shadow',
          'replay-gap-triple-a',
          'Chemical fire at harbor terminal triggers midnight evacuations',
          'rj1',
          1_712_176_200_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'pipeline_blast_shadow',
          'replay-gap-triple-b',
          'Pipeline blast disrupts refinery fuel shipments',
          'rj2',
          1_712_176_220_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_triple_shadow',
          'replay-gap-triple-c',
          'Inspectors return to harbor terminal after fire is contained',
          'rj3',
          1_712_176_240_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'rail_closure_shadow',
          'replay-gap-triple-d',
          'Freight rail closure slows chemical deliveries inland',
          'rj4',
          1_712_176_260_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_triple_shadow',
          'replay-gap-triple-e',
          'Harbor terminal crews reopen docks after fire cleanup',
          'rj5',
          1_712_176_280_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'tank_farm_shadow',
          'replay-gap-triple-f',
          'Tank farm leak halts fuel loading at adjacent depot',
          'rj6',
          1_712_176_300_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_triple_shadow',
          'replay-gap-triple-g',
          'Harbor fire investigators clear the final berth for reopening',
          'rj7',
          1_712_176_320_000,
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-harbor-fire-repeated-shadow-return',
    topic_id: 'replay-harbor-fire-repeated-shadow-return',
    ticks: [
      [
        makeBenchmarkItem(
          'harbor_fire_repeated_shadow',
          'replay-shadow-cycle-a',
          'Chemical fire at harbor terminal triggers midnight evacuations',
          'rk1',
          1_712_176_400_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'pipeline_blast_shadow',
          'replay-shadow-cycle-b',
          'Pipeline blast disrupts refinery fuel shipments',
          'rk3',
          1_712_176_420_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_repeated_shadow',
          'replay-shadow-cycle-c',
          'Inspectors return to harbor terminal after fire is contained',
          'rk4',
          1_712_176_440_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'pipeline_blast_shadow',
          'replay-shadow-cycle-d',
          'Refinery fuel shipments stay disrupted after the pipeline blast',
          'rk5',
          1_712_176_460_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_repeated_shadow',
          'replay-shadow-cycle-e',
          'Harbor terminal crews reopen docks after fire cleanup',
          'rk6',
          1_712_176_480_000,
        ),
      ],
    ],
  },
];
