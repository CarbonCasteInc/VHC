import { describe, expect, it } from 'vitest';
import type { FeedSource } from './newsTypes';
import {
  applySourceHealthReportToFeedSources,
  parseSourceHealthReportObject,
} from './sourceHealthPolicy';

const FEED_SOURCES: readonly FeedSource[] = [
  {
    id: 'source-a',
    name: 'Source A',
    rssUrl: 'https://a.example/rss',
    enabled: true,
  },
  {
    id: 'source-b',
    name: 'Source B',
    rssUrl: 'https://b.example/rss',
    enabled: true,
  },
  {
    id: 'source-c',
    name: 'Source C',
    rssUrl: 'https://c.example/rss',
    enabled: true,
  },
];

describe('sourceHealthPolicy', () => {
  it('parses nested runtimePolicy payloads', () => {
    const report = parseSourceHealthReportObject(
      {
        readinessStatus: 'review',
        recommendedAction: 'review_watchlist',
        runtimePolicy: {
          enabledSourceIds: ['source-a', 'source-b'],
          watchSourceIds: ['source-b'],
          removeSourceIds: ['source-c'],
        },
      },
      { reportSource: 'artifact:/tmp/source-health-report.json' },
    );

    expect(report).toEqual({
      readinessStatus: 'review',
      recommendedAction: 'review_watchlist',
      reportSource: 'artifact:/tmp/source-health-report.json',
      runtimePolicy: {
        enabledSourceIds: ['source-a', 'source-b'],
        watchSourceIds: ['source-b'],
        removeSourceIds: ['source-c'],
      },
    });
  });

  it('falls back to top-level keep/watch/remove fields', () => {
    const report = parseSourceHealthReportObject({
      keepSourceIds: ['source-a'],
      watchSourceIds: ['source-b'],
      removeSourceIds: ['source-c'],
    });

    expect(report?.runtimePolicy).toEqual({
      enabledSourceIds: ['source-a', 'source-b'],
      watchSourceIds: ['source-b'],
      removeSourceIds: ['source-c'],
    });
  });

  it('returns null when no policy ids are present', () => {
    expect(parseSourceHealthReportObject({ runtimePolicy: {} })).toBeNull();
    expect(parseSourceHealthReportObject(1)).toBeNull();
  });

  it('applies remove filtering when enforcement is enabled', () => {
    const report = parseSourceHealthReportObject({
      readinessStatus: 'blocked',
      recommendedAction: 'prune_remove_candidates',
      runtimePolicy: {
        enabledSourceIds: ['source-a', 'source-b'],
        watchSourceIds: ['source-b'],
        removeSourceIds: ['source-c'],
      },
    })!;

    const applied = applySourceHealthReportToFeedSources(FEED_SOURCES, report);

    expect(applied.feedSources.map((source) => source.id)).toEqual(['source-a', 'source-b']);
    expect(applied.summary).toEqual({
      enforcement: 'enabled',
      readinessStatus: 'blocked',
      recommendedAction: 'prune_remove_candidates',
      reportSource: null,
      retainedSourceIds: ['source-a', 'source-b'],
      watchSourceIds: ['source-b'],
      removedConfiguredSourceIds: ['source-c'],
      unclassifiedSourceIds: [],
    });
  });

  it('retains all sources when enforcement is disabled while still surfacing watch/remove state', () => {
    const report = parseSourceHealthReportObject({
      readinessStatus: 'review',
      recommendedAction: 'review_watchlist',
      runtimePolicy: {
        enabledSourceIds: ['source-a'],
        watchSourceIds: ['source-b'],
        removeSourceIds: ['source-c'],
      },
    })!;

    const applied = applySourceHealthReportToFeedSources(FEED_SOURCES, report, {
      enforcement: 'disabled',
    });

    expect(applied.feedSources.map((source) => source.id)).toEqual(['source-a', 'source-b', 'source-c']);
    expect(applied.summary.unclassifiedSourceIds).toEqual(['source-c']);
    expect(applied.summary.removedConfiguredSourceIds).toEqual([]);
    expect(applied.summary.watchSourceIds).toEqual(['source-b']);
  });
});
