import { makeBenchmarkItem } from './benchmarkCorpusBuilders';
import type { StoryClusterReplayScenario } from './benchmarkCorpusReplayTypes';

export const STORYCLUSTER_REPLAY_KNOWN_EVENT_ONGOING_SCENARIOS: StoryClusterReplayScenario[] = [
  {
    scenario_id: 'replay-known-event-kennedy-center-ongoing-arc',
    topic_id: 'replay-known-event-kennedy-center-ongoing-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'kennedy_center_takeover_episode',
          'pbs-kennedy-closure-replay',
          'Kennedy Center to close for 2 years for renovations in July, Trump says, after wave of cancellations',
          'kennedy-closure-replay-a',
          1_770_531_360_000,
          {
            publisher: 'PBS News',
            url: 'https://www.pbs.org/newshour/politics/kennedy-center-to-close-for-2-years-for-renovations-in-july-trump-says-after-wave-of-cancellations',
            canonicalUrl: 'https://www.pbs.org/newshour/politics/kennedy-center-to-close-for-2-years-for-renovations-in-july-trump-says-after-wave-of-cancellations',
            entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'renovation_closure', 'richard_grenell'],
            cluster_text: 'Trump said the Kennedy Center would close for two years for renovations, starting the same Kennedy Center takeover and closure episode that later brought staffing cuts, leadership turmoil, and board conflict.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'kennedy_center_takeover_episode',
          'ap-kennedy-staff-cuts-replay',
          "Kennedy Center head warns staff of cuts and 'skeletal' staffing during renovation closure",
          'kennedy-staff-cuts-replay-b',
          1_771_338_164_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/9eb9e9fa2368c3eb6fad1c57a90c3407',
            canonicalUrl: 'https://apnews.com/article/9eb9e9fa2368c3eb6fad1c57a90c3407',
            entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'renovation_closure', 'richard_grenell'],
            cluster_text: 'Richard Grenell warned Kennedy Center staff that the same two-year renovation closure would bring cuts and skeletal staffing.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'kennedy_center_takeover_episode',
          'ap-kennedy-grenell-step-down-replay',
          'Trump ally Ric Grenell stepping down as Kennedy Center president',
          'kennedy-grenell-step-down-replay-c',
          1_773_514_126_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/6bf4f74ea5f0e80abf8f9c181cdd431a',
            canonicalUrl: 'https://apnews.com/article/6bf4f74ea5f0e80abf8f9c181cdd431a',
            entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'richard_grenell', 'board_meeting'],
            cluster_text: 'Richard Grenell said he was stepping down as Kennedy Center president during the same Kennedy Center takeover fight over the renovation closure and board control.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'kennedy_center_takeover_episode',
          'ap-kennedy-board-showdown-replay',
          'A seat at the table, but no vote yet for a Democratic lawmaker in the Kennedy Center board showdown',
          'kennedy-board-showdown-replay-d',
          1_773_584_235_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/53d19b342753174b9a90b9c21aa9fa0c',
            canonicalUrl: 'https://apnews.com/article/53d19b342753174b9a90b9c21aa9fa0c',
            entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'richard_grenell', 'board_meeting'],
            cluster_text: 'A judge let a Democratic lawmaker attend the same Kennedy Center board showdown tied to Grenell, the renovation closure plan, and Trump’s takeover of the institution.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-fed-powell-gap-return',
    topic_id: 'replay-known-event-fed-powell-gap-return',
    ticks: [
      [
        makeBenchmarkItem(
          'fed_powell_subpoena_episode',
          'ap-fed-subpoena-replay',
          'Federal Reserve Chair Powell says DOJ has subpoenaed central bank, threatens criminal indictment',
          'fed-subpoena-replay-a',
          1_768_180_699_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/bf4fc6c690fa248fbc531bc9bc7f1758',
            canonicalUrl: 'https://apnews.com/article/bf4fc6c690fa248fbc531bc9bc7f1758',
            entity_keys: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
            cluster_text: 'Jerome Powell said the Justice Department subpoenaed the Federal Reserve over the same building-renovation probe and threatened criminal charges.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'fed_powell_subpoena_episode',
          'ap-fed-backlash-replay',
          'DOJ investigation of Fed Chair Powell sparks backlash, support for Fed independence',
          'fed-backlash-replay-b',
          1_768_234_798_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/d87eedf1e35195957f903f9963aeaf99',
            canonicalUrl: 'https://apnews.com/article/d87eedf1e35195957f903f9963aeaf99',
            entity_keys: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
            cluster_text: 'The same Justice Department subpoena fight over Federal Reserve building renovations triggered backlash and new defenses of Fed independence.',
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'fed_powell_subpoena_episode',
          'ap-fed-judge-quash-replay',
          "Judge quashes subpoenas in Justice Department's investigation of Fed chair Jerome Powell",
          'fed-judge-quash-replay-c',
          1_773_509_513_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/0fdd36447a6aa8ae3e7125930d03950f',
            canonicalUrl: 'https://apnews.com/article/0fdd36447a6aa8ae3e7125930d03950f',
            entity_keys: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
            cluster_text: 'A federal judge quashed the same Justice Department subpoenas aimed at Jerome Powell and the Federal Reserve building-renovation probe.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-flag-burn-order-gap-return',
    topic_id: 'replay-known-event-flag-burn-order-gap-return',
    ticks: [
      [
        makeBenchmarkItem(
          'white_house_flag_burning_episode',
          'ap-flag-ban-order-replay',
          'Trump moves to ban flag burning despite Supreme Court ruling that Constitution allows it',
          'flag-ban-order-replay-a',
          1_768_995_600_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/flag-burning-trump-order-ban',
            canonicalUrl: 'https://apnews.com/article/flag-burning-trump-order-ban',
            entity_keys: [
              'white_house_flag_burning_episode',
              'white_house_flag_burning_case',
              'american_flag',
              'white_house',
              'jan_carey',
              'flag_burning_order',
            ],
            cluster_text:
              'Trump announced a new push to ban flag burning after the Jan. Carey White House flag-burning case, setting the policy and legal crackdown that later collapsed in court.',
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'white_house_flag_burning_episode',
          'ap-flag-case-dismissal-replay',
          'Feds move to dismiss charges against Army veteran who burned American flag near White House',
          'flag-case-dismissal-replay-b',
          1_771_258_400_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/flag-burning-carey-case-dismissed',
            canonicalUrl: 'https://apnews.com/article/flag-burning-carey-case-dismissed',
            entity_keys: [
              'white_house_flag_burning_episode',
              'white_house_flag_burning_case',
              'american_flag',
              'white_house',
              'jan_carey',
              'flag_burning_order',
            ],
            cluster_text:
              'Federal prosecutors moved to dismiss the Jan. Carey White House flag-burning case, direct legal fallout from the same Trump-backed flag-burning crackdown.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-teacher-prank-charge-drop',
    topic_id: 'replay-known-event-teacher-prank-charge-drop',
    ticks: [
      [
        makeBenchmarkItem(
          'teacher_prank_death_episode',
          'ap-prank-adult-charge-replay',
          "Georgia teen charged as an adult in death of teacher hit by car after 'senior prank'",
          'teacher-prank-charge-replay-a',
          1_746_720_000_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/georgia-teacher-prank-adult-charge',
            canonicalUrl: 'https://apnews.com/article/georgia-teacher-prank-adult-charge',
            entity_keys: [
              'teacher_prank_death_episode',
              'teacher_prank_death_case',
              'adrianne_hutcherson',
              'senior_prank',
              'criminal_charge',
            ],
            cluster_text:
              'Georgia prosecutors charged a teen as an adult after teacher Adrianne Hutcherson was struck and killed during the same senior-prank case.',
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'teacher_prank_death_episode',
          'ap-prank-charge-drop-replay',
          'Charges dropped against teens whose teacher died during toilet paper prank',
          'teacher-prank-charge-drop-replay-b',
          1_757_116_800_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/georgia-teacher-prank-charges-dropped',
            canonicalUrl: 'https://apnews.com/article/georgia-teacher-prank-charges-dropped',
            entity_keys: [
              'teacher_prank_death_episode',
              'teacher_prank_death_case',
              'adrianne_hutcherson',
              'senior_prank',
              'criminal_charge',
            ],
            cluster_text:
              'Prosecutors later dropped charges in the same Georgia teacher-prank death case after the earlier adult-charge decision and public scrutiny.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-fani-willis-postdismissal-arc',
    topic_id: 'replay-known-event-fani-willis-postdismissal-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'fani_willis_postdismissal_episode',
          'ap-willis-legal-fees-replay',
          "Trump seeks $6.2 million in legal fees from Fani Willis' office over election interference case",
          'fani-willis-fees-replay-a',
          1_772_726_400_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-fani-willis-legal-fees',
            canonicalUrl: 'https://apnews.com/article/trump-fani-willis-legal-fees',
            entity_keys: [
              'fani_willis_postdismissal_episode',
              'georgia_trump_election_case',
              'fani_willis',
              'nathan_wade',
              'postdismissal_fallout',
            ],
            cluster_text:
              'Trump sought legal fees from Fani Willis after the collapse of the Georgia election interference case, part of the same post-dismissal fallout episode that later brought legislative pressure and hearings about Nathan Wade.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'fani_willis_postdismissal_episode',
          'ap-willis-gop-bills-replay',
          'Georgia Republicans push more bills aimed at Fulton County DA Fani Willis',
          'fani-willis-bills-replay-b',
          1_772_899_200_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/fani-willis-georgia-republicans-bills',
            canonicalUrl: 'https://apnews.com/article/fani-willis-georgia-republicans-bills',
            entity_keys: [
              'fani_willis_postdismissal_episode',
              'georgia_trump_election_case',
              'fani_willis',
              'nathan_wade',
              'postdismissal_fallout',
            ],
            cluster_text:
              'Georgia Republicans advanced new bills targeting Fani Willis as part of the same post-dismissal fallout from the Georgia Trump election case.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'fani_willis_postdismissal_episode',
          'ap-wade-hearing-replay',
          'State lawmakers grill former special prosecutor Nathan Wade over Georgia Trump election case',
          'nathan-wade-hearing-replay-c',
          1_773_249_600_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/nathan-wade-hearing-georgia-trump-case',
            canonicalUrl: 'https://apnews.com/article/nathan-wade-hearing-georgia-trump-case',
            entity_keys: [
              'fani_willis_postdismissal_episode',
              'georgia_trump_election_case',
              'fani_willis',
              'nathan_wade',
              'postdismissal_fallout',
            ],
            cluster_text:
              'Lawmakers questioned former special prosecutor Nathan Wade during the same post-dismissal fallout around the Georgia Trump election case and pressure on Fani Willis.',
          },
        ),
      ],
    ],
  },
];
