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
];
