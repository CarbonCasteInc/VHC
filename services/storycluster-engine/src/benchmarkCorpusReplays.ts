import type { StoryClusterCoherenceAuditItem } from './coherenceAudit';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';

export interface StoryClusterReplayScenario {
  scenario_id: string;
  topic_id: string;
  ticks: StoryClusterCoherenceAuditItem[][];
}

export const STORYCLUSTER_REPLAY_SCENARIOS: StoryClusterReplayScenario[] = [
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
