/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesComment, HermesThread } from '@vh/types';
import { FeedDiscussionSection } from './FeedDiscussionSection';

const forumState = vi.hoisted(() => ({
  comments: new Map<string, HermesComment[]>(),
  loadComments: vi.fn(),
  createThread: vi.fn(),
  createComment: vi.fn(),
}));

vi.mock('../../store/hermesForum', () => ({
  useForumStore: (selector?: (state: typeof forumState) => unknown) =>
    selector ? selector(forumState) : forumState,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, params, ...props }: React.PropsWithChildren<{ params: { threadId: string } }>) => (
    <a href={`/hermes/${params.threadId}`} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('../hermes/CommentStream', () => ({
  CommentStream: ({ threadId, comments }: { threadId: string; comments: HermesComment[] }) => (
    <div data-testid={`comment-stream-${threadId}`}>
      {comments.map((comment) => (
        <p key={comment.id}>{comment.content}</p>
      ))}
    </div>
  ),
}));

vi.mock('../hermes/forum/TrustGate', () => ({
  TrustGate: ({ children }: React.PropsWithChildren) => <>{children}</>,
}));

vi.mock('../hermes/forum/SlideToPost', () => ({
  SlideToPost: ({ onChange, disabled }: { onChange: (value: number) => void; disabled?: boolean }) => (
    <button type="button" data-testid="slide-to-post-mock" disabled={disabled} onClick={() => onChange(10)}>
      Slide
    </button>
  ),
}));

function makeThread(overrides: Partial<HermesThread> = {}): HermesThread {
  return {
    id: 'thread-1',
    schemaVersion: 'hermes-thread-v0',
    title: 'Transit discussion',
    content: 'Discuss the transit story.',
    author: 'author-1',
    timestamp: 1_700_000_000_000,
    tags: ['news'],
    upvotes: 0,
    downvotes: 0,
    score: 0,
    topicId: 'news-1',
    isHeadline: true,
    ...overrides,
  };
}

function makeComment(overrides: Partial<HermesComment> = {}): HermesComment {
  return {
    id: 'comment-1',
    schemaVersion: 'hermes-comment-v1',
    threadId: 'thread-1',
    parentId: null,
    content: 'First comment',
    author: 'commenter-1',
    timestamp: 1_700_000_000_100,
    stance: 'discuss',
    upvotes: 0,
    downvotes: 0,
    type: 'reply',
    ...overrides,
  };
}

describe('FeedDiscussionSection', () => {
  beforeEach(() => {
    forumState.comments = new Map();
    forumState.loadComments.mockReset();
    forumState.createThread.mockReset();
    forumState.createComment.mockReset();
    forumState.loadComments.mockResolvedValue([]);
    forumState.createThread.mockResolvedValue(makeThread());
    forumState.createComment.mockResolvedValue(makeComment());
  });

  afterEach(() => {
    cleanup();
  });

  it('loads existing story-thread comments and switches from fallback count to loaded count', async () => {
    const thread = makeThread();
    forumState.comments.set(thread.id, [
      makeComment({ id: 'comment-1', content: 'First loaded comment' }),
      makeComment({ id: 'comment-2', content: 'Second loaded comment' }),
    ]);

    render(
      <FeedDiscussionSection
        sectionId="news-card-news-1"
        thread={thread}
        fallbackCommentCount={5}
      />,
    );

    expect(screen.getByTestId('news-card-news-1-discussion-count')).toHaveTextContent('2 comments');
    expect(await screen.findByTestId('comment-stream-thread-1')).toHaveTextContent('First loaded comment');
    expect(forumState.loadComments).toHaveBeenCalledWith('thread-1');
    await waitFor(() => {
      expect(screen.getByTestId('news-card-news-1-discussion-count')).toHaveTextContent('2 comments');
    });
  });

  it('surfaces comment-load failures and retries the same story thread', async () => {
    const thread = makeThread();
    forumState.loadComments
      .mockRejectedValueOnce(new Error('relay unavailable'))
      .mockResolvedValueOnce([]);

    render(<FeedDiscussionSection sectionId="news-card-news-1" thread={thread} />);

    expect(await screen.findByTestId('news-card-news-1-discussion-load-error')).toHaveTextContent(
      'relay unavailable',
    );

    fireEvent.click(screen.getByTestId('news-card-news-1-discussion-retry-load'));

    await waitFor(() => expect(forumState.loadComments).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('news-card-news-1-discussion-empty')).toHaveTextContent(
      'No comments yet. Start the discussion.',
    );
  });

  it('starts a story discussion and immediately renders the created headline thread', async () => {
    const created = makeThread({
      id: 'news-story:story-news-1',
      title: 'City council votes on transit plan',
      sourceSynthesisId: 'syn-1',
      sourceEpoch: 2,
      sourceUrl: 'https://example.com/news-1',
      topicId: 'news-1',
    });
    forumState.createThread.mockResolvedValueOnce(created);

    render(
      <FeedDiscussionSection
        sectionId="news-card-news-1"
        thread={null}
        createThread={{
          defaultTitle: 'City council votes on transit plan',
          sourceSynthesisId: 'syn-1',
          sourceEpoch: 2,
          sourceUrl: 'https://example.com/news-1',
          topicId: 'news-1',
          threadId: 'news-story:story-news-1',
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('news-card-news-1-discussion-new-thread-toggle'));
    fireEvent.change(screen.getByTestId('thread-content'), {
      target: { value: 'Opening the story thread.' },
    });
    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(forumState.createThread).toHaveBeenCalledTimes(1));
    expect(forumState.createThread).toHaveBeenCalledWith(
      'City council votes on transit plan',
      'Opening the story thread.',
      [],
      { sourceSynthesisId: 'syn-1', sourceEpoch: 2 },
      {
        sourceUrl: 'https://example.com/news-1',
        topicId: 'news-1',
        threadId: 'news-story:story-news-1',
        isHeadline: true,
      },
    );
    expect(await screen.findByTestId('news-card-news-1-thread-head')).toHaveTextContent(
      'City council votes on transit plan',
    );
    expect(screen.getByTestId('news-card-news-1-open-thread')).toHaveAttribute(
      'href',
      '/hermes/news-story:story-news-1',
    );
    expect(screen.queryByTestId('news-card-news-1-discussion-new-thread-toggle')).not.toBeInTheDocument();
  });
});
