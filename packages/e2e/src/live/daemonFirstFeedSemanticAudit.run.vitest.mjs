import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readAuditableBundles = vi.fn();
const readRetainedSourceEvidenceSnapshot = vi.fn();
const readSemanticAuditStoreSnapshot = vi.fn();
const refreshNewsStoreLatest = vi.fn();
const waitForHeadlines = vi.fn();
const nudgeFeed = vi.fn();
const buildCanonicalSourcePairs = vi.fn();
const classifyCanonicalSourcePairs = vi.fn();
const hasRelatedTopicOnlyPair = vi.fn((results) =>
  results.some((result) => result.label === 'related_topic_only'));
const fetchMock = vi.fn();

vi.mock('./browserNewsStore', () => ({
  readAuditableBundles,
  readRetainedSourceEvidenceSnapshot,
  readSemanticAuditStoreSnapshot,
  refreshNewsStoreLatest,
}));

vi.mock('./daemonFirstFeedHarness', () => ({
  LIVE_BASE_URL: 'https://daemon.example.test',
  waitForHeadlines,
}));

vi.mock('./feedReadiness', () => ({ nudgeFeed }));

vi.mock('../../../../services/storycluster-engine/dist/index.js', () => ({
  buildCanonicalSourcePairs,
  classifyCanonicalSourcePairs,
  hasRelatedTopicOnlyPair,
}));

function makeBundle(storyId) {
  return {
    story_id: storyId,
    topic_id: `topic-${storyId}`,
    headline: `Headline ${storyId}`,
    sources: [
      {
        source_id: `${storyId}-a`,
        publisher: 'Source A',
        url: `https://example.com/${storyId}/a`,
        url_hash: `${storyId}-a`,
        title: `Title ${storyId} A`,
      },
      {
        source_id: `${storyId}-b`,
        publisher: 'Source B',
        url: `https://example.com/${storyId}/b`,
        url_hash: `${storyId}-b`,
        title: `Title ${storyId} B`,
      },
    ],
  };
}

function makeSnapshot(overrides = {}) {
  return {
    story_count: 4,
    auditable_count: 2,
    visible_story_ids: ['story-1', 'story-2', 'story-3'],
    top_story_ids: ['story-1', 'story-2', 'story-3', 'story-4'],
    top_auditable_story_ids: ['story-1', 'story-2'],
    stories: [],
    ...overrides,
  };
}

function makeRetainedSourceEvidenceSnapshot(overrides = {}) {
  return {
    schemaVersion: 'daemon-feed-retained-source-evidence-v1',
    generatedAt: '2026-03-22T00:00:00.000Z',
    story_count: 4,
    auditable_count: 2,
    visible_story_ids: ['story-1', 'story-2', 'story-3'],
    top_story_ids: ['story-1', 'story-2', 'story-3', 'story-4'],
    top_auditable_story_ids: ['story-1', 'story-2'],
    source_count: 2,
    sources: [{
      source_id: 'story-1-a',
      publisher: 'Source A',
      url: 'https://example.com/story-1/a',
      url_hash: 'story-1-a',
      title: 'Title story-1 A',
      observations: [{
        story_id: 'story-1',
        topic_id: 'topic-story-1',
        headline: 'Headline story-1',
        source_count: 2,
        primary_source_count: 2,
        secondary_asset_count: 0,
        is_auditable: true,
        is_dom_visible: true,
        source_roles: ['primary_source', 'source'],
      }],
    }],
    ...overrides,
  };
}

function makePair(bundle) {
  return {
    pair_id: `${bundle.story_id}-pair-1`,
    story_id: bundle.story_id,
    topic_id: bundle.topic_id,
    story_headline: bundle.headline,
    left: { ...bundle.sources[0], text: `Left text for ${bundle.story_id}` },
    right: { ...bundle.sources[1], text: `Right text for ${bundle.story_id}` },
  };
}

function makeResult(pairId, label = 'same_incident') {
  return {
    pair_id: pairId,
    label,
    confidence: 0.98,
    rationale: `label:${label}`,
  };
}

function artifactDir(runId) {
  return path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  refreshNewsStoreLatest.mockResolvedValue(undefined);
  readRetainedSourceEvidenceSnapshot.mockResolvedValue(makeRetainedSourceEvidenceSnapshot());
  waitForHeadlines.mockResolvedValue(undefined);
  nudgeFeed.mockResolvedValue(undefined);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ title: 'Fetched title', text: 'Fetched article body' }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  const runId = process.env.VH_DAEMON_FEED_RUN_ID;
  delete process.env.VH_DAEMON_FEED_RUN_ID;
  delete process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED;
  if (runId) {
    rmSync(artifactDir(runId), { recursive: true, force: true });
  }
});

describe('daemonFirstFeedSemanticAudit run coverage', () => {
  it('persists store and retained snapshots for timeout-path observability', async () => {
    process.env.VH_DAEMON_FEED_RUN_ID = `semantic-audit-test-${Date.now()}-timeout-snapshots`;
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot());

    const { captureDaemonFirstFeedSemanticAuditSnapshots } = await import('./daemonFirstFeedSemanticAudit');
    const result = await captureDaemonFirstFeedSemanticAuditSnapshots({});

    expect(result.storeSnapshot).toMatchObject({
      story_count: 4,
      auditable_count: 2,
    });
    expect(result.retainedSourceEvidenceSnapshot).toMatchObject({
      schemaVersion: 'daemon-feed-retained-source-evidence-v1',
      source_count: 2,
    });

    const artifactRoot = artifactDir(process.env.VH_DAEMON_FEED_RUN_ID);
    expect(JSON.parse(
      readFileSync(path.join(artifactRoot, 'semantic-audit-store-snapshot.json'), 'utf8'),
    )).toMatchObject({
      story_count: 4,
      auditable_count: 2,
    });
    expect(JSON.parse(
      readFileSync(path.join(artifactRoot, 'retained-source-evidence-snapshot.json'), 'utf8'),
    )).toMatchObject({
      schemaVersion: 'daemon-feed-retained-source-evidence-v1',
      source_count: 2,
    });
  });

  it('records empty sampled supply without invoking fetch or the classifier', async () => {
    readAuditableBundles.mockResolvedValue([]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 0 }));

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 0,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(classifyCanonicalSourcePairs).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      sampled_story_count: 0,
      supply: {
        status: 'empty',
        auditable_count: 0,
        sample_fill_rate: 0,
        sample_shortfall: 2,
      },
      overall: {
        audited_pair_count: 0,
        pass: false,
      },
    });
  });

  it('fails fast when the classifier does not return a result for a built pair', async () => {
    const bundle = makeBundle('story-1');
    readAuditableBundles.mockResolvedValue([bundle]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 1 }));
    buildCanonicalSourcePairs.mockReturnValue([makePair(bundle)]);
    classifyCanonicalSourcePairs.mockResolvedValue([]);

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    await expect(runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 1,
      timeoutMs: 50,
    })).rejects.toThrow('missing-audit-result:story-1-pair-1');
  });

  it('uses default options while preserving primary-source and secondary-asset metadata', async () => {
    const baseA = makeBundle('story-1');
    const baseB = makeBundle('story-2');
    const bundleA = { ...baseA, primary_sources: baseA.sources, secondary_assets: [baseA.sources[0]] };
    const bundleB = { ...baseB, primary_sources: baseB.sources, secondary_assets: [baseB.sources[0]] };
    const pairA = makePair(bundleA);
    readAuditableBundles.mockResolvedValue([bundleA, bundleB]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 2 }));
    buildCanonicalSourcePairs.mockImplementation((bundle, resolveText) => {
      resolveText({
        source_id: 'missing',
        publisher: 'Missing',
        title: 'Missing',
        url: 'https://example.com/missing',
        url_hash: 'missing',
      });
      return bundle.story_id === 'story-1' ? [pairA] : [];
    });
    classifyCanonicalSourcePairs.mockResolvedValue([makeResult(pairA.pair_id)]);

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, { openAIApiKey: 'test-key' });

    expect(report).toMatchObject({
      requested_sample_count: 2,
      sampled_story_count: 2,
      bundles: [
        {
          story_id: 'story-1',
          canonical_source_count: 2,
          secondary_asset_count: 1,
          canonical_sources: bundleA.primary_sources,
          pairs: [makeResult(pairA.pair_id)],
        },
        {
          story_id: 'story-2',
          canonical_source_count: 2,
          secondary_asset_count: 1,
          canonical_sources: bundleB.primary_sources,
          pairs: [],
        },
      ],
    });
  });

  it('captures full audited evidence after a refresh cycle and persists the report', async () => {
    const bundleA = makeBundle('story-1');
    const bundleB = makeBundle('story-2');
    const pairA = makePair(bundleA);
    const pairB = makePair(bundleB);
    readAuditableBundles
      .mockResolvedValueOnce([bundleA])
      .mockResolvedValueOnce([bundleA, bundleB]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 2 }));
    buildCanonicalSourcePairs.mockImplementation((bundle) => [bundle.story_id === 'story-1' ? pairA : pairB]);
    classifyCanonicalSourcePairs.mockResolvedValue([makeResult(pairA.pair_id), makeResult(pairB.pair_id)]);
    process.env.VH_DAEMON_FEED_RUN_ID = `semantic-audit-test-${Date.now()}-full`;

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 50,
    });

    expect(refreshNewsStoreLatest).toHaveBeenCalledTimes(1);
    expect(waitForHeadlines).toHaveBeenCalledTimes(1);
    expect(nudgeFeed).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(classifyCanonicalSourcePairs).toHaveBeenCalledWith(expect.arrayContaining([pairA, pairB]), {
      apiKey: 'test-key',
      baseUrl: undefined,
      model: undefined,
    });
    expect(report).toMatchObject({
      schema_version: 'daemon-first-feed-semantic-audit-v3',
      requested_sample_count: 2,
      sampled_story_count: 2,
      visible_story_ids: ['story-1', 'story-2', 'story-3'],
      supply: {
        status: 'full',
        auditable_count: 2,
        sample_fill_rate: 1,
        sample_shortfall: 0,
      },
      overall: {
        audited_pair_count: 2,
        related_topic_only_pair_count: 0,
        incomplete_bundle_count: 0,
        article_fetch_failure_count: 0,
        sample_fill_rate: 1,
        sample_shortfall: 0,
        pass: true,
      },
    });

    const persistedReport = JSON.parse(
      readFileSync(path.join(artifactDir(process.env.VH_DAEMON_FEED_RUN_ID), 'semantic-audit-report.json'), 'utf8'),
    );
    expect(persistedReport.overall.pass).toBe(true);
    const retainedEvidence = JSON.parse(
      readFileSync(path.join(artifactDir(process.env.VH_DAEMON_FEED_RUN_ID), 'retained-source-evidence-snapshot.json'), 'utf8'),
    );
    expect(retainedEvidence).toMatchObject({
      schemaVersion: 'daemon-feed-retained-source-evidence-v1',
      source_count: 2,
    });
  });

  it('keeps insufficient fixture-backed supply as a recorded failure instead of silently promoting it', async () => {
    const bundle = makeBundle('story-1');
    const pair = makePair(bundle);
    readAuditableBundles.mockResolvedValue([bundle]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 1 }));
    buildCanonicalSourcePairs.mockReturnValue([pair]);
    classifyCanonicalSourcePairs.mockResolvedValue([makeResult(pair.pair_id)]);
    process.env.VH_DAEMON_FEED_RUN_ID = `semantic-audit-test-${Date.now()}-partial`;

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 0,
    });

    expect(report).toMatchObject({
      requested_sample_count: 2,
      sampled_story_count: 1,
      supply: {
        status: 'partial',
        auditable_count: 1,
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
      },
      overall: {
        audited_pair_count: 1,
        related_topic_only_pair_count: 0,
        incomplete_bundle_count: 0,
        article_fetch_failure_count: 0,
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
        pass: false,
      },
    });

    const snapshotPath = path.join(artifactDir(process.env.VH_DAEMON_FEED_RUN_ID), 'semantic-audit-store-snapshot.json');
    expect(existsSync(snapshotPath)).toBe(true);
    expect(JSON.parse(readFileSync(snapshotPath, 'utf8'))).toMatchObject({
      story_count: 4,
      auditable_count: 1,
    });
  });

  it('accumulates distinct auditable bundles across refresh sweeps until the sample target is met', async () => {
    const bundleA = makeBundle('story-1');
    const bundleB = makeBundle('story-2');
    const bundleC = makeBundle('story-3');
    const pairA = makePair(bundleA);
    const pairB = makePair(bundleB);
    const pairC = makePair(bundleC);
    readAuditableBundles
      .mockResolvedValueOnce([bundleA])
      .mockResolvedValueOnce([bundleB])
      .mockResolvedValueOnce([bundleC]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 1 }));
    buildCanonicalSourcePairs.mockImplementation((bundle) => {
      if (bundle.story_id === 'story-1') return [pairA];
      if (bundle.story_id === 'story-2') return [pairB];
      return [pairC];
    });
    classifyCanonicalSourcePairs.mockResolvedValue([
      makeResult(pairA.pair_id),
      makeResult(pairB.pair_id),
      makeResult(pairC.pair_id),
    ]);

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 3,
      timeoutMs: 50,
    });

    expect(refreshNewsStoreLatest).toHaveBeenCalledTimes(2);
    expect(waitForHeadlines).toHaveBeenCalledTimes(2);
    expect(nudgeFeed).toHaveBeenCalledTimes(2);
    expect(nudgeFeed).toHaveBeenCalledWith({}, { finalSettleMs: 4000 });
    expect(report.bundles.map((bundle) => bundle.story_id)).toEqual(['story-1', 'story-2', 'story-3']);
    expect(report).toMatchObject({
      sampled_story_count: 3,
      supply: {
        status: 'full',
        sample_fill_rate: 1,
        sample_shortfall: 0,
      },
      overall: {
        audited_pair_count: 3,
        incomplete_bundle_count: 0,
        article_fetch_failure_count: 0,
        pass: true,
      },
    });
  });

  it('degrades persistent article-text failures into incomplete bundle evidence instead of aborting the run', async () => {
    const bundleA = makeBundle('story-1');
    const bundleB = makeBundle('story-2');
    const pairA = makePair(bundleA);
    readAuditableBundles.mockResolvedValue([bundleA, bundleB]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 2 }));
    buildCanonicalSourcePairs.mockImplementation((bundle) => {
      if (bundle.story_id === 'story-1') {
        return [pairA];
      }
      throw new Error('story-2 should be skipped because article-text fetch failed');
    });
    classifyCanonicalSourcePairs.mockResolvedValue([makeResult(pairA.pair_id)]);

    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('story-2%2Fb') || String(url).includes('/story-2/b')) {
        return { ok: false, status: 502 };
      }
      return {
        ok: true,
        json: async () => ({ title: 'Fetched title', text: 'Fetched article body' }),
      };
    });

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 0,
    });

    expect(buildCanonicalSourcePairs).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(report).toMatchObject({
      sampled_story_count: 2,
      article_fetch_failures: [
        {
          source_id: 'story-2-b',
          url: 'https://example.com/story-2/b',
          error: 'article-text 502 for story-2-b',
          attempts: 3,
        },
      ],
      bundles: [
        {
          story_id: 'story-1',
          audit_status: 'complete',
          pairs: [makeResult(pairA.pair_id)],
        },
        {
          story_id: 'story-2',
          audit_status: 'incomplete_article_text',
          pairs: [],
          missing_article_sources: [
            {
              source_id: 'story-2-b',
              url: 'https://example.com/story-2/b',
              error: 'article-text 502 for story-2-b',
              attempts: 3,
            },
          ],
        },
      ],
      overall: {
        audited_pair_count: 1,
        incomplete_bundle_count: 1,
        article_fetch_failure_count: 1,
        pass: false,
      },
    });
  });

  it('replaces an observed story when a later sweep exposes a richer primary-source snapshot', async () => {
    const baseSources = makeBundle('story-1').sources;
    const baseBundle = {
      ...makeBundle('story-1'),
      primary_sources: baseSources,
    };
    const upgradedBundle = {
      ...baseBundle,
      primary_sources: [
        baseSources[0],
        baseSources[1],
        {
          source_id: 'story-1-c',
          publisher: 'Source C',
          url: 'https://example.com/story-1/c',
          url_hash: 'story-1-c',
          title: 'Title story-1 C',
        },
      ],
    };
    const bundleB = makeBundle('story-2');
    const pairA = makePair(upgradedBundle);
    const pairB = makePair(bundleB);

    readAuditableBundles
      .mockResolvedValueOnce([baseBundle])
      .mockResolvedValueOnce([upgradedBundle, bundleB]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 2 }));
    buildCanonicalSourcePairs.mockImplementation((bundle) => {
      if (bundle.story_id === 'story-1') return [pairA];
      return [pairB];
    });
    classifyCanonicalSourcePairs.mockResolvedValue([
      makeResult(pairA.pair_id),
      makeResult(pairB.pair_id),
    ]);

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 50,
    });

    expect(report.bundles[0]).toMatchObject({
      story_id: 'story-1',
      canonical_source_count: 3,
      canonical_sources: upgradedBundle.primary_sources,
    });
  });

  it('preserves instantaneous sampling for fixture-backed gates instead of accumulating across sweeps', async () => {
    const bundleA = makeBundle('story-1');
    const bundleB = makeBundle('story-2');
    const pairB = makePair(bundleB);
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';

    readAuditableBundles
      .mockResolvedValueOnce([bundleA])
      .mockResolvedValueOnce([bundleB])
      .mockResolvedValue([bundleB]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 1 }));
    buildCanonicalSourcePairs.mockImplementation((bundle) => {
      if (bundle.story_id === 'story-2') return [pairB];
      return [];
    });
    classifyCanonicalSourcePairs.mockResolvedValue([makeResult(pairB.pair_id)]);

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 50,
    });

    expect(report).toMatchObject({
      sampled_story_count: 1,
      supply: {
        status: 'partial',
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
      },
      overall: {
        audited_pair_count: 1,
        incomplete_bundle_count: 0,
        article_fetch_failure_count: 0,
        pass: false,
      },
    });
    expect(report.bundles.map((bundle) => bundle.story_id)).toEqual(['story-2']);
    expect(nudgeFeed).toHaveBeenCalledWith({}, undefined);
  });

  it('returns the current auditable window immediately for fixture-backed gates when the sample is already full', async () => {
    const bundleA = makeBundle('story-1');
    const bundleB = makeBundle('story-2');
    const pairA = makePair(bundleA);
    const pairB = makePair(bundleB);
    process.env.VH_DAEMON_FEED_USE_FIXTURE_FEED = 'true';

    readAuditableBundles.mockResolvedValue([bundleA, bundleB]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 2 }));
    buildCanonicalSourcePairs.mockImplementation((bundle) => {
      if (bundle.story_id === 'story-1') return [pairA];
      return [pairB];
    });
    classifyCanonicalSourcePairs.mockResolvedValue([
      makeResult(pairA.pair_id),
      makeResult(pairB.pair_id),
    ]);

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 50,
    });

    expect(refreshNewsStoreLatest).not.toHaveBeenCalled();
    expect(nudgeFeed).not.toHaveBeenCalled();
    expect(waitForHeadlines).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      sampled_story_count: 2,
      supply: {
        status: 'full',
        sample_fill_rate: 1,
        sample_shortfall: 0,
      },
      overall: {
        audited_pair_count: 2,
        incomplete_bundle_count: 0,
        article_fetch_failure_count: 0,
        pass: true,
      },
    });
  });
});
