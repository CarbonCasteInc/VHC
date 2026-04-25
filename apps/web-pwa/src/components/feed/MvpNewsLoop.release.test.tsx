/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeedItem, StoryBundle, TopicSynthesisCorrection, TopicSynthesisV2 } from '@vh/data-model';
import type { HermesComment, HermesCommentModeration, HermesThread } from '@vh/types';
import { DEFAULT_RANKING_CONFIG } from '@vh/data-model';
import { useNewsStore } from '../../store/news';
import { useSynthesisStore } from '../../store/synthesis';
import { useDiscoveryStore } from '../../store/discovery';
import { useSentimentState } from '../../hooks/useSentimentState';
import { composeFeed } from '../../store/discovery';
import { getStoryDiscussionThreadId } from '../../utils/feedDiscussionThreads';
import { FeedShell } from './FeedShell';
import { NewsCard } from './NewsCard';
import { resetExpandedCardStore } from './expandedCardStore';
import type { UseDiscoveryFeedResult } from '../../hooks/useDiscoveryFeed';

const forumState = vi.hoisted(() => ({
  comments: new Map<string, HermesComment[]>(),
  commentModeration: new Map<string, Map<string, HermesCommentModeration>>(),
  threads: new Map<string, HermesThread>(),
  userVotes: new Map<string, unknown>(),
  loadComments: vi.fn(),
  createThread: vi.fn(),
  createComment: vi.fn(),
}));

const analysisPipelineState = vi.hoisted(() => ({
  synthesizeStoryFromAnalysisPipeline: vi.fn(),
  getCachedSynthesisForStory: vi.fn().mockReturnValue(null),
}));

vi.mock('../../store/hermesForum', () => ({
  useForumStore: Object.assign(
    (selector?: (state: typeof forumState) => unknown) =>
      selector ? selector(forumState) : forumState,
    {
      getState: () => forumState,
      setState: (next: Partial<typeof forumState>) => Object.assign(forumState, next),
      subscribe: () => () => undefined,
    },
  ),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params, ...props }: React.PropsWithChildren<{ params: { threadId: string } }>) => (
    <a href={`/hermes/${params.threadId}`} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ navigate: vi.fn() }),
  useRouterState: () => ({ location: { pathname: '/', search: {} } }),
}));

vi.mock('./newsCardAnalysis', () => ({
  synthesizeStoryFromAnalysisPipeline: analysisPipelineState.synthesizeStoryFromAnalysisPipeline,
  getCachedSynthesisForStory: analysisPipelineState.getCachedSynthesisForStory,
  sanitizePublicationNeutralSummary: (summary: string) => summary,
}));

vi.mock('../../hooks/useViewTracking', () => ({
  useViewTracking: vi.fn(),
}));

vi.mock('../../hooks/useConstituencyProof', () => ({
  useConstituencyProof: () => ({
    proof: {
      nullifier: 'mvp-release-voter',
      district_hash: 's0-root-mvp-district',
      merkle_root: 's0-root-mvp-district',
      proof: ['mvp'],
    },
    error: null,
    assurance: 'beta_local',
    canClaimVerifiedHuman: false,
    canClaimDistrictProof: false,
    canClaimSybilResistance: false,
  }),
}));

vi.mock('../../hooks/usePointAggregate', () => ({
  usePointAggregate: () => ({ aggregate: null, status: 'idle' }),
}));

vi.mock('../hermes/CommentStream', () => ({
  CommentStream: ({ threadId, comments }: { threadId: string; comments: HermesComment[] }) => (
    <div data-testid={`comment-stream-${threadId}`}>
      {comments.map((comment) => {
        const moderation = forumState.commentModeration.get(threadId)?.get(comment.id);
        return moderation?.status === 'hidden' ? (
          <p key={comment.id} data-testid={`comment-hidden-${comment.id}`}>
            Comment hidden by moderation. {moderation.reason_code}
          </p>
        ) : (
          <p key={comment.id}>{comment.content}</p>
        );
      })}
    </div>
  ),
}));

vi.mock('../hermes/forum/TrustGate', () => ({
  TrustGate: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('../hermes/forum/SlideToPost', () => ({
  SlideToPost: ({ onChange, disabled }: { onChange: (value: number) => void; disabled?: boolean }) => (
    <button type="button" data-testid="slide-to-post-mock" disabled={disabled} onClick={() => onChange(50)}>
      Slide
    </button>
  ),
}));

const NOW = 1_700_000_000_000;

function makeFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    topic_id: 'news-1',
    story_id: 'story-news-1',
    kind: 'NEWS_STORY',
    title: 'City council votes on transit plan',
    categories: ['Transit'],
    entity_keys: ['city council', 'transit expansion'],
    created_at: NOW - 3_600_000,
    latest_activity_at: NOW,
    hotness: 8,
    eye: 12,
    lightbulb: 4,
    comments: 2,
    ...overrides,
  };
}

function makeFeedResult(overrides: Partial<UseDiscoveryFeedResult> = {}): UseDiscoveryFeedResult {
  return {
    feed: [],
    selectedStorylineId: null,
    filter: 'NEWS',
    sortMode: 'HOTTEST',
    personalization: {
      preferredCategories: [],
      preferredTopics: [],
      mutedCategories: [],
      mutedTopics: [],
    },
    loading: false,
    error: null,
    setPersonalization: vi.fn(),
    setFilter: vi.fn(),
    focusStoryline: vi.fn(),
    clearStorylineFocus: vi.fn(),
    setSortMode: vi.fn(),
    ...overrides,
  };
}

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
      entity_keys: ['city council', 'transit expansion'],
      time_bucket: '2026-04-20T10',
      semantic_signature: 'mvp-signature',
    },
    provenance_hash: 'prov-1',
    created_at: NOW - 3_600_000,
    ...overrides,
  };
}

function makeSynthesis(overrides: Partial<TopicSynthesisV2> = {}): TopicSynthesisV2 {
  return {
    schemaVersion: 'topic-synthesis-v2',
    topic_id: 'news-1',
    epoch: 2,
    synthesis_id: 'syn-accepted-mvp',
    inputs: {
      story_bundle_ids: ['story-news-1'],
      topic_digest_ids: [],
      topic_seed_id: 'seed-mvp',
    },
    quorum: {
      required: 3,
      received: 3,
      reached_at: NOW,
      timed_out: false,
      selection_rule: 'deterministic',
    },
    facts_summary: 'Council approved a phased transit expansion plan using accepted synthesis.',
    frames: [
      {
        frame_point_id: 'frame-point-transit-investment',
        frame: 'Public investment is overdue',
        reframe_point_id: 'reframe-point-budget-risk',
        reframe: 'Budget risk should slow rollout',
      },
    ],
    warnings: [],
    divergence_metrics: {
      disagreement_score: 0.4,
      source_dispersion: 0.2,
      candidate_count: 3,
    },
    provenance: {
      candidate_ids: ['cand-1', 'cand-2', 'cand-3'],
      provider_mix: [{ provider_id: 'fixture-accepted-synthesis', count: 3 }],
    },
    created_at: NOW,
    ...overrides,
  };
}

function makeCorrection(overrides: Partial<TopicSynthesisCorrection> = {}): TopicSynthesisCorrection {
  return {
    schemaVersion: 'topic-synthesis-correction-v1',
    correction_id: 'correction-mvp-1',
    topic_id: 'news-1',
    synthesis_id: 'syn-accepted-mvp',
    epoch: 2,
    status: 'suppressed',
    reason_code: 'inaccurate_summary',
    reason: 'Operator verified this accepted synthesis should not be shown.',
    operator_id: 'release-ops',
    created_at: NOW + 2,
    audit: {
      action: 'synthesis_correction',
      notes: 'MVP release gate correction fixture.',
    },
    ...overrides,
  };
}

function makeThread(overrides: Partial<HermesThread> = {}): HermesThread {
  return {
    id: 'news-story:story-news-1',
    schemaVersion: 'hermes-thread-v0',
    title: 'City council votes on transit plan',
    content: 'Discuss the transit story.',
    author: 'author-1',
    timestamp: NOW,
    tags: ['news'],
    upvotes: 0,
    downvotes: 0,
    score: 0,
    topicId: 'news-1',
    sourceSynthesisId: 'syn-accepted-mvp',
    sourceEpoch: 2,
    isHeadline: true,
    ...overrides,
  };
}

function makeComment(overrides: Partial<HermesComment> = {}): HermesComment {
  return {
    id: 'comment-1',
    schemaVersion: 'hermes-comment-v1',
    threadId: 'news-story:story-news-1',
    parentId: null,
    content: 'This reply stays on the story thread.',
    author: 'commenter-1',
    timestamp: NOW + 1,
    stance: 'discuss',
    upvotes: 0,
    downvotes: 0,
    type: 'reply',
    ...overrides,
  };
}

function makeCommentModeration(overrides: Partial<HermesCommentModeration> = {}): HermesCommentModeration {
  return {
    schemaVersion: 'hermes-comment-moderation-v1',
    moderation_id: 'moderation-mvp-1',
    thread_id: 'news-story:story-news-1',
    comment_id: 'comment-abusive',
    status: 'hidden',
    reason_code: 'abusive_content',
    reason: 'Moderator hid abusive thread content.',
    operator_id: 'release-ops',
    created_at: NOW + 2,
    audit: {
      action: 'comment_moderation',
      notes: 'mvp release gate fixture',
    },
    ...overrides,
  };
}

function seedAcceptedStory(): FeedItem {
  const item = makeFeedItem();
  useNewsStore.getState().setStories([makeStoryBundle()]);
  useSynthesisStore.getState().setTopicSynthesis(item.topic_id, makeSynthesis());
  return item;
}

describe('MVP Web PWA news loop release gates', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    resetExpandedCardStore();
    useNewsStore.getState().reset();
    useSynthesisStore.getState().reset();
    useDiscoveryStore.getState().reset();
    useSentimentState.setState({
      ...useSentimentState.getState(),
      agreements: {},
      pointIdAliases: {},
      lightbulb: {},
      eye: {},
      signals: [],
    });
    forumState.comments = new Map();
    forumState.commentModeration = new Map();
    forumState.threads = new Map();
    forumState.userVotes = new Map();
    forumState.loadComments.mockReset().mockResolvedValue([]);
    forumState.createThread.mockReset();
    forumState.createComment.mockReset();
    analysisPipelineState.synthesizeStoryFromAnalysisPipeline.mockReset();
    analysisPipelineState.getCachedSynthesisForStory.mockReset().mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it('mvp gate: feed render uses fixtures and proves preferences change ranking and filtering', () => {
    const transit = makeFeedItem({ topic_id: 'transit', title: 'Transit expansion advances', hotness: 4.8, categories: ['Transit'] });
    const sports = makeFeedItem({ topic_id: 'sports', story_id: 'story-sports', title: 'Arena lease vote', hotness: 5, categories: ['Sports'] });
    const all = [transit, sports];

    const baseline = composeFeed(all, 'NEWS', 'HOTTEST', DEFAULT_RANKING_CONFIG, NOW);
    const preferredTransit = composeFeed(all, 'NEWS', 'HOTTEST', DEFAULT_RANKING_CONFIG, NOW, null, {
      preferredCategories: ['transit'],
      preferredTopics: [],
      mutedCategories: [],
      mutedTopics: [],
    });
    const mutedSports = composeFeed(all, 'NEWS', 'HOTTEST', DEFAULT_RANKING_CONFIG, NOW, null, {
      preferredCategories: [],
      preferredTopics: [],
      mutedCategories: ['sports'],
      mutedTopics: [],
    });

    expect(baseline.map((item) => item.topic_id)).toEqual(['sports', 'transit']);
    expect(preferredTransit.map((item) => item.topic_id)).toEqual(['transit', 'sports']);
    expect(mutedSports.map((item) => item.topic_id)).toEqual(['transit']);

    render(<FeedShell feedResult={makeFeedResult({ feed: preferredTransit })} />);

    expect(screen.getByTestId('feed-shell')).toBeInTheDocument();
    expect(screen.getByTestId('feed-shell-status')).toHaveTextContent('2 live · 2 news · 0 topics');
    expect(screen.getByTestId('news-card-transit')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-sports')).toBeInTheDocument();
  });

  it('mvp gate: story detail opens from accepted TopicSynthesisV2 without click-time analysis fallback', async () => {
    const item = seedAcceptedStory();

    render(<NewsCard item={item} />);

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-detail-news-1')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-summary-basis-news-1')).toHaveTextContent('Topic synthesis v2');
    expect(screen.getByTestId('news-card-summary-news-1')).toHaveTextContent('accepted synthesis');
    expect(screen.getByTestId('news-card-synthesis-provenance-news-1')).toHaveTextContent('syn-accepted-mvp');
    expect(screen.getByTestId('bias-table')).toHaveTextContent('Public investment is overdue');
    expect(screen.getByTestId('news-card-stance-scope-news-1')).toHaveTextContent('not to the story as a whole');
    expect(analysisPipelineState.synthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });

  it('mvp gate: synthesis correction hides bad accepted analysis with audit provenance', async () => {
    const item = seedAcceptedStory();
    useSynthesisStore.getState().setTopicCorrection(item.topic_id, makeCorrection());

    render(<NewsCard item={item} />);

    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('news-card-detail-news-1')).toBeInTheDocument();
    expect(screen.getByTestId('news-card-summary-basis-news-1')).toHaveTextContent('Operator correction');
    expect(screen.getByTestId('news-card-summary-news-1')).toHaveTextContent('suppressed by an operator');
    expect(screen.getByTestId('news-card-synthesis-correction-news-1')).toHaveTextContent('correction-mvp-1');
    expect(screen.getByTestId('news-card-synthesis-correction-news-1')).toHaveTextContent('release-ops');
    expect(screen.getByTestId('news-card-synthesis-correction-state-news-1')).toHaveTextContent('not shown');
    expect(screen.queryByTestId('news-card-synthesis-provenance-news-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bias-table')).not.toBeInTheDocument();
    expect(screen.queryByText('Public investment is overdue')).not.toBeInTheDocument();
    expect(analysisPipelineState.synthesizeStoryFromAnalysisPipeline).not.toHaveBeenCalled();
  });

  it('mvp gate: point stance writes and restores against accepted synthesis point ids', async () => {
    const item = seedAcceptedStory();

    const { unmount } = render(<NewsCard item={item} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    const agree = await screen.findByTestId('cell-vote-agree-frame-point-transit-investment');
    expect(agree).toHaveAttribute('data-canonical-point-id', 'frame-point-transit-investment');
    fireEvent.click(agree);

    await waitFor(() => expect(agree).toHaveAttribute('aria-pressed', 'true'));
    expect(
      useSentimentState.getState().getAgreement('news-1', 'frame-point-transit-investment', 'syn-accepted-mvp', 2),
    ).toBe(1);

    unmount();
    resetExpandedCardStore();
    render(<NewsCard item={item} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId('cell-vote-agree-frame-point-transit-investment')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('cell-vote-assurance-frame-point-transit-investment')).toHaveTextContent(
      'Beta-local stance',
    );
  });

  it('mvp gate: story thread resolves through NewsCard and keeps replies attached to the same deterministic news-story id after reload', async () => {
    const item = seedAcceptedStory();
    const story = makeStoryBundle();
    const deterministicThreadId = getStoryDiscussionThreadId(item, story);
    const canonicalThread = makeThread({
      id: deterministicThreadId,
      title: 'Canonical story thread',
      timestamp: NOW,
    });
    const legacyTopicThread = makeThread({
      id: 'legacy-topic-news-1',
      title: 'Legacy topic thread',
      timestamp: NOW + 5_000,
    });
    const reply = makeComment({ threadId: deterministicThreadId });

    forumState.threads.set(legacyTopicThread.id, legacyTopicThread);
    forumState.threads.set(canonicalThread.id, canonicalThread);
    forumState.comments.set(canonicalThread.id, []);
    forumState.comments.set(legacyTopicThread.id, []);
    forumState.loadComments.mockImplementation(async (threadId: string) => {
      if (threadId === deterministicThreadId && !forumState.comments.get(threadId)?.length) {
        forumState.comments.set(threadId, [reply]);
      }
    });
    forumState.createComment.mockImplementation(async (threadId: string, content: string) => {
      const comment = makeComment({ id: 'comment-posted', threadId, content });
      forumState.comments.set(threadId, [...(forumState.comments.get(threadId) ?? []), comment]);
      return comment;
    });

    render(<NewsCard item={item} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(await screen.findByTestId(`comment-stream-${deterministicThreadId}`)).toHaveTextContent(
      'This reply stays on the story thread.',
    );
    expect(screen.getByTestId('news-card-news-1-open-thread')).toHaveAttribute(
      'href',
      `/hermes/${deterministicThreadId}`,
    );
    expect(within(screen.getByTestId('news-card-news-1-thread-head')).getByText('Canonical story thread')).toBeInTheDocument();
    expect(screen.queryByText('Legacy topic thread')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('news-card-news-1-discussion-compose-toggle'));
    fireEvent.change(screen.getByTestId('comment-composer'), {
      target: { value: 'Reload should keep this reply on the same story.' },
    });
    fireEvent.click(screen.getByTestId('submit-comment-btn'));

    await waitFor(() => {
      expect(forumState.createComment).toHaveBeenCalledWith(
        deterministicThreadId,
        'Reload should keep this reply on the same story.',
        'discuss',
        undefined,
      );
    });

    cleanup();
    resetExpandedCardStore();
    render(<NewsCard item={item} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    expect(within(screen.getByTestId('news-card-news-1-thread-head')).getByText('Canonical story thread')).toBeInTheDocument();
    expect(await screen.findByTestId(`comment-stream-${deterministicThreadId}`)).toHaveTextContent(
      'Reload should keep this reply on the same story.',
    );
    expect(screen.getByTestId('news-card-news-1-open-thread')).toHaveAttribute(
      'href',
      `/hermes/${deterministicThreadId}`,
    );
    expect(screen.queryByText('Legacy topic thread')).not.toBeInTheDocument();
  });

  it('mvp gate: story thread moderation hides abusive replies while preserving the story thread', async () => {
    const item = seedAcceptedStory();
    const story = makeStoryBundle();
    const deterministicThreadId = getStoryDiscussionThreadId(item, story);
    const canonicalThread = makeThread({
      id: deterministicThreadId,
      title: 'Canonical story thread',
      timestamp: NOW,
    });
    const abusiveReply = makeComment({
      id: 'comment-abusive',
      threadId: deterministicThreadId,
      content: 'abusive content should not render',
    });
    const normalReply = makeComment({
      id: 'comment-normal',
      threadId: deterministicThreadId,
      content: 'This reply remains visible.',
      timestamp: NOW + 2,
    });

    forumState.threads.set(canonicalThread.id, canonicalThread);
    forumState.comments.set(canonicalThread.id, [abusiveReply, normalReply]);
    forumState.commentModeration.set(canonicalThread.id, new Map([
      ['comment-abusive', makeCommentModeration({ thread_id: canonicalThread.id })],
    ]));
    forumState.loadComments.mockResolvedValue(undefined);

    render(<NewsCard item={item} />);
    fireEvent.click(screen.getByTestId('news-card-headline-news-1'));

    const stream = await screen.findByTestId(`comment-stream-${deterministicThreadId}`);
    expect(stream).toHaveTextContent('This reply remains visible.');
    expect(screen.getByTestId('comment-hidden-comment-abusive')).toHaveTextContent('abusive_content');
    expect(screen.queryByText('abusive content should not render')).not.toBeInTheDocument();
    expect(screen.getByTestId('news-card-news-1-open-thread')).toHaveAttribute(
      'href',
      `/hermes/${deterministicThreadId}`,
    );
  });
});
