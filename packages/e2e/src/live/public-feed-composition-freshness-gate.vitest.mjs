import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  classifyPublicFeedCompositionFailure,
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
});
