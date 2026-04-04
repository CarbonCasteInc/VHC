import type { StoryClusterCoherenceAuditDataset } from './coherenceAudit';
import type { StoryClusterBenchmarkPairExpectation } from './benchmarkCorpusFixtures';
import { makeBenchmarkItem } from './benchmarkCorpusBuilders';

export const STORYCLUSTER_KNOWN_EVENT_ONGOING_FIXTURE_DATASETS: StoryClusterCoherenceAuditDataset[] = [
  {
    dataset_id: 'fixture-known-event-ongoing-kennedy-center',
    topic_id: 'fixture-known-event-ongoing-kennedy-center',
    items: [
      makeBenchmarkItem(
        'kennedy_center_takeover_episode',
        'pbs-kennedy-closure',
        'Kennedy Center to close for 2 years for renovations in July, Trump says, after wave of cancellations',
        'kennedy-closure-pbs',
        1_770_531_360_000,
        {
          publisher: 'PBS News',
          url: 'https://www.pbs.org/newshour/politics/kennedy-center-to-close-for-2-years-for-renovations-in-july-trump-says-after-wave-of-cancellations',
          canonicalUrl: 'https://www.pbs.org/newshour/politics/kennedy-center-to-close-for-2-years-for-renovations-in-july-trump-says-after-wave-of-cancellations',
          entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'renovation_closure', 'richard_grenell'],
          cluster_text: 'Trump said the Kennedy Center would close for two years for renovations, starting the same Kennedy Center takeover and closure episode that later brought staffing cuts, leadership turmoil, and board conflict.',
        },
      ),
      makeBenchmarkItem(
        'kennedy_center_takeover_episode',
        'ap-kennedy-staff-cuts',
        "Kennedy Center head warns staff of cuts and 'skeletal' staffing during renovation closure",
        'kennedy-staff-cuts-ap',
        1_771_338_164_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/9eb9e9fa2368c3eb6fad1c57a90c3407',
          canonicalUrl: 'https://apnews.com/article/9eb9e9fa2368c3eb6fad1c57a90c3407',
          entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'renovation_closure', 'richard_grenell'],
          cluster_text: 'Richard Grenell warned Kennedy Center staff that the same two-year renovation closure would bring cuts and skeletal staffing.',
        },
      ),
      makeBenchmarkItem(
        'kennedy_center_takeover_episode',
        'ap-kennedy-grenell-step-down',
        'Trump ally Ric Grenell stepping down as Kennedy Center president',
        'kennedy-grenell-step-down-ap',
        1_773_514_126_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/6bf4f74ea5f0e80abf8f9c181cdd431a',
          canonicalUrl: 'https://apnews.com/article/6bf4f74ea5f0e80abf8f9c181cdd431a',
          entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'richard_grenell', 'board_meeting'],
          cluster_text: 'Richard Grenell said he was stepping down as Kennedy Center president during the same Kennedy Center takeover fight over the renovation closure and board control.',
        },
      ),
      makeBenchmarkItem(
        'kennedy_center_takeover_episode',
        'ap-kennedy-board-showdown',
        'A seat at the table, but no vote yet for a Democratic lawmaker in the Kennedy Center board showdown',
        'kennedy-board-showdown-ap',
        1_773_584_235_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/53d19b342753174b9a90b9c21aa9fa0c',
          canonicalUrl: 'https://apnews.com/article/53d19b342753174b9a90b9c21aa9fa0c',
          entity_keys: ['kennedy_center_takeover_episode', 'kennedy_center', 'richard_grenell', 'board_meeting'],
          cluster_text: 'A judge let a Democratic lawmaker attend the same Kennedy Center board showdown tied to Grenell, the renovation closure plan, and Trump’s takeover of the institution.',
        },
      ),
      makeBenchmarkItem(
        'kennedy_center_takeover_commentary',
        'pbs-kennedy-grenell-interview',
        'We cannot have art institutions that lose money: Grenell defends Kennedy Center takeover',
        'kennedy-grenell-interview-pbs',
        1_767_701_380_000,
        {
          publisher: 'PBS News',
          url: 'https://www.pbs.org/newshour/show/we-cannot-have-art-institutions-that-lose-money-grenell-defends-kennedy-center-takeover',
          canonicalUrl: 'https://www.pbs.org/newshour/show/we-cannot-have-art-institutions-that-lose-money-grenell-defends-kennedy-center-takeover',
          entity_keys: ['kennedy_center_takeover_commentary', 'kennedy_center', 'richard_grenell', 'trump_takeover'],
          coverage_role: 'related',
          cluster_text: 'Grenell defended Trump’s Kennedy Center takeover in a PBS interview about the institution’s finances and direction.',
        },
      ),
    ],
  },
  {
    dataset_id: 'fixture-known-event-ongoing-fed-powell',
    topic_id: 'fixture-known-event-ongoing-fed-powell',
    items: [
      makeBenchmarkItem(
        'fed_powell_subpoena_episode',
        'ap-fed-subpoena',
        'Federal Reserve Chair Powell says DOJ has subpoenaed central bank, threatens criminal indictment',
        'fed-subpoena-ap',
        1_768_180_699_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/bf4fc6c690fa248fbc531bc9bc7f1758',
          canonicalUrl: 'https://apnews.com/article/bf4fc6c690fa248fbc531bc9bc7f1758',
          entity_keys: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
          cluster_text: 'Jerome Powell said the Justice Department subpoenaed the Federal Reserve over the same building-renovation probe and threatened criminal charges.',
        },
      ),
      makeBenchmarkItem(
        'fed_powell_subpoena_episode',
        'ap-fed-backlash',
        'DOJ investigation of Fed Chair Powell sparks backlash, support for Fed independence',
        'fed-backlash-ap',
        1_768_234_798_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/d87eedf1e35195957f903f9963aeaf99',
          canonicalUrl: 'https://apnews.com/article/d87eedf1e35195957f903f9963aeaf99',
          entity_keys: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
          cluster_text: 'The same Justice Department subpoena fight over Federal Reserve building renovations triggered backlash and new defenses of Fed independence.',
        },
      ),
      makeBenchmarkItem(
        'fed_powell_subpoena_episode',
        'ap-fed-judge-quash',
        "Judge quashes subpoenas in Justice Department's investigation of Fed chair Jerome Powell",
        'fed-judge-quash-ap',
        1_773_509_513_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/0fdd36447a6aa8ae3e7125930d03950f',
          canonicalUrl: 'https://apnews.com/article/0fdd36447a6aa8ae3e7125930d03950f',
          entity_keys: ['fed_powell_subpoena_episode', 'jerome_powell', 'federal_reserve', 'doj_subpoenas', 'building_renovation_probe'],
          cluster_text: 'A federal judge quashed the same Justice Department subpoenas aimed at Jerome Powell and the Federal Reserve building-renovation probe.',
        },
      ),
      makeBenchmarkItem(
        'fed_powell_subpoena_explainer',
        'ap-fed-what-we-know',
        "Bringing charges against the Fed: What we do (and don't) know",
        'fed-explainer-ap',
        1_768_245_330_000,
        {
          publisher: 'AP News',
          url: 'https://apnews.com/article/b5676bc638f04b3b528372b59673d804',
          canonicalUrl: 'https://apnews.com/article/b5676bc638f04b3b528372b59673d804',
          entity_keys: ['fed_powell_subpoena_explainer', 'jerome_powell', 'federal_reserve', 'doj_subpoenas'],
          coverage_role: 'related',
          cluster_text: 'An AP explainer laid out the legal theories and open questions around the Justice Department pressure campaign against Jerome Powell.',
        },
      ),
    ],
  },
  {
    dataset_id: 'fixture-known-event-ongoing-flag-burn-order-fallout',
    topic_id: 'fixture-known-event-ongoing-flag-burn-order-fallout',
    items: [
      makeBenchmarkItem(
        'white_house_flag_burning_episode',
        'ap-flag-ban-order',
        'Trump moves to ban flag burning despite Supreme Court ruling that Constitution allows it',
        'flag-ban-order-ap',
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
      makeBenchmarkItem(
        'white_house_flag_burning_episode',
        'ap-flag-case-dismissal',
        'Feds move to dismiss charges against Army veteran who burned American flag near White House',
        'flag-case-dismissal-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-teacher-prank-fallout',
    topic_id: 'fixture-known-event-ongoing-teacher-prank-fallout',
    items: [
      makeBenchmarkItem(
        'teacher_prank_death_episode',
        'ap-prank-adult-charge',
        "Georgia teen charged as an adult in death of teacher hit by car after 'senior prank'",
        'teacher-prank-adult-charge-ap',
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
      makeBenchmarkItem(
        'teacher_prank_death_episode',
        'ap-prank-charges-dropped',
        'Charges dropped against teens whose teacher died during toilet paper prank',
        'teacher-prank-charges-dropped-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-fani-willis-fallout',
    topic_id: 'fixture-known-event-ongoing-fani-willis-fallout',
    items: [
      makeBenchmarkItem(
        'fani_willis_postdismissal_episode',
        'ap-willis-legal-fees',
        "Trump seeks $6.2 million in legal fees from Fani Willis' office over election interference case",
        'fani-willis-legal-fees-ap',
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
      makeBenchmarkItem(
        'fani_willis_postdismissal_episode',
        'ap-willis-gop-bills',
        'Georgia Republicans push more bills aimed at Fulton County DA Fani Willis',
        'fani-willis-gop-bills-ap',
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
      makeBenchmarkItem(
        'fani_willis_postdismissal_episode',
        'ap-wade-hearing',
        'State lawmakers grill former special prosecutor Nathan Wade over Georgia Trump election case',
        'nathan-wade-hearing-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-eric-adams-dismissal',
    topic_id: 'fixture-known-event-ongoing-eric-adams-dismissal',
    items: [
      makeBenchmarkItem(
        'eric_adams_corruption_dismissal_episode',
        'reuters-adams-doj-dismissal',
        'US Justice Department seeks dismissal of corruption case against New York Mayor Eric Adams',
        'eric-adams-doj-dismissal-reuters',
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
      makeBenchmarkItem(
        'eric_adams_corruption_dismissal_episode',
        'reuters-adams-judge-weighs-dismissal',
        'Judge cancels Eric Adams trial, weighs DOJ request to dismiss charges',
        'eric-adams-judge-weighs-dismissal-reuters',
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
      makeBenchmarkItem(
        'eric_adams_corruption_dismissal_episode',
        'reuters-adams-case-dismissed',
        'Judge dismisses corruption case against New York Mayor Eric Adams',
        'eric-adams-case-dismissed-reuters',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-mahmoud-khalil',
    topic_id: 'fixture-known-event-ongoing-mahmoud-khalil',
    items: [
      makeBenchmarkItem(
        'mahmoud_khalil_detention_episode',
        'reuters-khalil-new-jersey-challenge',
        'Mahmoud Khalil can challenge detention in New Jersey, appeals court says',
        'mahmoud-khalil-new-jersey-challenge-reuters',
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
      makeBenchmarkItem(
        'mahmoud_khalil_detention_episode',
        'reuters-khalil-can-be-deported',
        'US judge says Trump administration can deport Columbia activist Mahmoud Khalil',
        'mahmoud-khalil-can-be-deported-reuters',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-abrego-garcia',
    topic_id: 'fixture-known-event-ongoing-abrego-garcia',
    items: [
      makeBenchmarkItem(
        'abrego_garcia_wrongful_deportation_episode',
        'reuters-abrego-no-detention-before-trial',
        'Judge says wrongfully deported Abrego Garcia should not be detained before trial',
        'abrego-no-detention-before-trial-reuters',
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
      makeBenchmarkItem(
        'abrego_garcia_wrongful_deportation_episode',
        'reuters-abrego-lawsuit-dismissal-bid',
        "Trump administration seeks to dismiss Kilmar Abrego Garcia's lawsuit over deportation",
        'abrego-lawsuit-dismissal-bid-reuters',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-rumeysa-ozturk',
    topic_id: 'fixture-known-event-ongoing-rumeysa-ozturk',
    items: [
      makeBenchmarkItem(
        'rumeysa_ozturk_detention_episode',
        'ap-ozturk-transfer-paused',
        "Appeals court pauses Tufts student's transfer to Vermont in immigration detention case",
        'ozturk-transfer-paused-ap',
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
      makeBenchmarkItem(
        'rumeysa_ozturk_detention_episode',
        'ap-ozturk-return-ordered',
        'Appeals court orders ICE to return detained Turkish Tufts University student to Vermont',
        'ozturk-return-ordered-ap',
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
      makeBenchmarkItem(
        'rumeysa_ozturk_detention_episode',
        'ap-ozturk-released',
        'Turkish Tufts University student released from Louisiana immigration detention center',
        'ozturk-released-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-mohsen-mahdawi',
    topic_id: 'fixture-known-event-ongoing-mohsen-mahdawi',
    items: [
      makeBenchmarkItem(
        'mohsen_mahdawi_detention_episode',
        'ap-mahdawi-arrested',
        'A Palestinian activist expecting a US citizenship interview is arrested instead by ICE in Vermont',
        'mahdawi-arrested-ap',
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
      makeBenchmarkItem(
        'mohsen_mahdawi_detention_episode',
        'ap-mahdawi-hearing-set',
        'Palestinian student remains detained in Vermont with a hearing set for next week',
        'mahdawi-hearing-set-ap',
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
      makeBenchmarkItem(
        'mohsen_mahdawi_detention_episode',
        'ap-mahdawi-released',
        'A Palestinian student at Columbia is freed after his arrest at a citizenship interview',
        'mahdawi-released-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-ras-baraka',
    topic_id: 'fixture-known-event-ongoing-ras-baraka',
    items: [
      makeBenchmarkItem(
        'ras_baraka_delaney_hall_episode',
        'ap-baraka-arrested',
        'Newark mayor denies trespassing at immigration detention center following arrest',
        'baraka-arrested-ap',
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
      makeBenchmarkItem(
        'ras_baraka_delaney_hall_episode',
        'ap-baraka-court-appearance',
        "Newark Mayor Ras Baraka says officials fingerprinting him second time tried to 'humiliate' him",
        'baraka-court-appearance-ap',
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
      makeBenchmarkItem(
        'ras_baraka_delaney_hall_episode',
        'ap-baraka-sues-habba',
        "Newark mayor sues New Jersey's top federal prosecutor after arrest at immigration detention site",
        'baraka-sues-habba-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-voice-of-america',
    topic_id: 'fixture-known-event-ongoing-voice-of-america',
    items: [
      makeBenchmarkItem(
        'voice_of_america_dismantling_episode',
        'ap-voa-blocks-firings',
        'Voice of America wins in court, for now, as judge blocks Trump administration from firing staff',
        'voa-blocks-firings-ap',
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
      makeBenchmarkItem(
        'voice_of_america_dismantling_episode',
        'ap-voa-blocks-dismantling',
        'Federal judge blocks Trump administration from dismantling Voice of America',
        'voa-blocks-dismantling-ap',
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
      makeBenchmarkItem(
        'voice_of_america_dismantling_episode',
        'ap-voa-restore-order-ignored',
        "Judge orders Trump administration to explain why order to restore Voice of America wasn't followed",
        'voa-restore-order-ignored-ap',
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
      makeBenchmarkItem(
        'voice_of_america_dismantling_episode',
        'ap-voa-suspends-job-cuts',
        "Judge suspends Trump administration's plan to eliminate hundreds of Voice of America jobs",
        'voa-suspends-job-cuts-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-harvard-foreign-students',
    topic_id: 'fixture-known-event-ongoing-harvard-foreign-students',
    items: [
      makeBenchmarkItem(
        'harvard_foreign_students_sanctions_episode',
        'ap-harvard-blocks-ban',
        'Federal judge blocks Trump administration from barring foreign student enrollment at Harvard',
        'harvard-blocks-ban-ap',
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
      makeBenchmarkItem(
        'harvard_foreign_students_sanctions_episode',
        'ap-harvard-extends-block',
        "Judge extends order suspending Trump's block on Harvard's incoming foreign students",
        'harvard-extends-block-ap',
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
      makeBenchmarkItem(
        'harvard_foreign_students_sanctions_episode',
        'ap-harvard-blocks-hosting-effort',
        'Federal judge blocks Trump effort to keep Harvard from hosting foreign students',
        'harvard-blocks-hosting-effort-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-yunseo-chung',
    topic_id: 'fixture-known-event-ongoing-yunseo-chung',
    items: [
      makeBenchmarkItem(
        'yunseo_chung_deportation_episode',
        'ap-chung-sues',
        "Columbia student protester who's lived in the US since age 7 sues to stop deportation order",
        'yunseo-chung-sues-ap',
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
      makeBenchmarkItem(
        'yunseo_chung_deportation_episode',
        'ap-chung-cant-be-detained',
        "Columbia student protester can't be detained for now as she fights deportation, judge rules",
        'yunseo-chung-cant-be-detained-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-ap-access',
    topic_id: 'fixture-known-event-ongoing-ap-access',
    items: [
      makeBenchmarkItem(
        'associated_press_access_episode',
        'ap-press-access-curtailed',
        "Trump says AP will continue to be curtailed at White House until it changes AP Style's guidance",
        'ap-access-curtailed-ap',
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
      makeBenchmarkItem(
        'associated_press_access_episode',
        'ap-press-access-reinstated',
        "AP wins reinstatement to White House events after judge rules government can't bar its journalists",
        'ap-access-reinstated-ap',
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
      makeBenchmarkItem(
        'associated_press_access_episode',
        'ap-press-access-enforcement',
        "Judge won't take further steps, for now, to enforce his order in AP's White House access case against Trump administration",
        'ap-access-enforcement-ap',
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
      makeBenchmarkItem(
        'associated_press_access_episode',
        'ap-press-access-appeals',
        "Appeals court won't reinstate AP access to presidential events amid ongoing dispute over 'Gulf of America'",
        'ap-access-appeals-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-cfpb-dismantling',
    topic_id: 'fixture-known-event-ongoing-cfpb-dismantling',
    items: [
      makeBenchmarkItem(
        'cfpb_dismantling_episode',
        'ap-cfpb-chaos',
        'Federal official recounts chaos inside consumer agency after Trump fired its director',
        'cfpb-chaos-ap',
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
      makeBenchmarkItem(
        'cfpb_dismantling_episode',
        'ap-cfpb-blocks-dismantling',
        'Federal judge blocks Trump from dismantling consumer watchdog CFPB',
        'cfpb-blocks-dismantling-ap',
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
      makeBenchmarkItem(
        'cfpb_dismantling_episode',
        'ap-cfpb-pauses-layoffs',
        'Judge pauses mass layoffs at consumer protection agency CFPB',
        'cfpb-pauses-layoffs-ap',
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
      makeBenchmarkItem(
        'cfpb_dismantling_episode',
        'ap-cfpb-blocks-defunding',
        'Judge blocks Trump administration from effectively defunding consumer protection agency',
        'cfpb-blocks-defunding-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-birthright-citizenship-order',
    topic_id: 'fixture-known-event-ongoing-birthright-citizenship-order',
    items: [
      makeBenchmarkItem(
        'birthright_citizenship_order_episode',
        'ap-birthright-fourth-judge',
        "A 4th federal judge blocks Trump's executive order seeking to end birthright citizenship",
        'birthright-fourth-judge-ap',
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
      makeBenchmarkItem(
        'birthright_citizenship_order_episode',
        'ap-birthright-appeals-court',
        "Appeals court won't lift block on Trump's executive order attempting to end birthright citizenship",
        'birthright-appeals-court-ap',
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
      makeBenchmarkItem(
        'birthright_citizenship_order_episode',
        'ap-birthright-new-hampshire',
        'New Hampshire judge pauses President Donald Trump birthright citizenship order nationwide',
        'birthright-new-hampshire-ap',
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
      makeBenchmarkItem(
        'birthright_citizenship_order_episode',
        'ap-birthright-remains-blocked',
        "Trump's birthright citizenship order remains blocked as lawsuits march on after Supreme Court ruling",
        'birthright-remains-blocked-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-key-bridge-collapse',
    topic_id: 'fixture-known-event-ongoing-key-bridge-collapse',
    items: [
      makeBenchmarkItem(
        'key_bridge_collapse_episode',
        'ap-key-bridge-collapse',
        'Major bridge in Baltimore collapses after being hit by cargo ship, sending vehicles into water',
        'key-bridge-collapse-ap',
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
      makeBenchmarkItem(
        'key_bridge_collapse_episode',
        'ap-key-bridge-salvage',
        'Salvage teams start removing containers from ship that hit Baltimore bridge before taking down span',
        'key-bridge-salvage-ap',
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
      makeBenchmarkItem(
        'key_bridge_collapse_episode',
        'ap-key-bridge-channel-reopens',
        'Fort McHenry Channel reopens in Baltimore, nearly 11 weeks after bridge collapse',
        'key-bridge-channel-reopens-ap',
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
      makeBenchmarkItem(
        'key_bridge_collapse_episode',
        'ap-key-bridge-cleanup-settlement',
        'Justice Department and owner of ship that caused Baltimore bridge collapse agree to $102 million settlement',
        'key-bridge-cleanup-settlement-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-dc-midair-collision',
    topic_id: 'fixture-known-event-ongoing-dc-midair-collision',
    items: [
      makeBenchmarkItem(
        'dc_midair_collision_episode',
        'ap-dc-midair-crash',
        'Passenger jet and Army helicopter collide midair near Reagan Airport, killing 67 people',
        'dc-midair-crash-ap',
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
      makeBenchmarkItem(
        'dc_midair_collision_episode',
        'ap-dc-midair-salvage',
        'Crews to salvage remnants of deadly DC midair collision from the Potomac River as early as Monday',
        'dc-midair-salvage-ap',
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
      makeBenchmarkItem(
        'dc_midair_collision_episode',
        'ap-dc-midair-altitude-data',
        'All 67 victims have been recovered from the DC midair collision. Data reveals conflicting altitudes',
        'dc-midair-altitude-data-ap',
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
      makeBenchmarkItem(
        'dc_midair_collision_episode',
        'ap-dc-midair-helicopter-ban',
        'NTSB recommends ban on some helicopter flights around Reagan airport after deadly midair collision',
        'dc-midair-helicopter-ban-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-air-india-crash',
    topic_id: 'fixture-known-event-ongoing-air-india-crash',
    items: [
      makeBenchmarkItem(
        'air_india_ahmedabad_crash_episode',
        'ap-air-india-crash',
        'Air India plane with more than 240 aboard crashes after takeoff from Ahmedabad in India',
        'air-india-crash-ap',
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
      makeBenchmarkItem(
        'air_india_ahmedabad_crash_episode',
        'ap-air-india-black-box-recovered',
        'Black box recovered from Air India crash that killed at least 265 people, authorities say',
        'air-india-black-box-recovered-ap',
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
      makeBenchmarkItem(
        'air_india_ahmedabad_crash_episode',
        'ap-air-india-black-box-analysis',
        'Black boxes from Air India crash are being analyzed as aviation authorities look for cause',
        'air-india-black-box-analysis-ap',
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
      makeBenchmarkItem(
        'air_india_ahmedabad_crash_episode',
        'ap-air-india-prelim-report',
        'Report on Air India crash focuses on fuel switches, but raises more questions than answers',
        'air-india-prelim-report-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-helene-i40-recovery',
    topic_id: 'fixture-known-event-ongoing-helene-i40-recovery',
    items: [
      makeBenchmarkItem(
        'helene_i40_recovery_episode',
        'ap-helene-i40-delay',
        'New damage delays I-40 reopening in North Carolina closed by Helene',
        'helene-i40-delay-ap',
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
      makeBenchmarkItem(
        'helene_i40_recovery_episode',
        'ap-helene-i40-march-reopen',
        'Stretch of North Carolina interstate that collapsed during Helene to reopen by March 1',
        'helene-i40-march-reopen-ap',
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
      makeBenchmarkItem(
        'helene_i40_recovery_episode',
        'ap-helene-i40-about-to-reopen',
        'A stretch of a North Carolina highway that collapsed during Helene is about to reopen',
        'helene-i40-about-to-reopen-ap',
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
      makeBenchmarkItem(
        'helene_i40_recovery_episode',
        'ap-helene-i40-rockslide-reopen',
        'Interstate 40 in the Smoky Mountains reopens faster than expected after rock slide and flooding',
        'helene-i40-rockslide-reopen-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-ruidoso-flood-recovery',
    topic_id: 'fixture-known-event-ongoing-ruidoso-flood-recovery',
    items: [
      makeBenchmarkItem(
        'ruidoso_flood_recovery_episode',
        'ap-ruidoso-flood-missing',
        '3 missing, house swept away as flash flooding hits mountain village in New Mexico',
        'ruidoso-flood-missing-ap',
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
      makeBenchmarkItem(
        'ruidoso_flood_recovery_episode',
        'ap-ruidoso-flood-cleanup',
        'Flash flooding that killed 3 leaves New Mexico village heartbroken, anxious as cleanup begins',
        'ruidoso-flood-cleanup-ap',
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
      makeBenchmarkItem(
        'ruidoso_flood_recovery_episode',
        'ap-ruidoso-flood-homes-damaged',
        'As many as 200 homes damaged as officials survey the aftermath of a deadly New Mexico flood',
        'ruidoso-flood-homes-damaged-ap',
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
      makeBenchmarkItem(
        'ruidoso_flood_recovery_episode',
        'ap-ruidoso-flood-disaster-relief',
        'Trump approves disaster relief for New Mexico mountain town battered by back-to-back floods',
        'ruidoso-flood-disaster-relief-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-lahaina-wildfire-recovery',
    topic_id: 'fixture-known-event-ongoing-lahaina-wildfire-recovery',
    items: [
      makeBenchmarkItem(
        'lahaina_wildfire_recovery_episode',
        'ap-lahaina-debris-site',
        "Maui's mayor says Lahaina debris site will be used temporarily until a permanent spot is found",
        'lahaina-debris-site-ap',
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
      makeBenchmarkItem(
        'lahaina_wildfire_recovery_episode',
        'ap-lahaina-housing-hotels',
        'Hawaii says 30 Lahaina fire survivors are moving into housing daily but 3,000 are still in hotels',
        'lahaina-housing-hotels-ap',
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
      makeBenchmarkItem(
        'lahaina_wildfire_recovery_episode',
        'ap-lahaina-fema-housing-extension',
        'Maui wildfire survivors will get an additional year of housing help from FEMA',
        'lahaina-fema-housing-extension-ap',
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
      makeBenchmarkItem(
        'lahaina_wildfire_recovery_episode',
        'ap-lahaina-debris-haul',
        '50 trucks will spend 5 months transporting Lahaina wildfire debris to a Maui landfill',
        'lahaina-debris-haul-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-iran-us-nuclear-talks',
    topic_id: 'fixture-known-event-ongoing-iran-us-nuclear-talks',
    items: [
      makeBenchmarkItem(
        'iran_us_nuclear_talks_episode',
        'ap-iran-us-direct-talks-announced',
        'Trump says direct talks are underway with Iran over its nuclear program. Iran says they’ll be indirect',
        'iran-us-direct-talks-announced-ap',
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
      makeBenchmarkItem(
        'iran_us_nuclear_talks_episode',
        'ap-iran-us-first-round',
        "Iran and US conclude 1st round of negotiations over Tehran's nuclear program in Oman",
        'iran-us-first-round-ap',
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
      makeBenchmarkItem(
        'iran_us_nuclear_talks_episode',
        'ap-iran-us-next-round-rome',
        'Iran says next round of negotiations with US over its nuclear program will be in Rome',
        'iran-us-next-round-rome-ap',
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
      makeBenchmarkItem(
        'iran_us_nuclear_talks_episode',
        'ap-iran-us-deal-not-imminent',
        'Iran’s foreign minister says no date and no time for next US nuclear talks, says deal not imminent',
        'iran-us-deal-not-imminent-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-gaza-ceasefire-episode',
    topic_id: 'fixture-known-event-ongoing-gaza-ceasefire-episode',
    items: [
      makeBenchmarkItem(
        'gaza_ceasefire_2025_episode',
        'ap-gaza-draft-deal',
        'Israel and Hamas are still hammering out details of ceasefire deal as Israeli strikes continue',
        'gaza-draft-deal-ap',
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
      makeBenchmarkItem(
        'gaza_ceasefire_2025_episode',
        'ap-gaza-ceasefire-holding',
        'Hamas names 3 hostages to be freed as part of Gaza ceasefire agreement',
        'gaza-ceasefire-holding-ap',
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
      makeBenchmarkItem(
        'gaza_ceasefire_2025_episode',
        'ap-gaza-phase-extension-dispute',
        'Israel backs what it says is a new US proposal to extend the Gaza ceasefire. Hamas rejects it',
        'gaza-phase-extension-dispute-ap',
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
      makeBenchmarkItem(
        'gaza_ceasefire_2025_episode',
        'ap-gaza-ceasefire-breakdown',
        'Israeli strikes kill more than 400 Palestinians and shatter weeks of relative calm in Gaza',
        'gaza-ceasefire-breakdown-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-ukraine-istanbul-talks',
    topic_id: 'fixture-known-event-ongoing-ukraine-istanbul-talks',
    items: [
      makeBenchmarkItem(
        'ukraine_istanbul_talks_episode',
        'ap-ukraine-istanbul-first-talks',
        'First direct Russia-Ukraine peace talks since early weeks of war end after less than 2 hours',
        'ukraine-istanbul-first-talks-ap',
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
      makeBenchmarkItem(
        'ukraine_istanbul_talks_episode',
        'ap-ukraine-no-new-talks',
        'No new direct Russia-Ukraine talks are scheduled, Kremlin says',
        'ukraine-no-new-talks-ap',
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
      makeBenchmarkItem(
        'ukraine_istanbul_talks_episode',
        'ap-ukraine-bodies-repatriated',
        'Russia and Ukraine say more bodies have been repatriated, in line with an agreement reached at talks in Istanbul',
        'ukraine-bodies-repatriated-ap',
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
      makeBenchmarkItem(
        'ukraine_istanbul_talks_episode',
        'ap-ukraine-ready-fresh-talks',
        'Putin says Russia is ready for fresh round of direct peace talks with Ukraine',
        'ukraine-ready-fresh-talks-ap',
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
  },
  {
    dataset_id: 'fixture-known-event-ongoing-nevada-voter-list-vs-college-sports-order',
    topic_id: 'fixture-known-event-ongoing-nevada-voter-list-vs-college-sports-order',
    items: [
      makeBenchmarkItem(
        'college_sports_stabilization_order_episode',
        'abc-college-sports-order',
        'President Trump signs executive order that aims to stabilize college sports',
        'college-sports-order-abc',
        1_775_268_000_000,
        {
          publisher: 'ABC News',
          url: 'https://abcnews.go.com/Politics/wireStory/president-trump-signs-executive-order-aims-stabilize-college-131508975',
          canonicalUrl:
            'https://abcnews.go.com/Politics/wireStory/president-trump-signs-executive-order-aims-stabilize-college-131508975',
          entity_keys: [
            'college_sports_stabilization_order_episode',
            'donald_trump',
            'executive_order',
            'college_sports',
            'ncaa',
          ],
          cluster_text:
            'Trump signed an executive order focused on stabilizing college sports, athlete compensation, and NCAA policy, a White House sports-regulation story rather than a voting-rights or election-administration dispute.',
        },
      ),
      makeBenchmarkItem(
        'nevada_voter_list_order_lawsuit_episode',
        'nevadaindependent-voter-list-lawsuit',
        'Nevada is suing to stop Trump order to make eligible voter lists. Is Lombardo looped in?',
        'nevada-voter-list-lawsuit-ni',
        1_775_269_200_000,
        {
          publisher: 'The Nevada Independent',
          url: 'https://thenevadaindependent.com/article/nevada-is-suing-to-stop-trump-order-to-make-eligible-voter-lists-is-lombardo-looped-in',
          canonicalUrl:
            'https://thenevadaindependent.com/article/nevada-is-suing-to-stop-trump-order-to-make-eligible-voter-lists-is-lombardo-looped-in',
          entity_keys: [
            'nevada_voter_list_order_lawsuit_episode',
            'donald_trump',
            'executive_order',
            'nevada',
            'eligible_voter_lists',
            'joe_lombardo',
          ],
          cluster_text:
            'Nevada sued over a Trump voting-order requirement about eligible voter lists, centering on election administration, state litigation, and Gov. Joe Lombardo instead of college sports or NCAA governance.',
        },
      ),
    ],
  },
];

export const STORYCLUSTER_KNOWN_EVENT_ONGOING_PAIR_EXPECTATIONS: StoryClusterBenchmarkPairExpectation[] = [
  {
    case_id: 'known-event-ongoing-kennedy-closure-staff-cuts',
    dataset_id: 'fixture-known-event-ongoing-kennedy-center',
    left_source_id: 'pbs-kennedy-closure',
    right_source_id: 'ap-kennedy-staff-cuts',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-kennedy-staff-cuts-grenell-step-down',
    dataset_id: 'fixture-known-event-ongoing-kennedy-center',
    left_source_id: 'ap-kennedy-staff-cuts',
    right_source_id: 'ap-kennedy-grenell-step-down',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-kennedy-grenell-board-showdown',
    dataset_id: 'fixture-known-event-ongoing-kennedy-center',
    left_source_id: 'ap-kennedy-grenell-step-down',
    right_source_id: 'ap-kennedy-board-showdown',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-kennedy-interview-vs-board',
    dataset_id: 'fixture-known-event-ongoing-kennedy-center',
    left_source_id: 'pbs-kennedy-grenell-interview',
    right_source_id: 'ap-kennedy-board-showdown',
    expected_label: 'commentary_on_event',
  },
  {
    case_id: 'known-event-ongoing-fed-subpoena-backlash',
    dataset_id: 'fixture-known-event-ongoing-fed-powell',
    left_source_id: 'ap-fed-subpoena',
    right_source_id: 'ap-fed-backlash',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-fed-subpoena-quash',
    dataset_id: 'fixture-known-event-ongoing-fed-powell',
    left_source_id: 'ap-fed-subpoena',
    right_source_id: 'ap-fed-judge-quash',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-fed-backlash-quash',
    dataset_id: 'fixture-known-event-ongoing-fed-powell',
    left_source_id: 'ap-fed-backlash',
    right_source_id: 'ap-fed-judge-quash',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-fed-explainer-vs-quash',
    dataset_id: 'fixture-known-event-ongoing-fed-powell',
    left_source_id: 'ap-fed-what-we-know',
    right_source_id: 'ap-fed-judge-quash',
    expected_label: 'commentary_on_event',
  },
  {
    case_id: 'known-event-ongoing-flag-ban-vs-dismissal',
    dataset_id: 'fixture-known-event-ongoing-flag-burn-order-fallout',
    left_source_id: 'ap-flag-ban-order',
    right_source_id: 'ap-flag-case-dismissal',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-prank-charge-vs-dismissal',
    dataset_id: 'fixture-known-event-ongoing-teacher-prank-fallout',
    left_source_id: 'ap-prank-adult-charge',
    right_source_id: 'ap-prank-charges-dropped',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-willis-fees-vs-bills',
    dataset_id: 'fixture-known-event-ongoing-fani-willis-fallout',
    left_source_id: 'ap-willis-legal-fees',
    right_source_id: 'ap-willis-gop-bills',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-willis-bills-vs-wade-hearing',
    dataset_id: 'fixture-known-event-ongoing-fani-willis-fallout',
    left_source_id: 'ap-willis-gop-bills',
    right_source_id: 'ap-wade-hearing',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-willis-fees-vs-wade-hearing',
    dataset_id: 'fixture-known-event-ongoing-fani-willis-fallout',
    left_source_id: 'ap-willis-legal-fees',
    right_source_id: 'ap-wade-hearing',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-adams-doj-vs-hearing',
    dataset_id: 'fixture-known-event-ongoing-eric-adams-dismissal',
    left_source_id: 'reuters-adams-doj-dismissal',
    right_source_id: 'reuters-adams-judge-weighs-dismissal',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-adams-doj-vs-dismissed',
    dataset_id: 'fixture-known-event-ongoing-eric-adams-dismissal',
    left_source_id: 'reuters-adams-doj-dismissal',
    right_source_id: 'reuters-adams-case-dismissed',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-adams-hearing-vs-dismissed',
    dataset_id: 'fixture-known-event-ongoing-eric-adams-dismissal',
    left_source_id: 'reuters-adams-judge-weighs-dismissal',
    right_source_id: 'reuters-adams-case-dismissed',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-khalil-detention-vs-deportation-ruling',
    dataset_id: 'fixture-known-event-ongoing-mahmoud-khalil',
    left_source_id: 'reuters-khalil-new-jersey-challenge',
    right_source_id: 'reuters-khalil-can-be-deported',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-abrego-lawsuit-vs-pretrial-detention',
    dataset_id: 'fixture-known-event-ongoing-abrego-garcia',
    left_source_id: 'reuters-abrego-lawsuit-dismissal-bid',
    right_source_id: 'reuters-abrego-no-detention-before-trial',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ozturk-transfer-vs-return',
    dataset_id: 'fixture-known-event-ongoing-rumeysa-ozturk',
    left_source_id: 'ap-ozturk-transfer-paused',
    right_source_id: 'ap-ozturk-return-ordered',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ozturk-return-vs-release',
    dataset_id: 'fixture-known-event-ongoing-rumeysa-ozturk',
    left_source_id: 'ap-ozturk-return-ordered',
    right_source_id: 'ap-ozturk-released',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-mahdawi-arrest-vs-hearing',
    dataset_id: 'fixture-known-event-ongoing-mohsen-mahdawi',
    left_source_id: 'ap-mahdawi-arrested',
    right_source_id: 'ap-mahdawi-hearing-set',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-mahdawi-hearing-vs-release',
    dataset_id: 'fixture-known-event-ongoing-mohsen-mahdawi',
    left_source_id: 'ap-mahdawi-hearing-set',
    right_source_id: 'ap-mahdawi-released',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-baraka-arrest-vs-hearing',
    dataset_id: 'fixture-known-event-ongoing-ras-baraka',
    left_source_id: 'ap-baraka-arrested',
    right_source_id: 'ap-baraka-court-appearance',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-baraka-hearing-vs-lawsuit',
    dataset_id: 'fixture-known-event-ongoing-ras-baraka',
    left_source_id: 'ap-baraka-court-appearance',
    right_source_id: 'ap-baraka-sues-habba',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-voa-firing-vs-dismantling',
    dataset_id: 'fixture-known-event-ongoing-voice-of-america',
    left_source_id: 'ap-voa-blocks-firings',
    right_source_id: 'ap-voa-blocks-dismantling',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-voa-dismantling-vs-restore-order',
    dataset_id: 'fixture-known-event-ongoing-voice-of-america',
    left_source_id: 'ap-voa-blocks-dismantling',
    right_source_id: 'ap-voa-restore-order-ignored',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-voa-restore-order-vs-job-cuts',
    dataset_id: 'fixture-known-event-ongoing-voice-of-america',
    left_source_id: 'ap-voa-restore-order-ignored',
    right_source_id: 'ap-voa-suspends-job-cuts',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-harvard-ban-vs-extension',
    dataset_id: 'fixture-known-event-ongoing-harvard-foreign-students',
    left_source_id: 'ap-harvard-blocks-ban',
    right_source_id: 'ap-harvard-extends-block',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-harvard-extension-vs-hosting-order',
    dataset_id: 'fixture-known-event-ongoing-harvard-foreign-students',
    left_source_id: 'ap-harvard-extends-block',
    right_source_id: 'ap-harvard-blocks-hosting-effort',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-chung-lawsuit-vs-detention-order',
    dataset_id: 'fixture-known-event-ongoing-yunseo-chung',
    left_source_id: 'ap-chung-sues',
    right_source_id: 'ap-chung-cant-be-detained',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ap-access-curtailed-vs-reinstated',
    dataset_id: 'fixture-known-event-ongoing-ap-access',
    left_source_id: 'ap-press-access-curtailed',
    right_source_id: 'ap-press-access-reinstated',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ap-access-reinstated-vs-enforcement',
    dataset_id: 'fixture-known-event-ongoing-ap-access',
    left_source_id: 'ap-press-access-reinstated',
    right_source_id: 'ap-press-access-enforcement',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ap-access-enforcement-vs-appeals',
    dataset_id: 'fixture-known-event-ongoing-ap-access',
    left_source_id: 'ap-press-access-enforcement',
    right_source_id: 'ap-press-access-appeals',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-cfpb-chaos-vs-block',
    dataset_id: 'fixture-known-event-ongoing-cfpb-dismantling',
    left_source_id: 'ap-cfpb-chaos',
    right_source_id: 'ap-cfpb-blocks-dismantling',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-cfpb-block-vs-layoffs',
    dataset_id: 'fixture-known-event-ongoing-cfpb-dismantling',
    left_source_id: 'ap-cfpb-blocks-dismantling',
    right_source_id: 'ap-cfpb-pauses-layoffs',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-cfpb-layoffs-vs-defunding',
    dataset_id: 'fixture-known-event-ongoing-cfpb-dismantling',
    left_source_id: 'ap-cfpb-pauses-layoffs',
    right_source_id: 'ap-cfpb-blocks-defunding',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-birthright-fourth-judge-vs-appeal',
    dataset_id: 'fixture-known-event-ongoing-birthright-citizenship-order',
    left_source_id: 'ap-birthright-fourth-judge',
    right_source_id: 'ap-birthright-appeals-court',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-birthright-appeal-vs-new-hampshire',
    dataset_id: 'fixture-known-event-ongoing-birthright-citizenship-order',
    left_source_id: 'ap-birthright-appeals-court',
    right_source_id: 'ap-birthright-new-hampshire',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-birthright-new-hampshire-vs-remains-blocked',
    dataset_id: 'fixture-known-event-ongoing-birthright-citizenship-order',
    left_source_id: 'ap-birthright-new-hampshire',
    right_source_id: 'ap-birthright-remains-blocked',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-key-bridge-collapse-vs-salvage',
    dataset_id: 'fixture-known-event-ongoing-key-bridge-collapse',
    left_source_id: 'ap-key-bridge-collapse',
    right_source_id: 'ap-key-bridge-salvage',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-key-bridge-salvage-vs-channel-reopens',
    dataset_id: 'fixture-known-event-ongoing-key-bridge-collapse',
    left_source_id: 'ap-key-bridge-salvage',
    right_source_id: 'ap-key-bridge-channel-reopens',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-key-bridge-channel-vs-settlement',
    dataset_id: 'fixture-known-event-ongoing-key-bridge-collapse',
    left_source_id: 'ap-key-bridge-channel-reopens',
    right_source_id: 'ap-key-bridge-cleanup-settlement',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-dc-midair-crash-vs-salvage',
    dataset_id: 'fixture-known-event-ongoing-dc-midair-collision',
    left_source_id: 'ap-dc-midair-crash',
    right_source_id: 'ap-dc-midair-salvage',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-dc-midair-salvage-vs-altitude-data',
    dataset_id: 'fixture-known-event-ongoing-dc-midair-collision',
    left_source_id: 'ap-dc-midair-salvage',
    right_source_id: 'ap-dc-midair-altitude-data',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-dc-midair-altitude-vs-helicopter-ban',
    dataset_id: 'fixture-known-event-ongoing-dc-midair-collision',
    left_source_id: 'ap-dc-midair-altitude-data',
    right_source_id: 'ap-dc-midair-helicopter-ban',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-air-india-crash-vs-black-box',
    dataset_id: 'fixture-known-event-ongoing-air-india-crash',
    left_source_id: 'ap-air-india-crash',
    right_source_id: 'ap-air-india-black-box-recovered',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-air-india-black-box-vs-analysis',
    dataset_id: 'fixture-known-event-ongoing-air-india-crash',
    left_source_id: 'ap-air-india-black-box-recovered',
    right_source_id: 'ap-air-india-black-box-analysis',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-air-india-analysis-vs-prelim-report',
    dataset_id: 'fixture-known-event-ongoing-air-india-crash',
    left_source_id: 'ap-air-india-black-box-analysis',
    right_source_id: 'ap-air-india-prelim-report',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-helene-i40-delay-vs-march-reopen',
    dataset_id: 'fixture-known-event-ongoing-helene-i40-recovery',
    left_source_id: 'ap-helene-i40-delay',
    right_source_id: 'ap-helene-i40-march-reopen',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-helene-i40-march-vs-about-to-reopen',
    dataset_id: 'fixture-known-event-ongoing-helene-i40-recovery',
    left_source_id: 'ap-helene-i40-march-reopen',
    right_source_id: 'ap-helene-i40-about-to-reopen',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-helene-i40-about-to-reopen-vs-rockslide-reopen',
    dataset_id: 'fixture-known-event-ongoing-helene-i40-recovery',
    left_source_id: 'ap-helene-i40-about-to-reopen',
    right_source_id: 'ap-helene-i40-rockslide-reopen',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ruidoso-flood-impact-vs-cleanup',
    dataset_id: 'fixture-known-event-ongoing-ruidoso-flood-recovery',
    left_source_id: 'ap-ruidoso-flood-missing',
    right_source_id: 'ap-ruidoso-flood-cleanup',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ruidoso-flood-cleanup-vs-homes-damaged',
    dataset_id: 'fixture-known-event-ongoing-ruidoso-flood-recovery',
    left_source_id: 'ap-ruidoso-flood-cleanup',
    right_source_id: 'ap-ruidoso-flood-homes-damaged',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ruidoso-homes-damaged-vs-disaster-relief',
    dataset_id: 'fixture-known-event-ongoing-ruidoso-flood-recovery',
    left_source_id: 'ap-ruidoso-flood-homes-damaged',
    right_source_id: 'ap-ruidoso-flood-disaster-relief',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-lahaina-debris-site-vs-housing-hotels',
    dataset_id: 'fixture-known-event-ongoing-lahaina-wildfire-recovery',
    left_source_id: 'ap-lahaina-debris-site',
    right_source_id: 'ap-lahaina-housing-hotels',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-lahaina-housing-vs-fema-extension',
    dataset_id: 'fixture-known-event-ongoing-lahaina-wildfire-recovery',
    left_source_id: 'ap-lahaina-housing-hotels',
    right_source_id: 'ap-lahaina-fema-housing-extension',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-lahaina-fema-extension-vs-debris-haul',
    dataset_id: 'fixture-known-event-ongoing-lahaina-wildfire-recovery',
    left_source_id: 'ap-lahaina-fema-housing-extension',
    right_source_id: 'ap-lahaina-debris-haul',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-iran-talks-announced-vs-first-round',
    dataset_id: 'fixture-known-event-ongoing-iran-us-nuclear-talks',
    left_source_id: 'ap-iran-us-direct-talks-announced',
    right_source_id: 'ap-iran-us-first-round',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-iran-first-round-vs-rome',
    dataset_id: 'fixture-known-event-ongoing-iran-us-nuclear-talks',
    left_source_id: 'ap-iran-us-first-round',
    right_source_id: 'ap-iran-us-next-round-rome',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-iran-rome-vs-not-imminent',
    dataset_id: 'fixture-known-event-ongoing-iran-us-nuclear-talks',
    left_source_id: 'ap-iran-us-next-round-rome',
    right_source_id: 'ap-iran-us-deal-not-imminent',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-gaza-draft-vs-holding',
    dataset_id: 'fixture-known-event-ongoing-gaza-ceasefire-episode',
    left_source_id: 'ap-gaza-draft-deal',
    right_source_id: 'ap-gaza-ceasefire-holding',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-gaza-holding-vs-extension-dispute',
    dataset_id: 'fixture-known-event-ongoing-gaza-ceasefire-episode',
    left_source_id: 'ap-gaza-ceasefire-holding',
    right_source_id: 'ap-gaza-phase-extension-dispute',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-gaza-extension-vs-breakdown',
    dataset_id: 'fixture-known-event-ongoing-gaza-ceasefire-episode',
    left_source_id: 'ap-gaza-phase-extension-dispute',
    right_source_id: 'ap-gaza-ceasefire-breakdown',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ukraine-first-talks-vs-none-scheduled',
    dataset_id: 'fixture-known-event-ongoing-ukraine-istanbul-talks',
    left_source_id: 'ap-ukraine-istanbul-first-talks',
    right_source_id: 'ap-ukraine-no-new-talks',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ukraine-none-scheduled-vs-bodies',
    dataset_id: 'fixture-known-event-ongoing-ukraine-istanbul-talks',
    left_source_id: 'ap-ukraine-no-new-talks',
    right_source_id: 'ap-ukraine-bodies-repatriated',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-ukraine-bodies-vs-fresh-talks',
    dataset_id: 'fixture-known-event-ongoing-ukraine-istanbul-talks',
    left_source_id: 'ap-ukraine-bodies-repatriated',
    right_source_id: 'ap-ukraine-ready-fresh-talks',
    expected_label: 'same_developing_episode',
  },
  {
    case_id: 'known-event-ongoing-nevada-voter-lists-vs-college-sports-order',
    dataset_id: 'fixture-known-event-ongoing-nevada-voter-list-vs-college-sports-order',
    left_source_id: 'abc-college-sports-order',
    right_source_id: 'nevadaindependent-voter-list-lawsuit',
    expected_label: 'unrelated',
  },
];
