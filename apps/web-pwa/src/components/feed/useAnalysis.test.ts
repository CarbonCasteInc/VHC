/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import {
  canAnalyze,
  recordAnalysis,
  useAnalysis,
} from './useAnalysis';
import {
  getCachedSynthesisForStory,
  synthesizeStoryFromAnalysisPipeline,
  type NewsCardAnalysisSynthesis,
} from './newsCardAnalysis';
import {
  readMeshAnalysis,
  writeMeshAnalysis,
} from './useAnalysisMesh';
import * as DevModelPickerModule from '../dev/DevModelPicker';
vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  getCachedSynthesisForStory: vi.fn(),
}));
vi.mock('./useAnalysisMesh', () => ({
  readMeshAnalysis: vi.fn(),
  writeMeshAnalysis: vi.fn(),
}));
vi.mock('../dev/DevModelPicker', () => ({
  DEV_MODEL_CHANGED_EVENT: 'vh:dev-model-changed',
  getDevModelOverride: vi.fn(),
}));

const mockSynthesizeStoryFromAnalysisPipeline = vi.mocked(
  synthesizeStoryFromAnalysisPipeline,
);
const mockGetCachedSynthesisForStory = vi.mocked(getCachedSynthesisForStory);
const mockReadMeshAnalysis = vi.mocked(readMeshAnalysis);
const mockWriteMeshAnalysis = vi.mocked(writeMeshAnalysis);
const mockGetDevModelOverride = vi.mocked(DevModelPickerModule.getDevModelOverride);
const NOW = 1_700_000_000_000;
function makeStoryBundle(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-news-1',
    topic_id: 'news-1',
    headline: 'City council votes on transit plan',
    summary_hint: 'Transit vote split council members along budget priorities.',
    cluster_window_start: NOW - 7_200_000,
    cluster_window_end: NOW,
    sources: [
      {
        source_id: 'src-1',
        publisher: 'Local Paper',
        url: 'https://example.com/news-1',
        url_hash: 'hash-1',
        published_at: NOW - 3_600_000,
        title: 'City council votes on transit plan',
      },
    ],
    cluster_features: {
      entity_keys: ['city-council', 'transit'],
      time_bucket: '2026-02-16T10',
      semantic_signature: 'sig-1',
    },
    provenance_hash: 'prov-1',
    created_at: NOW - 3_600_000,
    ...overrides,
  };
}
function makeAnalysis(overrides: Partial<NewsCardAnalysisSynthesis> = {}): NewsCardAnalysisSynthesis {
  return {
    summary: 'Balanced summary synthesized from three sources.',
    frames: [
      {
        frame: 'Local Paper: Transit spending should accelerate now.',
        reframe: 'Funding limits justify a phased approach.',
      },
    ],
    analyses: [
      {
        source_id: 'src-1',
        publisher: 'Local Paper',
        url: 'https://example.com/news-1',
        summary: 'Local coverage emphasizes project urgency.',
        biases: ['Urgency lens dominates budget context.'],
        counterpoints: ['City debt load suggests phased implementation.'],
        provider_id: 'openai',
        model_id: 'gpt-4o-mini',
      },
    ],
    ...overrides,
  };
}
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
describe('useAnalysis', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'true');
    mockSynthesizeStoryFromAnalysisPipeline.mockReset();
    mockGetCachedSynthesisForStory.mockReset();
    mockReadMeshAnalysis.mockReset();
    mockWriteMeshAnalysis.mockReset();
    mockGetDevModelOverride.mockReset();
    mockGetDevModelOverride.mockReturnValue(null);
    mockGetCachedSynthesisForStory.mockReturnValue(null);
    mockReadMeshAnalysis.mockResolvedValue(null);
    mockWriteMeshAnalysis.mockResolvedValue();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
  it('returns idle when feature flag is off', () => {
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
    const story = makeStoryBundle();
    const { result } = renderHook(() => useAnalysis(story, true));
    expect(result.current.status).toBe('idle');
    expect(result.current.analysis).toBeNull();
    expect(result.current.error).toBeNull();
    act(() => {
      result.current.retry();
    });
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('returns idle when story is null', () => {
    const { result } = renderHook(() => useAnalysis(null, true));
    expect(result.current.status).toBe('idle');
    expect(result.current.analysis).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('triggers analysis when enabled flips to true', async () => {
    const story = makeStoryBundle();
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValueOnce(makeAnalysis());
    const { result, rerender } = renderHook(
      ({ enabled }) => useAnalysis(story, enabled),
      {
        initialProps: { enabled: false },
      },
    );
    expect(result.current.status).toBe('idle');
    rerender({ enabled: true });
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledWith(story);
    expect(result.current.analysis?.summary).toContain('Balanced summary');
  });

  it('re-runs analysis when the global dev model changes', async () => {
    const story = makeStoryBundle();
    mockSynthesizeStoryFromAnalysisPipeline
      .mockResolvedValueOnce(makeAnalysis({ summary: 'Default model analysis.' }))
      .mockResolvedValueOnce(makeAnalysis({ summary: 'gpt-4o analysis.' }));

    const { result } = renderHook(() => useAnalysis(story, true));

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.analysis?.summary).toBe('Default model analysis.');
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);

    mockGetDevModelOverride.mockReturnValue('gpt-4o');
    act(() => {
      window.dispatchEvent(new CustomEvent('vh:dev-model-changed'));
    });

    await waitFor(() => {
      expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.analysis?.summary).toBe('gpt-4o analysis.');
  });
  it('returns cached result immediately on re-trigger', async () => {
    const story = makeStoryBundle();
    const cached = makeAnalysis({ summary: 'Cached synthesis from prior run.' });
    mockGetCachedSynthesisForStory.mockReturnValue(cached);
    const { result, rerender } = renderHook(
      ({ enabled }) => useAnalysis(story, enabled),
      {
        initialProps: { enabled: true },
      },
    );
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.analysis?.summary).toBe('Cached synthesis from prior run.');
    expect(mockReadMeshAnalysis).not.toHaveBeenCalled();
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
    rerender({ enabled: false });
    rerender({ enabled: true });
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });

  it('reuses mesh analysis before budget gate and skips pipeline', async () => {
    const story = makeStoryBundle();
    const meshAnalysis = makeAnalysis({ summary: 'Reused from mesh.' });
    mockReadMeshAnalysis.mockResolvedValueOnce(meshAnalysis);

    localStorage.setItem(
      'vh_analysis_budget',
      JSON.stringify({ date: todayIso(), count: 20 }),
    );

    const { result } = renderHook(() => useAnalysis(story, true));

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });

    expect(result.current.analysis?.summary).toBe('Reused from mesh.');
    expect(mockReadMeshAnalysis).toHaveBeenCalledWith(story, 'model:default');
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
    expect(mockWriteMeshAnalysis).not.toHaveBeenCalled();
  });

  it('publishes generated analysis to mesh after pipeline success', async () => {
    const story = makeStoryBundle();
    const generated = makeAnalysis({ summary: 'Generated and persisted.' });
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValueOnce(generated);

    const { result } = renderHook(() => useAnalysis(story, true));

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });

    expect(mockReadMeshAnalysis).toHaveBeenCalledWith(story, 'model:default');
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledWith(story);
    expect(mockWriteMeshAnalysis).toHaveBeenCalledWith(story, generated, 'model:default');
    expect(result.current.analysis?.summary).toBe('Generated and persisted.');
  });

  it('lets user B reuse user A mesh artifact without second pipeline call', async () => {
    const story = makeStoryBundle();
    const generated = makeAnalysis({ summary: 'User A generated this artifact.' });
    let meshArtifact: NewsCardAnalysisSynthesis | null = null;

    mockReadMeshAnalysis.mockImplementation(async () => meshArtifact);
    mockWriteMeshAnalysis.mockImplementation(async (_story, analysis) => {
      meshArtifact = analysis;
    });
    mockSynthesizeStoryFromAnalysisPipeline.mockResolvedValue(generated);

    const userA = renderHook(() => useAnalysis(story, true));
    await waitFor(() => {
      expect(userA.result.current.status).toBe('success');
    });
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
    userA.unmount();

    const userB = renderHook(() => useAnalysis(story, true));
    await waitFor(() => {
      expect(userB.result.current.status).toBe('success');
    });

    expect(userB.result.current.analysis?.summary).toBe('User A generated this artifact.');
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
    expect(mockReadMeshAnalysis).toHaveBeenCalledTimes(2);
    userB.unmount();
  });
  it('times out after 60 seconds', () => {
    vi.useFakeTimers();
    const story = makeStoryBundle();
    const neverSettles = new Promise<NewsCardAnalysisSynthesis>(() => {
      // intentionally unresolved
    });
    mockSynthesizeStoryFromAnalysisPipeline.mockReturnValue(neverSettles);
    const { result } = renderHook(() => useAnalysis(story, true));
    expect(result.current.status).toBe('loading');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.status).toBe('timeout');
    expect(result.current.error).toBe('Analysis timed out. The server may be busy.');
  });
  it('handles fetch error and surfaces error state', async () => {
    const story = makeStoryBundle();
    mockSynthesizeStoryFromAnalysisPipeline.mockRejectedValueOnce(
      new Error('analysis relay unavailable'),
    );
    const { result } = renderHook(() => useAnalysis(story, true));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBe('analysis relay unavailable');
  });
  it('retry resets error state and re-fetches analysis', async () => {
    const story = makeStoryBundle();
    mockSynthesizeStoryFromAnalysisPipeline
      .mockRejectedValueOnce(new Error('temporary outage'))
      .mockResolvedValueOnce(makeAnalysis({ summary: 'Recovered after retry.' }));
    const { result } = renderHook(() => useAnalysis(story, true));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    act(() => {
      result.current.retry();
    });
    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(2);
    expect(result.current.analysis?.summary).toBe('Recovered after retry.');
  });
  it('blocks analysis when daily budget limit is reached', async () => {
    const story = makeStoryBundle();
    localStorage.setItem(
      'vh_analysis_budget',
      JSON.stringify({ date: todayIso(), count: 20 }),
    );
    const { result } = renderHook(() => useAnalysis(story, true));
    await waitFor(() => {
      expect(result.current.status).toBe('budget_exceeded');
    });
    expect(result.current.error).toBe('Daily analysis limit reached. Try again tomorrow.');
    expect(mockReadMeshAnalysis).toHaveBeenCalledWith(story, 'model:default');
    expect(mockSynthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });
  it('cleans up pending timeout on unmount', () => {
    vi.useFakeTimers();
    const story = makeStoryBundle();
    mockSynthesizeStoryFromAnalysisPipeline.mockReturnValue(
      new Promise<NewsCardAnalysisSynthesis>(() => {
        // intentionally unresolved
      }),
    );
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { result, unmount } = renderHook(() => useAnalysis(story, true));
    expect(result.current.status).toBe('loading');
    unmount();
    expect(clearTimeoutSpy).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
  });
  it('recordAnalysis and canAnalyze enforce max 20 analyses per day', () => {
    expect(canAnalyze()).toBe(true);
    for (let index = 0; index < 20; index += 1) {
      recordAnalysis();
    }
    expect(canAnalyze()).toBe(false);
    expect(localStorage.getItem('vh_analysis_budget')).not.toBeNull();
  });
  it('budget governor resets when stored date is stale or malformed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-18T00:00:00Z'));
    localStorage.setItem('vh_analysis_budget', JSON.stringify({ date: '2026-02-17', count: 20 }));
    expect(canAnalyze()).toBe(true);
    localStorage.setItem('vh_analysis_budget', '{not-json');
    expect(canAnalyze()).toBe(true);
    localStorage.setItem('vh_analysis_budget', JSON.stringify({ date: 123, count: 'bad' }));
    expect(canAnalyze()).toBe(true);
    recordAnalysis();
    expect(localStorage.getItem('vh_analysis_budget')).toBe(
      JSON.stringify({ date: '2026-02-18', count: 1 }),
    );
  });
  it('falls back safely when localStorage is unavailable or throws on write', () => {
    const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      value: undefined,
      configurable: true,
    });
    expect(canAnalyze()).toBe(true);
    expect(() => recordAnalysis()).not.toThrow();
    if (originalStorage) {
      Object.defineProperty(globalThis, 'localStorage', originalStorage);
    }
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('write blocked');
      });
    expect(() => recordAnalysis()).not.toThrow();
    setItemSpy.mockRestore();
  });
  it('uses fallback error message for non-Error rejections', async () => {
    const story = makeStoryBundle();
    mockSynthesizeStoryFromAnalysisPipeline.mockRejectedValueOnce('not-an-error');
    const { result } = renderHook(() => useAnalysis(story, true));
    await waitFor(() => {
      expect(result.current.status).toBe('error');
    });
    expect(result.current.error).toBe('Analysis pipeline unavailable.');
  });
  it('ignores late success after timeout', async () => {
    vi.useFakeTimers();
    const story = makeStoryBundle();
    let resolvePending!: (value: NewsCardAnalysisSynthesis) => void;
    const pending = new Promise<NewsCardAnalysisSynthesis>((resolve) => {
      resolvePending = resolve;
    });
    mockSynthesizeStoryFromAnalysisPipeline.mockReturnValue(pending);
    const { result } = renderHook(() => useAnalysis(story, true));
    expect(result.current.status).toBe('loading');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.status).toBe('timeout');
    await act(async () => {
      resolvePending(makeAnalysis({ summary: 'Late success should be ignored.' }));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('timeout');
    expect(result.current.error).toBe('Analysis timed out. The server may be busy.');
  });
  it('ignores late failures after timeout', async () => {
    vi.useFakeTimers();
    const story = makeStoryBundle();
    let rejectPending!: (reason?: unknown) => void;
    const pending = new Promise<NewsCardAnalysisSynthesis>((_resolve, reject) => {
      rejectPending = reject;
    });
    void pending.catch(() => {
      // consume late rejection to avoid unhandled rejection noise in timeout-path test
    });
    mockSynthesizeStoryFromAnalysisPipeline.mockReturnValue(pending);
    const { result } = renderHook(() => useAnalysis(story, true));
    expect(result.current.status).toBe('loading');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.status).toBe('timeout');
    await act(async () => {
      rejectPending(new Error('late failure'));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('timeout');
    expect(result.current.error).toBe('Analysis timed out. The server may be busy.');
  });

  it('ignores stale success from an old request after story changes', async () => {
    const firstStory = makeStoryBundle({ story_id: 'story-1', topic_id: 'topic-1', provenance_hash: 'prov-1' });
    const secondStory = makeStoryBundle({ story_id: 'story-2', topic_id: 'topic-2', provenance_hash: 'prov-2' });
    const secondAnalysis = makeAnalysis({ summary: 'Second story analysis.' });

    let resolveFirst!: (value: NewsCardAnalysisSynthesis) => void;
    const firstPending = new Promise<NewsCardAnalysisSynthesis>((resolve) => {
      resolveFirst = resolve;
    });

    mockSynthesizeStoryFromAnalysisPipeline
      .mockReturnValueOnce(firstPending)
      .mockResolvedValueOnce(secondAnalysis);

    const { result, rerender } = renderHook(
      ({ story }) => useAnalysis(story, true),
      { initialProps: { story: firstStory } },
    );

    await waitFor(() => {
      expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
    });

    rerender({ story: secondStory });

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.analysis?.summary).toBe('Second story analysis.');

    await act(async () => {
      resolveFirst(makeAnalysis({ summary: 'Stale first-story analysis.' }));
      await Promise.resolve();
    });

    expect(result.current.analysis?.summary).toBe('Second story analysis.');
  });

  it('ignores stale failure from an old request after story changes', async () => {
    const firstStory = makeStoryBundle({ story_id: 'story-3', topic_id: 'topic-3', provenance_hash: 'prov-3' });
    const secondStory = makeStoryBundle({ story_id: 'story-4', topic_id: 'topic-4', provenance_hash: 'prov-4' });
    const secondAnalysis = makeAnalysis({ summary: 'Fresh second story analysis.' });

    let rejectFirst!: (reason?: unknown) => void;
    const firstPending = new Promise<NewsCardAnalysisSynthesis>((_resolve, reject) => {
      rejectFirst = reject;
    });
    void firstPending.catch(() => {
      // consumed intentionally: stale request should be ignored by hook
    });

    mockSynthesizeStoryFromAnalysisPipeline
      .mockReturnValueOnce(firstPending)
      .mockResolvedValueOnce(secondAnalysis);

    const { result, rerender } = renderHook(
      ({ story }) => useAnalysis(story, true),
      { initialProps: { story: firstStory } },
    );

    await waitFor(() => {
      expect(mockSynthesizeStoryFromAnalysisPipeline).toHaveBeenCalledTimes(1);
    });

    rerender({ story: secondStory });

    await waitFor(() => {
      expect(result.current.status).toBe('success');
    });
    expect(result.current.analysis?.summary).toBe('Fresh second story analysis.');

    await act(async () => {
      rejectFirst(new Error('stale request failed'));
      await Promise.resolve();
    });

    expect(result.current.status).toBe('success');
    expect(result.current.analysis?.summary).toBe('Fresh second story analysis.');
  });
});
