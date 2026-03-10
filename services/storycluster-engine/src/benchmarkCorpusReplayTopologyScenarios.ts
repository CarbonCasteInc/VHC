import type { StoryClusterReplayScenario } from './benchmarkCorpusReplays';
import { replaceReplayTopicWithSeedClusters } from './liveBenchmarkReplayTopology';

export const STORYCLUSTER_REPLAY_TOPOLOGY_SCENARIOS: StoryClusterReplayScenario[] = [
  {
    scenario_id: 'replay-topology-correction-cycles',
    topic_id: 'replay-topology-correction-cycles',
    ticks: [[], [], [], []],
    before_tick: async ({ tick_index, store, topic_id }) => {
      if (tick_index === 0) {
        replaceReplayTopicWithSeedClusters(store, topic_id, [
          {
            story_id: 'story-anchor',
            sources: [
              {
                source_id: 'seed-merge-a1',
                url_hash: 'tm1',
                published_at: 1_712_177_000_000,
                title: 'Port attack closes the eastern terminal overnight',
                summary: 'Harbor officials confirm the eastern terminal remains shut after the port attack.',
                text: 'Port attack closes the eastern terminal overnight. Harbor officials confirm the eastern terminal remains shut after the port attack.',
                entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
                locations: ['harbor'],
                trigger: 'attack',
              },
            ],
          },
          {
            story_id: 'story-merge-shadow-1',
            sources: [
              {
                source_id: 'seed-merge-b1',
                url_hash: 'tm2',
                published_at: 1_712_177_020_000,
                title: 'Eastern berth closures widen after the overnight port attack',
                summary: 'The harbor authority extends berth closures after the same overnight port attack.',
                text: 'Eastern berth closures widen after the overnight port attack. The harbor authority extends berth closures after the same overnight port attack.',
                entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
                locations: ['harbor'],
                trigger: 'attack',
              },
            ],
          },
        ], 41);
        return;
      }

      if (tick_index === 1) {
        replaceReplayTopicWithSeedClusters(store, topic_id, [{
          story_id: 'story-anchor',
          lineage: { merged_from: ['story-merge-shadow-1'] },
          sources: [
            {
              source_id: 'seed-anchor-a',
              url_hash: 'ts1',
              published_at: 1_712_177_040_000,
              title: 'Port attack leaves cranes idle at the eastern terminal',
              summary: 'Investigators say the port attack halted cranes at the eastern terminal.',
              text: 'Port attack leaves cranes idle at the eastern terminal. Investigators say the port attack halted cranes at the eastern terminal.',
              entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
              locations: ['harbor'],
              trigger: 'attack',
            },
            {
              source_id: 'seed-anchor-b',
              url_hash: 'ts2',
              published_at: 1_712_177_050_000,
              title: 'Harbor crews inspect damaged loading arms after the port attack',
              summary: 'Harbor crews inspect damaged loading arms after the port attack.',
              text: 'Harbor crews inspect damaged loading arms after the port attack at the eastern terminal.',
              entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
              locations: ['harbor'],
              trigger: 'attack',
            },
            {
              source_id: 'seed-market-a',
              url_hash: 'ts3',
              published_at: 1_712_177_060_000,
              title: 'Stocks slide as insurers absorb new shipping losses',
              summary: 'Insurers warn that markets are sliding as shipping losses mount.',
              text: 'Stocks slide as insurers absorb new shipping losses. Insurers warn that markets are sliding as shipping losses mount.',
              entities: ['market_slump', 'shipping_insurers', 'shipping_losses'],
              locations: ['harbor'],
              trigger: 'slide',
            },
            {
              source_id: 'seed-market-b',
              url_hash: 'ts4',
              published_at: 1_712_177_070_000,
              title: 'Markets cut shipping forecasts after insurer losses deepen',
              summary: 'Analysts cut shipping forecasts as insurer losses deepen.',
              text: 'Markets cut shipping forecasts after insurer losses deepen. Analysts cut shipping forecasts as insurer losses deepen.',
              entities: ['market_slump', 'shipping_insurers', 'shipping_losses'],
              locations: ['harbor'],
              trigger: 'cut',
            },
          ],
        }], 61);
        return;
      }

      if (tick_index === 2) {
        replaceReplayTopicWithSeedClusters(store, topic_id, [
          {
            story_id: 'story-anchor',
            sources: [
              {
                source_id: 'seed-merge-c1',
                url_hash: 'tm3',
                published_at: 1_712_177_080_000,
                title: 'Port attack cleanup keeps the eastern terminal partly shut',
                summary: 'Cleanup continues at the eastern terminal after the port attack.',
                text: 'Port attack cleanup keeps the eastern terminal partly shut. Cleanup continues at the eastern terminal after the port attack.',
                entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
                locations: ['harbor'],
                trigger: 'attack',
              },
            ],
          },
          {
            story_id: 'story-merge-shadow-2',
            sources: [
              {
                source_id: 'seed-merge-d1',
                url_hash: 'tm4',
                published_at: 1_712_177_100_000,
                title: 'Harbor authority extends terminal closures after the same port attack',
                summary: 'The harbor authority extends terminal closures after the same port attack.',
                text: 'Harbor authority extends terminal closures after the same port attack at the eastern terminal.',
                entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
                locations: ['harbor'],
                trigger: 'attack',
              },
            ],
          },
        ], 81);
        return;
      }

      replaceReplayTopicWithSeedClusters(store, topic_id, [{
        story_id: 'story-anchor',
        lineage: { merged_from: ['story-merge-shadow-2'] },
        sources: [
          {
            source_id: 'seed-anchor-c',
            url_hash: 'ts5',
            published_at: 1_712_177_120_000,
            title: 'Port attack investigators reopen the eastern gate',
            summary: 'Investigators reopen one eastern gate after the port attack.',
            text: 'Port attack investigators reopen the eastern gate. Investigators reopen one eastern gate after the port attack.',
            entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
            locations: ['harbor'],
            trigger: 'attack',
          },
          {
            source_id: 'seed-anchor-d',
            url_hash: 'ts6',
            published_at: 1_712_177_130_000,
            title: 'Harbor crews clear containers after the port attack',
            summary: 'Harbor crews clear damaged containers after the port attack.',
            text: 'Harbor crews clear damaged containers after the port attack at the eastern terminal.',
            entities: ['port_attack', 'eastern_terminal', 'harbor_authority'],
            locations: ['harbor'],
            trigger: 'attack',
          },
          {
            source_id: 'seed-market-c',
            url_hash: 'ts7',
            published_at: 1_712_177_140_000,
            title: 'Markets slide again as insurers widen shipping loss forecasts',
            summary: 'Insurers widen shipping loss forecasts and markets slide again.',
            text: 'Markets slide again as insurers widen shipping loss forecasts. Insurers widen shipping loss forecasts and markets slide again.',
            entities: ['market_slump', 'shipping_insurers', 'shipping_losses'],
            locations: ['harbor'],
            trigger: 'slide',
          },
          {
            source_id: 'seed-market-d',
            url_hash: 'ts8',
            published_at: 1_712_177_150_000,
            title: 'Brokerages cut shipping outlooks as insurer losses return',
            summary: 'Brokerages cut shipping outlooks as insurer losses return.',
            text: 'Brokerages cut shipping outlooks as insurer losses return. Brokerages cut shipping outlooks as insurer losses return.',
            entities: ['market_slump', 'shipping_insurers', 'shipping_losses'],
            locations: ['harbor'],
            trigger: 'cut',
          },
        ],
      }], 101);
    },
  },
];
