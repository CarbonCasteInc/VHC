/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, StoryBundle, StorylineGroup } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { NewsCard } from './NewsCard';

vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  getCachedSynthesisForStory: vi.fn().mockReturnValue(null),
}));

const NOW = 1_700_000_000_000;

function makeItem(): FeedItem {
  return {
    topic_id: 'news-1',
    story_id: 'story-news-1',
    kind: 'NEWS_STORY',
    title: 'City council votes on transit plan',
    created_at: NOW - 3_600_000,
    latest_activity_at: NOW,
    hotness: 7.1234,
    eye: 22,
    lightbulb: 8,
    comments: 5,
  };
}

function makeStory(): StoryBundle {
  return {
    schemaVersion: 'story-bundle-v0',
    story_id: 'story-news-1',
    topic_id: 'a'.repeat(64),
    storyline_id: 'storyline-transit',
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
  };
}

function makeStoryline(): StorylineGroup {
  return {
    schemaVersion: 'storyline-group-v0',
    storyline_id: 'storyline-transit',
    topic_id: 'a'.repeat(64),
    canonical_story_id: 'story-news-1',
    story_ids: ['story-news-1'],
    headline: 'Transit storyline',
    related_coverage: [
      {
        source_id: 'src-related',
        publisher: 'Budget Watch',
        title: 'Budget hawks resist broader rail push',
        url: 'https://example.com/related',
        url_hash: 'related-hash',
      },
    ],
    entity_keys: ['city-council', 'transit'],
    time_bucket: '2026-02-16T10',
    created_at: NOW - 3_600_000,
    updated_at: NOW,
  };
}

describe('NewsCard related coverage', () => {
  beforeEach(() => {
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    vi.stubEnv('VITE_VH_ANALYSIS_PIPELINE', 'false');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
  });

  it('renders related coverage from the storyline separately from canonical sources', async () => {
    useNewsStore.getState().setStories([makeStory()]);
    useNewsStore.getState().setStorylines([makeStoryline()]);

    render(<NewsCard item={makeItem()} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-related-coverage-news-1')).toHaveTextContent(
      'Budget Watch: Budget hawks resist broader rail push',
    );
    expect(screen.getByTestId('source-badge-src-1')).toHaveAttribute(
      'href',
      'https://example.com/news-1',
    );
  });
});
