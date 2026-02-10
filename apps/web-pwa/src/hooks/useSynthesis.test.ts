// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopicSynthesisV2 } from '@vh/data-model';

function synthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'topic-1',
    epoch: 4,
    synthesis_id: 'synth-4',
    inputs: {
      story_bundle_ids: ['story-1'],
      topic_digest_ids: ['digest-1']
    },
    quorum: {
      required: 3,
      received: 3,
      reached_at: 100,
      timed_out: false,
      selection_rule: 'deterministic'
    },
    facts_summary: 'Summary',
    frames: [
      {
        frame: 'Frame',
        reframe: 'Reframe'
      }
    ],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0.1,
      source_dispersion: 0.2,
      candidate_count: 3
    },
    provenance: {
      candidate_ids: ['candidate-1', 'candidate-2', 'candidate-3'],
      provider_mix: [
        {
          provider_id: 'provider-1',
          count: 3
        }
      ]
    },
    created_at: 200,
    ...overrides
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('useSynthesis', () => {
  it('returns noop result when feature flag is disabled', async () => {
    vi.stubEnv('VITE_TOPIC_SYNTHESIS_V2_ENABLED', 'false');
    vi.stubEnv('VITE_E2E_MODE', 'true');

    const { useSynthesis } = await import('./useSynthesis');
    const { result } = renderHook(() => useSynthesis('topic-1'));

    expect(result.current).toEqual({
      enabled: false,
      topicId: null,
      epoch: null,
      synthesis: null,
      hydrated: false,
      loading: false,
      error: null,
      refresh: expect.any(Function)
    });

    await act(async () => {
      await result.current.refresh();
    });
  });

  it('returns empty topic state when topic id is missing', async () => {
    vi.stubEnv('VITE_TOPIC_SYNTHESIS_V2_ENABLED', 'true');
    vi.stubEnv('VITE_E2E_MODE', 'true');

    const { useSynthesisStore } = await import('../store/synthesis');
    const startHydrationSpy = vi.fn();
    const refreshTopicSpy = vi.fn(async () => undefined);

    useSynthesisStore.setState({
      enabled: true,
      startHydration: startHydrationSpy,
      refreshTopic: refreshTopicSpy
    });

    const { useSynthesis } = await import('./useSynthesis');
    const { result } = renderHook(() => useSynthesis('   '));

    expect(result.current.enabled).toBe(true);
    expect(result.current.topicId).toBeNull();
    expect(result.current.epoch).toBeNull();
    expect(result.current.synthesis).toBeNull();
    expect(result.current.hydrated).toBe(false);

    await act(async () => {
      await result.current.refresh();
    });

    expect(startHydrationSpy).not.toHaveBeenCalled();
    expect(refreshTopicSpy).not.toHaveBeenCalled();
  });

  it('accepts undefined topic id without hydration side effects', async () => {
    vi.stubEnv('VITE_TOPIC_SYNTHESIS_V2_ENABLED', 'true');
    vi.stubEnv('VITE_E2E_MODE', 'true');

    const { useSynthesisStore } = await import('../store/synthesis');
    const startHydrationSpy = vi.fn();
    const refreshTopicSpy = vi.fn(async () => undefined);

    useSynthesisStore.setState({
      enabled: true,
      startHydration: startHydrationSpy,
      refreshTopic: refreshTopicSpy
    });

    const { useSynthesis } = await import('./useSynthesis');
    const { result } = renderHook(() => useSynthesis());

    expect(result.current.enabled).toBe(true);
    expect(result.current.topicId).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });

    expect(startHydrationSpy).not.toHaveBeenCalled();
    expect(refreshTopicSpy).not.toHaveBeenCalled();
  });

  it('hydrates + refreshes selected topic and exposes manual refresh', async () => {
    vi.stubEnv('VITE_TOPIC_SYNTHESIS_V2_ENABLED', 'true');
    vi.stubEnv('VITE_E2E_MODE', 'true');

    const { useSynthesisStore } = await import('../store/synthesis');

    useSynthesisStore.getState().setTopicSynthesis('topic-1', synthesis());
    useSynthesisStore.getState().setTopicHydrated('topic-1', true);

    const startHydrationSpy = vi.fn();
    const refreshTopicSpy = vi.fn(async () => undefined);

    useSynthesisStore.setState({
      enabled: true,
      startHydration: startHydrationSpy,
      refreshTopic: refreshTopicSpy
    });

    const { useSynthesis } = await import('./useSynthesis');
    const { result } = renderHook(() => useSynthesis(' topic-1 '));

    await waitFor(() => {
      expect(startHydrationSpy).toHaveBeenCalledWith('topic-1');
      expect(refreshTopicSpy).toHaveBeenCalledWith('topic-1');
    });

    expect(result.current.enabled).toBe(true);
    expect(result.current.topicId).toBe('topic-1');
    expect(result.current.epoch).toBe(4);
    expect(result.current.synthesis?.synthesis_id).toBe('synth-4');
    expect(result.current.hydrated).toBe(true);

    await act(async () => {
      await result.current.refresh();
    });

    expect(refreshTopicSpy).toHaveBeenCalledTimes(2);
  });
});
