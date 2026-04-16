import { describe, expect, it } from 'vitest';
import type { FeedItem, RankingConfig } from '@vh/data-model';
import { DEFAULT_RANKING_CONFIG } from '@vh/data-model';
import { sortItems } from './ranking';

const NOW = 1_700_000_000_000;
const HOUR_MS = 3_600_000;

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'topic-1',
    kind: 'NEWS_STORY',
    title: 'Test item',
    created_at: NOW - 2 * HOUR_MS,
    latest_activity_at: NOW - HOUR_MS,
    hotness: 0,
    eye: 10,
    lightbulb: 5,
    comments: 3,
    ...overrides,
  };
}

const CONFIG: RankingConfig = { ...DEFAULT_RANKING_CONFIG };

describe('HOTTEST storyline cap', () => {
  it('pulls replacements from beyond the initial diversify window before exceeding the storyline cap', () => {
    const dominant = Array.from({ length: 8 }, (_, index) =>
      makeFeedItem({
        topic_id: `alpha-${index + 1}`,
        title: `Alpha storyline update ${index + 1}`,
        storyline_id: 'storyline-alpha',
        hotness: 1 - index * 0.01,
      }));

    const challengers = Array.from({ length: 10 }, (_, index) =>
      makeFeedItem({
        topic_id: `other-${index + 1}`,
        title: `Transit disruption ${index + 1}`,
        storyline_id: `storyline-other-${index + 1}`,
        hotness: 0.92 - index * 0.01,
      }));

    const result = sortItems([...dominant, ...challengers], 'HOTTEST', CONFIG, NOW);
    const topWindow = result.slice(0, 12);
    const dominantCount = topWindow.filter((item) => item.storyline_id === 'storyline-alpha').length;

    expect(dominantCount).toBeLessThanOrEqual(2);
    expect(topWindow.map((item) => item.topic_id)).toEqual([
      'alpha-1',
      'other-1',
      'alpha-2',
      'other-2',
      'other-3',
      'other-4',
      'other-5',
      'other-6',
      'other-7',
      'other-8',
      'other-9',
      'other-10',
    ]);
  });

  it('uses ranking config diversification settings instead of hard-coded caps', () => {
    const config: RankingConfig = {
      ...CONFIG,
      hottestDiversification: {
        window: 4,
        storylineCap: 1,
        adjacentEntityOverlapPenalty: 0,
      },
    };
    const items = [
      makeFeedItem({ topic_id: 'alpha-1', storyline_id: 'storyline-alpha', hotness: 1 }),
      makeFeedItem({ topic_id: 'alpha-2', storyline_id: 'storyline-alpha', hotness: 0.99 }),
      makeFeedItem({ topic_id: 'beta-1', storyline_id: 'storyline-beta', hotness: 0.98 }),
      makeFeedItem({ topic_id: 'gamma-1', storyline_id: 'storyline-gamma', hotness: 0.97 }),
      makeFeedItem({ topic_id: 'delta-1', storyline_id: 'storyline-delta', hotness: 0.96 }),
    ];

    const result = sortItems(items, 'HOTTEST', config, NOW).slice(0, 4);

    expect(result.map((item) => item.topic_id)).toEqual([
      'alpha-1',
      'beta-1',
      'gamma-1',
      'delta-1',
    ]);
  });
});
