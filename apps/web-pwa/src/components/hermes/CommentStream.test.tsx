/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommentStream } from './CommentStream';

const voteMock = vi.fn();
const createCommentMock = vi.fn(async () => undefined);
const submitCommentReportMock = vi.fn(async () => undefined);
let trustScore = 1;

const c = (overrides: any) => ({
  id: 'id',
  schemaVersion: 'hermes-comment-v1',
  threadId: 't',
  parentId: null,
  content: '',
  author: 'a',
  timestamp: 0,
  stance: 'discuss',
  upvotes: 0,
  downvotes: 0,
  ...overrides
});

const mockStore = {
  commentModeration: new Map<string, Map<string, any>>(),
  userVotes: new Map<string, 'up' | 'down' | null>(),
  vote: voteMock,
  createComment: createCommentMock
};

vi.mock('../../store/hermesForum', () => ({
  useForumStore: (selector?: (s: typeof mockStore) => any) => (selector ? selector(mockStore) : mockStore)
}));

vi.mock('../../store/newsReports', () => ({
  useNewsReportStore: (selector?: (s: { submitCommentReport: typeof submitCommentReportMock }) => any) => {
    const state = { submitCommentReport: submitCommentReportMock };
    return selector ? selector(state) : state;
  }
}));

vi.mock('../../hooks/useIdentity', () => ({
  useIdentity: () => ({ identity: { session: { trustScore } } })
}));

describe('CommentStream', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    mockStore.commentModeration = new Map();
    mockStore.userVotes = new Map();
    voteMock.mockReset();
    createCommentMock.mockReset();
    submitCommentReportMock.mockReset();
    trustScore = 1;
  });

  it('renders a moderation placeholder without original hidden comment content', () => {
    const comments: any[] = [
      c({ id: 'hidden-comment', content: 'abusive original content', author: 'alice', timestamp: 1, stance: 'concur' })
    ];
    mockStore.commentModeration = new Map([
      [
        't',
        new Map([
          [
            'hidden-comment',
            {
              schemaVersion: 'hermes-comment-moderation-v1',
              moderation_id: 'mod-1',
              thread_id: 't',
              comment_id: 'hidden-comment',
              status: 'hidden',
              reason_code: 'abusive_content',
              reason: 'Abusive language.',
              operator_id: 'ops-1',
              created_at: 10,
              audit: { action: 'comment_moderation' }
            }
          ]
        ])
      ]
    ]);

    render(<CommentStream threadId="t" comments={comments as any} />);

    expect(screen.getByTestId('comment-hidden-hidden-comment')).toHaveTextContent('Comment hidden by moderation.');
    expect(screen.getByTestId('comment-hidden-hidden-comment')).toHaveTextContent('abusive_content');
    expect(screen.queryByText('abusive original content')).not.toBeInTheDocument();
    expect(screen.queryByTestId('reply-btn-hidden-comment')).not.toBeInTheDocument();
  });

  it('renders restored comments normally', () => {
    const comments: any[] = [
      c({ id: 'restored-comment', content: 'restored content', author: 'alice', timestamp: 1, stance: 'concur' })
    ];
    mockStore.commentModeration = new Map([
      [
        't',
        new Map([
          [
            'restored-comment',
            {
              schemaVersion: 'hermes-comment-moderation-v1',
              moderation_id: 'mod-2',
              thread_id: 't',
              comment_id: 'restored-comment',
              status: 'restored',
              reason_code: 'appeal_accepted',
              operator_id: 'ops-1',
              created_at: 20,
              audit: {
                action: 'comment_moderation',
                supersedes_moderation_id: 'mod-1'
              }
            }
          ]
        ])
      ]
    ]);

    render(<CommentStream threadId="t" comments={comments as any} />);

    expect(screen.getByText('restored content')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-hidden-restored-comment')).not.toBeInTheDocument();
  });

  it('submits a story-thread comment report without hiding the comment directly', async () => {
    const comments: any[] = [
      c({ id: 'reported-comment', content: 'visible reported content', author: 'alice', timestamp: 1, stance: 'concur' })
    ];

    render(<CommentStream threadId="news-story:story-1" comments={comments as any} />);
    fireEvent.click(screen.getByTestId('comment-report-submit-reported-comment'));

    await waitFor(() => expect(submitCommentReportMock).toHaveBeenCalledWith({
      threadId: 'news-story:story-1',
      commentId: 'reported-comment',
      reasonCode: 'abusive_content'
    }));
    expect(screen.getByText('visible reported content')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-hidden-reported-comment')).not.toBeInTheDocument();
  });

  it('renders root comments in chronological order', () => {
    const comments: any[] = [
      c({ id: 'b', content: 'Second', author: 'bob', timestamp: 2, stance: 'counter' }),
      c({ id: 'a', content: 'First', author: 'alice', timestamp: 1, stance: 'concur' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);
    const articles = screen.getAllByRole('article');
    expect(articles[0]).toHaveTextContent('First');
    expect(articles[1]).toHaveTextContent('Second');
  });

  it('aligns root comments by stance using flex containers', () => {
    const comments: any[] = [
      c({ id: 'a', content: 'Support', author: 'alice', timestamp: 1, stance: 'concur' }),
      c({ id: 'b', content: 'Oppose', author: 'bob', timestamp: 2, stance: 'counter' }),
      c({ id: 'c', content: 'Discuss', author: 'carol', timestamp: 3, stance: 'discuss' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // Root comments have max-width (92% at depth 0) and are aligned via flex container
    expect(screen.getByTestId('comment-frame-a')).toHaveStyle({ maxWidth: '92%' });
    expect(screen.getByTestId('comment-frame-b')).toHaveStyle({ maxWidth: '92%' });
    expect(screen.getByTestId('comment-frame-c')).toHaveStyle({ maxWidth: '92%' });

    // Check flex containers have correct alignment classes
    const wrapA = screen.getByTestId('comment-wrap-a');
    const wrapB = screen.getByTestId('comment-wrap-b');
    const wrapC = screen.getByTestId('comment-wrap-c');

    expect(wrapA.querySelector('.justify-start')).toBeInTheDocument();
    expect(wrapB.querySelector('.justify-end')).toBeInTheDocument();
    expect(wrapC.querySelector('.justify-center')).toBeInTheDocument();
  });

  it('nested comments use their own stance for connector side', () => {
    const comments: any[] = [
      c({ id: 'a', content: 'Support', author: 'alice', timestamp: 1, stance: 'concur' }),
      c({ id: 'n1', parentId: 'a', content: 'Nested reply', author: 'nest', timestamp: 2, stance: 'counter' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // Nested comment exists and has its own stance background
    const nested = screen.getByTestId('comment-n1');
    expect(nested).toBeInTheDocument();
    expect(nested).toHaveStyle({ backgroundColor: 'var(--stream-counter-bg)' });

    // Connector side and alignment follow the nested comment's own stance
    const nestedWrap = screen.getByTestId('comment-wrap-n1');
    expect(nestedWrap.querySelector('.justify-end')).toBeInTheDocument();

    const svg = nestedWrap.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveStyle({ right: '-26.5px' }); // INDENT_PX - LINE_WIDTH = 26.5

    expect(nested).toHaveClass('rounded-l-lg', 'border-r-[3px]');
  });

  it('keeps deep reply branches visible by default', () => {
    const comments: any[] = [
      c({ id: 'r', content: 'Root', timestamp: 1, stance: 'concur' }),
      c({ id: 'c1', parentId: 'r', content: 'L1', timestamp: 2 }),
      c({ id: 'c2', parentId: 'c1', content: 'L2', timestamp: 3 }),
      c({ id: 'c3', parentId: 'c2', content: 'L3', timestamp: 4 }),
      c({ id: 'c4', parentId: 'c3', content: 'L4', timestamp: 5 })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    expect(screen.getByText('L4')).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId('comment-wrap-c3').querySelector('button[aria-label="Collapse replies"]') as HTMLButtonElement
    );
    expect(screen.queryByText('L4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('comment-wrap-c3').querySelector('button[aria-label^="Show"]') as HTMLButtonElement);
    expect(screen.getByText('L4')).toBeInTheDocument();
  });

  it('keeps newly added deep replies visible until the user collapses them', async () => {
    const base: any[] = [
      c({ id: 'r', content: 'Root', timestamp: 1, stance: 'concur' }),
      c({ id: 'c1', parentId: 'r', content: 'L1', timestamp: 2 }),
      c({ id: 'c2', parentId: 'c1', content: 'L2', timestamp: 3 }),
      c({ id: 'c3', parentId: 'c2', content: 'L3', timestamp: 4 })
    ];

    const { rerender } = render(<CommentStream threadId="t" comments={base as any} />);
    expect(screen.getByText('L3')).toBeInTheDocument();

    // Live update adds a child at depth 4: it should stay visible until the user collapses it.
    rerender(
      <CommentStream
        threadId="t"
        comments={[
          ...base,
          c({ id: 'c4', parentId: 'c3', content: 'L4', timestamp: 5 })
        ] as any}
      />
    );

    await waitFor(() => expect(screen.getByText('L4')).toBeInTheDocument());
    fireEvent.click(
      screen.getByTestId('comment-wrap-c3').querySelector('button[aria-label="Collapse replies"]') as HTMLButtonElement
    );
    expect(screen.queryByText('L4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('comment-wrap-c3').querySelector('button[aria-label^="Show"]') as HTMLButtonElement);
    expect(screen.getByText('L4')).toBeInTheDocument();

    // Another live update should not auto-collapse after the user toggles.
    rerender(
      <CommentStream
        threadId="t"
        comments={[
          ...base,
          c({ id: 'c4', parentId: 'c3', content: 'L4', timestamp: 5 }),
          c({ id: 'c5', parentId: 'c3', content: 'L5', timestamp: 6 })
        ] as any}
      />
    );
    expect(screen.getByText('L5')).toBeInTheDocument();
  });

  it('shows a TrustGate fallback when unverified', () => {
    trustScore = 0.2;
    const comments: any[] = [c({ id: 'a', content: 'First', author: 'alice', timestamp: 1, stance: 'concur' })];

    render(<CommentStream threadId="t" comments={comments as any} />);
    expect(screen.getByTestId('reply-trust-gate')).toHaveTextContent('Verify to reply');
    expect(screen.queryByTestId('reply-btn-a')).not.toBeInTheDocument();
  });

  it('opens an inline composer when Reply is clicked', () => {
    const comments: any[] = [c({ id: 'a', content: 'First', author: 'alice', timestamp: 1, stance: 'concur' })];

    render(<CommentStream threadId="t" comments={comments as any} />);
    fireEvent.click(screen.getByTestId('reply-btn-a'));
    expect(screen.getByTestId('comment-composer')).toBeInTheDocument();
  });

  it('renders tree connectors for support replies on the left (even under oppose roots)', () => {
    const comments: any[] = [
      c({ id: 'a', content: 'Oppose root', author: 'alice', timestamp: 1, stance: 'counter' }),
      c({ id: 'n1', parentId: 'a', content: 'Support reply', author: 'nest', timestamp: 2, stance: 'concur' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // Nested comment should have an SVG branch connector positioned on the left
    const nestedWrap = screen.getByTestId('comment-wrap-n1');
    const svg = nestedWrap.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveStyle({ left: '-26.5px' }); // INDENT_PX - LINE_WIDTH = 26.5
  });

  it('renders tree connectors for oppose replies on the right (even under support roots)', () => {
    const comments: any[] = [
      c({ id: 'b', content: 'Support root', author: 'bob', timestamp: 1, stance: 'concur' }),
      c({ id: 'n1', parentId: 'b', content: 'Oppose reply', author: 'nest', timestamp: 2, stance: 'counter' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // Nested comment should have an SVG branch connector positioned on the right
    const nestedWrap = screen.getByTestId('comment-wrap-n1');
    const svg = nestedWrap.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveStyle({ right: '-26.5px' }); // INDENT_PX - LINE_WIDTH = 26.5
  });

  it('renders border on correct side based on stance', () => {
    const comments: any[] = [
      c({ id: 'a', content: 'Support', author: 'alice', timestamp: 1, stance: 'concur' }),
      c({ id: 'b', content: 'Oppose', author: 'bob', timestamp: 2, stance: 'counter' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // Support card should have left border (rounded-r-lg border-l-[3px])
    const supportCard = screen.getByTestId('comment-a');
    expect(supportCard).toHaveClass('rounded-r-lg', 'border-l-[3px]');

    // Oppose card should have right border (rounded-l-lg border-r-[3px])
    const opposeCard = screen.getByTestId('comment-b');
    expect(opposeCard).toHaveClass('rounded-l-lg', 'border-r-[3px]');
  });

  it('renders discuss comments with tighter branch than support comments', () => {
    const comments: any[] = [
      c({ id: 'a', content: 'Root', author: 'alice', timestamp: 1, stance: 'concur' }),
      c({ id: 'n1', parentId: 'a', content: 'Support reply', author: 'nest', timestamp: 2, stance: 'concur' }),
      c({ id: 'n2', parentId: 'a', content: 'Discuss reply', author: 'nest2', timestamp: 3, stance: 'discuss' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // SVGs span INDENT_PX - LINE_WIDTH (26.5px) to align with container padding
    const supportWrap = screen.getByTestId('comment-wrap-n1');
    const supportSvg = supportWrap.querySelector('svg');
    expect(supportSvg).toHaveStyle({ left: '-26.5px', width: '26.5px' });
    expect(supportSvg).toHaveAttribute('data-trunk-offset', '0'); // trunk at edge
    expect(supportSvg).toHaveAttribute('data-parent-trunk-offset', '0'); // outer trunk at edge

    const discussWrap = screen.getByTestId('comment-wrap-n2');
    const discussSvg = discussWrap.querySelector('svg');
    expect(discussSvg).toHaveStyle({ left: '-26.5px', width: '26.5px' });
    expect(discussSvg).toHaveAttribute('data-trunk-offset', '17'); // trunk moved inward (28-11=17)
    expect(discussSvg).toHaveAttribute('data-parent-trunk-offset', '0'); // outer trunk remains at edge (min offset)
  });

  it('renders per-row trunk segments that end at the last child on each side', () => {
    const comments: any[] = [
      c({ id: 'p', content: 'Parent', author: 'alice', timestamp: 1, stance: 'concur' }),
      c({ id: 'c1', parentId: 'p', content: 'L1', author: 'a', timestamp: 2, stance: 'concur' }),
      c({ id: 'c2', parentId: 'p', content: 'L2', author: 'a', timestamp: 3, stance: 'concur' }),
      c({ id: 'c3', parentId: 'p', content: 'R1', author: 'a', timestamp: 4, stance: 'counter' }),
      c({ id: 'c4', parentId: 'p', content: 'L3', author: 'a', timestamp: 5, stance: 'concur' })
    ];

    render(<CommentStream threadId="t" comments={comments as any} />);

    // Left trunk continues behind the right child row and terminates in the last-left row via SVG (no trunk div).
    expect(screen.getByTestId('trunk-left-c1')).toBeInTheDocument();
    expect(screen.getByTestId('trunk-left-c2')).toBeInTheDocument();
    expect(screen.getByTestId('trunk-left-c3')).toBeInTheDocument();
    expect(screen.queryByTestId('trunk-left-c4')).not.toBeInTheDocument();

    // Right trunk terminates in the last-right row via SVG (no trunk div).
    expect(screen.getByTestId('trunk-right-c1')).toBeInTheDocument();
    expect(screen.getByTestId('trunk-right-c2')).toBeInTheDocument();
    expect(screen.queryByTestId('trunk-right-c3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('trunk-right-c4')).not.toBeInTheDocument();
  });
});
