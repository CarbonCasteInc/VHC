/* @vitest-environment jsdom */

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as GunClient from '@vh/gun-client';
import * as ClientResolver from '../store/clientResolver';
import { combineFeedEngagementMetrics, useFeedEngagementMetrics } from './useFeedEngagementMetrics';
import { useSentimentState } from './useSentimentState';

describe('combineFeedEngagementMetrics', () => {
  it('adds local decayed user weights to feed counters while mesh catches up', () => {
    expect(
      combineFeedEngagementMetrics({
        baseEye: 10,
        baseLightbulb: 3,
        comments: 2,
        localEyeWeight: 1.285,
        localLightbulbWeight: 1,
      }),
    ).toEqual({
      eye: 11.285,
      lightbulb: 4,
      comments: 2,
    });
  });

  it('prefers larger mesh aggregates over stale feed counters plus local overlay', () => {
    expect(
      combineFeedEngagementMetrics({
        baseEye: 0,
        baseLightbulb: 0,
        comments: 0,
        localEyeWeight: 1,
        localLightbulbWeight: 1,
        meshAggregate: {
          eye_weight: 12.95,
          lightbulb_weight: 6.235,
        },
      }),
    ).toEqual({
      eye: 12.95,
      lightbulb: 6.235,
      comments: 0,
    });
  });
});

describe('useFeedEngagementMetrics', () => {
  beforeEach(() => {
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(null);
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads mesh topic engagement aggregates when a client is available', async () => {
    const fakeClient = {} as never;
    vi.spyOn(ClientResolver, 'resolveClientFromAppStore').mockReturnValue(fakeClient);
    vi.spyOn(GunClient, 'readTopicEngagementSummary').mockResolvedValue({
      schema_version: 'topic-engagement-aggregate-v1',
      topic_id: 'topic-mesh',
      eye_weight: 12.95,
      lightbulb_weight: 6.235,
      readers: 7,
      engagers: 4,
      version: 1,
      computed_at: 1,
    });

    const { result } = renderHook(() =>
      useFeedEngagementMetrics({
        topicId: 'topic-mesh',
        eye: 0,
        lightbulb: 0,
        comments: 3,
      }),
    );

    await waitFor(() => {
      expect(result.current.eye).toBe(12.95);
      expect(result.current.lightbulb).toBe(6.235);
    });
    expect(GunClient.readTopicEngagementSummary).toHaveBeenCalledWith(fakeClient, 'topic-mesh');
  });
});
