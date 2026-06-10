/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  POINT_AGGREGATE_REFRESH_EVENT,
  dispatchPointAggregateRefresh,
  subscribePointAggregateRefresh,
} from './pointAggregateRefreshEvents';

describe('pointAggregateRefreshEvents', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches refresh details through Event fallback when CustomEvent is unavailable', () => {
    vi.stubGlobal('CustomEvent', undefined);
    const listener = vi.fn();
    const unsubscribe = subscribePointAggregateRefresh(listener);

    dispatchPointAggregateRefresh({
      topicId: 'topic-1',
      synthesisId: 'synthesis-1',
      epoch: 2,
      pointId: 'point-1',
      previousAgreement: 0,
      nextAgreement: 1,
    });

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      topicId: 'topic-1',
      synthesisId: 'synthesis-1',
      epoch: 2,
      pointId: 'point-1',
      nextAgreement: 1,
    }));
    unsubscribe();
  });

  it('no-ops when the runtime cannot dispatch or subscribe to window events', () => {
    const dispatchEvent = globalThis.dispatchEvent;
    vi.stubGlobal('dispatchEvent', undefined);
    expect(() => dispatchPointAggregateRefresh({
      topicId: 'topic-1',
      synthesisId: 'synthesis-1',
      epoch: 1,
      pointId: 'point-1',
    })).not.toThrow();

    vi.stubGlobal('dispatchEvent', dispatchEvent);
    vi.stubGlobal('addEventListener', undefined);
    vi.stubGlobal('removeEventListener', undefined);
    const unsubscribe = subscribePointAggregateRefresh(vi.fn());
    expect(() => unsubscribe()).not.toThrow();
  });

  it('ignores aggregate refresh events without object details', () => {
    const listener = vi.fn();
    const unsubscribe = subscribePointAggregateRefresh(listener);

    globalThis.dispatchEvent(new Event(POINT_AGGREGATE_REFRESH_EVENT));

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
