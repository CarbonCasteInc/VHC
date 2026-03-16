import type { StoryClusterCoherenceAuditDataset } from './coherenceAudit';
import type { StoryClusterPairLabel } from './pairOntology';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';

export interface StoryClusterKnownEventPairExpectation {
  case_id: string;
  dataset_id: string;
  left_source_id: string;
  right_source_id: string;
  expected_label: StoryClusterPairLabel;
}

export const STORYCLUSTER_KNOWN_EVENT_FIXTURE_DATASETS: StoryClusterCoherenceAuditDataset[] = [
  {
    dataset_id: 'fixture-known-event-live-public-pairs',
    topic_id: 'fixture-known-event-live-public-pairs',
    items: [
      makeBenchmarkItem(
        'pardon_lobbyist_extortion_case',
        'ap-extortion',
        'A pardon lobbyist, $500,000 demand and alleged ‘enforcer’ lead to extortion charge in New York',
        'e6cf1dcf',
        1_773_513_414_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/new-york-lobbyist-extortion-charge-2c1ce8e9c85fc0e54418dd5d01c7042b',
          canonicalUrl: 'https://apnews.com/article/new-york-lobbyist-extortion-charge-2c1ce8e9c85fc0e54418dd5d01c7042b',
          entity_keys: ['pardon_lobbyist_extortion_case', 'joshua_nass', 'attempted_extortion', 'new_york'],
          cluster_text: 'A pardon lobbyist and an alleged enforcer were charged in New York after prosecutors said they tried to extort a target for $500,000.',
        },
      ),
      makeBenchmarkItem(
        'pardon_lobbyist_extortion_case',
        'cnn-extortion',
        'Lobbyist tied to pardon from Trump charged with attempted extortion',
        '206c1897',
        1_773_580_329_000,
        {
          publisher: 'CNN Politics',
          url: 'https://www.cnn.com/2026/03/14/politics/joshua-nass-lobbyist-charged',
          canonicalUrl: 'https://www.cnn.com/2026/03/14/politics/joshua-nass-lobbyist-charged',
          entity_keys: ['pardon_lobbyist_extortion_case', 'joshua_nass', 'attempted_extortion', 'donald_trump'],
          cluster_text: 'A lobbyist tied to a Trump pardon was charged with attempted extortion in New York over an alleged $500,000 demand.',
        },
      ),
      makeBenchmarkItem(
        'white_house_flag_burning_case',
        'cbs-flag-burn',
        'DOJ moves to drop charges against man who burned American flag outside White House',
        'c82c83f9',
        1_773_458_817_000,
        {
          publisher: 'CBS News',
          url: 'https://www.cbsnews.com/news/doj-moves-drop-charges-man-burned-us-flag-outside-white-house',
          canonicalUrl: 'https://www.cbsnews.com/news/doj-moves-drop-charges-man-burned-us-flag-outside-white-house',
          entity_keys: ['white_house_flag_burning_case', 'jan_carey', 'white_house', 'american_flag'],
          cluster_text: 'The Justice Department moved to dismiss charges against Jan Carey for burning an American flag outside the White House.',
        },
      ),
      makeBenchmarkItem(
        'white_house_flag_burning_case',
        'nbc-flag-burn',
        'DOJ drops case against veteran arrested after burning U.S. flag near White House',
        '1e26a659',
        1_773_456_513_000,
        {
          publisher: 'NBC News',
          url: 'https://www.nbcnews.com/politics/justice-department/drops-case-veteran-carey-arrested-burning-american-flag-white-house-rcna263438',
          canonicalUrl: 'https://www.nbcnews.com/politics/justice-department/drops-case-veteran-carey-arrested-burning-american-flag-white-house-rcna263438',
          entity_keys: ['white_house_flag_burning_case', 'jan_carey', 'white_house', 'american_flag'],
          cluster_text: 'The DOJ dropped the case against Jan Carey after his arrest for burning a U.S. flag near the White House.',
        },
      ),
      makeBenchmarkItem(
        'white_house_screening_facility_plan',
        'cnn-white-house-facility',
        'Trump seeks to replace White House visitor screening center with underground facility',
        'c84f2a10',
        1_773_575_648_000,
        {
          publisher: 'CNN Politics',
          url: 'https://www.cnn.com/2026/03/14/politics/white-house-screening-center-underground-facility',
          canonicalUrl: 'https://www.cnn.com/2026/03/14/politics/white-house-screening-center-underground-facility',
          entity_keys: ['white_house_screening_facility_plan', 'white_house', 'visitor_screening_center', 'underground_facility'],
          cluster_text: 'Trump wants to replace the White House visitor screening center with an underground facility as part of a site redesign.',
        },
      ),
      makeBenchmarkItem(
        'teacher_prank_death_case',
        'bbc-prank-death',
        'Charges dropped against teens whose teacher died during toilet paper prank',
        'bbc-prank-01',
        1_773_517_201_000,
        {
          publisher: 'BBC News',
          url: 'https://www.bbc.com/news/articles/teacher-prank-charge-dropped',
          canonicalUrl: 'https://www.bbc.com/news/articles/teacher-prank-charge-dropped',
          entity_keys: ['teacher_prank_death_case', 'teacher_prank', 'criminal_charge', 'teen_defendants'],
          cluster_text: 'Prosecutors dropped charges against teens after a teacher died during a toilet paper prank when he slipped and was hit by a vehicle.',
        },
      ),
      makeBenchmarkItem(
        'teacher_prank_death_case',
        'huffpost-prank-death',
        'Prosecutor Drops Criminal Charge Against Teen After Teacher Dies In Prank Mishap',
        'huff-prank-01',
        1_773_487_927_000,
        {
          publisher: 'HuffPost',
          url: 'https://www.huffpost.com/entry/prosecutor-drops-criminal-charge-against-teen-after-teacher-dies-in-prank-mishap_n_69b48548e4b0676e64bf885c',
          canonicalUrl: 'https://www.huffpost.com/entry/prosecutor-drops-criminal-charge-against-teen-after-teacher-dies-in-prank-mishap_n_69b48548e4b0676e64bf885c',
          entity_keys: ['teacher_prank_death_case', 'teacher_prank', 'criminal_charge', 'teen_defendants'],
          cluster_text: 'A prosecutor dropped a criminal charge against a teen after a teacher died during a prank mishap involving a fall and a passing vehicle.',
        },
      ),
    ],
  },
];

export const STORYCLUSTER_KNOWN_EVENT_PAIR_EXPECTATIONS: StoryClusterKnownEventPairExpectation[] = [
  {
    case_id: 'known-event-extortion-bundle',
    dataset_id: 'fixture-known-event-live-public-pairs',
    left_source_id: 'ap-extortion',
    right_source_id: 'cnn-extortion',
    expected_label: 'same_incident',
  },
  {
    case_id: 'known-event-flag-burn-bundle',
    dataset_id: 'fixture-known-event-live-public-pairs',
    left_source_id: 'cbs-flag-burn',
    right_source_id: 'nbc-flag-burn',
    expected_label: 'same_incident',
  },
  {
    case_id: 'known-event-prank-bundle',
    dataset_id: 'fixture-known-event-live-public-pairs',
    left_source_id: 'bbc-prank-death',
    right_source_id: 'huffpost-prank-death',
    expected_label: 'same_incident',
  },
  {
    case_id: 'known-event-white-house-facility-vs-flag-burn',
    dataset_id: 'fixture-known-event-live-public-pairs',
    left_source_id: 'cnn-white-house-facility',
    right_source_id: 'cbs-flag-burn',
    expected_label: 'related_topic_only',
  },
  {
    case_id: 'known-event-white-house-facility-vs-extortion',
    dataset_id: 'fixture-known-event-live-public-pairs',
    left_source_id: 'cnn-white-house-facility',
    right_source_id: 'ap-extortion',
    expected_label: 'related_topic_only',
  },
];
