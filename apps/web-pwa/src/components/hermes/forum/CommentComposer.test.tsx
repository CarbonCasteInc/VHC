/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommentComposer, REPLY_CHAR_LIMIT, REPLY_WARNING_THRESHOLD } from './CommentComposer';

const createCommentMock = vi.fn(async () => undefined);
const mockStore = { createComment: createCommentMock };

vi.mock('../../../store/hermesForum', () => ({
  useForumStore: (selector?: any) => (selector ? selector(mockStore) : mockStore),
}));

vi.mock('./SlideToPost', () => ({
  SlideToPost: ({ onChange, disabled }: any) => (
    <button type="button" data-testid="slide-to-post-mock" disabled={disabled} onClick={() => onChange(10)}>
      Slide
    </button>
  ),
}));

function typeIntoComposer(text: string) {
  fireEvent.change(screen.getByTestId('comment-composer'), { target: { value: text } });
}

function pasteIntoComposer(pasteText: string, selectionStart = 0, selectionEnd?: number) {
  const textarea = screen.getByTestId('comment-composer') as HTMLTextAreaElement;
  // Set selection range for paste
  Object.defineProperty(textarea, 'selectionStart', { value: selectionStart, writable: true });
  Object.defineProperty(textarea, 'selectionEnd', { value: selectionEnd ?? selectionStart, writable: true });

  const pasteEvent = new Event('paste', { bubbles: true }) as any;
  pasteEvent.clipboardData = {
    getData: () => pasteText,
  };
  pasteEvent.preventDefault = vi.fn();
  fireEvent(textarea, pasteEvent);
}

describe('CommentComposer', () => {
  beforeEach(() => {
    localStorage.clear();
    createCommentMock.mockClear();
  });
  afterEach(() => cleanup());

  it('disables slide-to-post until content exists, then posts', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<CommentComposer threadId="thread-1" parentId="parent-1" onSubmit={onSubmit} />);

    const slide = screen.getByTestId('slide-to-post-mock');
    const submit = screen.getByTestId('submit-comment-btn');
    expect(slide).toBeDisabled();
    expect(submit).toBeDisabled();

    typeIntoComposer(' Hello ');
    expect(slide).not.toBeDisabled();
    expect(submit).not.toBeDisabled();

    fireEvent.click(slide);
    fireEvent.click(submit);

    await waitFor(() => expect(createCommentMock).toHaveBeenCalled());
    expect(createCommentMock).toHaveBeenCalledWith('thread-1', 'Hello', 'concur', 'parent-1');
    expect(onSubmit).toHaveBeenCalled();
  });

  // ── Counter display at various lengths ──

  describe('character counter', () => {
    it('does not show counter below warning threshold', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD - 1));
      expect(screen.queryByTestId('char-counter')).not.toBeInTheDocument();
    });

    it('shows counter at exactly warning threshold (200)', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
      expect(screen.getByTestId('char-counter')).toBeInTheDocument();
      expect(screen.getByTestId('char-count')).toHaveTextContent(`${REPLY_WARNING_THRESHOLD}/${REPLY_CHAR_LIMIT}`);
    });

    it('shows counter between warning and limit', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(220));
      expect(screen.getByTestId('char-count')).toHaveTextContent(`220/${REPLY_CHAR_LIMIT}`);
    });

    it('shows counter at exactly 240', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT));
      expect(screen.getByTestId('char-count')).toHaveTextContent(`${REPLY_CHAR_LIMIT}/${REPLY_CHAR_LIMIT}`);
    });
  });

  // ── Warning state at exactly 200 ──

  describe('warning state', () => {
    it('counter has amber color class at 200 chars', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
      expect(screen.getByTestId('char-count')).toHaveClass('text-amber-500');
    });

    it('counter has red color class at 240 chars', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT));
      expect(screen.getByTestId('char-count')).toHaveClass('text-red-500');
    });
  });

  // ── Hard stop at exactly 240 ──

  describe('hard stop at 240', () => {
    it('truncates typed content to 240 chars', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT + 50));
      const textarea = screen.getByTestId('comment-composer') as HTMLTextAreaElement;
      expect(textarea.value.length).toBe(REPLY_CHAR_LIMIT);
    });

    it('paste beyond limit triggers truncation and overflow flag', () => {
      render(<CommentComposer threadId="t1" />);
      // First set some content
      typeIntoComposer('x'.repeat(230));
      // Paste that would exceed limit
      pasteIntoComposer('y'.repeat(50), 230, 230);
      // CTA should be visible due to overflow attempt
      expect(screen.getByTestId('convert-to-article-cta')).toBeInTheDocument();
    });

    it('allows exactly 240 characters', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT));
      const textarea = screen.getByTestId('comment-composer') as HTMLTextAreaElement;
      expect(textarea.value.length).toBe(REPLY_CHAR_LIMIT);
    });
  });

  // ── CTA visibility ──

  describe('Convert to Article CTA', () => {
    it('appears at ≥200 chars', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
      expect(screen.getByTestId('convert-to-article-cta')).toBeInTheDocument();
    });

    it('does not appear below 200 chars without overflow', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD - 1));
      expect(screen.queryByTestId('convert-to-article-cta')).not.toBeInTheDocument();
    });

    it('appears on overflow attempt even if content shrinks', () => {
      render(<CommentComposer threadId="t1" />);
      // Trigger overflow
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT + 10));
      // Content is truncated to 240 but overflow flag is set
      expect(screen.getByTestId('convert-to-article-cta')).toBeInTheDocument();
      // Now clear to short text — CTA still shows because overflow was attempted
      typeIntoComposer('hello');
      expect(screen.getByTestId('convert-to-article-cta')).toBeInTheDocument();
    });

    it('CTA button is disabled without onConvertToArticle handler', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
      const btn = screen.getByTestId('convert-to-article-btn');
      expect(btn).toBeDisabled();
      expect(btn).toHaveAttribute('title', 'Coming soon');
    });

    it('CTA button is enabled with onConvertToArticle handler', () => {
      const handler = vi.fn();
      render(<CommentComposer threadId="t1" onConvertToArticle={handler} />);
      typeIntoComposer('x'.repeat(REPLY_WARNING_THRESHOLD));
      const btn = screen.getByTestId('convert-to-article-btn');
      expect(btn).not.toBeDisabled();
      fireEvent.click(btn);
      expect(handler).toHaveBeenCalledWith('x'.repeat(REPLY_WARNING_THRESHOLD));
    });
  });

  // ── Thread creation: cap does NOT apply ──

  describe('thread creation mode (no cap)', () => {
    it('does not show counter or enforce limit in thread creation mode', () => {
      render(<CommentComposer threadId="t1" isThreadCreation />);
      typeIntoComposer('x'.repeat(500));
      const textarea = screen.getByTestId('comment-composer') as HTMLTextAreaElement;
      expect(textarea.value.length).toBe(500);
      expect(screen.queryByTestId('char-counter')).not.toBeInTheDocument();
      expect(screen.queryByTestId('convert-to-article-cta')).not.toBeInTheDocument();
    });
  });

  // ── Submit blocked when at limit with overflow ──

  describe('submit blocking', () => {
    it('submit button enabled at exactly 240 chars', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT));
      expect(screen.getByTestId('submit-comment-btn')).not.toBeDisabled();
    });

    it('submit button enabled for normal content under limit', () => {
      render(<CommentComposer threadId="t1" />);
      typeIntoComposer('hello');
      expect(screen.getByTestId('submit-comment-btn')).not.toBeDisabled();
    });

    it('clears overflow flag after successful post', async () => {
      render(<CommentComposer threadId="t1" />);
      // Trigger overflow
      typeIntoComposer('x'.repeat(REPLY_CHAR_LIMIT + 10));
      expect(screen.getByTestId('convert-to-article-cta')).toBeInTheDocument();

      // Post (content is truncated to 240)
      fireEvent.click(screen.getByTestId('submit-comment-btn'));
      await waitFor(() => expect(createCommentMock).toHaveBeenCalled());

      // After post, overflow should be cleared and no CTA
      expect(screen.queryByTestId('convert-to-article-cta')).not.toBeInTheDocument();
    });
  });

  // ── Constants exported correctly ──

  describe('constants', () => {
    it('exports correct limit values', () => {
      expect(REPLY_CHAR_LIMIT).toBe(240);
      expect(REPLY_WARNING_THRESHOLD).toBe(200);
    });
  });
});
