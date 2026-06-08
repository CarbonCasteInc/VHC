import { mkdtemp, mkdir, readFile, readlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assertPublicRelayPeerReadbacks,
  classifyPublicFeedCompositionFailure,
  publicRelayPeerOriginsFromEnv,
  runPublicFeedCompositionFreshnessGate,
  summarizeSourceHealthReport,
} from './public-feed-composition-freshness-gate.mjs';

function jsonResponse(payload, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => JSON.stringify(payload),
  };
}

describe('public feed composition freshness gate', () => {
  function mixedFeedFixtures(now = Date.now()) {
    const stories = {
      'story-singleton': {
        story_id: 'story-singleton',
        topic_id: 'topic-singleton',
        headline: 'One valid singleton story',
        provenance_hash: 'prov-singleton',
        created_at: now - 10_000,
        cluster_window_start: now - 12_000,
        sources: [{ publisher: 'Source A', url: 'https://source-a.example/story' }],
      },
      'story-bundle': {
        story_id: 'story-bundle',
        topic_id: 'topic-bundle',
        headline: 'One corroborated bundled story',
        provenance_hash: 'prov-bundle',
        created_at: now - 20_000,
        cluster_window_start: now - 24_000,
        sources: [
          { publisher: 'Source A', url: 'https://source-a.example/bundle' },
          { publisher: 'Source B', url: 'https://source-b.example/bundle' },
        ],
      },
    };
    const records = Object.fromEntries(Object.entries(stories).map(([storyId, story], index) => [
      storyId,
      {
        story_id: storyId,
        latest_activity_at: now - index * 1_000,
        product_state_schema_version: 'vh-news-product-feed-index-v1',
        topic_id: story.topic_id,
        source_set_revision: story.provenance_hash,
        source_count: story.sources.length,
        canonical_source_count: story.sources.length,
        story_created_at: story.created_at,
        cluster_window_start: story.cluster_window_start,
      },
    ]));
    const storyStates = Object.fromEntries(Object.entries(stories).map(([storyId]) => [
      storyId,
      {
        synthesis_state: 'accepted_synthesis_available',
        frame_table_state: 'frame_table_ready',
        lifecycle_status: 'accepted_available',
      },
    ]));
    return {
      stories,
      latestIndex: {
        records,
        composition: {
          total_visible: 2,
          singleton_visible: 1,
          multi_source_visible: 1,
          pending_synthesis: 0,
          accepted_synthesis_available: 2,
          terminal_unavailable: 0,
          average_source_count: 1.5,
          max_source_count: 2,
          freshness_age_ms: 1_000,
        },
        story_states: storyStates,
      },
    };
  }

  function installMixedFeedFetch(fixtures) {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/vh/news/latest-index') {
        return jsonResponse(fixtures.latestIndex);
      }
      if (parsed.pathname === '/vh/news/story') {
        const storyId = parsed.searchParams.get('story_id');
        const story = fixtures.stories[storyId];
        return story
          ? jsonResponse({ story })
          : jsonResponse({ ok: false, error: 'story-not-found' }, { ok: false, status: 404 });
      }
      if (parsed.pathname === '/vh/topics/synthesis') {
        const topicId = parsed.searchParams.get('topic_id');
        return jsonResponse({
          synthesis: {
            topic_id: topicId,
            synthesis_id: `syn-${topicId}`,
            facts_summary: `Facts for ${topicId}`,
            frames: [{
              frame: 'Frame',
              reframe: 'Reframe',
              frame_point_id: `fp-${topicId}`,
              reframe_point_id: `rp-${topicId}`,
            }],
          },
        });
      }
      return jsonResponse({ ok: false, error: 'not-found' }, { ok: false, status: 404 });
    }));
  }

  it('summarizes corroborated source-health evidence', () => {
    expect(summarizeSourceHealthReport({
      schemaVersion: 'news-source-health-report-v1',
      generatedAt: '2026-05-30T19:39:54.689Z',
      readinessStatus: 'ready',
      releaseEvidence: { status: 'pass' },
      sourceCount: 28,
      feedContribution: {
        totalIngestedItemCount: 917,
        totalNormalizedItemCount: 851,
        totalBundleCount: 385,
        totalSingletonBundleCount: 339,
        totalCorroboratedBundleCount: 46,
        corroboratingSourceIds: ['ap-topnews', 'npr-news'],
      },
    })).toMatchObject({
      available: true,
      releaseEvidenceStatus: 'pass',
      sourceCount: 28,
      totalBundleCount: 385,
      totalCorroboratedBundleCount: 46,
      corroboratingSourceCount: 2,
    });
  });

  it('keeps true multi-source scarcity separate from product publication failure', () => {
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-feed-composition-missing-multi-source',
      { totalCorroboratedBundleCount: 0 },
    )).toBe('setup_scarcity');
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-feed-composition-missing-multi-source',
      { totalCorroboratedBundleCount: 4 },
    )).toBe('fail');
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-latest-index-missing-composition',
      { totalCorroboratedBundleCount: 0 },
    )).toBe('fail');
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-latest-index-product-metadata-missing:1',
      { totalCorroboratedBundleCount: 0 },
    )).toBe('fail');
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-latest-index-pagination-unavailable:first-page-next-cursor-missing',
      { totalCorroboratedBundleCount: 0 },
    )).toBe('fail');
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-peer-readback-not-configured',
      { totalCorroboratedBundleCount: 0 },
    )).toBe('fail');
    expect(classifyPublicFeedCompositionFailure(
      'public-relay-peer-readback-failed:https://gun-b.example/:story_states_missing',
      { totalCorroboratedBundleCount: 0 },
    )).toBe('fail');
  });

  it('derives relay origins from configured public WSS peers', () => {
    expect(publicRelayPeerOriginsFromEnv({
      VH_PUBLIC_FEED_GUN_PEER_URL: 'wss://gun-a.example/gun',
      VH_PUBLIC_FEED_PUBLIC_WSS_PEERS: '["wss://gun-b.example/gun","wss://gun-a.example/gun"]',
      VH_PUBLIC_FEED_PUBLIC_RELAY_ORIGINS: 'https://relay.example/',
    })).toEqual([
      'https://gun-a.example/',
      'https://gun-b.example/',
      'https://relay.example/',
    ]);
  });

  it('records independent latest-index and story-body readback for every configured public peer', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-composition-gate-'));
    const artifactDir = path.join(repoRoot, 'artifacts');
    const fixtures = mixedFeedFixtures();
    installMixedFeedFetch(fixtures);

    try {
      const summary = await runPublicFeedCompositionFreshnessGate({
        repoRoot,
        env: {
          VH_PUBLIC_FEED_APP_URL: 'https://venn.example/',
          VH_PUBLIC_FEED_PUBLIC_WSS_PEERS: '["wss://gun-a.example/gun","wss://gun-b.example/gun"]',
          VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR: artifactDir,
          VH_PUBLIC_FEED_REQUIRE_CURSOR_PAGINATION: 'false',
        },
      });

      expect(summary.status).toBe('pass');
      expect(summary.publicPeerReadback).toMatchObject({
        status: 'pass',
        required: true,
        origins: ['https://gun-a.example/', 'https://gun-b.example/'],
        originCount: 2,
      });
      expect(summary.publicPeerReadback.readbacks).toHaveLength(2);
      expect(summary.publicPeerReadback.readbacks[0].storyBodyReadbacks.length).toBeGreaterThan(0);

      const artifact = JSON.parse(await readFile(
        path.join(artifactDir, 'public-feed-composition-freshness-summary.json'),
        'utf8',
      ));
      expect(artifact.publicPeerReadback.status).toBe('pass');
      expect(artifact.publicPeerReadback.readbacks.every((readback) => readback.status === 'pass')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not scrape article text for honest pending synthesis rows', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-composition-gate-'));
    const artifactDir = path.join(repoRoot, 'artifacts');
    const fixtures = mixedFeedFixtures();
    for (const state of Object.values(fixtures.latestIndex.story_states)) {
      state.synthesis_state = 'synthesis_pending';
      state.frame_table_state = 'frame_table_pending';
      state.lifecycle_status = 'pending';
    }
    fixtures.latestIndex.composition.pending_synthesis = 2;
    fixtures.latestIndex.composition.accepted_synthesis_available = 0;
    const fetchSpy = vi.fn(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/article-text') {
        throw new Error('unexpected-article-text-probe');
      }
      if (parsed.pathname === '/vh/news/latest-index') {
        return jsonResponse(fixtures.latestIndex);
      }
      if (parsed.pathname === '/vh/news/story') {
        const storyId = parsed.searchParams.get('story_id');
        const story = fixtures.stories[storyId];
        return story
          ? jsonResponse({ story })
          : jsonResponse({ ok: false, error: 'story-not-found' }, { ok: false, status: 404 });
      }
      if (parsed.pathname === '/vh/topics/synthesis') {
        return jsonResponse({ ok: false, error: 'topic-synthesis-not-found' }, { ok: false, status: 404 });
      }
      return jsonResponse({ ok: false, error: 'not-found' }, { ok: false, status: 404 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    try {
      const summary = await runPublicFeedCompositionFreshnessGate({
        repoRoot,
        env: {
          VH_PUBLIC_FEED_APP_URL: 'https://venn.example/',
          VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR: artifactDir,
          VH_PUBLIC_FEED_REQUIRE_CURSOR_PAGINATION: 'false',
          VH_PUBLIC_FEED_REQUIRE_PUBLIC_PEER_READBACK: 'false',
          VH_PUBLIC_FEED_REQUIRE_ACCEPTED_SYNTHESIS: 'false',
        },
      });

      expect(summary.status).toBe('pass');
      expect(summary.articleTextSampleStatusCounts).toEqual({
        not_checked_synthesis_pending: 2,
      });
      expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/article-text'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails deployed public gates when public peer readback is required but not configured', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-composition-gate-'));
    const artifactDir = path.join(repoRoot, 'artifacts');
    const fixtures = mixedFeedFixtures();
    installMixedFeedFetch(fixtures);

    try {
      await expect(runPublicFeedCompositionFreshnessGate({
        repoRoot,
        env: {
          VH_PUBLIC_FEED_APP_URL: 'https://venn.example/',
          VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR: artifactDir,
          VH_PUBLIC_FEED_REQUIRE_CURSOR_PAGINATION: 'false',
        },
      })).rejects.toThrow('fail:public-relay-peer-readback-not-configured');

      const summary = JSON.parse(await readFile(
        path.join(artifactDir, 'public-feed-composition-freshness-summary.json'),
        'utf8',
      ));
      expect(summary.publicPeerReadback).toMatchObject({
        status: 'fail',
        required: true,
        originCount: 0,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('treats failed peer relay surfaces as blocking composition evidence', () => {
    expect(() => assertPublicRelayPeerReadbacks({
      required: true,
      originCount: 1,
      status: 'fail',
      failedOrigins: [{
        origin: 'https://gun-b.example/',
        failures: ['story_states_missing'],
      }],
    })).toThrow('public-relay-peer-readback-failed:https://gun-b.example/:story_states_missing');
  });

  it('fails singleton-only public feeds when source-health proves corroborated supply exists', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-composition-gate-'));
    const sourceHealthPath = path.join(
      repoRoot,
      'services',
      'news-aggregator',
      '.tmp',
      'news-source-admission',
      'latest',
      'source-health-report.json',
    );
    await mkdir(path.dirname(sourceHealthPath), { recursive: true });
    await writeFile(sourceHealthPath, JSON.stringify({
      schemaVersion: 'news-source-health-report-v1',
      generatedAt: '2026-05-30T19:39:54.689Z',
      readinessStatus: 'ready',
      releaseEvidence: { status: 'pass' },
      sourceCount: 28,
      feedContribution: {
        totalIngestedItemCount: 917,
        totalNormalizedItemCount: 851,
        totalBundleCount: 385,
        totalSingletonBundleCount: 339,
        totalCorroboratedBundleCount: 46,
        corroboratingSourceIds: ['ap-topnews', 'npr-news'],
      },
    }));
    const artifactDir = path.join(repoRoot, 'artifacts');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/vh/news/latest-index')) {
        return jsonResponse({
          records: {
            'story-singleton': {
              story_id: 'story-singleton',
              latest_activity_at: Date.now(),
              product_state_schema_version: 'vh-news-product-feed-index-v1',
              topic_id: 'topic-singleton',
              source_set_revision: 'prov-singleton',
              source_count: 1,
              canonical_source_count: 1,
              story_created_at: 5,
              cluster_window_start: 4,
            },
          },
          composition: {
            total_visible: 1,
            singleton_visible: 1,
            multi_source_visible: 0,
            freshness_age_ms: 1_000,
          },
          story_states: {
            'story-singleton': {
              synthesis_state: 'synthesis_pending',
              frame_table_state: 'frame_table_pending',
              lifecycle_status: 'pending',
            },
          },
        });
      }
      if (href.includes('/vh/news/story')) {
        return jsonResponse({
          story: {
            story_id: 'story-singleton',
            topic_id: 'topic-singleton',
            headline: 'One valid singleton story',
            provenance_hash: 'prov-singleton',
            created_at: 5,
            cluster_window_start: 4,
            sources: [{ publisher: 'source-a', url: 'https://source.example/story' }],
          },
        });
      }
      if (href.includes('/vh/topics/synthesis')) {
        return jsonResponse({ ok: false, error: 'topic-synthesis-not-found' }, { ok: false, status: 404 });
      }
      if (href.includes('/article-text')) {
        return jsonResponse({ text: 'Readable article body.' });
      }
      return jsonResponse({});
    }));

    try {
      await expect(runPublicFeedCompositionFreshnessGate({
        repoRoot,
        env: {
          VH_PUBLIC_FEED_APP_URL: 'https://venn.example/',
          VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR: artifactDir,
          VH_PUBLIC_FEED_REQUIRE_PUBLIC_PEER_READBACK: 'false',
        },
      })).rejects.toThrow('fail:public-relay-feed-composition-missing-multi-source');

      const summary = JSON.parse(await readFile(
        path.join(artifactDir, 'public-feed-composition-freshness-summary.json'),
        'utf8',
      ));
      expect(summary.status).toBe('fail');
      expect(summary.sourceHealthEvidence).toMatchObject({
        available: true,
        totalCorroboratedBundleCount: 46,
      });
      expect(summary.counts).toMatchObject({
        singletonReadableCount: 1,
        multiSourceReadableCount: 0,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('fails when the latest page is mixed only because relay backfilled an older bundled row', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-composition-gate-'));
    const sourceHealthPath = path.join(
      repoRoot,
      'services',
      'news-aggregator',
      '.tmp',
      'news-source-admission',
      'latest',
      'source-health-report.json',
    );
    await mkdir(path.dirname(sourceHealthPath), { recursive: true });
    await writeFile(sourceHealthPath, JSON.stringify({
      schemaVersion: 'news-source-health-report-v1',
      generatedAt: '2026-06-08T12:00:00.000Z',
      readinessStatus: 'ready',
      releaseEvidence: { status: 'pass' },
      sourceCount: 28,
      feedContribution: {
        totalBundleCount: 3,
        totalSingletonBundleCount: 2,
        totalCorroboratedBundleCount: 1,
      },
    }));
    const artifactDir = path.join(repoRoot, 'artifacts');
    const now = Date.now();
    const stories = {
      'story-singleton-a': {
        story_id: 'story-singleton-a',
        topic_id: 'topic-singleton-a',
        headline: 'Fresh singleton A',
        provenance_hash: 'prov-singleton-a',
        created_at: now - 2_000,
        cluster_window_start: now - 3_000,
        sources: [{ publisher: 'source-a', url: 'https://source.example/a' }],
      },
      'story-singleton-b': {
        story_id: 'story-singleton-b',
        topic_id: 'topic-singleton-b',
        headline: 'Fresh singleton B',
        provenance_hash: 'prov-singleton-b',
        created_at: now - 4_000,
        cluster_window_start: now - 5_000,
        sources: [{ publisher: 'source-b', url: 'https://source.example/b' }],
      },
      'story-old-bundle': {
        story_id: 'story-old-bundle',
        topic_id: 'topic-old-bundle',
        headline: 'Older bundled story',
        provenance_hash: 'prov-old-bundle',
        created_at: now - 100_000,
        cluster_window_start: now - 101_000,
        sources: [
          { publisher: 'source-a', url: 'https://source.example/old-a' },
          { publisher: 'source-c', url: 'https://source.example/old-c' },
        ],
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/vh/news/latest-index') {
        return jsonResponse({
          records: Object.fromEntries(Object.entries(stories).map(([storyId, story], index) => [
            storyId,
            {
              story_id: storyId,
              latest_activity_at: now - index * 1_000,
              product_state_schema_version: 'vh-news-product-feed-index-v1',
              topic_id: story.topic_id,
              source_set_revision: story.provenance_hash,
              source_count: story.sources.length,
              canonical_source_count: story.sources.length,
              story_created_at: story.created_at,
              cluster_window_start: story.cluster_window_start,
            },
          ])),
          composition: {
            total_visible: 3,
            singleton_visible: 2,
            multi_source_visible: 1,
            organic_selected_count: 2,
            organic_singleton_visible: 2,
            organic_multi_source_visible: 0,
            scan_window_selected_count: 3,
            scan_window_singleton_visible: 2,
            scan_window_multi_source_visible: 1,
            backfill_used: true,
            backfill_story_ids: ['story-old-bundle'],
            freshness_age_ms: 1_000,
          },
          backfill_used: true,
          backfill_story_ids: ['story-old-bundle'],
          composition_backfill_records: [{
            story_id: 'story-old-bundle',
            reason: 'freshest_visible_corroborated_story_backfilled_for_mixed_feed_window',
            source_count: 2,
            latest_activity_at: now - 2_000,
          }],
          story_states: Object.fromEntries(Object.keys(stories).map((storyId) => [
            storyId,
            {
              synthesis_state: 'synthesis_pending',
              frame_table_state: 'frame_table_pending',
              lifecycle_status: 'pending',
            },
          ])),
        });
      }
      if (parsed.pathname === '/vh/news/story') {
        const story = stories[parsed.searchParams.get('story_id')];
        return story
          ? jsonResponse({ story })
          : jsonResponse({ ok: false, error: 'story-not-found' }, { ok: false, status: 404 });
      }
      if (parsed.pathname === '/vh/topics/synthesis') {
        return jsonResponse({ ok: false, error: 'topic-synthesis-not-found' }, { ok: false, status: 404 });
      }
      return jsonResponse({});
    }));

    try {
      await expect(runPublicFeedCompositionFreshnessGate({
        repoRoot,
        env: {
          VH_PUBLIC_FEED_APP_URL: 'https://venn.example/',
          VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR: artifactDir,
          VH_PUBLIC_FEED_REQUIRE_PUBLIC_PEER_READBACK: 'false',
          VH_PUBLIC_FEED_REQUIRE_CURSOR_PAGINATION: 'false',
        },
      })).rejects.toThrow('fail:public-relay-feed-composition-backfill-only-multi-source');

      const summary = JSON.parse(await readFile(
        path.join(artifactDir, 'public-feed-composition-freshness-summary.json'),
        'utf8',
      ));
      expect(summary.status).toBe('fail');
      expect(summary.organicComposition).toMatchObject({
        singletonVisible: 2,
        multiSourceVisible: 0,
      });
      expect(summary.scanWindowComposition).toMatchObject({
        multiSourceVisible: 1,
      });
      expect(summary.compositionBackfill).toMatchObject({
        used: true,
        storyIds: ['story-old-bundle'],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('writes a failure summary when the public latest-index fetch fails before readback sampling', async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'vh-public-composition-fetch-fail-'));
    const artifactDir = path.join(repoRoot, 'artifacts');
    const latestPath = path.join(repoRoot, '.tmp', 'release-evidence', 'public-feed-composition-freshness', 'latest');
    await mkdir(path.dirname(artifactDir), { recursive: true });
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ error: 'cloudflare-1033' }, { ok: false, status: 530 })));

    try {
      await expect(runPublicFeedCompositionFreshnessGate({
        repoRoot,
        env: {
          VH_PUBLIC_FEED_APP_URL: 'https://venn.carboncaste.io/',
          VH_PUBLIC_FEED_COMPOSITION_ARTIFACT_DIR: artifactDir,
          VH_PUBLIC_FEED_COMPOSITION_TIMEOUT_MS: '1000',
        },
      })).rejects.toThrow('fail:public-relay-latest-index-http-530');

      const summary = JSON.parse(await readFile(
        path.join(artifactDir, 'public-feed-composition-freshness-summary.json'),
        'utf8',
      ));
      expect(summary).toMatchObject({
        status: 'fail',
        config: {
          baseUrl: 'https://venn.carboncaste.io/',
        },
        counts: {},
      });
      expect(summary.failure).toContain('public-relay-latest-index-http-530');
      expect(summary.failure).toContain('cloudflare-1033');
      await expect(readlink(latestPath)).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
