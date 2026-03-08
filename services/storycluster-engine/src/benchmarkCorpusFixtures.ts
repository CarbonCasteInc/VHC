import type { StoryClusterCoherenceAuditDataset } from './coherenceAudit';
import type { StoryClusterPairLabel } from './pairOntology';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';

export interface StoryClusterBenchmarkPairExpectation {
  case_id: string;
  dataset_id: string;
  left_source_id: string;
  right_source_id: string;
  expected_label: StoryClusterPairLabel;
}

export const STORYCLUSTER_FIXTURE_DATASETS: StoryClusterCoherenceAuditDataset[] = [
  {
    dataset_id: 'fixture-multilingual-port-market',
    topic_id: 'fixture-multilingual-port-market',
    items: [
      makeBenchmarkItem('port_attack', 'wire-a', 'Port attack disrupts terminals overnight', 'a1', 1_710_100_000_000),
      makeBenchmarkItem('port_attack', 'wire-b', 'Officials say recovery talks begin Friday after port attack', 'a2', 1_710_100_020_000),
      makeBenchmarkItem('port_attack', 'wire-c', 'El gobierno confirmó nuevas sanciones tras el ataque al puerto', 'a3', 1_710_100_040_000, { language: 'es' }),
      makeBenchmarkItem('market_reaction', 'wire-d', 'Stocks slide after Tehran strike rattles insurers', 'b1', 1_710_100_060_000),
      makeBenchmarkItem('market_reaction', 'wire-e', 'Brokers revise shipping forecasts after the regional strike', 'b2', 1_710_100_080_000),
      makeBenchmarkItem('evacuation_updates', 'wire-f', 'Evacuation routes reopen after the refinery fire', 'c1', 1_710_100_090_000),
      makeBenchmarkItem('evacuation_updates', 'wire-g', 'Officials say refinery fire shelters stay open overnight', 'c2', 1_710_100_095_000),
      makeBenchmarkItem('diplomatic_followup', 'wire-h', 'Diplomatic talks resume after the sanctions dispute', 'd1', 1_710_100_120_000),
      makeBenchmarkItem('diplomatic_followup', 'wire-i', 'Summit aides prepare another round of sanctions talks', 'd2', 1_710_100_140_000),
    ],
  },
  {
    dataset_id: 'fixture-same-topic-trap-separation',
    topic_id: 'fixture-same-topic-trap-separation',
    items: [
      makeBenchmarkItem('market_aftershock', 'wire-j', 'Stocks slide after the overnight strike jolts shipping insurers', 'h1', 1_710_300_000_000),
      makeBenchmarkItem('market_aftershock', 'wire-k', 'Brokers cut shipping forecasts as markets absorb the strike', 'h2', 1_710_300_020_000),
      makeBenchmarkItem('opinion_commentary', 'desk-l', 'Opinion: how to think clearly before forming views on the conflict', 'i1', 1_710_300_040_000, { coverage_role: 'related' }),
      makeBenchmarkItem('ceasefire_vote', 'wire-m', 'Parliament schedules a ceasefire vote after the weekend attacks', 'j1', 1_710_300_060_000),
      makeBenchmarkItem('ceasefire_vote', 'wire-n', 'Coalition leaders whip support ahead of the ceasefire vote', 'j2', 1_710_300_080_000),
      makeBenchmarkItem('protest_crackdown', 'wire-o', 'Police detain protest leaders after the capital march turns violent', 'k1', 1_710_300_100_000),
      makeBenchmarkItem('protest_crackdown', 'wire-p', 'Capital courts review charges after protest arrests', 'k2', 1_710_300_120_000),
    ],
  },
  {
    dataset_id: 'fixture-liveblog-contamination',
    topic_id: 'fixture-liveblog-contamination',
    items: [
      makeBenchmarkItem('liveblog_port_attack', 'live-a', 'Live updates: port attack response minute by minute', 'l1', 1_710_400_000_000, { publisher: 'Live Desk', summary: 'Live updates and wire snippets from the port attack response.', coverage_role: 'related' }),
      makeBenchmarkItem('liveblog_port_attack', 'live-b', 'Live blog: emergency crews respond at the port overnight', 'l2', 1_710_400_010_000, { publisher: 'Live Desk', summary: 'Rolling live coverage from the port attack response.', coverage_role: 'related' }),
      makeBenchmarkItem('ceasefire_vote', 'wire-q', 'Parliament schedules a ceasefire vote after the attacks', 'l3', 1_710_400_030_000),
      makeBenchmarkItem('ceasefire_vote', 'wire-r', 'Coalition whips support before the ceasefire vote', 'l4', 1_710_400_050_000),
      makeBenchmarkItem('explainer_recap', 'desk-s', 'Explainer: what the weekend attacks mean for regional diplomacy', 'l5', 1_710_400_070_000, { coverage_role: 'related' }),
    ],
  },
  {
    dataset_id: 'fixture-entity-overlap-distinct',
    topic_id: 'fixture-entity-overlap-distinct',
    items: [
      makeBenchmarkItem('capital_budget', 'wire-t', 'Capital council approves the budget after an overnight session', 'm1', 1_710_500_000_000, { entity_keys: ['capital_budget', 'capital'] }),
      makeBenchmarkItem('capital_budget', 'wire-u', 'Mayor signs the new capital budget after the council vote', 'm2', 1_710_500_020_000, { entity_keys: ['capital_budget', 'capital'] }),
      makeBenchmarkItem('capital_protest', 'wire-v', 'Capital police detain march organizers after protest clashes', 'm3', 1_710_500_040_000, { entity_keys: ['capital_protest', 'capital'] }),
      makeBenchmarkItem('capital_protest', 'wire-w', 'Capital courts review charges after protest arrests', 'm4', 1_710_500_060_000, { entity_keys: ['capital_protest', 'capital'] }),
    ],
  },
  {
    dataset_id: 'fixture-recap-vs-breaking',
    topic_id: 'fixture-recap-vs-breaking',
    items: [
      makeBenchmarkItem('relief_convoy', 'wire-x', 'Relief convoy reaches the border crossing before dawn', 'n1', 1_710_600_000_000),
      makeBenchmarkItem('relief_convoy', 'wire-y', 'Aid groups confirm the convoy crossed before sunrise', 'n2', 1_710_600_020_000),
      makeBenchmarkItem('policy_recap', 'desk-z', 'Recap: how governments argued over border aid access this week', 'n3', 1_710_600_050_000, { coverage_role: 'related' }),
      makeBenchmarkItem('policy_recap', 'desk-aa', 'Explainer recap: the policy fight behind the border aid dispute', 'n4', 1_710_600_070_000, { coverage_role: 'related' }),
    ],
  },
  {
    dataset_id: 'fixture-geo-similar-distinct',
    topic_id: 'fixture-geo-similar-distinct',
    items: [
      makeBenchmarkItem('osaka_quake_response', 'wire-ab', 'Osaka rescue teams clear roads after the quake', 'o1', 1_710_700_000_000, { entity_keys: ['osaka_quake_response', 'osaka'] }),
      makeBenchmarkItem('osaka_quake_response', 'wire-ac', 'After the quake, Osaka officials reopen key roads', 'o2', 1_710_700_020_000, { entity_keys: ['osaka_quake_response', 'osaka'] }),
      makeBenchmarkItem('osaka_drill', 'wire-ad', 'Osaka hospitals run a citywide earthquake drill', 'o3', 1_710_700_050_000, { entity_keys: ['osaka_drill', 'osaka'] }),
      makeBenchmarkItem('osaka_drill', 'wire-ae', 'City officials review the Osaka emergency drill results', 'o4', 1_710_700_070_000, { entity_keys: ['osaka_drill', 'osaka'] }),
    ],
  },
  {
    dataset_id: 'fixture-image-reuse-distinct',
    topic_id: 'fixture-image-reuse-distinct',
    items: [
      makeBenchmarkItem('port_attack', 'wire-af', 'Port attack disrupts container traffic overnight', 'p1', 1_710_800_000_000, { image_hash: 'shared-image' }),
      makeBenchmarkItem('port_attack', 'wire-ag', 'Recovery talks begin after the port attack', 'p2', 1_710_800_020_000, { image_hash: 'shared-image' }),
      makeBenchmarkItem('protest_crackdown', 'wire-ah', 'Police detain protest leaders after the capital march', 'p3', 1_710_800_040_000, { image_hash: 'shared-image' }),
      makeBenchmarkItem('protest_crackdown', 'wire-ai', 'Capital courts review charges after protest arrests', 'p4', 1_710_800_060_000, { image_hash: 'shared-image' }),
    ],
  },
  {
    dataset_id: 'fixture-url-canonical-drift',
    topic_id: 'fixture-url-canonical-drift',
    items: [
      makeBenchmarkItem('ship_delays', 'wire-aj', 'Shipping delays deepen after the overnight strike', 'q1', 1_710_900_000_000, { canonicalUrl: 'https://example.com/shipping-live' }),
      makeBenchmarkItem('ship_delays', 'wire-ak', 'Carriers warn of longer shipping delays after the strike', 'q2', 1_710_900_020_000, { canonicalUrl: 'https://example.com/shipping-live' }),
      makeBenchmarkItem('ship_delays', 'wire-al', 'Insurers warn delays will continue after the port attack', 'q3', 1_710_900_040_000, { canonicalUrl: 'https://example.com/shipping-followup' }),
      makeBenchmarkItem('fuel_spike', 'wire-am', 'Fuel prices jump as traders price in the conflict risk', 'q4', 1_710_900_070_000),
      makeBenchmarkItem('fuel_spike', 'wire-an', 'Energy desks raise price forecasts after the overnight strike', 'q5', 1_710_900_090_000),
    ],
  },
  {
    dataset_id: 'fixture-sparse-singletons',
    topic_id: 'fixture-sparse-singletons',
    items: [
      makeBenchmarkItem('bridge_closure', 'wire-ao', 'Authorities close the bridge after a structural alarm', 'r1', 1_711_000_000_000),
      makeBenchmarkItem('wildfire_evacuation', 'wire-ap', 'Wildfire evacuation orders expand overnight', 'r2', 1_711_000_030_000),
      makeBenchmarkItem('trade_vote', 'wire-aq', 'Lawmakers delay the trade vote after procedural objections', 'r3', 1_711_000_060_000),
    ],
  },
  {
    dataset_id: 'fixture-verified-jan6-plaque-same-incident',
    topic_id: 'fixture-verified-jan6-plaque-same-incident',
    items: [
      makeBenchmarkItem('jan6_plaque_display', 'cbs-plaque-article', 'Jan. 6 plaque honoring police officers displayed at the Capitol after delay', 'jan6a', 1_711_100_000_000, { publisher: 'CBS' }),
      makeBenchmarkItem('jan6_plaque_display', 'cbs-plaque-video', 'Video shows Jan. 6 plaque honoring police officers displayed at the Capitol', 'jan6b', 1_711_100_030_000, { publisher: 'CBS' }),
    ],
  },
  {
    dataset_id: 'fixture-verified-iran-roundup-drone-strike-separation',
    topic_id: 'fixture-verified-iran-roundup-drone-strike-separation',
    items: [
      makeBenchmarkItem('iran_drone_strike', 'cbs-drone-strike', 'Armed Iranian opposition group says its camp was hit with drone strike', 'iran1', 1_711_200_000_000, { publisher: 'CBS', entity_keys: ['iran_drone_strike', 'iran', 'drone_strike'] }),
      makeBenchmarkItem('iran_drone_strike', 'wire-drone-followup', 'Opposition group says drone strike hit camp as regional fighting escalates', 'iran2', 1_711_200_040_000, { publisher: 'WIRE-IRAN', entity_keys: ['iran_drone_strike', 'iran', 'drone_strike'] }),
      makeBenchmarkItem('iran_conflict_roundup', 'guardian-roundup', 'Trump news at a glance: US leader says Iran being decimated; admits US troop deployment not off the table', 'iran3', 1_711_200_080_000, {
        publisher: 'Guardian',
        entity_keys: ['iran_conflict_roundup', 'iran', 'trump'],
        coverage_role: 'related',
      }),
    ],
  },
];

export const STORYCLUSTER_FIXTURE_PAIR_EXPECTATIONS: StoryClusterBenchmarkPairExpectation[] = [
  {
    case_id: 'same-topic-trap-market-pair',
    dataset_id: 'fixture-same-topic-trap-separation',
    left_source_id: 'wire-j',
    right_source_id: 'wire-k',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'same-topic-trap-market-vs-opinion',
    dataset_id: 'fixture-same-topic-trap-separation',
    left_source_id: 'wire-j',
    right_source_id: 'desk-l',
    expected_label: 'commentary_on_event',
  },
  {
    case_id: 'verified-jan6-plaque-article-video',
    dataset_id: 'fixture-verified-jan6-plaque-same-incident',
    left_source_id: 'cbs-plaque-article',
    right_source_id: 'cbs-plaque-video',
    expected_label: 'duplicate',
  },
  {
    case_id: 'verified-iran-drone-strike-roundup-separation',
    dataset_id: 'fixture-verified-iran-roundup-drone-strike-separation',
    left_source_id: 'cbs-drone-strike',
    right_source_id: 'guardian-roundup',
    expected_label: 'related_topic_only',
  },
  {
    case_id: 'verified-iran-drone-strike-followup-bundle',
    dataset_id: 'fixture-verified-iran-roundup-drone-strike-separation',
    left_source_id: 'cbs-drone-strike',
    right_source_id: 'wire-drone-followup',
    expected_label: 'same_incident',
  },
];
