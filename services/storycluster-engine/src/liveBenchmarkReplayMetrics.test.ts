import { describe, expect, it } from 'vitest';
import {
  aggregateReplayContinuity,
  createReplayContinuityTracker,
  observeReplayContinuityTick,
  summarizeReplayContinuity,
} from './liveBenchmarkReplayMetrics';

describe('live benchmark replay metrics', () => {
  it('tracks continuous persistence and gap-return continuity separately', () => {
    const tracker = createReplayContinuityTracker();

    observeReplayContinuityTick(tracker, new Map([['event-a', 'story-a'], ['event-b', 'story-b']]));
    observeReplayContinuityTick(tracker, new Map([['event-a', 'story-a'], ['event-b', null]]));
    observeReplayContinuityTick(tracker, new Map([['event-a', 'story-a'], ['event-b', 'story-b']]));
    observeReplayContinuityTick(tracker, new Map([['event-a', 'story-c'], ['event-b', 'story-d']]));

    expect(summarizeReplayContinuity(tracker)).toEqual({
      persistence_observations: 6,
      persistence_retained: 2,
      persistence_rate: 0.333333,
      reappearance_observations: 1,
      reappearance_retained: 1,
      reappearance_rate: 1,
    });
  });

  it('aggregates continuity totals and handles zero-observation rates', () => {
    expect(aggregateReplayContinuity([])).toEqual({
      persistence_observations: 0,
      persistence_retained: 0,
      persistence_rate: 0,
      reappearance_observations: 0,
      reappearance_retained: 0,
      reappearance_rate: 0,
    });

    expect(aggregateReplayContinuity([
      {
        persistence_observations: 2,
        persistence_retained: 1,
        persistence_rate: 0.5,
        reappearance_observations: 1,
        reappearance_retained: 1,
        reappearance_rate: 1,
      },
      {
        persistence_observations: 1,
        persistence_retained: 1,
        persistence_rate: 1,
        reappearance_observations: 2,
        reappearance_retained: 0,
        reappearance_rate: 0,
      },
    ])).toEqual({
      persistence_observations: 3,
      persistence_retained: 2,
      persistence_rate: 0.666667,
      reappearance_observations: 3,
      reappearance_retained: 1,
      reappearance_rate: 0.333333,
    });
  });
});
