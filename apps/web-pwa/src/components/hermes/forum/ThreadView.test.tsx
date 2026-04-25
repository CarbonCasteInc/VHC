/* @vitest-environment jsdom */
import React from 'react';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, beforeEach, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { ThreadView } from './ThreadView';

const baseThread = {
  id: 'thread-1',
  schemaVersion: 'hermes-thread-v0' as const,
  title: 'Debate title',
  content: 'Thread body',
  author: 'alice-nullifier',
  timestamp: Date.now(),
  tags: [],
  upvotes: 0,
  downvotes: 0,
  score: 0
};

const mockStore = {
  threads: new Map<string, any>(),
  comments: new Map<string, any[]>(),
  commentModeration: new Map<string, Map<string, any>>(),
  loadComments: vi.fn().mockResolvedValue(undefined),
  createComment: vi.fn().mockResolvedValue(undefined),
  userVotes: new Map<string, 'up' | 'down' | null>(),
  vote: vi.fn()
};

vi.mock('../../../store/hermesForum', () => ({
  useForumStore: (selector?: (s: typeof mockStore) => any) => (selector ? selector(mockStore) : mockStore)
}));

vi.mock('../../../hooks/useIdentity', () => ({
  useIdentity: () => ({ identity: { session: { trustScore: 1 } } })
}));

vi.mock('../../../hooks/useSentimentState', () => ({
  useSentimentState: (selector?: any) =>
    selector
      ? selector({ getEyeWeight: () => 0, getLightbulbWeight: () => 0 })
      : { getEyeWeight: () => 0, getLightbulbWeight: () => 0 }
}));

vi.mock('../../../hooks/useViewTracking', () => ({
  useViewTracking: () => undefined
}));

vi.mock('../CommunityReactionSummary', () => ({
  CommunityReactionSummary: ({ children }: any) => <div data-testid="community-summary">{children}</div>
}));

expect.extend(matchers);

describe('ThreadView threaded layout', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mockStore.threads = new Map([[baseThread.id, baseThread]]);
    mockStore.comments = new Map();
    mockStore.commentModeration = new Map();
    mockStore.loadComments.mockClear();
    mockStore.createComment.mockClear();
    mockStore.vote.mockClear();
    mockStore.userVotes = new Map();
    window.localStorage.clear();
  });

  it('shows a one-time callout and dismisses it', async () => {
    render(<ThreadView threadId={baseThread.id} />);
    await waitFor(() => expect(mockStore.loadComments).toHaveBeenCalled());

    expect(screen.getByText(/Thread view updated/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dismiss update notice/i }));
    expect(screen.queryByText(/Thread view updated/i)).not.toBeInTheDocument();
  });

  it('renders comments in a single stream', async () => {
    mockStore.comments = new Map([
      [
        baseThread.id,
        [
          {
            id: 'c1',
            schemaVersion: 'hermes-comment-v1' as const,
            threadId: baseThread.id,
            parentId: null,
            content: 'Agree content',
            author: 'agree-author',
            timestamp: Date.now(),
            stance: 'concur' as const,
            upvotes: 0,
            downvotes: 0
          },
          {
            id: 'c2',
            schemaVersion: 'hermes-comment-v1' as const,
            threadId: baseThread.id,
            parentId: null,
            content: 'Counter content',
            author: 'counter-author',
            timestamp: Date.now(),
            stance: 'counter' as const,
            upvotes: 0,
            downvotes: 0
          }
        ]
      ]
    ]);

    render(<ThreadView threadId={baseThread.id} />);
    await waitFor(() => expect(mockStore.loadComments).toHaveBeenCalled());

    expect(screen.getByText('Agree content')).toBeInTheDocument();
    expect(screen.getByText('Counter content')).toBeInTheDocument();
  });

  it('toggles the root reply composer', async () => {
    render(<ThreadView threadId={baseThread.id} />);
    await waitFor(() => expect(mockStore.loadComments).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /reply to thread/i }));
    expect(screen.getByTestId('comment-composer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /reply to thread/i }));
    expect(screen.queryByTestId('comment-composer')).not.toBeInTheDocument();
  });
});
