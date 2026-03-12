import { existsSync, readFileSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readAuditableBundles = vi.fn();
const readSemanticAuditStoreSnapshot = vi.fn();
const refreshNewsStoreLatest = vi.fn();
const waitForHeadlines = vi.fn();
const nudgeFeed = vi.fn();
const buildCanonicalSourcePairs = vi.fn();
const classifyCanonicalSourcePairs = vi.fn();
const hasRelatedTopicOnlyPair = vi.fn((results: Array<{ label: string }>) =>
  results.some((result) => result.label === 'related_topic_only'));
const fetchMock = vi.fn();

vi.mock('./browserNewsStore', () => ({
  readAuditableBundles,
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

function makeBundle(storyId: string) {
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

function makePair(bundle: ReturnType<typeof makeBundle>) {
  return {
    pair_id: `${bundle.story_id}-pair-1`,
    story_id: bundle.story_id,
    topic_id: bundle.topic_id,
    story_headline: bundle.headline,
    left: { ...bundle.sources[0], text: `Left text for ${bundle.story_id}` },
    right: { ...bundle.sources[1], text: `Right text for ${bundle.story_id}` },
  };
}

function makeResult(pairId: string, label: 'same_incident' | 'related_topic_only' = 'same_incident') {
  return {
    pair_id: pairId,
    label,
    confidence: 0.98,
    rationale: `label:${label}`,
  };
}

function artifactDir(runId: string) {
  return path.resolve(process.cwd(), '../../.tmp/e2e-daemon-feed', runId);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  refreshNewsStoreLatest.mockResolvedValue(undefined);
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
  if (runId) {
    rmSync(artifactDir(runId), { recursive: true, force: true });
  }
});

describe('daemonFirstFeedSemanticAudit run coverage', () => {
  it('records empty sampled supply without invoking fetch or the classifier', async () => {
    readAuditableBundles.mockResolvedValue([]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 0 }));

    const { runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const report = await runDaemonFirstFeedSemanticAudit({} as never, {
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
    await expect(runDaemonFirstFeedSemanticAudit({} as never, {
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
    const report = await runDaemonFirstFeedSemanticAudit({} as never, { openAIApiKey: 'test-key' });

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
    const report = await runDaemonFirstFeedSemanticAudit({} as never, {
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
      schema_version: 'daemon-first-feed-semantic-audit-v2',
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
        sample_fill_rate: 1,
        sample_shortfall: 0,
        pass: true,
      },
    });

    const persistedReport = JSON.parse(
      readFileSync(path.join(artifactDir(process.env.VH_DAEMON_FEED_RUN_ID), 'semantic-audit-report.json'), 'utf8'),
    );
    expect(persistedReport.overall.pass).toBe(true);
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
    const report = await runDaemonFirstFeedSemanticAudit({} as never, {
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
});
