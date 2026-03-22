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

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  readRetainedSourceEvidenceSnapshot.mockResolvedValue({
    schemaVersion: 'daemon-feed-retained-source-evidence-v1',
    generatedAt: '2026-03-22T00:00:00.000Z',
    story_count: 0,
    auditable_count: 0,
    visible_story_ids: [],
    top_story_ids: [],
    top_auditable_story_ids: [],
    source_count: 0,
    sources: [],
  });
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
  delete process.env.VH_DAEMON_FEED_RUN_ID;
});

describe('daemonFirstFeedSemanticAudit fetch and helper coverage', () => {
  it('summarizes partial supply without promoting the run', async () => {
    const { buildDaemonFeedSemanticAuditReport, summarizeSemanticAuditSupply } = await import('./daemonFirstFeedSemanticAudit');
    const sampledBundles = [makeBundle('story-1')];
    const supply = summarizeSemanticAuditSupply(3, sampledBundles, makeSnapshot({ auditable_count: 1 }));

    expect(supply).toEqual({
      status: 'partial',
      story_count: 4,
      auditable_count: 1,
      visible_story_ids: ['story-1', 'story-2', 'story-3'],
      top_story_ids: ['story-1', 'story-2', 'story-3', 'story-4'],
      top_auditable_story_ids: ['story-1', 'story-2'],
      sample_fill_rate: 1 / 3,
      sample_shortfall: 2,
    });

    expect(buildDaemonFeedSemanticAuditReport(
      3,
      [{
        story_id: 'story-1',
        topic_id: 'topic-story-1',
        headline: 'Headline story-1',
        canonical_source_count: 2,
        secondary_asset_count: 0,
        canonical_sources: sampledBundles[0].sources,
        pairs: [],
        has_related_topic_only_pair: false,
      }],
      1,
      0,
      supply,
    )).toMatchObject({
      schema_version: 'daemon-first-feed-semantic-audit-v2',
      requested_sample_count: 3,
      sampled_story_count: 1,
      visible_story_ids: ['story-1', 'story-2', 'story-3'],
      supply: {
        status: 'partial',
        story_count: 4,
        auditable_count: 1,
        sample_fill_rate: 1 / 3,
        sample_shortfall: 2,
      },
      overall: {
        audited_pair_count: 1,
        related_topic_only_pair_count: 0,
        sample_fill_rate: 1 / 3,
        sample_shortfall: 2,
        pass: false,
      },
    });
  });

  it('surfaces article-text HTTP failures, missing text, and timeouts', async () => {
    const { fetchArticlePayload } = await import('./daemonFirstFeedSemanticAudit');

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(fetchArticlePayload('https://daemon.example.test', 'https://example.com/a', 'source-a'))
      .rejects.toThrow('article-text 503 for source-a');

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ title: 'No body', text: '   ' }) });
    await expect(fetchArticlePayload('https://daemon.example.test', 'https://example.com/b', 'source-b'))
      .rejects.toThrow('article-text missing text for source-b');

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(fetchArticlePayload('https://daemon.example.test', 'https://example.com/c', 'source-c'))
      .rejects.toThrow('article-text timeout for source-c');
  });

  it('normalizes non-string article titles and rejects non-string article text', async () => {
    const { fetchArticlePayload } = await import('./daemonFirstFeedSemanticAudit');

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ title: 123, text: ' Body ' }) });
    await expect(fetchArticlePayload('https://daemon.example.test', 'https://example.com/d', 'source-d'))
      .resolves.toEqual({ title: '', text: 'Body' });

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ title: 'Ignored', text: 123 }) });
    await expect(fetchArticlePayload('https://daemon.example.test', 'https://example.com/e', 'source-e'))
      .rejects.toThrow('article-text missing text for source-e');
  });

  it('rethrows non-timeout article-text fetch failures', async () => {
    const { fetchArticlePayload } = await import('./daemonFirstFeedSemanticAudit');
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    await expect(fetchArticlePayload('https://daemon.example.test', 'https://example.com/f', 'source-f'))
      .rejects.toThrow('boom');
  });

  it('covers empty diagnostics, contaminated full samples, and no-run-id partial execution', async () => {
    const { buildDaemonFeedSemanticAuditReport, summarizeSemanticAuditSupply, runDaemonFirstFeedSemanticAudit } = await import('./daemonFirstFeedSemanticAudit');
    const bundle = makeBundle('story-1');
    const emptySupply = summarizeSemanticAuditSupply(2, [], makeSnapshot({ auditable_count: 0 }));
    expect(emptySupply).toMatchObject({
      status: 'empty',
      auditable_count: 0,
      sample_fill_rate: 0,
      sample_shortfall: 2,
    });

    const fullSupply = summarizeSemanticAuditSupply(1, [bundle], makeSnapshot({ auditable_count: 1 }));
    expect(buildDaemonFeedSemanticAuditReport(
      1,
      [{
        story_id: bundle.story_id,
        topic_id: bundle.topic_id,
        headline: bundle.headline,
        canonical_source_count: 2,
        secondary_asset_count: 0,
        canonical_sources: bundle.sources,
        pairs: [],
        has_related_topic_only_pair: true,
      }],
      1,
      1,
      fullSupply,
    ).overall.pass).toBe(false);

    readAuditableBundles.mockResolvedValue([bundle]);
    readSemanticAuditStoreSnapshot.mockResolvedValue(makeSnapshot({ auditable_count: 1 }));
    buildCanonicalSourcePairs.mockReturnValue([]);
    classifyCanonicalSourcePairs.mockResolvedValue([]);

    const report = await runDaemonFirstFeedSemanticAudit({}, {
      openAIApiKey: 'test-key',
      sampleCount: 2,
      timeoutMs: 0,
    });

    expect(classifyCanonicalSourcePairs).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      sampled_story_count: 1,
      supply: {
        status: 'partial',
        sample_fill_rate: 0.5,
        sample_shortfall: 1,
      },
      overall: {
        audited_pair_count: 0,
        pass: false,
      },
    });
  });
});
