import { makeBenchmarkItem } from './benchmarkCorpusBuilders';
import type { StoryClusterReplayScenario } from './benchmarkCorpusReplayTypes';

export const STORYCLUSTER_REPLAY_KNOWN_EVENT_SCENARIOS: StoryClusterReplayScenario[] = [
  {
    scenario_id: 'replay-known-event-extortion-gap-return',
    topic_id: 'replay-known-event-extortion-gap-return',
    ticks: [
      [
        makeBenchmarkItem(
          'pardon_lobbyist_extortion_case',
          'ap-extortion-replay',
          'A pardon lobbyist, $500,000 demand and alleged ‘enforcer’ lead to extortion charge in New York',
          're-extortion-a',
          1_773_513_414_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/new-york-lobbyist-extortion-charge-2c1ce8e9c85fc0e54418dd5d01c7042b',
            canonicalUrl: 'https://apnews.com/article/new-york-lobbyist-extortion-charge-2c1ce8e9c85fc0e54418dd5d01c7042b',
            entity_keys: ['pardon_lobbyist_extortion_case', 'joshua_nass', 'attempted_extortion', 'new_york'],
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'pardon_lobbyist_extortion_case',
          'cnn-extortion-replay',
          'Lobbyist tied to pardon from Trump charged with attempted extortion',
          're-extortion-b',
          1_773_580_329_000,
          {
            publisher: 'CNN Politics',
            url: 'https://www.cnn.com/2026/03/14/politics/joshua-nass-lobbyist-charged',
            canonicalUrl: 'https://www.cnn.com/2026/03/14/politics/joshua-nass-lobbyist-charged',
            entity_keys: ['pardon_lobbyist_extortion_case', 'joshua_nass', 'attempted_extortion', 'donald_trump'],
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-flag-burn-shadow-return',
    topic_id: 'replay-known-event-flag-burn-shadow-return',
    ticks: [
      [
        makeBenchmarkItem(
          'white_house_flag_burning_case',
          'cbs-flag-burn-replay',
          'DOJ moves to drop charges against man who burned American flag outside White House',
          're-flag-burn-a',
          1_773_458_817_000,
          {
            publisher: 'CBS News',
            url: 'https://www.cbsnews.com/news/doj-moves-drop-charges-man-burned-us-flag-outside-white-house',
            canonicalUrl: 'https://www.cbsnews.com/news/doj-moves-drop-charges-man-burned-us-flag-outside-white-house',
            entity_keys: ['white_house_flag_burning_case', 'jan_carey', 'white_house', 'american_flag'],
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'white_house_screening_facility_plan',
          'cnn-white-house-facility-replay',
          'Trump seeks to replace White House visitor screening center with underground facility',
          're-white-house-facility-a',
          1_773_575_648_000,
          {
            publisher: 'CNN Politics',
            url: 'https://www.cnn.com/2026/03/14/politics/white-house-screening-center-underground-facility',
            canonicalUrl: 'https://www.cnn.com/2026/03/14/politics/white-house-screening-center-underground-facility',
            entity_keys: ['white_house_screening_facility_plan', 'white_house', 'visitor_screening_center', 'underground_facility'],
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'white_house_flag_burning_case',
          'nbc-flag-burn-replay',
          'DOJ drops case against veteran arrested after burning U.S. flag near White House',
          're-flag-burn-b',
          1_773_456_513_000,
          {
            publisher: 'NBC News',
            url: 'https://www.nbcnews.com/politics/justice-department/drops-case-veteran-carey-arrested-burning-american-flag-white-house-rcna263438',
            canonicalUrl: 'https://www.nbcnews.com/politics/justice-department/drops-case-veteran-carey-arrested-burning-american-flag-white-house-rcna263438',
            entity_keys: ['white_house_flag_burning_case', 'jan_carey', 'white_house', 'american_flag'],
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-prank-source-growth',
    topic_id: 'replay-known-event-prank-source-growth',
    ticks: [
      [
        makeBenchmarkItem(
          'teacher_prank_death_case',
          'bbc-prank-replay',
          'Charges dropped against teens whose teacher died during toilet paper prank',
          're-prank-a',
          1_773_517_201_000,
          {
            publisher: 'BBC News',
            url: 'https://www.bbc.com/news/articles/teacher-prank-charge-dropped',
            canonicalUrl: 'https://www.bbc.com/news/articles/teacher-prank-charge-dropped',
            entity_keys: ['teacher_prank_death_case', 'teacher_prank', 'criminal_charge', 'teen_defendants'],
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'teacher_prank_death_case',
          'huffpost-prank-replay',
          'Prosecutor Drops Criminal Charge Against Teen After Teacher Dies In Prank Mishap',
          're-prank-b',
          1_773_487_927_000,
          {
            publisher: 'HuffPost',
            url: 'https://www.huffpost.com/entry/prosecutor-drops-criminal-charge-against-teen-after-teacher-dies-in-prank-mishap_n_69b48548e4b0676e64bf885c',
            canonicalUrl: 'https://www.huffpost.com/entry/prosecutor-drops-criminal-charge-against-teen-after-teacher-dies-in-prank-mishap_n_69b48548e4b0676e64bf885c',
            entity_keys: ['teacher_prank_death_case', 'teacher_prank', 'criminal_charge', 'teen_defendants'],
          },
        ),
      ],
    ],
  },
];
