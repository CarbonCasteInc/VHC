import { describe, expect, it, vi } from 'vitest';
import type { StoryBundle } from '@vh/data-model';
import type { NewsSynthesisLifecycleRecord, VennClient } from '@vh/gun-client';
import {
  DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS,
  buildPendingSynthesisCandidate,
  collectPendingSynthesisCatchupCandidates,
  isStoryPendingSynthesisCatchup,
} from './pendingSynthesisCatchup';

function collectObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry) => collectObjectKeys(entry));
  return Object.entries(value).flatMap(([key, nested]) => [key, ...collectObjectKeys(nested)]);
}

function story(overrides: Partial<StoryBundle> = {}): StoryBundle {
  return {
    schemaVersion: 'vh-story-bundle-v1',
    story_id: 'story-1',
    topic_id: 'topic-1',
    headline: 'Public story headline',
    summary: 'Public story summary',
    canonical_url: 'https://example.com/story',
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    cluster_window_start: 1_700_000_000_000,
    cluster_window_end: 1_700_000_100_000,
    provenance_hash: 'source-set-1',
    sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher 1',
        title: 'Source article',
        url: 'https://example.com/story',
        published_at: 1_700_000_000_000,
        fetched_at: 1_700_000_000_000,
        canonical: true,
      },
    ],
    primary_sources: [
      {
        source_id: 'source-1',
        publisher: 'Publisher 1',
        title: 'Source article',
        url: 'https://example.com/story',
        published_at: 1_700_000_000_000,
        fetched_at: 1_700_000_000_000,
        canonical: true,
      },
    ],
    related_links: [],
    cluster_features: {
      confidence_score: 0.9,
      coverage_score: 0.5,
      velocity_score: 0.4,
      shared_entities: [],
      shared_keywords: [],
    },
    ...overrides,
  } as StoryBundle;
}

function lifecycle(overrides: Partial<NewsSynthesisLifecycleRecord> = {}): NewsSynthesisLifecycleRecord {
  return {
    schemaVersion: 'vh-news-synthesis-lifecycle-v1',
    story_id: 'story-1',
    topic_id: 'topic-1',
    source_set_revision: 'source-set-1',
    source_count: 1,
    canonical_source_count: 1,
    status: 'pending',
    retryable: false,
    frame_table_state: 'frame_table_pending',
    updated_at: 1_700_000_000_000,
    ...overrides,
  };
}

describe('pending synthesis catch-up', () => {
  it('selects only current pending, retryable, or stale in-progress lifecycle rows', () => {
    const currentStory = story();
    expect(isStoryPendingSynthesisCatchup({ story: currentStory, lifecycle: lifecycle() })).toBe(true);
    expect(isStoryPendingSynthesisCatchup({
      story: currentStory,
      lifecycle: lifecycle({ status: 'retryable_failure', retryable: true }),
    })).toBe(true);
    expect(isStoryPendingSynthesisCatchup({
      story: currentStory,
      lifecycle: lifecycle({
        status: 'in_progress',
        updated_at: 1_700_000_000_000 - DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS - 1,
      }),
    }, {
      nowMs: 1_700_000_000_000,
    })).toBe(true);
    expect(isStoryPendingSynthesisCatchup({
      story: currentStory,
      lifecycle: lifecycle({
        status: 'in_progress',
        updated_at: 1_700_000_000_000 - DEFAULT_SYNTHESIS_IN_PROGRESS_STALE_MS + 1,
      }),
    }, {
      nowMs: 1_700_000_000_000,
    })).toBe(false);
    expect(isStoryPendingSynthesisCatchup({
      story: currentStory,
      lifecycle: lifecycle({ status: 'accepted_available', frame_table_state: 'frame_table_ready' }),
    })).toBe(false);
    expect(isStoryPendingSynthesisCatchup({
      story: currentStory,
      lifecycle: lifecycle({ source_set_revision: 'old-source-set' }),
    })).toBe(false);
    expect(isStoryPendingSynthesisCatchup({ story: currentStory, lifecycle: null })).toBe(false);
  });

  it('builds deterministic full-analysis and bias-table candidates without private fields', () => {
    const candidate = buildPendingSynthesisCandidate({
      story: story(),
      model: 'gpt-test',
      now: () => 1_700_000_010_000,
    });

    expect(candidate).toMatchObject({
      story_id: 'story-1',
      provider: { provider_id: 'remote-analysis', model_id: 'gpt-test', kind: 'remote' },
      request: {
        prompt: 'public-news-bundle-synthesis-catchup:story-1',
        model: 'gpt-test',
      },
      work_items: [
        {
          story_id: 'story-1',
          topic_id: 'topic-1',
          work_type: 'full-analysis',
          requested_at: 1_700_000_010_000,
        },
        {
          story_id: 'story-1',
          topic_id: 'topic-1',
          work_type: 'bias-table',
          requested_at: 1_700_000_010_000,
        },
      ],
    });
    expect(collectObjectKeys(candidate).join('\n')).not.toMatch(
      /(^|_)(api_key|auth|credential|identity|jwt|pin|private|secret|session|token)$/i,
    );
  });

  it('collects product-visible pending stories from the latest feed window', async () => {
    const currentStory = story();
    const acceptedStory = story({
      story_id: 'story-accepted',
      topic_id: 'topic-accepted',
      provenance_hash: 'source-set-accepted',
    });
    const readLatestPage = vi.fn().mockResolvedValue({
      index: {
        'story-1': 1_700_000_100_000,
        'story-accepted': 1_700_000_090_000,
        'story-missing': 1_700_000_080_000,
      },
      stories: {
        'story-1': currentStory,
        'story-accepted': acceptedStory,
      },
      nextCursor: null,
      recordCount: 3,
    });
    const readStory = vi.fn().mockResolvedValue(null);
    const readLifecycle = vi.fn(async (_client: VennClient, storyId: string) => {
      if (storyId === 'story-1') return lifecycle();
      if (storyId === 'story-accepted') {
        return lifecycle({
          story_id: 'story-accepted',
          topic_id: 'topic-accepted',
          source_set_revision: 'source-set-accepted',
          status: 'accepted_available',
          frame_table_state: 'frame_table_ready',
        });
      }
      return null;
    });

    const result = await collectPendingSynthesisCatchupCandidates({ id: 'client' } as VennClient, {
      limit: 3,
      model: 'gpt-test',
      now: () => 1_700_000_010_000,
      readLatestPage,
      readStory,
      readLifecycle,
    });

    expect(readLatestPage).toHaveBeenCalledWith({ id: 'client' }, { limit: 3 });
    expect(result.scanned).toBe(3);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.staleInProgress).toBe(0);
    expect(result.bootstrappedMissingLifecycle).toBe(0);
    expect(result.candidates.map((candidate) => candidate.story.story_id)).toEqual(['story-1']);
    expect(result.candidates[0]?.candidate.request.model).toBe('gpt-test');
  });

  it('bootstraps missing lifecycle rows for product-visible pending feed stories', async () => {
    const currentStory = story();
    const readLatestPage = vi.fn().mockResolvedValue({
      index: { 'story-1': 1_700_000_100_000 },
      stories: { 'story-1': currentStory },
      storyStates: {
        'story-1': {
          synthesis_state: 'synthesis_pending',
          lifecycle_status: 'pending',
        },
      },
      nextCursor: null,
      recordCount: 1,
    });
    const readLifecycle = vi.fn().mockResolvedValue(null);

    const result = await collectPendingSynthesisCatchupCandidates({ id: 'client' } as VennClient, {
      limit: 1,
      model: 'gpt-test',
      now: () => 1_700_000_010_000,
      readLatestPage,
      readStory: vi.fn().mockResolvedValue(null),
      readLifecycle,
    });

    expect(result.scanned).toBe(1);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.bootstrappedMissingLifecycle).toBe(1);
    expect(result.candidates[0]?.lifecycle).toMatchObject({
      story_id: 'story-1',
      topic_id: 'topic-1',
      source_set_revision: 'source-set-1',
      status: 'pending',
      reason: 'missing_lifecycle_bootstrap',
      frame_table_state: 'frame_table_pending',
      updated_at: 1_700_000_010_000,
    });
  });

  it('does not bootstrap missing lifecycle rows for accepted feed states', async () => {
    const currentStory = story();
    const readLatestPage = vi.fn().mockResolvedValue({
      index: { 'story-1': 1_700_000_100_000 },
      stories: { 'story-1': currentStory },
      storyStates: {
        'story-1': {
          synthesis_state: 'accepted_synthesis_available',
          lifecycle_status: 'accepted_available',
        },
      },
      nextCursor: null,
      recordCount: 1,
    });

    const result = await collectPendingSynthesisCatchupCandidates({ id: 'client' } as VennClient, {
      limit: 1,
      now: () => 1_700_000_010_000,
      readLatestPage,
      readStory: vi.fn().mockResolvedValue(null),
      readLifecycle: vi.fn().mockResolvedValue(null),
    });

    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.bootstrappedMissingLifecycle).toBe(0);
  });

  it('re-enqueues stale in-progress current source-set rows without downgrading lifecycle state', async () => {
    const currentStory = story({
      story_id: 'story-stale-progress',
      topic_id: 'topic-stale-progress',
      provenance_hash: 'source-set-stale-progress',
    });
    const freshInProgressStory = story({
      story_id: 'story-fresh-progress',
      topic_id: 'topic-fresh-progress',
      provenance_hash: 'source-set-fresh-progress',
    });
    const readLatestPage = vi.fn().mockResolvedValue({
      index: {
        'story-stale-progress': 1_700_000_100_000,
        'story-fresh-progress': 1_700_000_090_000,
      },
      stories: {
        'story-stale-progress': currentStory,
        'story-fresh-progress': freshInProgressStory,
      },
      nextCursor: null,
      recordCount: 2,
    });
    const readStory = vi.fn().mockResolvedValue(null);
    const readLifecycle = vi.fn(async (_client: VennClient, storyId: string) => {
      if (storyId === 'story-stale-progress') {
        return lifecycle({
          story_id: 'story-stale-progress',
          topic_id: 'topic-stale-progress',
          source_set_revision: 'source-set-stale-progress',
          status: 'in_progress',
          updated_at: 1_700_000_000_000,
        });
      }
      return lifecycle({
        story_id: 'story-fresh-progress',
        topic_id: 'topic-fresh-progress',
        source_set_revision: 'source-set-fresh-progress',
        status: 'in_progress',
        updated_at: 1_700_000_599_000,
      });
    });

    const result = await collectPendingSynthesisCatchupCandidates({ id: 'client' } as VennClient, {
      limit: 2,
      now: () => 1_700_000_601_000,
      staleInProgressMs: 10 * 60 * 1000,
      readLatestPage,
      readStory,
      readLifecycle,
    });

    expect(result.scanned).toBe(2);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.staleInProgress).toBe(1);
    expect(result.candidates[0]?.story.story_id).toBe('story-stale-progress');
    expect(result.candidates[0]?.lifecycle.status).toBe('in_progress');
  });
});
