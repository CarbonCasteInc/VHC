import { makeBenchmarkItem } from './benchmarkCorpusBuilders';
import type { StoryClusterReplayScenario } from './benchmarkCorpusReplayTypes';

export const STORYCLUSTER_REPLAY_KNOWN_EVENT_ONGOING_SCENARIOS: StoryClusterReplayScenario[] = [
  {
    scenario_id: 'replay-known-event-no-kings-protests-source-growth',
    topic_id: 'replay-known-event-no-kings-protests-source-growth',
    ticks: [
      [
        makeBenchmarkItem(
          'no_kings_protests_episode',
          'pbs-no-kings-rallies-replay',
          "'No Kings' rallies draw crowds across U.S. and Europe as Springsteen headlines Minnesota demonstration",
          'no-kings-rallies-replay-a',
          1_774_733_241_000,
          {
            publisher: 'PBS News',
            url: 'https://www.pbs.org/newshour/nation/no-kings-rallies-draw-crowds-across-u-s-and-europe-as-springsteen-headlines-minnesota-demonstration',
            canonicalUrl:
              'https://www.pbs.org/newshour/nation/no-kings-rallies-draw-crowds-across-u-s-and-europe-as-springsteen-headlines-minnesota-demonstration',
            entity_keys: ['no_kings_protests_episode', 'no_kings_rallies', 'donald_trump', 'bruce_springsteen', 'minnesota'],
            cluster_text:
              'Large No Kings rallies protested Donald Trump across the U.S. and Europe, with Minnesota as a flagship stop where Bruce Springsteen headlined the same protest episode.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'no_kings_protests_episode',
          'bbc-no-kings-rallies-replay',
          'No Kings protests draw large crowds to rally against Donald Trump',
          'no-kings-rallies-replay-b',
          1_774_828_645_000,
          {
            publisher: 'BBC News',
            url: 'https://www.bbc.com/news/articles/cq8wy7g1gd1o?at_medium=RSS&at_campaign=rss',
            canonicalUrl: 'https://www.bbc.com/news/articles/cq8wy7g1gd1o?at_campaign=rss&at_medium=RSS',
            entity_keys: ['no_kings_protests_episode', 'no_kings_rallies', 'donald_trump', 'bruce_springsteen', 'minnesota'],
            cluster_text:
              'No Kings protests drew large crowds against Donald Trump in the same protest wave, including the Minnesota rally where Bruce Springsteen performed.',
          },
        ),
      ],
    ],
  },
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
  {
    scenario_id: 'replay-known-event-eric-adams-dismissal-arc',
    topic_id: 'replay-known-event-eric-adams-dismissal-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'eric_adams_corruption_dismissal_episode',
          'reuters-adams-doj-dismissal-replay',
          'US Justice Department seeks dismissal of corruption case against New York Mayor Eric Adams',
          'eric-adams-doj-dismissal-replay-a',
          1_739_201_400_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/us-justice-department-seeks-dismissal-corruption-case-against-new-york-mayor-eric-adams-2025-02-14/',
            canonicalUrl:
              'https://www.reuters.com/world/us/us-justice-department-seeks-dismissal-corruption-case-against-new-york-mayor-eric-adams-2025-02-14/',
            entity_keys: [
              'eric_adams_corruption_dismissal_episode',
              'eric_adams',
              'corruption_case',
              'doj_dismissal_motion',
              'new_york_mayor',
            ],
            cluster_text:
              'The Justice Department moved to dismiss the corruption case against Eric Adams, beginning the same legal-dismissal episode that later brought court scrutiny and a formal dismissal.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'eric_adams_corruption_dismissal_episode',
          'reuters-adams-judge-weighs-dismissal-replay',
          'Judge cancels Eric Adams trial, weighs DOJ request to dismiss charges',
          'eric-adams-judge-weighs-dismissal-replay-b',
          1_739_883_600_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/judge-cancels-eric-adams-trial-weighs-doj-request-dismiss-charges-2025-02-21/',
            canonicalUrl:
              'https://www.reuters.com/world/us/judge-cancels-eric-adams-trial-weighs-doj-request-dismiss-charges-2025-02-21/',
            entity_keys: [
              'eric_adams_corruption_dismissal_episode',
              'eric_adams',
              'corruption_case',
              'doj_dismissal_motion',
              'new_york_mayor',
            ],
            cluster_text:
              'A federal judge paused Eric Adams trial proceedings while weighing the same Justice Department dismissal request in the corruption case.',
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'eric_adams_corruption_dismissal_episode',
          'reuters-adams-case-dismissed-replay',
          'Judge dismisses corruption case against New York Mayor Eric Adams',
          'eric-adams-case-dismissed-replay-c',
          1_743_249_600_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/judge-dismisses-corruption-case-against-new-york-mayor-eric-adams-2025-04-02/',
            canonicalUrl:
              'https://www.reuters.com/world/us/judge-dismisses-corruption-case-against-new-york-mayor-eric-adams-2025-04-02/',
            entity_keys: [
              'eric_adams_corruption_dismissal_episode',
              'eric_adams',
              'corruption_case',
              'doj_dismissal_motion',
              'new_york_mayor',
            ],
            cluster_text:
              'The judge formally dismissed the corruption case against Eric Adams, closing the same dismissal episode that started with the Justice Department motion and court review.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-mahmoud-khalil-gap-return',
    topic_id: 'replay-known-event-mahmoud-khalil-gap-return',
    ticks: [
      [
        makeBenchmarkItem(
          'mahmoud_khalil_detention_episode',
          'reuters-khalil-can-be-deported-replay',
          'US judge says Trump administration can deport Columbia activist Mahmoud Khalil',
          'mahmoud-khalil-can-be-deported-replay-a',
          1_749_945_600_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/us-judge-says-trump-administration-can-deport-columbia-activist-mahmoud-khalil-2025-06-13/',
            canonicalUrl:
              'https://www.reuters.com/world/us/us-judge-says-trump-administration-can-deport-columbia-activist-mahmoud-khalil-2025-06-13/',
            entity_keys: [
              'mahmoud_khalil_detention_episode',
              'mahmoud_khalil',
              'columbia_activist',
              'deportation_case',
              'immigration_detention',
            ],
            cluster_text:
              'A judge said the Trump administration could deport Mahmoud Khalil in the same legal episode over the Columbia activist detention and deportation fight.',
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'mahmoud_khalil_detention_episode',
          'reuters-khalil-new-jersey-challenge-replay',
          'Mahmoud Khalil can challenge detention in New Jersey, appeals court says',
          'mahmoud-khalil-new-jersey-challenge-replay-b',
          1_754_409_600_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/mahmoud-khalil-can-challenge-detention-new-jersey-appeals-court-says-2025-08-04/',
            canonicalUrl:
              'https://www.reuters.com/world/us/mahmoud-khalil-can-challenge-detention-new-jersey-appeals-court-says-2025-08-04/',
            entity_keys: [
              'mahmoud_khalil_detention_episode',
              'mahmoud_khalil',
              'columbia_activist',
              'deportation_case',
              'immigration_detention',
            ],
            cluster_text:
              'An appeals court said Mahmoud Khalil could challenge his detention in New Jersey in the same deportation-and-detention legal episode arising from the Trump administration case against the Columbia activist.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-abrego-garcia-gap-return',
    topic_id: 'replay-known-event-abrego-garcia-gap-return',
    ticks: [
      [
        makeBenchmarkItem(
          'abrego_garcia_wrongful_deportation_episode',
          'reuters-abrego-lawsuit-dismissal-replay',
          "Trump administration seeks to dismiss Kilmar Abrego Garcia's lawsuit over deportation",
          'abrego-lawsuit-dismissal-replay-a',
          1_749_859_200_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/trump-administration-seeks-dismiss-kilmar-abrego-garcias-lawsuit-over-deportation-2025-06-12/',
            canonicalUrl:
              'https://www.reuters.com/world/us/trump-administration-seeks-dismiss-kilmar-abrego-garcias-lawsuit-over-deportation-2025-06-12/',
            entity_keys: [
              'abrego_garcia_wrongful_deportation_episode',
              'kilmar_abrego_garcia',
              'wrongful_deportation_case',
              'pretrial_detention',
              'el_salvador_return',
            ],
            cluster_text:
              'The Trump administration sought to dismiss Kilmar Abrego Garcia lawsuit over his deportation in the same continuing legal episode that later reached pretrial-detention rulings after his return.',
          },
        ),
      ],
      [],
      [
        makeBenchmarkItem(
          'abrego_garcia_wrongful_deportation_episode',
          'reuters-abrego-no-detention-replay',
          'Judge says wrongfully deported Abrego Garcia should not be detained before trial',
          'abrego-no-detention-replay-b',
          1_755_446_400_000,
          {
            publisher: 'Reuters',
            url: 'https://www.reuters.com/world/us/judge-says-wrongfully-deported-abrego-garcia-should-not-be-detained-before-trial-2025-08-16/',
            canonicalUrl:
              'https://www.reuters.com/world/us/judge-says-wrongfully-deported-abrego-garcia-should-not-be-detained-before-trial-2025-08-16/',
            entity_keys: [
              'abrego_garcia_wrongful_deportation_episode',
              'kilmar_abrego_garcia',
              'wrongful_deportation_case',
              'pretrial_detention',
              'el_salvador_return',
            ],
            cluster_text:
              'A judge said Kilmar Abrego Garcia should not be detained before trial in the same wrongful-deportation episode that followed his return and criminal case.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-rumeysa-ozturk-arc',
    topic_id: 'replay-known-event-rumeysa-ozturk-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'rumeysa_ozturk_detention_episode',
          'ap-ozturk-transfer-paused-replay',
          "Appeals court pauses Tufts student's transfer to Vermont in immigration detention case",
          'ozturk-transfer-paused-replay-a',
          1_745_923_259_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/11369dd81ec5b95a7ad7c1d2a0c74f2d',
            canonicalUrl: 'https://apnews.com/article/11369dd81ec5b95a7ad7c1d2a0c74f2d',
            entity_keys: [
              'rumeysa_ozturk_detention_episode',
              'rumeysa_ozturk',
              'tufts_student',
              'immigration_detention',
              'vermont_transfer_fight',
            ],
            cluster_text:
              'A federal appeals court paused Rumeysa Ozturk transfer back to Vermont in the same detention-and-release legal fight over the Tufts student immigration case.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'rumeysa_ozturk_detention_episode',
          'ap-ozturk-return-ordered-replay',
          'Appeals court orders ICE to return detained Turkish Tufts University student to Vermont',
          'ozturk-return-ordered-replay-b',
          1_746_631_464_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/709e6266f7bcebe5b281bdac3fb28e19',
            canonicalUrl: 'https://apnews.com/article/709e6266f7bcebe5b281bdac3fb28e19',
            entity_keys: [
              'rumeysa_ozturk_detention_episode',
              'rumeysa_ozturk',
              'tufts_student',
              'immigration_detention',
              'vermont_transfer_fight',
            ],
            cluster_text:
              'The appeals court then ordered ICE to return Rumeysa Ozturk to Vermont in the same detention challenge over her transfer and confinement in Louisiana.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'rumeysa_ozturk_detention_episode',
          'ap-ozturk-released-replay',
          'Turkish Tufts University student released from Louisiana immigration detention center',
          'ozturk-released-replay-c',
          1_746_786_686_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/034d97a7e280c68a7d1fb6aa879ce87c',
            canonicalUrl: 'https://apnews.com/article/034d97a7e280c68a7d1fb6aa879ce87c',
            entity_keys: [
              'rumeysa_ozturk_detention_episode',
              'rumeysa_ozturk',
              'tufts_student',
              'immigration_detention',
              'vermont_transfer_fight',
            ],
            cluster_text:
              'Rumeysa Ozturk was released from detention as the latest development in the same detention-and-transfer episode involving the Tufts student and the Vermont court fight.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-mohsen-mahdawi-arc',
    topic_id: 'replay-known-event-mohsen-mahdawi-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'mohsen_mahdawi_detention_episode',
          'ap-mahdawi-arrested-replay',
          'A Palestinian activist expecting a US citizenship interview is arrested instead by ICE in Vermont',
          'mahdawi-arrested-replay-a',
          1_744_664_841_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/fca7e73fe2cbd616c1eacf3bdececdbe',
            canonicalUrl: 'https://apnews.com/article/fca7e73fe2cbd616c1eacf3bdececdbe',
            entity_keys: [
              'mohsen_mahdawi_detention_episode',
              'mohsen_mahdawi',
              'columbia_student',
              'immigration_detention',
              'citizenship_interview_arrest',
            ],
            cluster_text:
              'Mohsen Mahdawi was arrested during a citizenship interview in Vermont, beginning the same detention episode that later brought court hearings and his release.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'mohsen_mahdawi_detention_episode',
          'ap-mahdawi-hearing-set-replay',
          'Palestinian student remains detained in Vermont with a hearing set for next week',
          'mahdawi-hearing-set-replay-b',
          1_745_452_402_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/2078326229e424b722e837595a03a042',
            canonicalUrl: 'https://apnews.com/article/2078326229e424b722e837595a03a042',
            entity_keys: [
              'mohsen_mahdawi_detention_episode',
              'mohsen_mahdawi',
              'columbia_student',
              'immigration_detention',
              'citizenship_interview_arrest',
            ],
            cluster_text:
              'Mahdawi remained detained and got a court hearing date in the same Vermont detention episode that started with his arrest during the citizenship interview.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'mohsen_mahdawi_detention_episode',
          'ap-mahdawi-released-replay',
          'A Palestinian student at Columbia is freed after his arrest at a citizenship interview',
          'mahdawi-released-replay-c',
          1_746_020_292_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/dd95ffff78464df1b485d5912f1b3fcb',
            canonicalUrl: 'https://apnews.com/article/dd95ffff78464df1b485d5912f1b3fcb',
            entity_keys: [
              'mohsen_mahdawi_detention_episode',
              'mohsen_mahdawi',
              'columbia_student',
              'immigration_detention',
              'citizenship_interview_arrest',
            ],
            cluster_text:
              'Mahdawi was released after a judge order in the same detention episode triggered by his arrest at the citizenship interview.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-ras-baraka-arc',
    topic_id: 'replay-known-event-ras-baraka-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'ras_baraka_delaney_hall_episode',
          'ap-baraka-arrested-replay',
          'Newark mayor denies trespassing at immigration detention center following arrest',
          'baraka-arrested-replay-a',
          1_746_851_593_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/2b044ff4355240511e579275b8961270',
            canonicalUrl: 'https://apnews.com/article/2b044ff4355240511e579275b8961270',
            entity_keys: [
              'ras_baraka_delaney_hall_episode',
              'ras_baraka',
              'delaney_hall',
              'trespassing_charge',
              'alina_habba',
            ],
            cluster_text:
              'Ras Baraka denied trespassing after his arrest at Delaney Hall, beginning the same arrest-and-prosecution episode that later brought court proceedings and a lawsuit.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ras_baraka_delaney_hall_episode',
          'ap-baraka-court-appearance-replay',
          "Newark Mayor Ras Baraka says officials fingerprinting him second time tried to 'humiliate' him",
          'baraka-court-appearance-replay-b',
          1_747_279_373_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/4490e7ef9bc88e6b9261a0e548632ecd',
            canonicalUrl: 'https://apnews.com/article/4490e7ef9bc88e6b9261a0e548632ecd',
            entity_keys: [
              'ras_baraka_delaney_hall_episode',
              'ras_baraka',
              'delaney_hall',
              'trespassing_charge',
              'alina_habba',
            ],
            cluster_text:
              'Baraka described being fingerprinted again after a court hearing in the same Delaney Hall arrest and trespassing case.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ras_baraka_delaney_hall_episode',
          'ap-baraka-sues-habba-replay',
          "Newark mayor sues New Jersey's top federal prosecutor after arrest at immigration detention site",
          'baraka-sues-habba-replay-c',
          1_748_963_275_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/0d17f4adb136b9fefc02ea8b498124ed',
            canonicalUrl: 'https://apnews.com/article/0d17f4adb136b9fefc02ea8b498124ed',
            entity_keys: [
              'ras_baraka_delaney_hall_episode',
              'ras_baraka',
              'delaney_hall',
              'trespassing_charge',
              'alina_habba',
            ],
            cluster_text:
              'Baraka sued Alina Habba over the same Delaney Hall arrest and dropped trespassing case, extending that same arrest-and-prosecution episode into civil litigation.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-voice-of-america-arc',
    topic_id: 'replay-known-event-voice-of-america-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'voice_of_america_dismantling_episode',
          'ap-voa-blocks-firings-replay',
          'Voice of America wins in court, for now, as judge blocks Trump administration from firing staff',
          'voa-blocks-firings-replay-a',
          1_743_201_273_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/a1ed0ad37917055a1565da5325bd4fd8',
            canonicalUrl: 'https://apnews.com/article/a1ed0ad37917055a1565da5325bd4fd8',
            entity_keys: [
              'voice_of_america_dismantling_episode',
              'voice_of_america',
              'us_agency_for_global_media',
              'kari_lake',
              'staff_firings',
            ],
            cluster_text:
              'A judge blocked the Trump administration from firing Voice of America staff in the same ongoing effort to dismantle VOA that later brought restoration orders and renewed job-cut fights.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'voice_of_america_dismantling_episode',
          'ap-voa-blocks-dismantling-replay',
          'Federal judge blocks Trump administration from dismantling Voice of America',
          'voa-blocks-dismantling-replay-b',
          1_745_353_087_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/f30c48df0c16de622ec5fd99ee6c627c',
            canonicalUrl: 'https://apnews.com/article/f30c48df0c16de622ec5fd99ee6c627c',
            entity_keys: [
              'voice_of_america_dismantling_episode',
              'voice_of_america',
              'us_agency_for_global_media',
              'kari_lake',
              'staff_firings',
            ],
            cluster_text:
              'A federal judge blocked the broader dismantling of Voice of America in the same administration shutdown episode that began with staff cuts and continued through later compliance fights.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'voice_of_america_dismantling_episode',
          'ap-voa-restore-order-ignored-replay',
          "Judge orders Trump administration to explain why order to restore Voice of America wasn't followed",
          'voa-restore-order-ignored-replay-c',
          1_754_013_262_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/b60d40621f41b2ff4460803de4e0142f',
            canonicalUrl: 'https://apnews.com/article/b60d40621f41b2ff4460803de4e0142f',
            entity_keys: [
              'voice_of_america_dismantling_episode',
              'voice_of_america',
              'us_agency_for_global_media',
              'kari_lake',
              'staff_firings',
            ],
            cluster_text:
              'The judge later demanded an explanation for the government failure to restore Voice of America operations in the same dismantling lawsuit.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'voice_of_america_dismantling_episode',
          'ap-voa-suspends-job-cuts-replay',
          "Judge suspends Trump administration's plan to eliminate hundreds of Voice of America jobs",
          'voa-suspends-job-cuts-replay-d',
          1_759_190_759_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/253c1c08e767ab4a2340b58e896f88a8',
            canonicalUrl: 'https://apnews.com/article/253c1c08e767ab4a2340b58e896f88a8',
            entity_keys: [
              'voice_of_america_dismantling_episode',
              'voice_of_america',
              'us_agency_for_global_media',
              'kari_lake',
              'staff_firings',
            ],
            cluster_text:
              'A judge later suspended new mass job cuts at Voice of America in the same dismantling-and-restoration legal episode.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-harvard-foreign-students-arc',
    topic_id: 'replay-known-event-harvard-foreign-students-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'harvard_foreign_students_sanctions_episode',
          'ap-harvard-blocks-ban-replay',
          'Federal judge blocks Trump administration from barring foreign student enrollment at Harvard',
          'harvard-blocks-ban-replay-a',
          1_748_092_422_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/94b65866c563e67a7a7a3c79e90144d6',
            canonicalUrl: 'https://apnews.com/article/94b65866c563e67a7a7a3c79e90144d6',
            entity_keys: [
              'harvard_foreign_students_sanctions_episode',
              'harvard_university',
              'foreign_students',
              'student_visa_sanctions',
              'allison_burroughs',
            ],
            cluster_text:
              'A judge blocked the Trump administration from barring Harvard from enrolling foreign students, starting the same legal episode over sanctions on Harvard international enrollment.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'harvard_foreign_students_sanctions_episode',
          'ap-harvard-extends-block-replay',
          "Judge extends order suspending Trump's block on Harvard's incoming foreign students",
          'harvard-extends-block-replay-b',
          1_750_097_522_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/e098ce93756fe51c476037b0ff52fabe',
            canonicalUrl: 'https://apnews.com/article/e098ce93756fe51c476037b0ff52fabe',
            entity_keys: [
              'harvard_foreign_students_sanctions_episode',
              'harvard_university',
              'foreign_students',
              'student_visa_sanctions',
              'allison_burroughs',
            ],
            cluster_text:
              'The court extended its hold on the Harvard foreign-student block in the same sanctions dispute over international enrollment.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'harvard_foreign_students_sanctions_episode',
          'ap-harvard-blocks-hosting-effort-replay',
          'Federal judge blocks Trump effort to keep Harvard from hosting foreign students',
          'harvard-blocks-hosting-effort-replay-c',
          1_750_449_434_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/9498074cfe5f1054a712b9c21d36c6c5',
            canonicalUrl: 'https://apnews.com/article/9498074cfe5f1054a712b9c21d36c6c5',
            entity_keys: [
              'harvard_foreign_students_sanctions_episode',
              'harvard_university',
              'foreign_students',
              'student_visa_sanctions',
              'allison_burroughs',
            ],
            cluster_text:
              'The court again blocked efforts to stop Harvard from hosting foreign students in the same continuing sanctions case over international enrollment.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-yunseo-chung-arc',
    topic_id: 'replay-known-event-yunseo-chung-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'yunseo_chung_deportation_episode',
          'ap-chung-sues-replay',
          "Columbia student protester who's lived in the US since age 7 sues to stop deportation order",
          'yunseo-chung-sues-replay-a',
          1_742_840_024_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/052280bfe4e8d4d07e98a681058340fe',
            canonicalUrl: 'https://apnews.com/article/052280bfe4e8d4d07e98a681058340fe',
            entity_keys: [
              'yunseo_chung_deportation_episode',
              'yunseo_chung',
              'columbia_student',
              'deportation_order',
              'ice_detention_fight',
            ],
            cluster_text:
              'Yunseo Chung sued to stop her deportation in the same Columbia student deportation episode that immediately led to court rulings on whether ICE could detain her.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'yunseo_chung_deportation_episode',
          'ap-chung-cant-be-detained-replay',
          "Columbia student protester can't be detained for now as she fights deportation, judge rules",
          'yunseo-chung-cant-be-detained-replay-b',
          1_742_933_922_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/2d7bd689b013b8bb6300fd6ab54de933',
            canonicalUrl: 'https://apnews.com/article/2d7bd689b013b8bb6300fd6ab54de933',
            entity_keys: [
              'yunseo_chung_deportation_episode',
              'yunseo_chung',
              'columbia_student',
              'deportation_order',
              'ice_detention_fight',
            ],
            cluster_text:
              'A judge then barred immigration detention of Yunseo Chung while the same deportation challenge played out.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-ap-access-arc',
    topic_id: 'replay-known-event-ap-access-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'associated_press_access_episode',
          'ap-press-access-curtailed-replay',
          "Trump says AP will continue to be curtailed at White House until it changes AP Style's guidance",
          'ap-access-curtailed-replay-a',
          1_739_312_235_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-ap-access-oval-office-air-force-one-40bc53fbe6d4ddb706c958d825c9e2d5',
            canonicalUrl:
              'https://apnews.com/article/trump-ap-access-oval-office-air-force-one-40bc53fbe6d4ddb706c958d825c9e2d5',
            entity_keys: [
              'associated_press_access_episode',
              'associated_press',
              'white_house_press_access',
              'gulf_of_america_naming_dispute',
              'trevor_mcfadden',
            ],
            cluster_text:
              'The White House said AP access would remain curtailed over the Gulf of America naming dispute, beginning the same Associated Press access case that later brought trial-court and appeals-court rulings.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'associated_press_access_episode',
          'ap-press-access-reinstated-replay',
          "AP wins reinstatement to White House events after judge rules government can't bar its journalists",
          'ap-access-reinstated-replay-b',
          1_744_146_577_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/ap-trump-gulf-america-white-house-press-access-63c0c6c732ecde1afbeb9ddc4e3b9627',
            canonicalUrl:
              'https://apnews.com/article/ap-trump-gulf-america-white-house-press-access-63c0c6c732ecde1afbeb9ddc4e3b9627',
            entity_keys: [
              'associated_press_access_episode',
              'associated_press',
              'white_house_press_access',
              'gulf_of_america_naming_dispute',
              'trevor_mcfadden',
            ],
            cluster_text:
              'A judge ordered AP journalists restored to White House events in the same press-access dispute over the Gulf naming fight.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'associated_press_access_episode',
          'ap-press-access-enforcement-replay',
          "Judge won't take further steps, for now, to enforce his order in AP's White House access case against Trump administration",
          'ap-access-enforcement-replay-c',
          1_744_996_782_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/ap-trump-white-house-access-gulf-america-a652a1c154866ef05ece5d96f250dcb9',
            canonicalUrl:
              'https://apnews.com/article/ap-trump-white-house-access-gulf-america-a652a1c154866ef05ece5d96f250dcb9',
            entity_keys: [
              'associated_press_access_episode',
              'associated_press',
              'white_house_press_access',
              'gulf_of_america_naming_dispute',
              'trevor_mcfadden',
            ],
            cluster_text:
              'The judge later declined further enforcement steps, for now, in the same AP White House access case over the naming dispute.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'associated_press_access_episode',
          'ap-press-access-appeals-replay',
          "Appeals court won't reinstate AP access to presidential events amid ongoing dispute over 'Gulf of America'",
          'ap-access-appeals-replay-d',
          1_753_231_322_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/ap-trump-gulf-america-white-house-press-6d8a7bb5752b781d650d6edf431e5fd9',
            canonicalUrl:
              'https://apnews.com/article/ap-trump-gulf-america-white-house-press-6d8a7bb5752b781d650d6edf431e5fd9',
            entity_keys: [
              'associated_press_access_episode',
              'associated_press',
              'white_house_press_access',
              'gulf_of_america_naming_dispute',
              'trevor_mcfadden',
            ],
            cluster_text:
              'An appeals court later refused to reinstate AP access to presidential events in the same White House press-access litigation over Gulf of America terminology.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-cfpb-dismantling-arc',
    topic_id: 'replay-known-event-cfpb-dismantling-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'cfpb_dismantling_episode',
          'ap-cfpb-chaos-replay',
          'Federal official recounts chaos inside consumer agency after Trump fired its director',
          'cfpb-chaos-replay-a',
          1_741_638_801_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/cfpb-trump-firing-employee-testimony-980ed7ce6a35300b0bd9b05e1aa3976f',
            canonicalUrl:
              'https://apnews.com/article/cfpb-trump-firing-employee-testimony-980ed7ce6a35300b0bd9b05e1aa3976f',
            entity_keys: [
              'cfpb_dismantling_episode',
              'consumer_financial_protection_bureau',
              'russell_vought',
              'amy_berman_jackson',
              'cfpb_shutdown_push',
            ],
            cluster_text:
              'A federal official described chaos inside the CFPB after the administration fired its director, part of the same dismantling push that later triggered injunctions against layoffs and defunding.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'cfpb_dismantling_episode',
          'ap-cfpb-blocks-dismantling-replay',
          'Federal judge blocks Trump from dismantling consumer watchdog CFPB',
          'cfpb-blocks-dismantling-replay-b',
          1_743_194_873_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/consumer-finance-protection-bureau-trump-musk-layoffs-00b1587f5d461d9daac42f017290bcfb',
            canonicalUrl:
              'https://apnews.com/article/consumer-finance-protection-bureau-trump-musk-layoffs-00b1587f5d461d9daac42f017290bcfb',
            entity_keys: [
              'cfpb_dismantling_episode',
              'consumer_financial_protection_bureau',
              'russell_vought',
              'amy_berman_jackson',
              'cfpb_shutdown_push',
            ],
            cluster_text:
              'A judge blocked the administration from dismantling the CFPB in the same shutdown-and-layoffs legal fight over the consumer watchdog.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'cfpb_dismantling_episode',
          'ap-cfpb-pauses-layoffs-replay',
          'Judge pauses mass layoffs at consumer protection agency CFPB',
          'cfpb-pauses-layoffs-replay-c',
          1_744_992_255_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/consumer-finance-protection-bureau-layoffs-judge-order-8666bd2f7854a1d2abaf93388f118608',
            canonicalUrl:
              'https://apnews.com/article/consumer-finance-protection-bureau-layoffs-judge-order-8666bd2f7854a1d2abaf93388f118608',
            entity_keys: [
              'cfpb_dismantling_episode',
              'consumer_financial_protection_bureau',
              'russell_vought',
              'amy_berman_jackson',
              'cfpb_shutdown_push',
            ],
            cluster_text:
              'The court later paused mass layoffs at the CFPB in the same dismantling case over whether the agency could be hollowed out.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'cfpb_dismantling_episode',
          'ap-cfpb-blocks-defunding-replay',
          'Judge blocks Trump administration from effectively defunding consumer protection agency',
          'cfpb-blocks-defunding-replay-d',
          1_767_113_974_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-cfpb-defund-consumer-watchdog-judge-f967453f65f161ad63ea6d32ec80498f',
            canonicalUrl:
              'https://apnews.com/article/trump-cfpb-defund-consumer-watchdog-judge-f967453f65f161ad63ea6d32ec80498f',
            entity_keys: [
              'cfpb_dismantling_episode',
              'consumer_financial_protection_bureau',
              'russell_vought',
              'amy_berman_jackson',
              'cfpb_shutdown_push',
            ],
            cluster_text:
              'The judge later blocked efforts to effectively defund the CFPB in the same ongoing dismantling episode over layoffs, shutdown, and agency survival.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-birthright-citizenship-order-arc',
    topic_id: 'replay-known-event-birthright-citizenship-order-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'birthright_citizenship_order_episode',
          'ap-birthright-fourth-judge-replay',
          "A 4th federal judge blocks Trump's executive order seeking to end birthright citizenship",
          'birthright-fourth-judge-replay-a',
          1_739_481_602_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-birthright-citizenship-executive-order-b95ec1d7a3fd95ebcd2d12bdf52f0c71',
            canonicalUrl:
              'https://apnews.com/article/trump-birthright-citizenship-executive-order-b95ec1d7a3fd95ebcd2d12bdf52f0c71',
            entity_keys: [
              'birthright_citizenship_order_episode',
              'birthright_citizenship_order',
              'fourteenth_amendment',
              'trump_executive_order',
              'federal_injunctions',
            ],
            cluster_text:
              'A fourth federal judge blocked the birthright-citizenship executive order, beginning the same ongoing litigation over whether Trump could end automatic citizenship by executive action.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'birthright_citizenship_order_episode',
          'ap-birthright-appeals-court-replay',
          "Appeals court won't lift block on Trump's executive order attempting to end birthright citizenship",
          'birthright-appeals-court-replay-b',
          1_741_724_144_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-birthright-citizenship-appeal-f1c61e1f0e8a133bf094ae6f35cabcc7',
            canonicalUrl:
              'https://apnews.com/article/trump-birthright-citizenship-appeal-f1c61e1f0e8a133bf094ae6f35cabcc7',
            entity_keys: [
              'birthright_citizenship_order_episode',
              'birthright_citizenship_order',
              'fourteenth_amendment',
              'trump_executive_order',
              'federal_injunctions',
            ],
            cluster_text:
              'An appeals court refused to lift an injunction against the same birthright-citizenship order in the continuing legal fight over executive power and the Fourteenth Amendment.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'birthright_citizenship_order_episode',
          'ap-birthright-new-hampshire-replay',
          'New Hampshire judge pauses President Donald Trump birthright citizenship order nationwide',
          'birthright-new-hampshire-replay-c',
          1_752_120_085_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-birthright-citizenship-order-federal-judge-c74f229f8fdaf71400530ad6cc3b346e',
            canonicalUrl:
              'https://apnews.com/article/trump-birthright-citizenship-order-federal-judge-c74f229f8fdaf71400530ad6cc3b346e',
            entity_keys: [
              'birthright_citizenship_order_episode',
              'birthright_citizenship_order',
              'fourteenth_amendment',
              'trump_executive_order',
              'federal_injunctions',
            ],
            cluster_text:
              'A New Hampshire judge later paused the same birthright-citizenship order nationwide through a class action, extending the same ongoing litigation over the executive order.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'birthright_citizenship_order_episode',
          'ap-birthright-remains-blocked-replay',
          "Trump's birthright citizenship order remains blocked as lawsuits march on after Supreme Court ruling",
          'birthright-remains-blocked-replay-d',
          1_752_858_510_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/trump-birthright-citizenship-lawsuits-supreme-court-b5cd136a3803ce7f5f1a66f9ec27f2b8',
            canonicalUrl:
              'https://apnews.com/article/trump-birthright-citizenship-lawsuits-supreme-court-b5cd136a3803ce7f5f1a66f9ec27f2b8',
            entity_keys: [
              'birthright_citizenship_order_episode',
              'birthright_citizenship_order',
              'fourteenth_amendment',
              'trump_executive_order',
              'federal_injunctions',
            ],
            cluster_text:
              'The order remained blocked as lawsuits continued after the Supreme Court ruling, part of the same ongoing birthright-citizenship litigation over Trump’s executive order.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-birthright-arguments-source-growth',
    topic_id: 'replay-known-event-birthright-arguments-source-growth',
    ticks: [
      [
        makeBenchmarkItem(
          'birthright_citizenship_argument_episode',
          'cbs-birthright-arguments-replay',
          'Trump plans to attend Supreme Court arguments in birthright citizenship case',
          'birthright-arguments-cbs-replay-a',
          1_775_034_600_000,
          {
            publisher: 'CBS News',
            url: 'https://www.cbsnews.com/news/trump-supreme-court-birthright-citizenship-case/',
            canonicalUrl: 'https://www.cbsnews.com/news/trump-supreme-court-birthright-citizenship-case/',
            entity_keys: [
              'birthright_citizenship_argument_episode',
              'birthright_citizenship_order',
              'birthright_citizenship',
              'donald_trump',
              'supreme_court',
            ],
            cluster_text:
              'Trump planned to attend Supreme Court arguments in the same birthright-citizenship case over his executive order, part of the same arguments-day episode about nationwide injunctions and the Fourteenth Amendment.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'birthright_citizenship_argument_episode',
          'nbc-birthright-arguments-replay',
          "Supreme Court weighs Trump's contentious attempt to limit birthright citizenship",
          'birthright-arguments-nbc-replay-b',
          1_775_035_500_000,
          {
            publisher: 'NBC News',
            url: 'https://www.nbcnews.com/politics/supreme-court/supreme-court-weighs-trumps-contentious-attempt-limit-birthright-citizenship-rcna208123',
            canonicalUrl:
              'https://www.nbcnews.com/politics/supreme-court/supreme-court-weighs-trumps-contentious-attempt-limit-birthright-citizenship-rcna208123',
            entity_keys: [
              'birthright_citizenship_argument_episode',
              'birthright_citizenship_order',
              'birthright_citizenship',
              'donald_trump',
              'supreme_court',
            ],
            cluster_text:
              'The Supreme Court weighed Trump’s attempt to limit birthright citizenship during the same arguments-day episode over the executive order, nationwide injunctions, and the Fourteenth Amendment.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-key-bridge-collapse-arc',
    topic_id: 'replay-known-event-key-bridge-collapse-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'key_bridge_collapse_episode',
          'ap-key-bridge-collapse-replay',
          'Major bridge in Baltimore collapses after being hit by cargo ship, sending vehicles into water',
          'key-bridge-collapse-replay-a',
          1_711_437_007_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/baltimore-bridge-collapse-ship-dali-bb60e1c41c7398379ee7caba104af265',
            canonicalUrl:
              'https://apnews.com/article/baltimore-bridge-collapse-ship-dali-bb60e1c41c7398379ee7caba104af265',
            entity_keys: [
              'key_bridge_collapse_episode',
              'francis_scott_key_bridge',
              'dali_cargo_ship',
              'baltimore_harbor',
              'recovery_and_clearance',
            ],
            cluster_text:
              'The Francis Scott Key Bridge collapsed after the cargo ship Dali struck it, beginning the same disaster, recovery, and investigation episode that later covered salvage, channel reopening, and cleanup claims.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'key_bridge_collapse_episode',
          'ap-key-bridge-salvage-replay',
          'Salvage teams start removing containers from ship that hit Baltimore bridge before taking down span',
          'key-bridge-salvage-replay-b',
          1_712_539_418_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/baltimore-key-bridge-collapse-salvage-29748f3df97f82f6af35fa11c010e18b',
            canonicalUrl:
              'https://apnews.com/article/baltimore-key-bridge-collapse-salvage-29748f3df97f82f6af35fa11c010e18b',
            entity_keys: [
              'key_bridge_collapse_episode',
              'francis_scott_key_bridge',
              'dali_cargo_ship',
              'baltimore_harbor',
              'recovery_and_clearance',
            ],
            cluster_text:
              'Salvage teams began removing containers from the Dali in the same Key Bridge collapse recovery episode before crews could cut away the fallen span.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'key_bridge_collapse_episode',
          'ap-key-bridge-channel-reopens-replay',
          'Fort McHenry Channel reopens in Baltimore, nearly 11 weeks after bridge collapse',
          'key-bridge-channel-reopens-replay-c',
          1_718_060_861_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/baltimore-key-bridge-collapse-channel-opens-6ff247b8fa51a8014824f56657e983a2',
            canonicalUrl:
              'https://apnews.com/article/baltimore-key-bridge-collapse-channel-opens-6ff247b8fa51a8014824f56657e983a2',
            entity_keys: [
              'key_bridge_collapse_episode',
              'francis_scott_key_bridge',
              'dali_cargo_ship',
              'baltimore_harbor',
              'recovery_and_clearance',
            ],
            cluster_text:
              'The Fort McHenry Channel reopened after weeks of debris removal in the same Key Bridge collapse recovery episode caused by the Dali strike.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'key_bridge_collapse_episode',
          'ap-key-bridge-cleanup-settlement-replay',
          'Justice Department and owner of ship that caused Baltimore bridge collapse agree to $102 million settlement',
          'key-bridge-cleanup-settlement-replay-d',
          1_729_804_959_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/baltimore-bridge-collapse-dali-justice-department-settlement-77839dd93dbf640eb3d2a9d08de04425',
            canonicalUrl:
              'https://apnews.com/article/baltimore-bridge-collapse-dali-justice-department-settlement-77839dd93dbf640eb3d2a9d08de04425',
            entity_keys: [
              'key_bridge_collapse_episode',
              'francis_scott_key_bridge',
              'dali_cargo_ship',
              'baltimore_harbor',
              'recovery_and_clearance',
            ],
            cluster_text:
              'The Justice Department reached a cleanup settlement with the Dali owner in the same Key Bridge collapse episode that began with the bridge strike and continued through recovery operations.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-dc-midair-collision-arc',
    topic_id: 'replay-known-event-dc-midair-collision-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'dc_midair_collision_episode',
          'ap-dc-midair-crash-replay',
          'Passenger jet and Army helicopter collide midair near Reagan Airport, killing 67 people',
          'dc-midair-crash-replay-a',
          1_738_231_312_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/plane-crash-helicopter-reagan-airport-washington-dc-08c62ab8048d2f0d08391995bcecd33e',
            canonicalUrl:
              'https://apnews.com/article/plane-crash-helicopter-reagan-airport-washington-dc-08c62ab8048d2f0d08391995bcecd33e',
            entity_keys: [
              'dc_midair_collision_episode',
              'reagan_national_airport',
              'army_black_hawk',
              'american_airlines_regional_jet',
              'ntsb_investigation',
              'potomac_river',
            ],
            cluster_text:
              'A passenger jet and an Army Black Hawk helicopter collided near Reagan National Airport and crashed into the Potomac River, beginning the same crash, recovery, and investigation episode that later covered salvage, altitude data, and helicopter restrictions.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'dc_midair_collision_episode',
          'ap-dc-midair-salvage-replay',
          'Crews to salvage remnants of deadly DC midair collision from the Potomac River as early as Monday',
          'dc-midair-salvage-replay-b',
          1_738_589_252_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/dc-plane-crash-salvage-black-boxes-77f663adef453c7b9f182e5b951f4882',
            canonicalUrl:
              'https://apnews.com/article/dc-plane-crash-salvage-black-boxes-77f663adef453c7b9f182e5b951f4882',
            entity_keys: [
              'dc_midair_collision_episode',
              'reagan_national_airport',
              'army_black_hawk',
              'american_airlines_regional_jet',
              'ntsb_investigation',
              'potomac_river',
            ],
            cluster_text:
              'Crews prepared to salvage wreckage from the Potomac River in the same Reagan Airport midair collision between the American Airlines regional jet and the Army Black Hawk helicopter.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'dc_midair_collision_episode',
          'ap-dc-midair-altitude-data-replay',
          'All 67 victims have been recovered from the DC midair collision. Data reveals conflicting altitudes',
          'dc-midair-altitude-data-replay-c',
          1_738_682_882_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/plane-helicopter-crash-victims-black-boxes-reagan-b3d5d8e1266e7934ee94797dee8d87ab',
            canonicalUrl:
              'https://apnews.com/article/plane-helicopter-crash-victims-black-boxes-reagan-b3d5d8e1266e7934ee94797dee8d87ab',
            entity_keys: [
              'dc_midair_collision_episode',
              'reagan_national_airport',
              'army_black_hawk',
              'american_airlines_regional_jet',
              'ntsb_investigation',
              'potomac_river',
            ],
            cluster_text:
              'Recovery of all 67 victims and new altitude data became part of the same investigation into the Reagan Airport midair collision between the American Airlines regional jet and the Army Black Hawk helicopter in the Potomac River.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'dc_midair_collision_episode',
          'ap-dc-midair-helicopter-ban-replay',
          'NTSB recommends ban on some helicopter flights around Reagan airport after deadly midair collision',
          'dc-midair-helicopter-ban-replay-d',
          1_741_718_065_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/reagan-airport-helicopter-ntsb-crash-90b09ea5dcaacedf6d4c6c1b45e83f66',
            canonicalUrl:
              'https://apnews.com/article/reagan-airport-helicopter-ntsb-crash-90b09ea5dcaacedf6d4c6c1b45e83f66',
            entity_keys: [
              'dc_midair_collision_episode',
              'reagan_national_airport',
              'army_black_hawk',
              'american_airlines_regional_jet',
              'ntsb_investigation',
              'potomac_river',
            ],
            cluster_text:
              'The NTSB later recommended banning some helicopter flights around Reagan Airport as a safety response to the same deadly midair collision between the American Airlines regional jet and the Army Black Hawk helicopter over the Potomac River.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-air-india-crash-arc',
    topic_id: 'replay-known-event-air-india-crash-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'air_india_ahmedabad_crash_episode',
          'ap-air-india-crash-replay',
          'Air India plane with more than 240 aboard crashes after takeoff from Ahmedabad in India',
          'air-india-crash-replay-a',
          1_749_718_246_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/india-plane-crash-ahmedabad-air-india-b787-6177c3725324f0116f3953f5549f4bb9',
            canonicalUrl:
              'https://apnews.com/article/india-plane-crash-ahmedabad-air-india-b787-6177c3725324f0116f3953f5549f4bb9',
            entity_keys: [
              'air_india_ahmedabad_crash_episode',
              'air_india',
              'ahmedabad',
              'boeing_787',
              'crash_investigation',
            ],
            cluster_text:
              'An Air India Boeing 787 crashed after takeoff from Ahmedabad, beginning the same fatal crash episode that later focused on black-box recovery, data extraction, and preliminary findings.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'air_india_ahmedabad_crash_episode',
          'ap-air-india-black-box-recovered-replay',
          'Black box recovered from Air India crash that killed at least 265 people, authorities say',
          'air-india-black-box-recovered-replay-b',
          1_749_790_553_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/india-plane-crash-air-india-black-box-1a34648c154dcee07b8ea3443fe5df73',
            canonicalUrl:
              'https://apnews.com/article/india-plane-crash-air-india-black-box-1a34648c154dcee07b8ea3443fe5df73',
            entity_keys: [
              'air_india_ahmedabad_crash_episode',
              'air_india',
              'ahmedabad',
              'boeing_787',
              'crash_investigation',
            ],
            cluster_text:
              'Authorities recovered the black box in the same Air India crash investigation after the Ahmedabad Boeing 787 disaster.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'air_india_ahmedabad_crash_episode',
          'ap-air-india-black-box-analysis-replay',
          'Black boxes from Air India crash are being analyzed as aviation authorities look for cause',
          'air-india-black-box-analysis-replay-c',
          1_750_934_972_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/air-india-crash-black-boxes-cause-efe6ff7f6788f5d4fc3c4b75b2d88e72',
            canonicalUrl:
              'https://apnews.com/article/air-india-crash-black-boxes-cause-efe6ff7f6788f5d4fc3c4b75b2d88e72',
            entity_keys: [
              'air_india_ahmedabad_crash_episode',
              'air_india',
              'ahmedabad',
              'boeing_787',
              'crash_investigation',
            ],
            cluster_text:
              'Investigators analyzed the black boxes in the same Air India Ahmedabad crash episode as authorities searched for the cause of the Boeing 787 disaster.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'air_india_ahmedabad_crash_episode',
          'ap-air-india-prelim-report-replay',
          'Report on Air India crash focuses on fuel switches, but raises more questions than answers',
          'air-india-prelim-report-replay-d',
          1_752_285_102_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/india-air-crash-fuel-switches-report-11d49f83998c7050aa823811711d7dde',
            canonicalUrl:
              'https://apnews.com/article/india-air-crash-fuel-switches-report-11d49f83998c7050aa823811711d7dde',
            entity_keys: [
              'air_india_ahmedabad_crash_episode',
              'air_india',
              'ahmedabad',
              'boeing_787',
              'crash_investigation',
            ],
            cluster_text:
              'A preliminary report on fuel switches became the next investigation phase in the same Air India Ahmedabad crash episode.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-helene-i40-recovery-arc',
    topic_id: 'replay-known-event-helene-i40-recovery-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'helene_i40_recovery_episode',
          'ap-helene-i40-delay-replay',
          'New damage delays I-40 reopening in North Carolina closed by Helene',
          'helene-i40-delay-replay-a',
          1_734_741_250_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/hurricane-helene-interstate-40-tennessee-north-carolina-b374045724088f421f6d1f54fc58cfa6',
            canonicalUrl:
              'https://apnews.com/article/hurricane-helene-interstate-40-tennessee-north-carolina-b374045724088f421f6d1f54fc58cfa6',
            entity_keys: [
              'helene_i40_recovery_episode',
              'hurricane_helene',
              'interstate_40',
              'pigeon_river_gorge',
              'transportation_recovery',
            ],
            cluster_text:
              'New slide damage delayed reopening of the same Interstate 40 corridor in the Pigeon River Gorge that Hurricane Helene had already destroyed, part of the same long-running recovery episode.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'helene_i40_recovery_episode',
          'ap-helene-i40-march-reopen-replay',
          'Stretch of North Carolina interstate that collapsed during Helene to reopen by March 1',
          'helene-i40-march-reopen-replay-b',
          1_739_222_342_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/hurricane-helene-interstate-40-tennessee-north-carolina-8a5d2efe3c3592266fe1cb9fe25790e9',
            canonicalUrl:
              'https://apnews.com/article/hurricane-helene-interstate-40-tennessee-north-carolina-8a5d2efe3c3592266fe1cb9fe25790e9',
            entity_keys: [
              'helene_i40_recovery_episode',
              'hurricane_helene',
              'interstate_40',
              'pigeon_river_gorge',
              'transportation_recovery',
            ],
            cluster_text:
              'Officials said the same Helene-damaged stretch of Interstate 40 would reopen by March 1, another phase in the ongoing repair of the washed-out Pigeon River Gorge corridor.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'helene_i40_recovery_episode',
          'ap-helene-i40-about-to-reopen-replay',
          'A stretch of a North Carolina highway that collapsed during Helene is about to reopen',
          'helene-i40-about-to-reopen-replay-c',
          1_740_758_348_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/hurricane-helene-interstate-40-tennessee-north-carolina-85c84cb1fcfcbf263f3c6313976d1d33',
            canonicalUrl:
              'https://apnews.com/article/hurricane-helene-interstate-40-tennessee-north-carolina-85c84cb1fcfcbf263f3c6313976d1d33',
            entity_keys: [
              'helene_i40_recovery_episode',
              'hurricane_helene',
              'interstate_40',
              'pigeon_river_gorge',
              'transportation_recovery',
            ],
            cluster_text:
              'Crews were about to reopen the same Helene-collapsed section of Interstate 40 in North Carolina after months of repairs in the Pigeon River Gorge.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'helene_i40_recovery_episode',
          'ap-helene-i40-rockslide-reopen-replay',
          'Interstate 40 in the Smoky Mountains reopens faster than expected after rock slide and flooding',
          'helene-i40-rockslide-reopen-replay-d',
          1_751_046_641_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/helene-i40-rock-slide-flooding-smoky-mountains-658368d310f4e94fc2d121e72d6e8d7c',
            canonicalUrl:
              'https://apnews.com/article/helene-i40-rock-slide-flooding-smoky-mountains-658368d310f4e94fc2d121e72d6e8d7c',
            entity_keys: [
              'helene_i40_recovery_episode',
              'hurricane_helene',
              'interstate_40',
              'pigeon_river_gorge',
              'transportation_recovery',
            ],
            cluster_text:
              'Interstate 40 reopened again after a rock slide and flooding in the same Helene recovery episode affecting the damaged Smoky Mountains corridor.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-ruidoso-flood-recovery-arc',
    topic_id: 'replay-known-event-ruidoso-flood-recovery-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'ruidoso_flood_recovery_episode',
          'ap-ruidoso-flood-missing-replay',
          '3 missing, house swept away as flash flooding hits mountain village in New Mexico',
          'ruidoso-flood-missing-replay-a',
          1_752_023_050_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/new-mexico-flash-flooding-ruidoso-rio-ruidoso-189b3133c9407f0164a8726b6522f3f3',
            canonicalUrl:
              'https://apnews.com/article/new-mexico-flash-flooding-ruidoso-rio-ruidoso-189b3133c9407f0164a8726b6522f3f3',
            entity_keys: [
              'ruidoso_flood_recovery_episode',
              'ruidoso',
              'rio_ruidoso',
              'new_mexico_flooding',
              'burn_scar_flooding',
            ],
            cluster_text:
              'Flash flooding hit Ruidoso and swept away a house, beginning the same mountain-village flood and recovery episode that later covered cleanup, home-damage counts, and disaster relief.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ruidoso_flood_recovery_episode',
          'ap-ruidoso-flood-cleanup-replay',
          'Flash flooding that killed 3 leaves New Mexico village heartbroken, anxious as cleanup begins',
          'ruidoso-flood-cleanup-replay-b',
          1_752_057_230_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/new-mexico-ruidoso-flooding-35b6427b581745f84dba09f06b38bc2d',
            canonicalUrl:
              'https://apnews.com/article/new-mexico-ruidoso-flooding-35b6427b581745f84dba09f06b38bc2d',
            entity_keys: [
              'ruidoso_flood_recovery_episode',
              'ruidoso',
              'rio_ruidoso',
              'new_mexico_flooding',
              'burn_scar_flooding',
            ],
            cluster_text:
              'Cleanup began in Ruidoso after the same deadly flash flood, continuing the same local disaster-and-recovery episode around the Rio Ruidoso.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ruidoso_flood_recovery_episode',
          'ap-ruidoso-flood-homes-damaged-replay',
          'As many as 200 homes damaged as officials survey the aftermath of a deadly New Mexico flood',
          'ruidoso-flood-homes-damaged-replay-c',
          1_752_120_995_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/new-mexico-flood-ruidoso-river-homes-damaged-350c4fd2de85d4eb7f9a8f89c994ddc0',
            canonicalUrl:
              'https://apnews.com/article/new-mexico-flood-ruidoso-river-homes-damaged-350c4fd2de85d4eb7f9a8f89c994ddc0',
            entity_keys: [
              'ruidoso_flood_recovery_episode',
              'ruidoso',
              'rio_ruidoso',
              'new_mexico_flooding',
              'burn_scar_flooding',
            ],
            cluster_text:
              'Officials counted heavy home damage after the same Ruidoso flood, another phase of the same village recovery episode following the deadly surge on the Rio Ruidoso.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ruidoso_flood_recovery_episode',
          'ap-ruidoso-flood-disaster-relief-replay',
          'Trump approves disaster relief for New Mexico mountain town battered by back-to-back floods',
          'ruidoso-flood-disaster-relief-replay-d',
          1_753_733_521_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/new-mexico-floods-ruidoso-disaster-relief-f791ff86b1540ff36afee34ccc53f9f1',
            canonicalUrl:
              'https://apnews.com/article/new-mexico-floods-ruidoso-disaster-relief-f791ff86b1540ff36afee34ccc53f9f1',
            entity_keys: [
              'ruidoso_flood_recovery_episode',
              'ruidoso',
              'rio_ruidoso',
              'new_mexico_flooding',
              'burn_scar_flooding',
            ],
            cluster_text:
              'Federal disaster relief followed back-to-back floods in Ruidoso as the same flood-recovery episode expanded from immediate damage into long-tail aid and rebuilding.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-lahaina-wildfire-recovery-arc',
    topic_id: 'replay-known-event-lahaina-wildfire-recovery-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'lahaina_wildfire_recovery_episode',
          'ap-lahaina-debris-site-replay',
          "Maui's mayor says Lahaina debris site will be used temporarily until a permanent spot is found",
          'lahaina-debris-site-replay-a',
          1_704_425_051_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/lahaina-wildfire-recovery-hawaii-maui-98cd9c85afce2ec23cd6d64de4d5e0c1',
            canonicalUrl:
              'https://apnews.com/article/lahaina-wildfire-recovery-hawaii-maui-98cd9c85afce2ec23cd6d64de4d5e0c1',
            entity_keys: [
              'lahaina_wildfire_recovery_episode',
              'lahaina',
              'maui',
              'wildfire_recovery',
              'survivor_housing',
              'debris_cleanup',
            ],
            cluster_text:
              'Officials said Lahaina wildfire debris would use a temporary Maui site while a permanent solution was found, part of the same long recovery episode after the wildfire destroyed Lahaina.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'lahaina_wildfire_recovery_episode',
          'ap-lahaina-housing-hotels-replay',
          'Hawaii says 30 Lahaina fire survivors are moving into housing daily but 3,000 are still in hotels',
          'lahaina-housing-hotels-replay-b',
          1_711_588_638_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/maui-fires-housing-hotels-lahaina-5ad15a8aab54fb4509a59c9f1ee101df',
            canonicalUrl:
              'https://apnews.com/article/maui-fires-housing-hotels-lahaina-5ad15a8aab54fb4509a59c9f1ee101df',
            entity_keys: [
              'lahaina_wildfire_recovery_episode',
              'lahaina',
              'maui',
              'wildfire_recovery',
              'survivor_housing',
              'debris_cleanup',
            ],
            cluster_text:
              'Housing placements for Lahaina fire survivors and thousands still living in hotels marked another recovery phase in the same Lahaina wildfire episode.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'lahaina_wildfire_recovery_episode',
          'ap-lahaina-fema-housing-extension-replay',
          'Maui wildfire survivors will get an additional year of housing help from FEMA',
          'lahaina-fema-housing-extension-replay-c',
          1_729_020_755_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/maui-wildfire-survivors-fema-housing-assistance-43d0769d714a2e665749cdd8f1e4d4b0',
            canonicalUrl:
              'https://apnews.com/article/maui-wildfire-survivors-fema-housing-assistance-43d0769d714a2e665749cdd8f1e4d4b0',
            entity_keys: [
              'lahaina_wildfire_recovery_episode',
              'lahaina',
              'maui',
              'wildfire_recovery',
              'survivor_housing',
              'debris_cleanup',
            ],
            cluster_text:
              'FEMA extended housing help for survivors in the same Lahaina wildfire recovery episode as families continued navigating long-term displacement.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'lahaina_wildfire_recovery_episode',
          'ap-lahaina-debris-haul-replay',
          '50 trucks will spend 5 months transporting Lahaina wildfire debris to a Maui landfill',
          'lahaina-debris-haul-replay-d',
          1_749_507_228_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/lahaina-wildfire-debris-landfill-d7229f8c6b294192fa33b25f4cbfae24',
            canonicalUrl:
              'https://apnews.com/article/lahaina-wildfire-debris-landfill-d7229f8c6b294192fa33b25f4cbfae24',
            entity_keys: [
              'lahaina_wildfire_recovery_episode',
              'lahaina',
              'maui',
              'wildfire_recovery',
              'survivor_housing',
              'debris_cleanup',
            ],
            cluster_text:
              'Large-scale debris hauling to a Maui landfill continued the same Lahaina wildfire recovery episode as cleanup stretched far beyond the initial disaster.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-iran-us-nuclear-talks-arc',
    topic_id: 'replay-known-event-iran-us-nuclear-talks-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'iran_us_nuclear_talks_episode',
          'ap-iran-us-direct-talks-announced-replay',
          'Trump says direct talks are underway with Iran over its nuclear program. Iran says they’ll be indirect',
          'iran-us-direct-talks-announced-replay-a',
          1_744_037_084_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/iran-us-trump-nuclear-direct-talks-negotiations-333965bef4f092fbc7e023c6c4a376a4',
            canonicalUrl:
              'https://apnews.com/article/iran-us-trump-nuclear-direct-talks-negotiations-333965bef4f092fbc7e023c6c4a376a4',
            entity_keys: [
              'iran_us_nuclear_talks_episode',
              'iran',
              'united_states',
              'abbas_araghchi',
              'steve_witkoff',
              'oman_talks',
              'iran_nuclear_program',
              'nuclear_negotiations',
            ],
            summary:
              'Trump said Steve Witkoff and Iran foreign minister Abbas Araghchi would enter a new Oman-mediated negotiation over Iran nuclear limits.',
            cluster_text:
              'Trump said Steve Witkoff and Abbas Araghchi were starting a new Oman-mediated negotiation over Iran nuclear limits, beginning the same 2025 Iran-US talks episode that later moved through Oman and Rome and into later bargaining over a possible deal.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'iran_us_nuclear_talks_episode',
          'ap-iran-us-first-round-replay',
          "Iran and US conclude 1st round of negotiations over Tehran's nuclear program in Oman",
          'iran-us-first-round-replay-b',
          1_744_451_130_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/iran-us-talks-oman-nuclear-program-10c7a5e301e1ca6ef35964302b1d0ebc',
            canonicalUrl:
              'https://apnews.com/article/iran-us-talks-oman-nuclear-program-10c7a5e301e1ca6ef35964302b1d0ebc',
            entity_keys: [
              'iran_us_nuclear_talks_episode',
              'iran',
              'united_states',
              'abbas_araghchi',
              'steve_witkoff',
              'oman_talks',
              'iran_nuclear_program',
              'nuclear_negotiations',
            ],
            summary:
              'Iran and the United States finished a first Oman round between Abbas Araghchi and Steve Witkoff over limits on Tehran nuclear program.',
            cluster_text:
              'Iran and the United States completed the first Oman round between Abbas Araghchi and Steve Witkoff in the same 2025 nuclear-negotiation episode over Tehran nuclear limits.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'iran_us_nuclear_talks_episode',
          'ap-iran-us-next-round-rome-replay',
          'Iran says next round of negotiations with US over its nuclear program will be in Rome',
          'iran-us-next-round-rome-replay-c',
          1_746_001_440_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/iran-us-talks-nuclear-program-rome-sanctions-f14ecb6c0cb50a19c52357162c3a8f9d',
            canonicalUrl:
              'https://apnews.com/article/iran-us-talks-nuclear-program-rome-sanctions-f14ecb6c0cb50a19c52357162c3a8f9d',
            entity_keys: [
              'iran_us_nuclear_talks_episode',
              'iran',
              'united_states',
              'abbas_araghchi',
              'steve_witkoff',
              'oman_talks',
              'rome_talks',
              'iran_nuclear_program',
              'nuclear_negotiations',
            ],
            summary:
              'Iran said the same Abbas Araghchi and Steve Witkoff nuclear talks would continue in Rome after the first Oman round.',
            cluster_text:
              'Iran said the next round of the same Abbas Araghchi-Steve Witkoff nuclear negotiations would move from Oman to Rome, extending the same 2025 talks episode.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'iran_us_nuclear_talks_episode',
          'ap-iran-us-deal-not-imminent-replay',
          'Iran’s foreign minister says no date and no time for next US nuclear talks, says deal not imminent',
          'iran-us-deal-not-imminent-replay-d',
          1_748_542_933_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/iran-us-nuclear-talks-trump-oman-04ad18cb1815187f4d18f5af2d25cf75',
            canonicalUrl:
              'https://apnews.com/article/iran-us-nuclear-talks-trump-oman-04ad18cb1815187f4d18f5af2d25cf75',
            entity_keys: [
              'iran_us_nuclear_talks_episode',
              'iran',
              'united_states',
              'abbas_araghchi',
              'steve_witkoff',
              'oman_talks',
              'rome_talks',
              'iran_nuclear_program',
              'nuclear_negotiations',
            ],
            summary:
              'Abbas Araghchi said no new date was set for the same Oman-Rome nuclear talks with US envoy Steve Witkoff and no deal was imminent.',
            cluster_text:
              'Abbas Araghchi said no new date was set and no deal was imminent in the same Oman-and-Rome nuclear talks episode with Steve Witkoff over Iran nuclear limits.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-trump-library-vs-kennedy-separation',
    topic_id: 'replay-known-event-trump-library-vs-kennedy-separation',
    ticks: [
      [
        makeBenchmarkItem(
          'trump_presidential_library_design_episode',
          'nbc-trump-library-design-replay',
          'Design for Trump’s presidential library draws praise and protest in Miami',
          'trump-library-design-nbc-replay-a',
          1_775_030_000_000,
          {
            publisher: 'NBC News',
            url: 'https://www.nbcnews.com/politics/donald-trump/design-trumps-presidential-library-draws-praise-protest-miami-rcna207950',
            canonicalUrl:
              'https://www.nbcnews.com/politics/donald-trump/design-trumps-presidential-library-draws-praise-protest-miami-rcna207950',
            entity_keys: [
              'trump_presidential_library_design_episode',
              'donald_trump',
              'presidential_library',
              'miami',
              'architecture',
            ],
            cluster_text:
              'A design for Trump’s presidential library in Miami drew praise and protest, centering on architecture, donors, and local opposition around the proposed library project.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'trump_presidential_library_design_episode',
          'nbc-trump-library-design-replay',
          'Design for Trump’s presidential library draws praise and protest in Miami',
          'trump-library-design-nbc-replay-a',
          1_775_030_000_000,
          {
            publisher: 'NBC News',
            url: 'https://www.nbcnews.com/politics/donald-trump/design-trumps-presidential-library-draws-praise-protest-miami-rcna207950',
            canonicalUrl:
              'https://www.nbcnews.com/politics/donald-trump/design-trumps-presidential-library-draws-praise-protest-miami-rcna207950',
            entity_keys: [
              'trump_presidential_library_design_episode',
              'donald_trump',
              'presidential_library',
              'miami',
              'architecture',
            ],
            cluster_text:
              'A design for Trump’s presidential library in Miami drew praise and protest, centering on architecture, donors, and local opposition around the proposed library project.',
          },
        ),
        makeBenchmarkItem(
          'kennedy_center_chicago_visit_episode',
          'nbc-kennedy-chicago-replay',
          "Trump attends Kennedy Center performance of 'Chicago' ahead of planned two-year closure",
          'kennedy-chicago-nbc-replay-b',
          1_775_030_600_000,
          {
            publisher: 'NBC News',
            url: 'https://www.nbcnews.com/politics/donald-trump/trump-attends-kennedy-center-performance-chicago-ahead-planned-two-year-closure-rcna208011',
            canonicalUrl:
              'https://www.nbcnews.com/politics/donald-trump/trump-attends-kennedy-center-performance-chicago-ahead-planned-two-year-closure-rcna208011',
            entity_keys: [
              'kennedy_center_chicago_visit_episode',
              'donald_trump',
              'kennedy_center',
              'chicago_musical',
              'closure_plan',
            ],
            cluster_text:
              'Trump attended a Kennedy Center performance of Chicago ahead of the venue’s planned two-year closure, focusing on the arts venue, the closure timeline, and Trump’s cultural takeover of the institution.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-cuba-tanker-source-growth',
    topic_id: 'replay-known-event-cuba-tanker-source-growth',
    ticks: [
      [
        makeBenchmarkItem(
          'cuba_russian_tanker_episode',
          'guardian-world-cuba-tanker-replay',
          'Russian oil tanker heading to Cuba amid US economic blockade',
          'cuba-tanker-guardian-replay-a',
          1_773_957_300_000,
          {
            publisher: 'The Guardian',
            url: 'https://www.theguardian.com/world/2026/mar/19/cuba-us-economic-blockade-trump-russian-oil-tanker',
            canonicalUrl: 'https://www.theguardian.com/world/2026/mar/19/cuba-us-economic-blockade-trump-russian-oil-tanker',
            entity_keys: [
              'cuba_russian_tanker_episode',
              'cuba',
              'russian_oil_tanker',
              'economic_blockade',
              'fuel_shipments',
            ],
            cluster_text:
              'A Russian oil tanker was heading to Cuba amid a US economic blockade, starting the same Cuba tanker episode about fuel shipments, blackout pressure, and the Trump administration’s stance toward deliveries to the island.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'cuba_russian_tanker_episode',
          'cbs-cuba-tanker-replay',
          'Trump says he has "no problem" with Russian tanker bringing oil to Cuba',
          'cuba-tanker-cbs-replay-b',
          1_774_866_620_000,
          {
            publisher: 'CBS News',
            url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem/',
            canonicalUrl: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem',
            entity_keys: [
              'cuba_russian_tanker_episode',
              'cuba',
              'russian_oil_tanker',
              'donald_trump',
              'fuel_shipments',
            ],
            cluster_text:
              'Trump said he had no problem with a Russian tanker bringing oil to Cuba in the same Cuba tanker episode about whether the delivery would be allowed to reach the island during fuel pressure and blockade conditions.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-cuba-tanker-vs-trump-opinion-separation',
    topic_id: 'replay-known-event-cuba-tanker-vs-trump-opinion-separation',
    ticks: [
      [
        makeBenchmarkItem(
          'cuba_russian_tanker_episode',
          'cbs-cuba-tanker-separation-replay',
          'Trump says he has "no problem" with Russian tanker bringing oil to Cuba',
          'cuba-tanker-separation-cbs-replay-a',
          1_774_866_620_000,
          {
            publisher: 'CBS News',
            url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem/',
            canonicalUrl: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem',
            entity_keys: [
              'cuba_russian_tanker_episode',
              'cuba',
              'russian_oil_tanker',
              'donald_trump',
              'fuel_shipments',
            ],
            cluster_text:
              'Trump said he had no problem with a Russian tanker bringing oil to Cuba, part of the same Cuba fuel-shipment episode over whether the tanker would be allowed to reach the island.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'cuba_russian_tanker_episode',
          'cbs-cuba-tanker-separation-replay',
          'Trump says he has "no problem" with Russian tanker bringing oil to Cuba',
          'cuba-tanker-separation-cbs-replay-a',
          1_774_866_620_000,
          {
            publisher: 'CBS News',
            url: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem/',
            canonicalUrl: 'https://www.cbsnews.com/news/cuba-blockade-russian-tanker-trump-no-problem',
            entity_keys: [
              'cuba_russian_tanker_episode',
              'cuba',
              'russian_oil_tanker',
              'donald_trump',
              'fuel_shipments',
            ],
            cluster_text:
              'Trump said he had no problem with a Russian tanker bringing oil to Cuba, part of the same Cuba fuel-shipment episode over whether the tanker would be allowed to reach the island.',
          },
        ),
        makeBenchmarkItem(
          'trump_democrats_primary_opinion_episode',
          'guardian-trump-opinion-replay',
          'For Democrats, fighting Trump isn’t enough anymore',
          'trump-opinion-guardian-replay-b',
          1_774_864_807_000,
          {
            publisher: 'The Guardian',
            url: 'https://www.theguardian.com/commentisfree/2026/mar/30/democrats-trump-dan-goldman-brad-lander',
            canonicalUrl:
              'https://www.theguardian.com/commentisfree/2026/mar/30/democrats-trump-dan-goldman-brad-lander',
            entity_keys: [
              'trump_democrats_primary_opinion_episode',
              'donald_trump',
              'democratic_primary',
              'new_york',
              'opinion',
            ],
            cluster_text:
              'A Guardian opinion essay argued that Democrats need a positive political agenda beyond opposing Trump, focusing on the New York 10th district primary and ideological conflicts inside the Democratic party.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-dhs-airport-shutdown-source-growth',
    topic_id: 'replay-known-event-dhs-airport-shutdown-source-growth',
    ticks: [
      [
        makeBenchmarkItem(
          'dhs_shutdown_airport_disruption_episode',
          'bbc-dhs-shutdown-airport-replay',
          'Partial government shutdown becomes the longest in US history',
          'dhs-shutdown-bbc-replay-a',
          1_774_833_231_000,
          {
            publisher: 'BBC News',
            url: 'https://www.bbc.com/news/articles/cyv1qpzq5v7o?at_medium=RSS&at_campaign=rss',
            canonicalUrl: 'https://www.bbc.com/news/articles/cyv1qpzq5v7o?at_campaign=rss&at_medium=RSS',
            entity_keys: [
              'dhs_shutdown_airport_disruption_episode',
              'dhs_shutdown',
              'tsa',
              'airports',
              'travel_delays',
            ],
            cluster_text:
              'The Department of Homeland Security shutdown became the longest in US history and caused travel chaos at airports, beginning the same shutdown-and-airport-disruption episode over TSA staffing, lines, and political stalemate.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'dhs_shutdown_airport_disruption_episode',
          'abc-dhs-shutdown-airport-replay',
          'TSA pay may be coming, but airport delays could persist and ICE agents may not leave soon',
          'dhs-shutdown-abc-replay-b',
          1_774_829_322_000,
          {
            publisher: 'ABC News',
            url: 'https://abcnews.com/Politics/wireStory/tsa-pay-coming-airport-delays-persist-ice-agents-131505159',
            canonicalUrl: 'https://abcnews.com/Politics/wireStory/tsa-pay-coming-airport-delays-persist-ice-agents-131505159',
            entity_keys: [
              'dhs_shutdown_airport_disruption_episode',
              'dhs_shutdown',
              'tsa',
              'airports',
              'ice_officers',
            ],
            cluster_text:
              'Trump signed an order on TSA pay while airport delays persisted and ICE agents remained in the same DHS shutdown airport-disruption episode about staffing shortages and long security lines.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'dhs_shutdown_airport_disruption_episode',
          'wapo-dhs-shutdown-airport-replay',
          'Long lines persist at some U.S. airports despite arrival of ICE officers',
          'dhs-shutdown-wapo-replay-c',
          1_774_270_800_000,
          {
            publisher: 'The Washington Post',
            url: 'https://www.washingtonpost.com/immigration/2026/03/23/ice-agents-airports/',
            canonicalUrl: 'https://www.washingtonpost.com/immigration/2026/03/23/ice-agents-airports/',
            entity_keys: [
              'dhs_shutdown_airport_disruption_episode',
              'dhs_shutdown',
              'tsa',
              'airports',
              'ice_officers',
            ],
            cluster_text:
              'Long lines persisted at US airports despite the arrival of ICE officers in the same DHS shutdown airport-disruption episode about TSA staffing shortages and the funding impasse.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'dhs_shutdown_airport_disruption_episode',
          'nbc-dhs-shutdown-airport-replay',
          "'I blame them all': Travelers frustrated with Washington as shutdown drags on",
          'dhs-shutdown-nbc-replay-d',
          1_774_861_860_000,
          {
            publisher: 'NBC News',
            url: 'https://www.nbcnews.com/politics/congress/travelers-frustrated-washington-shutdown-blame-rcna265602',
            canonicalUrl:
              'https://www.nbcnews.com/politics/congress/travelers-frustrated-washington-shutdown-blame-rcna265602',
            entity_keys: [
              'dhs_shutdown_airport_disruption_episode',
              'dhs_shutdown',
              'travelers',
              'airports',
              'travel_delays',
            ],
            cluster_text:
              'Travelers blamed Washington as the same DHS shutdown dragged on, capturing the same airport-disruption episode that left airline workers strained and airport lines snarled.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-gaza-ceasefire-2025-arc',
    topic_id: 'replay-known-event-gaza-ceasefire-2025-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'gaza_ceasefire_2025_episode',
          'ap-gaza-draft-deal-replay',
          'Israel and Hamas are still hammering out details of ceasefire deal as Israeli strikes continue',
          'gaza-draft-deal-replay-a',
          1_736_819_169_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/israel-palestinians-hamas-war-news-01-14-2025-29ca4f67de4a59ea7d0d91b308f1db17',
            canonicalUrl:
              'https://apnews.com/article/israel-palestinians-hamas-war-news-01-14-2025-29ca4f67de4a59ea7d0d91b308f1db17',
            entity_keys: [
              'gaza_ceasefire_2025_episode',
              'gaza',
              'israel',
              'hamas',
              'hostage_ceasefire_negotiations',
            ],
            cluster_text:
              'Israel and Hamas were still finalizing the same 2025 Gaza ceasefire-and-hostage agreement, starting the same negotiation and implementation episode that later brought disputes over extensions and eventually renewed strikes.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'gaza_ceasefire_2025_episode',
          'ap-gaza-ceasefire-holding-replay',
          'Hamas names 3 hostages to be freed as part of Gaza ceasefire agreement',
          'gaza-ceasefire-holding-replay-b',
          1_739_543_059_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/israel-palestinians-hamas-war-news-ceasefire-hostages-february-14-16c9073d4cace9bd5559604f8ee2bb5f',
            canonicalUrl:
              'https://apnews.com/article/israel-palestinians-hamas-war-news-ceasefire-hostages-february-14-16c9073d4cace9bd5559604f8ee2bb5f',
            entity_keys: [
              'gaza_ceasefire_2025_episode',
              'gaza',
              'israel',
              'hamas',
              'hostage_ceasefire_negotiations',
            ],
            cluster_text:
              'Hamas named hostages for release while the same 2025 Gaza ceasefire agreement was being implemented, part of the same hostage-for-ceasefire episode.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'gaza_ceasefire_2025_episode',
          'ap-gaza-phase-extension-dispute-replay',
          'Israel backs what it says is a new US proposal to extend the Gaza ceasefire. Hamas rejects it',
          'gaza-phase-extension-dispute-replay-c',
          1_740_825_956_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/israel-palestinians-hamas-war-ceasefire-hostages-caf2f1ac4ead0f3b8a31fe52eb0a31e2',
            canonicalUrl:
              'https://apnews.com/article/israel-palestinians-hamas-war-ceasefire-hostages-caf2f1ac4ead0f3b8a31fe52eb0a31e2',
            entity_keys: [
              'gaza_ceasefire_2025_episode',
              'gaza',
              'israel',
              'hamas',
              'hostage_ceasefire_negotiations',
            ],
            cluster_text:
              'Israel backed a proposal to extend the same 2025 Gaza ceasefire while Hamas rejected it, continuing the same hostages-and-truce negotiation episode.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'gaza_ceasefire_2025_episode',
          'ap-gaza-ceasefire-breakdown-replay',
          'Israeli strikes kill more than 400 Palestinians and shatter weeks of relative calm in Gaza',
          'gaza-ceasefire-breakdown-replay-d',
          1_742_244_990_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/israel-palestinians-hamas-war-news-ceasefire-hostages-03-17-2025-b0fd9732f1c74092b23fd01e3bfb922c',
            canonicalUrl:
              'https://apnews.com/article/israel-palestinians-hamas-war-news-ceasefire-hostages-03-17-2025-b0fd9732f1c74092b23fd01e3bfb922c',
            entity_keys: [
              'gaza_ceasefire_2025_episode',
              'gaza',
              'israel',
              'hamas',
              'hostage_ceasefire_negotiations',
            ],
            cluster_text:
              'Israeli strikes shattered the relative calm in the same 2025 Gaza ceasefire episode after weeks of implementation disputes and stalled hostage negotiations.',
          },
        ),
      ],
    ],
  },
  {
    scenario_id: 'replay-known-event-ukraine-istanbul-talks-arc',
    topic_id: 'replay-known-event-ukraine-istanbul-talks-arc',
    ticks: [
      [
        makeBenchmarkItem(
          'ukraine_istanbul_talks_episode',
          'ap-ukraine-istanbul-first-talks-replay',
          'First direct Russia-Ukraine peace talks since early weeks of war end after less than 2 hours',
          'ukraine-istanbul-first-talks-replay-a',
          1_747_382_938_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/russia-ukraine-war-talks-istanbul-putin-zelenskyy-trump-6cb5845a50fb6ba9a151eadd5bdbce18',
            canonicalUrl:
              'https://apnews.com/article/russia-ukraine-war-talks-istanbul-putin-zelenskyy-trump-6cb5845a50fb6ba9a151eadd5bdbce18',
            entity_keys: [
              'ukraine_istanbul_talks_episode',
              'russia',
              'ukraine',
              'istanbul_talks',
              'ceasefire_negotiations',
            ],
            cluster_text:
              'Russia and Ukraine held the first direct Istanbul peace talks of the 2025 negotiation drive, beginning the same talks episode that later covered scheduling disputes, humanitarian exchanges, and fresh proposals.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ukraine_istanbul_talks_episode',
          'ap-ukraine-no-new-talks-replay',
          'No new direct Russia-Ukraine talks are scheduled, Kremlin says',
          'ukraine-no-new-talks-replay-b',
          1_747_915_338_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/russia-ukraine-war-prisoners-pow-exchange-istanbul-b04e31f74d6f0de83fa773c759f04bde',
            canonicalUrl:
              'https://apnews.com/article/russia-ukraine-war-prisoners-pow-exchange-istanbul-b04e31f74d6f0de83fa773c759f04bde',
            entity_keys: [
              'ukraine_istanbul_talks_episode',
              'russia',
              'ukraine',
              'istanbul_talks',
              'ceasefire_negotiations',
            ],
            cluster_text:
              'The Kremlin said no new direct talks were scheduled in the same Istanbul peace-process episode even as negotiation follow-up and prisoner issues remained active.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ukraine_istanbul_talks_episode',
          'ap-ukraine-bodies-repatriated-replay',
          'Russia and Ukraine say more bodies have been repatriated, in line with an agreement reached at talks in Istanbul',
          'ukraine-bodies-repatriated-replay-c',
          1_749_834_600_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/russia-ukraine-war-bodies-repatriated-istanbul-talks-3ec950056d00554207c26138ff4e2c8d',
            canonicalUrl:
              'https://apnews.com/article/russia-ukraine-war-bodies-repatriated-istanbul-talks-3ec950056d00554207c26138ff4e2c8d',
            entity_keys: [
              'ukraine_istanbul_talks_episode',
              'russia',
              'ukraine',
              'istanbul_talks',
              'ceasefire_negotiations',
            ],
            cluster_text:
              'Russia and Ukraine repatriated more bodies under the same Istanbul agreement, extending the same 2025 direct-talks episode into humanitarian follow-through.',
          },
        ),
      ],
      [
        makeBenchmarkItem(
          'ukraine_istanbul_talks_episode',
          'ap-ukraine-ready-fresh-talks-replay',
          'Putin says Russia is ready for fresh round of direct peace talks with Ukraine',
          'ukraine-ready-fresh-talks-replay-d',
          1_751_019_358_000,
          {
            publisher: 'AP News',
            url: 'https://apnews.com/article/russia-ukraine-war-putin-peace-talks-492f81d93f860a179278fdc0ecf2a93f',
            canonicalUrl:
              'https://apnews.com/article/russia-ukraine-war-putin-peace-talks-492f81d93f860a179278fdc0ecf2a93f',
            entity_keys: [
              'ukraine_istanbul_talks_episode',
              'russia',
              'ukraine',
              'istanbul_talks',
              'ceasefire_negotiations',
            ],
            cluster_text:
              'Putin said Russia was ready for another direct round in the same Istanbul peace-talks episode, continuing the 2025 ceasefire-and-negotiation track.',
          },
        ),
      ],
    ],
  },
];
