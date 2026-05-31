import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle, StorylineGroup } from './newsTypes';

const { orchestrateNewsPipelineMock } = vi.hoisted(() => ({
  orchestrateNewsPipelineMock: vi.fn(),
}));

vi.mock('./newsOrchestrator', () => ({
  orchestrateNewsPipeline: orchestrateNewsPipelineMock,
}));

import { __internal, isNewsRuntimeEnabled, startNewsRuntime } from './newsRuntime';

const STORY_BUNDLE: StoryBundle = {
  schemaVersion: 'story-bundle-v0',
  story_id: 'story-1',
  topic_id: 'topic-1',
  headline: 'Headline',
  summary_hint: 'Summary',
  cluster_window_start: 1_700_000_000_000,
  cluster_window_end: 1_700_000_100_000,
  sources: [
    {
      source_id: 'src-1',
      publisher: 'Publisher',
      url: 'https://example.com/story-1',
      url_hash: 'abc123',
      published_at: 1_700_000_000_000,
      title: 'Headline',
    },
  ],
  cluster_features: {
    entity_keys: ['topic'],
    time_bucket: '2026-02-15T14',
    semantic_signature: 'deadbeef',
  },
  provenance_hash: 'provhash',
  created_at: 1_700_000_200_000,
};

const VIDEO_STORY_BUNDLE: StoryBundle = {
  ...STORY_BUNDLE,
  story_id: 'story-video',
  headline: 'Video: source clip',
  summary_hint: 'Source video available directly from the publisher.',
  sources: [
    {
      source_id: 'src-video',
      publisher: 'TODAY',
      url: 'https://www.today.com/video/source-clip-1',
      url_hash: 'video-hash',
      published_at: 1_700_000_000_000,
      title: 'Video: source clip',
    },
  ],
  provenance_hash: 'provhash-video',
};

const STORYLINE: StorylineGroup = {
  schemaVersion: 'storyline-group-v0',
  storyline_id: 'storyline-1',
  topic_id: 'topic-1',
  canonical_story_id: 'story-1',
  story_ids: ['story-1'],
  headline: 'Transit storyline',
  related_coverage: [],
  entity_keys: ['topic'],
  time_bucket: '2026-02-15T14',
  created_at: 1_700_000_200_000,
  updated_at: 1_700_000_300_000,
};

const BASE_CONFIG = {
  feedSources: [
    {
      id: 'source-1',
      name: 'Source 1',
      rssUrl: 'https://example.com/feed.xml',
      enabled: true,
    },
  ],
  topicMapping: {
    defaultTopicId: 'topic-1',
    sourceTopics: {},
  },
  gunClient: { id: 'gun-client' },
};

async function flushTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function batch(bundles: StoryBundle[] = [], storylines: StorylineGroup[] = []) {
  return { bundles, storylines };
}

function storyBundle(
  storyId: string,
  {
    sourceCount = 1,
    clusterWindowEnd = 1_700_000_100_000,
    createdAt = 1_700_000_200_000,
    confidenceScore = 0.9,
    titles,
  }: {
    sourceCount?: number;
    clusterWindowEnd?: number;
    createdAt?: number;
    confidenceScore?: number;
    titles?: string[];
  } = {},
): StoryBundle {
  const sources = Array.from({ length: sourceCount }, (_, index) => ({
    source_id: `src-${storyId}-${index + 1}`,
    publisher: `Publisher ${index + 1}`,
    url: `https://example.com/${storyId}/${index + 1}`,
    url_hash: `${storyId}-${index + 1}`,
    published_at: clusterWindowEnd,
    title: titles?.[index] ?? `${storyId} title ${index + 1}`,
  }));
  return {
    ...STORY_BUNDLE,
    story_id: storyId,
    headline: `${storyId} headline`,
    cluster_window_end: clusterWindowEnd,
    sources,
    primary_sources: sources,
    cluster_features: {
      ...STORY_BUNDLE.cluster_features,
      confidence_score: confidenceScore,
    },
    provenance_hash: `${storyId}-provhash`,
    created_at: createdAt,
  };
}

describe('newsRuntime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'default-model');
    orchestrateNewsPipelineMock.mockReset();
    orchestrateNewsPipelineMock.mockResolvedValue(batch());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('evaluates feature-flag and helper branches', () => {
    expect(__internal.isTruthyFlag(undefined)).toBe(false);
    expect(__internal.isTruthyFlag('   ')).toBe(false);
    expect(__internal.isTruthyFlag('false')).toBe(false);
    expect(__internal.isTruthyFlag('0')).toBe(false);
    expect(__internal.isTruthyFlag('true')).toBe(true);

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'no');
    expect(isNewsRuntimeEnabled()).toBe(false);

    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'yes');
    expect(isNewsRuntimeEnabled()).toBe(true);

    expect(__internal.normalizePollInterval(undefined)).toBe(30 * 60 * 1000);
    expect(__internal.normalizePollInterval(10.7)).toBe(10);
    expect(() => __internal.normalizePollInterval(0)).toThrow('pollIntervalMs must be a positive finite number');
    expect(__internal.normalizeOptionalPositiveInt(undefined, 'sample')).toBeNull();
    expect(__internal.normalizeOptionalPositiveInt(4.8, 'sample')).toBe(4);
    expect(() => __internal.normalizeOptionalPositiveInt(0, 'sample')).toThrow(
      'sample must be a positive finite number',
    );

    vi.stubEnv('CUSTOM_RUNTIME_ENV', ' value ');
    expect(__internal.readEnvVar('CUSTOM_RUNTIME_ENV')).toBe(' value ');
    vi.stubEnv('VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES', ' 3 ');
    expect(__internal.readOptionalPositiveIntEnv('VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES')).toBe(3);
    vi.stubEnv('VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES', 'bad');
    expect(() => __internal.readOptionalPositiveIntEnv('VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES')).toThrow(
      'VH_NEWS_RUNTIME_MAX_PUBLISHED_BUNDLES must be a positive integer',
    );
    expect(__internal.resolvePruneStaleBundles(BASE_CONFIG)).toBe(false);
    vi.stubEnv('VH_NEWS_RUNTIME_PRUNE_STALE_BUNDLES', 'true');
    expect(__internal.resolvePruneStaleBundles(BASE_CONFIG)).toBe(true);
    expect(__internal.resolvePruneStaleBundles({ ...BASE_CONFIG, pruneStaleBundles: false })).toBe(false);

    const originalProcess = globalThis.process;
    vi.stubGlobal('process', undefined);
    expect(__internal.readEnvVar('CUSTOM_RUNTIME_ENV')).toBeUndefined();
    expect(__internal.readEnvVar('MISSING_RUNTIME_ENV')).toBeUndefined();
    vi.stubGlobal('process', originalProcess);
  });

  it('uses summary when available and falls back to headline for prompts', () => {
    expect(__internal.defaultPrompt(STORY_BUNDLE)).toBe('Summary');
    expect(__internal.defaultPrompt({ ...STORY_BUNDLE, summary_hint: undefined })).toBe('Headline');
  });

  it('does not start when VITE_NEWS_RUNTIME_ENABLED is false', async () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'false');

    const writeStoryBundle = vi.fn();
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 5,
      runOnStart: true,
    });

    await vi.advanceTimersByTimeAsync(25);
    await flushTasks();

    expect(handle.isRunning()).toBe(false);
    expect(handle.lastRun()).toBeNull();
    expect(orchestrateNewsPipelineMock).not.toHaveBeenCalled();
    expect(writeStoryBundle).not.toHaveBeenCalled();

    handle.stop();
  });

  it('allows explicit enabled override for daemon callers', async () => {
    vi.stubEnv('VITE_NEWS_RUNTIME_ENABLED', 'false');
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      enabled: true,
      writeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(handle.isRunning()).toBe(true);
    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);

    handle.stop();
  });

  it('runs periodic ticks, publishes bundles, and updates lastRun', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: false,
    });

    expect(handle.isRunning()).toBe(true);
    expect(handle.lastRun()).toBeNull();

    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);
    expect(handle.lastRun()).toBeInstanceOf(Date);

    handle.stop();
    expect(handle.isRunning()).toBe(false);
  });

  it('caps published bundles by corroboration and recency when configured', async () => {
    const staleSingleton = storyBundle('stale-singleton', {
      sourceCount: 1,
      clusterWindowEnd: 100,
    });
    const recentSingleton = storyBundle('recent-singleton', {
      sourceCount: 1,
      clusterWindowEnd: 300,
    });
    const corroborated = storyBundle('corroborated', {
      sourceCount: 2,
      clusterWindowEnd: 200,
    });

    orchestrateNewsPipelineMock.mockResolvedValue(batch([
      staleSingleton,
      recentSingleton,
      corroborated,
    ]));
    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      maxPublishedBundles: 2,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(writeStoryBundle.mock.calls.map((call) => call[1].story_id)).toEqual([
      'corroborated',
      'recent-singleton',
    ]);

    handle.stop();
  });

  it('orders unlimited bundle publication by corroboration and recency', () => {
    const staleSingleton = storyBundle('stale-singleton', {
      sourceCount: 1,
      clusterWindowEnd: 100,
    });
    const recentSingleton = storyBundle('recent-singleton', {
      sourceCount: 1,
      clusterWindowEnd: 300,
    });
    const corroborated = storyBundle('corroborated', {
      sourceCount: 2,
      clusterWindowEnd: 200,
    });

    expect(__internal.selectBundlesForPublication([
      staleSingleton,
      recentSingleton,
      corroborated,
    ], null).map((bundle) => bundle.story_id)).toEqual([
      'corroborated',
      'recent-singleton',
      'stale-singleton',
    ]);
  });

  it('filters weak two-source canonical bundles before publication', () => {
    const weakTopicOnly = storyBundle('weak-topic-only', {
      sourceCount: 2,
      confidenceScore: 0.57,
      titles: [
        'Newsom outlines his final budget proposal with no deficit, new major spending',
        'Gavin Newsom free diapers program gets quiet contracting carve-out',
      ],
    });
    const strongTwoSource = storyBundle('strong-two-source', {
      sourceCount: 2,
      confidenceScore: 0.82,
      titles: [
        'Smalley leads as McIlroy and Rahm impress at the US PGA',
        'Smalley takes two-shot lead into final round of US PGA Championship',
      ],
    });

    expect(__internal.isPublicationEligibleBundle(weakTopicOnly)).toBe(false);
    expect(__internal.isPublicationEligibleBundle(strongTwoSource)).toBe(true);
    expect(__internal.selectBundlesForPublication([weakTopicOnly, strongTwoSource], null)).toEqual([
      strongTwoSource,
    ]);
  });

  it('trusts production remote StoryCluster output instead of applying local title filters', async () => {
    const weakByLocalTitleHeuristic = storyBundle('production-two-source', {
      sourceCount: 2,
      confidenceScore: 0.57,
      titles: [
        'Newsom outlines his final budget proposal with no deficit, new major spending',
        'Gavin Newsom free diapers program gets quiet contracting carve-out',
      ],
    });

    expect(__internal.isPublicationEligibleBundle(weakByLocalTitleHeuristic)).toBe(false);
    expect(__internal.selectBundlesForPublication(
      [weakByLocalTitleHeuristic],
      null,
      { trustClusterOutput: true },
    )).toEqual([weakByLocalTitleHeuristic]);
    expect(__internal.trustsClusterOutputForPublication({
      ...BASE_CONFIG,
      orchestratorOptions: {
        productionMode: true,
        allowHeuristicFallback: false,
      },
    })).toBe(true);

    orchestrateNewsPipelineMock.mockResolvedValue(batch([weakByLocalTitleHeuristic]));
    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: true,
      orchestratorOptions: {
        productionMode: true,
        allowHeuristicFallback: false,
      },
    });

    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, weakByLocalTitleHeuristic);

    handle.stop();
  });

  it('keeps two-source bundles with explicit same-action title support below the strong-confidence line', () => {
    const legalSameEvent = storyBundle('legal-same-event', {
      sourceCount: 2,
      confidenceScore: 0.79,
      titles: [
        'California man facing federal charges in international turtle trafficking plot',
        'California man arrested for attempting to traffic wild turtles',
      ],
    });

    expect(__internal.isPublicationEligibleBundle(legalSameEvent)).toBe(true);
  });

  it('keeps title-supported same-incident bundles just below the normal two-source confidence floor', () => {
    const sanDiegoShooting = storyBundle('san-diego-shooting', {
      sourceCount: 2,
      confidenceScore: 0.46,
      titles: [
        'Man charged with murder after San Diego mosque shooting leaves one dead',
        'Former Navy man pleads not guilty in San Diego mosque shooting that killed one',
      ],
    });
    const weakTopicOnly = storyBundle('weak-low-confidence-topic', {
      sourceCount: 2,
      confidenceScore: 0.46,
      titles: [
        'Newsom outlines his final budget proposal with no deficit, new major spending',
        'Gavin Newsom free diapers program gets quiet contracting carve-out',
      ],
    });

    expect(__internal.hasTitlePairCanonicalSupport(
      sanDiegoShooting.sources[0]!.title,
      sanDiegoShooting.sources[1]!.title,
    )).toBe(true);
    expect(__internal.isPublicationEligibleBundle(sanDiegoShooting)).toBe(true);
    expect(__internal.isPublicationEligibleBundle(weakTopicOnly)).toBe(false);
  });

  it('rejects genuinely weak two-source bundles below the publication confidence floor', () => {
    const weakSingletonPair = storyBundle('weak-two-source-pair', {
      sourceCount: 2,
      confidenceScore: 0.31,
      titles: [
        'City council approves a late-night zoning extension',
        'Central bank minutes show inflation concerns eased last month',
      ],
    });

    expect(__internal.isPublicationEligibleBundle(weakSingletonPair)).toBe(false);
  });

  it('keeps recent two-source bundles with shared normalized title anchors', () => {
    const diplomacyEpisode = storyBundle('diplomacy-episode', {
      sourceCount: 2,
      confidenceScore: 0.79,
      titles: [
        "Days after Trump's summit in Beijing, Putin will meet with China's Xi",
        "Putin to meet Chinese leader Xi Jinping following Trump's visit",
      ],
    });
    const taiwanEpisode = storyBundle('taiwan-episode', {
      sourceCount: 2,
      confidenceScore: 0.68,
      titles: [
        "Trump warns Taiwan against declaring independence, hours after summit with China's Xi",
        "Trump's comment about negotiations on Taiwan heightens concerns over China",
      ],
    });

    expect(__internal.isPublicationEligibleBundle(diplomacyEpisode)).toBe(true);
    expect(__internal.isPublicationEligibleBundle(taiwanEpisode)).toBe(true);
  });

  it('normalizes title anchors and action overlap for publication support', () => {
    expect(__internal.normalizeTitleKeyword('')).toBeNull();
    expect(__internal.normalizeTitleKeyword('00042')).toBeNull();
    expect(__internal.normalizeTitleKeyword('Trump&#039;s')).toBe('trump');
    expect(__internal.normalizeTitleKeyword('Ebola-related')).toBeNull();
    expect(__internal.titlesHaveMatchingAction(
      'Senator introduces a budget amendment',
      'Budget amendment draws sharp criticism',
    )).toBe(false);
    expect(__internal.titlesHaveMatchingAction(
      'Man arrested in turtle trafficking case',
      'Suspect charged over turtle smuggling plot',
    )).toBe(true);
    expect(__internal.hasTitlePairCanonicalSupport(
      'Trump threatens to pull Boebert endorsement over Massie support',
      'Trump threatens weak minded Boebert with primary after Massie campaign',
    )).toBe(true);
    expect(__internal.hasTitlePairCanonicalSupport(
      'Man arrested in turtle trafficking case',
      'Suspect charged over turtle smuggling plot',
    )).toBe(true);
    expect(__internal.hasTitlePairCanonicalSupport(
      'U.S. announces Ebola-related travel restrictions amid outbreak in Congo, Uganda',
      'Singapore steps up health measures after Ebola outbreak in DR Congo, Uganda',
    )).toBe(false);
    expect(__internal.hasTitlePairCanonicalSupport(
      'American who contracted Ebola in DR Congo evacuated for treatment',
      'US evacuates American doctor who contracted Ebola in DR Congo for treatment',
    )).toBe(true);
    expect(__internal.bundleConfidenceScore({
      ...STORY_BUNDLE,
      cluster_features: {
        ...STORY_BUNDLE.cluster_features,
        confidence_score: Number.NaN,
      },
    })).toBe(0.5);
  });

  it('keeps three-source corroborated bundles on source diversity even with varied headlines', () => {
    const multiSource = storyBundle('multi-source', {
      sourceCount: 3,
      confidenceScore: 0.71,
      titles: [
        'Trump blasts disloyal Sen. Cassidy while pushing challenger in Louisiana primary',
        'Republican senator who voted to convict Trump battles for re-election',
        'GOP Sen. Cassidy fights to hold onto seat in Louisiana primary',
      ],
    });

    expect(__internal.isPublicationEligibleBundle(multiSource)).toBe(true);
  });

  it('demotes unsupported outlier sources from multi-source canonical bundles before publication', () => {
    const mixedSupremeCourtBundle = storyBundle('mixed-supreme-court', {
      sourceCount: 4,
      confidenceScore: 0.79,
      titles: [
        'Supreme Court rejects Virginia Democrats bid to revive new congressional map',
        'Supreme Court rejects Virginia Democrats attempt to revive new congressional map',
        'Supreme Court rejects bid to restore Virginia congressional map favoring Democrats',
        'Supreme Court allows access to abortion pill by mail for now',
      ],
    });

    const [selected] = __internal.selectBundlesForPublication([mixedSupremeCourtBundle], null);

    expect(selected?.primary_sources?.map((source) => source.title)).toEqual([
      'Supreme Court rejects Virginia Democrats bid to revive new congressional map',
      'Supreme Court rejects Virginia Democrats attempt to revive new congressional map',
      'Supreme Court rejects bid to restore Virginia congressional map favoring Democrats',
    ]);
    expect(selected?.related_links?.map((source) => source.title)).toEqual([
      'Supreme Court allows access to abortion pill by mail for now',
    ]);
  });

  it('keeps multi-source bundles unchanged when title support is all-or-nothing', () => {
    const allSupported = storyBundle('all-supported', {
      sourceCount: 3,
      confidenceScore: 0.79,
      titles: [
        'Court rejects Virginia map challenge from Democrats',
        'Supreme Court rejects Virginia Democrats map challenge',
        'High court rejects Virginia Democrats congressional map bid',
      ],
    });
    const tooFewSupported = storyBundle('too-few-supported', {
      sourceCount: 4,
      confidenceScore: 0.79,
      titles: [
        'Senate parliamentarian nixes ballroom fund in budget bill',
        'Ebola response team expands Congo vaccine campaign',
        'Climate report says sea levels rose again this year',
        'Transit agency approves late-night rail extension',
      ],
    });

    expect(__internal.refineBundleForPublication(allSupported)).toBe(allSupported);
    expect(__internal.refineBundleForPublication(tooFewSupported)).toBe(tooFewSupported);
  });

  it('sorts capped bundle publication deterministically through every tie breaker', () => {
    const older = storyBundle('older', {
      sourceCount: 2,
      clusterWindowEnd: 100,
      createdAt: 100,
    });
    const newerWindow = storyBundle('newer-window', {
      sourceCount: 2,
      clusterWindowEnd: 200,
      createdAt: 50,
    });
    const newerCreated = storyBundle('newer-created', {
      sourceCount: 2,
      clusterWindowEnd: 200,
      createdAt: 80,
    });
    const alphabeticWinner = storyBundle('alphabetic-winner', {
      sourceCount: 2,
      clusterWindowEnd: 200,
      createdAt: 80,
    });

    expect(__internal.selectBundlesForPublication([
      older,
      newerWindow,
      newerCreated,
      alphabeticWinner,
    ], 3).map((bundle) => bundle.story_id)).toEqual([
      'alphabetic-winner',
      'newer-created',
      'newer-window',
    ]);
  });

  it('prunes stale published stories after a non-empty refresh shrinks the bundle set', async () => {
    const storyTwo: StoryBundle = {
      ...STORY_BUNDLE,
      story_id: 'story-2',
      topic_id: 'topic-2',
      headline: 'Second story',
      provenance_hash: 'provhash-2',
      created_at: STORY_BUNDLE.created_at + 1,
    };
    orchestrateNewsPipelineMock
      .mockResolvedValueOnce(batch([STORY_BUNDLE, storyTwo]))
      .mockResolvedValueOnce(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const removeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      removeStoryBundle,
      pruneStaleBundles: true,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();
    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, storyTwo);
    expect(removeStoryBundle).toHaveBeenCalledTimes(1);
    expect(removeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, 'story-2');

    handle.stop();
  });

  it('preserves previously published stories by default when a refresh returns fewer bundles', async () => {
    const storyTwo: StoryBundle = {
      ...STORY_BUNDLE,
      story_id: 'story-2',
      topic_id: 'topic-2',
      headline: 'Second story',
      provenance_hash: 'provhash-2',
      created_at: STORY_BUNDLE.created_at + 1,
    };
    orchestrateNewsPipelineMock
      .mockResolvedValueOnce(batch([STORY_BUNDLE, storyTwo]))
      .mockResolvedValueOnce(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const removeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      removeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();
    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);
    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, storyTwo);
    expect(removeStoryBundle).not.toHaveBeenCalled();

    handle.stop();
  });

  it('does not prune previously published stories when a refresh returns no bundles', async () => {
    orchestrateNewsPipelineMock
      .mockResolvedValueOnce(batch([STORY_BUNDLE]))
      .mockResolvedValueOnce(batch());

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const removeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      removeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();
    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledTimes(1);
    expect(removeStoryBundle).not.toHaveBeenCalled();

    handle.stop();
  });

  it('reports storyline write failures and continues the tick', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE], [STORYLINE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const writeStorylineGroup = vi.fn().mockRejectedValue(new Error('storyline write failed'));
    const onError = vi.fn();
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      writeStorylineGroup,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(writeStorylineGroup).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORYLINE);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'storyline write failed' }));
    expect(handle.lastRun()).toBeInstanceOf(Date);

    handle.stop();
  });

  it('reports non-Error storyline write failures', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE], [STORYLINE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const writeStorylineGroup = vi.fn().mockRejectedValue('storyline string failure');
    const onError = vi.fn();
    const traceSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubEnv('VH_NEWS_RUNTIME_TRACE', 'true');
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      writeStorylineGroup,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(traceSpy).toHaveBeenCalledWith('[vh:news-runtime] storyline_write_failed', {
      storyline_id: STORYLINE.storyline_id,
      error: 'storyline string failure',
    });
    expect(onError).toHaveBeenCalledWith('storyline string failure');

    handle.stop();
  });

  it('reports missing write adapter via onError callback', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const onError = vi.fn();
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('writeStoryBundle adapter is required');
    handle.stop();
  });

  it('reports runtime errors via onError callback', async () => {
    const runtimeError = new Error('mesh write failed');
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const onError = vi.fn();
    const writeStoryBundle = vi.fn().mockRejectedValue(runtimeError);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(onError).toHaveBeenCalledWith(runtimeError);
    expect(handle.lastRun()).toBeNull();
    handle.stop();
    handle.stop();
  });

  it('continues publishing later bundles when one story write fails', async () => {
    const first = storyBundle('write-fails', { sourceCount: 2, clusterWindowEnd: 200 });
    const second = storyBundle('write-succeeds', { sourceCount: 1, clusterWindowEnd: 100 });
    const writeError = new Error('latest index readback failed');
    orchestrateNewsPipelineMock.mockResolvedValue(batch([first, second]));

    const writeStoryBundle = vi.fn()
      .mockRejectedValueOnce(writeError)
      .mockResolvedValueOnce(undefined);
    const onError = vi.fn();
    const onSynthesisCandidate = vi.fn();
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onError,
      onSynthesisCandidate,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();
    await flushTasks();

    expect(writeStoryBundle.mock.calls.map((call) => call[1].story_id)).toEqual([
      'write-fails',
      'write-succeeds',
    ]);
    expect(onError).toHaveBeenCalledWith(writeError);
    expect(handle.lastRun()).toBeInstanceOf(Date);
    expect(onSynthesisCandidate).toHaveBeenCalledTimes(1);
    expect(onSynthesisCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ story_id: 'write-succeeds' }),
    );

    handle.stop();
  });

  it('emits runtime trace logs when VH_NEWS_RUNTIME_TRACE is enabled', async () => {
    vi.stubEnv('VH_NEWS_RUNTIME_TRACE', 'true');
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE], [STORYLINE]));
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const writeStorylineGroup = vi.fn().mockResolvedValue(undefined);

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      writeStorylineGroup,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:news-runtime] tick_queued_immediate',
      expect.objectContaining({ poll_interval_ms: 10 }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:news-runtime] tick_clustered',
      expect.objectContaining({ bundle_count: 1, storyline_count: 1 }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:news-runtime] tick_completed',
      expect.objectContaining({ published_story_count: 1, published_storyline_count: 1 }),
    );

    handle.stop();
  });

  it('logs non-Error failures through tick_failed trace output', async () => {
    vi.stubEnv('VH_NEWS_RUNTIME_TRACE', 'true');
    orchestrateNewsPipelineMock.mockRejectedValue('string failure');
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const onError = vi.fn();

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle: vi.fn().mockResolvedValue(undefined),
      onError,
      pollIntervalMs: 10,
      runOnStart: true,
    });

    await flushTasks();

    expect(onError).toHaveBeenCalledWith('string failure');
    expect(infoSpy).toHaveBeenCalledWith(
      '[vh:news-runtime] tick_failed',
      expect.objectContaining({ error: 'string failure' }),
    );

    handle.stop();
  });

  it('skips overlapping ticks while a run is in flight', async () => {
    let resolveRun: ((result: ReturnType<typeof batch>) => void) | null = null;
    orchestrateNewsPipelineMock.mockImplementation(
      () =>
        new Promise<ReturnType<typeof batch>>((resolve) => {
          resolveRun = resolve;
        }),
    );

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      pollIntervalMs: 5,
      runOnStart: true,
    });

    await vi.advanceTimersByTimeAsync(20);
    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);

    resolveRun?.(batch([STORY_BUNDLE]));
    await flushTasks();

    handle.stop();
  });

  it('stops future ticks after stop() is called', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      pollIntervalMs: 10,
      runOnStart: false,
    });

    await vi.advanceTimersByTimeAsync(10);
    await flushTasks();

    handle.stop();
    await vi.advanceTimersByTimeAsync(40);
    await flushTasks();

    expect(orchestrateNewsPipelineMock).toHaveBeenCalledTimes(1);
    expect(writeStoryBundle).toHaveBeenCalledTimes(1);
  });

  it('propagates VITE_ANALYSIS_MODEL into synthesis candidate metadata', async () => {
    vi.stubEnv('VITE_ANALYSIS_MODEL', 'test-model-1');
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const onSynthesisCandidate = vi.fn();

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onSynthesisCandidate,
      runOnStart: true,
      pollIntervalMs: 30,
    });

    await flushTasks();

    expect(onSynthesisCandidate).toHaveBeenCalledTimes(1);
    expect(onSynthesisCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        story_id: 'story-1',
        provider: {
          provider_id: 'remote-analysis',
          model_id: 'test-model-1',
          kind: 'remote',
        },
        request: expect.objectContaining({ model: 'test-model-1' }),
        work_items: [
          expect.objectContaining({ work_type: 'full-analysis', story_id: 'story-1' }),
          expect.objectContaining({ work_type: 'bias-table', story_id: 'story-1' }),
        ],
        advanced_artifact: expect.objectContaining({
          schemaVersion: 'story-advanced-v1',
          story_id: 'story-1',
          topic_id: 'topic-1',
          me_tuples: expect.any(Array),
          drift_metrics: expect.objectContaining({
            composite: expect.any(Number),
          }),
          timeline_graph: expect.objectContaining({
            nodes: expect.any(Array),
          }),
        }),
      }),
    );

    handle.stop();
  });

  it('does not emit synthesis candidates for singleton video bundles', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([VIDEO_STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const onSynthesisCandidate = vi.fn();

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onSynthesisCandidate,
      runOnStart: true,
      pollIntervalMs: 30,
    });

    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, VIDEO_STORY_BUNDLE);
    expect(onSynthesisCandidate).not.toHaveBeenCalled();

    handle.stop();
  });

  it('does not block story publish when advanced artifact generation throws', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onSynthesisCandidate = vi.fn();

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onError,
      onSynthesisCandidate,
      createAdvancedArtifact: () => {
        throw new Error('advanced artifact failed');
      },
      runOnStart: true,
      pollIntervalMs: 30,
    });

    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);
    expect(handle.lastRun()).toBeInstanceOf(Date);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('advanced artifact failed');
    expect(onSynthesisCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        story_id: 'story-1',
        advanced_artifact: undefined,
      }),
    );

    handle.stop();
  });

  it('does not block story publish when enrichment callback fails asynchronously', async () => {
    orchestrateNewsPipelineMock.mockResolvedValue(batch([STORY_BUNDLE]));

    const writeStoryBundle = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const onSynthesisCandidate = vi.fn().mockRejectedValue(new Error('enrichment timeout'));

    const handle = startNewsRuntime({
      ...BASE_CONFIG,
      writeStoryBundle,
      onError,
      onSynthesisCandidate,
      runOnStart: true,
      pollIntervalMs: 30,
    });

    await flushTasks();
    await flushTasks();

    expect(writeStoryBundle).toHaveBeenCalledWith(BASE_CONFIG.gunClient, STORY_BUNDLE);
    expect(handle.lastRun()).toBeInstanceOf(Date);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(String(onError.mock.calls[0]?.[0])).toContain('enrichment timeout');

    handle.stop();
  });
});
