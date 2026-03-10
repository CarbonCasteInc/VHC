import type { StoryClusterCoherenceAuditItem } from './coherenceAudit';
import type { ClusterStore } from './clusterStore';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';
import { STORYCLUSTER_REPLAY_LONG_WINDOW_SCENARIOS } from './benchmarkCorpusReplayLongWindowScenarios';
import { STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS } from './benchmarkCorpusReplayTopologyScenarios';
import type { StoryClusterRemoteResponse } from './remoteContract';
import type { StoryClusterStageRunnerOptions } from './stageRunner';

export interface StoryClusterReplayTickHookContext {
  scenario_id: string;
  topic_id: string;
  tick_index: number;
  store: ClusterStore;
  remoteRunner: (
    payload: unknown,
    options?: StoryClusterStageRunnerOptions,
  ) => Promise<StoryClusterRemoteResponse>;
}

export type StoryClusterReplayTickHook = (
  context: StoryClusterReplayTickHookContext,
) => Promise<void> | void;

export interface StoryClusterReplayScenario {
  scenario_id: string;
  topic_id: string;
  ticks: StoryClusterCoherenceAuditItem[][];
  before_tick?: StoryClusterReplayTickHook;
}

const STORYCLUSTER_REPLAY_BASE_SCENARIOS: StoryClusterReplayScenario[] = [
  {
    scenario_id: 'replay-port-attack-expansion',
    topic_id: 'replay-port-attack-expansion',
    ticks: [
      [
        makeBenchmarkItem('port_attack', 'replay-a', 'Port attack disrupts terminals overnight', 'ra1', 1_712_000_000_000),
        makeBenchmarkItem('port_attack', 'replay-b', 'Officials say recovery talks begin Friday after port attack', 'ra2', 1_712_000_020_000),
      ],
      [makeBenchmarkItem('port_attack', 'replay-c', 'El gobierno confirmó nuevas sanciones tras el ataque al puerto', 'ra3', 1_712_000_040_000, { language: 'es' })],
      [makeBenchmarkItem('port_attack', 'replay-d', 'Insurers warn delays will continue after port attack', 'ra4', 1_712_000_060_000)],
    ],
  },
  {
    scenario_id: 'replay-capital-blackout-source-growth',
    topic_id: 'replay-capital-blackout-source-growth',
    ticks: [
      [
        makeBenchmarkItem(
          'capital_blackout',
          'replay-n',
          'Substation blast cuts power across capital districts',
          'rd1',
          1_712_050_000_000,
          {
            publisher: 'WIRE-N',
            cluster_text: 'A substation failure cut electricity across several capital districts and forced hospitals onto backup generators.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'capital_blackout',
          'replay-o',
          'Hospitals switch to generators as capital blackout spreads',
          'rd2',
          1_712_050_020_000,
          {
            publisher: 'WIRE-O',
            cluster_text: 'Hospitals switched to backup generators as the same capital blackout spread after the substation failure.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'capital_blackout',
          'replay-p',
          'Apagón deja hospitales y barrios sin luz tras falla en subestación',
          'rd3',
          1_712_050_040_000,
          {
            publisher: 'WIRE-P',
            language: 'es',
            translation_applied: true,
            cluster_text: 'The capital blackout left hospitals and neighborhoods without electricity after the same substation failure.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'capital_blackout',
          'replay-q',
          'Crews replace damaged gear as capital blackout enters second day',
          'rd4',
          1_712_050_060_000,
          {
            publisher: 'WIRE-Q',
            cluster_text: 'Repair crews replaced damaged switching gear as the same capital blackout entered a second day.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-market-opinion-separation',
    topic_id: 'replay-market-opinion-separation',
    ticks: [
      [
        makeBenchmarkItem('market_aftershock', 'replay-e', 'Stocks slide after the overnight strike jolts shipping insurers', 'rb1', 1_712_100_000_000),
        makeBenchmarkItem('market_aftershock', 'replay-f', 'Brokers cut shipping forecasts as markets absorb the strike', 'rb2', 1_712_100_020_000),
      ],
      [makeBenchmarkItem('opinion_commentary', 'replay-g', 'Opinion: how to think clearly before forming views on the conflict', 'rb3', 1_712_100_040_000, { coverage_role: 'related' })],
      [makeBenchmarkItem('market_aftershock', 'replay-h', 'Insurers hedge against prolonged shipping disruption after the strike', 'rb4', 1_712_100_060_000)],
    ],
  },
  {
    scenario_id: 'replay-harbor-fire-headline-drift',
    topic_id: 'replay-harbor-fire-headline-drift',
    ticks: [
      [
        makeBenchmarkItem(
          'harbor_fire',
          'replay-r',
          'Chemical fire at harbor terminal triggers midnight evacuations',
          're1',
          1_712_150_000_000,
          {
            publisher: 'WIRE-R',
            cluster_text: 'A chemical fire at the harbor terminal triggered overnight evacuations after drums ignited near the loading bay.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire',
          'replay-s',
          'Residents told to shelter away from smoke near the harbor',
          're2',
          1_712_150_020_000,
          {
            publisher: 'WIRE-S',
            cluster_text: 'Residents were told to shelter away from smoke after the same chemical fire at the harbor terminal.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire',
          'replay-t',
          'Inspectors enter burned warehouse after harbor blaze is contained',
          're3',
          1_712_150_040_000,
          {
            publisher: 'WIRE-T',
            cluster_text: 'Inspectors entered the burned warehouse after the same harbor terminal fire was contained and the evacuation zone remained in place.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-harbor-fire-gap-return',
    topic_id: 'replay-harbor-fire-gap-return',
    ticks: [
      [
        makeBenchmarkItem(
          'harbor_fire_gap',
          'replay-gap-a',
          'Chemical fire at harbor terminal triggers midnight evacuations',
          'rg1',
          1_712_175_000_000,
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'harbor_fire_gap',
          'replay-gap-b',
          'Inspectors return to harbor terminal after fire is contained',
          'rg2',
          1_712_175_040_000,
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-harbor-fire-gap-shadow',
    topic_id: 'replay-harbor-fire-gap-shadow',
    ticks: [
      [
        makeBenchmarkItem(
          'harbor_fire_gap_shadow',
          'replay-gap-shadow-a',
          'Chemical fire at harbor terminal triggers midnight evacuations',
          'rh1',
          1_712_176_000_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'pipeline_blast_shadow',
          'replay-gap-shadow-b',
          'Pipeline blast disrupts refinery fuel shipments',
          'rh2',
          1_712_176_020_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'harbor_fire_gap_shadow',
          'replay-gap-shadow-c',
          'Inspectors return to harbor terminal after fire is contained',
          'rh3',
          1_712_176_040_000,
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-ceasefire-protest-separation',
    topic_id: 'replay-ceasefire-protest-separation',
    ticks: [
      [
        makeBenchmarkItem('ceasefire_vote', 'replay-i', 'Parliament schedules a ceasefire vote after the weekend attacks', 'rc1', 1_712_200_000_000),
        makeBenchmarkItem('ceasefire_vote', 'replay-j', 'Coalition leaders whip support ahead of the ceasefire vote', 'rc2', 1_712_200_020_000),
      ],
      [
        makeBenchmarkItem('protest_crackdown', 'replay-k', 'Police detain protest leaders after the capital march turns violent', 'rc3', 1_712_200_040_000),
        makeBenchmarkItem('protest_crackdown', 'replay-l', 'Capital courts review charges after protest arrests', 'rc4', 1_712_200_060_000),
      ],
      [makeBenchmarkItem('ceasefire_vote', 'replay-m', 'Lawmakers prepare final amendments before the ceasefire vote', 'rc5', 1_712_200_080_000)],
    ],
  },
  {
    scenario_id: 'replay-geneva-headline-drift',
    topic_id: 'replay-geneva-headline-drift',
    ticks: [
      [
        makeBenchmarkItem(
          'geneva_talks',
          'replay-n',
          'Emergency Geneva talks begin after overnight missile strike hits fuel depots',
          'rd1',
          1_712_300_000_000,
        ),
        makeBenchmarkItem(
          'geneva_talks',
          'replay-o',
          'Mediators convene in Geneva after overnight strike damages fuel depots',
          'rd2',
          1_712_300_020_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'geneva_talks',
          'replay-p',
          'Gobiernos europeos reanudan las conversaciones de Ginebra tras el ataque nocturno',
          'rd3',
          1_712_300_040_000,
          { language: 'es' },
        ),
      ],
      [
        makeBenchmarkItem(
          'geneva_talks',
          'replay-q',
          'Diplomats race to keep Geneva ceasefire talks alive after depot strike',
          'rd4',
          1_712_300_060_000,
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-port-strike-recap-separation',
    topic_id: 'replay-port-strike-recap-separation',
    ticks: [
      [
        makeBenchmarkItem(
          'port_strike_day_two',
          'replay-r',
          'Dockworkers extend the Atlantic port strike into a second day',
          're1',
          1_712_400_000_000,
        ),
        makeBenchmarkItem(
          'port_strike_day_two',
          'replay-s',
          'Atlantic shipping delays deepen as the port strike enters day two',
          're2',
          1_712_400_020_000,
        ),
      ],
      [
        makeBenchmarkItem(
          'port_strike_recap',
          'replay-t',
          'Recap: how the Atlantic port strike changed overnight',
          're3',
          1_712_400_040_000,
          { coverage_role: 'related' },
        ),
      ],
      [
        makeBenchmarkItem(
          'port_strike_day_two',
          'replay-u',
          'Talks resume as Atlantic port strike moves toward a third day',
          're4',
          1_712_400_060_000,
        ),
      ],
    ],
  },
];

export const STORYCLUSTER_REPLAY_SCENARIOS: StoryClusterReplayScenario[] = [
  ...STORYCLUSTER_REPLAY_BASE_SCENARIOS,
  ...STORYCLUSTER_REPLAY_LONG_WINDOW_SCENARIOS,
  ...STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS,
];
