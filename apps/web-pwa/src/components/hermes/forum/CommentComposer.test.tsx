/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommentComposer } from './CommentComposer';

const createCommentMock = vi.fn(async () => undefined);
const mockStore = { createComment: createCommentMock };

vi.mock('../../../store/hermesForum', () => ({
  useForumStore: (selector?: any) => (selector ? selector(mockStore) : mockStore)
}));

vi.mock('./SlideToPost', () => ({
  SlideToPost: ({ onChange, disabled }: any) => (
    <button
      type="button"
      data-testid="slide-to-post-mock"
      disabled={disabled}
      onClick={() => onChange(10)}
    >
      Slide
    </button>
  )
}));

describe('CommentComposer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => cleanup());

  it('disables slide-to-post until content exists, then posts', async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<CommentComposer threadId="thread-1" parentId="parent-1" onSubmit={onSubmit} />);

    const slide = screen.getByTestId('slide-to-post-mock');
    const submit = screen.getByTestId('submit-comment-btn');
    expect(slide).toBeDisabled();
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByTestId('comment-composer'), { target: { value: ' Hello ' } });
    expect(slide).not.toBeDisabled();
    expect(submit).not.toBeDisabled();

    fireEvent.click(slide);
    fireEvent.click(submit);

    await waitFor(() => expect(createCommentMock).toHaveBeenCalled());
    expect(createCommentMock).toHaveBeenCalledWith('thread-1', 'Hello', 'concur', 'parent-1');
    expect(onSubmit).toHaveBeenCalled();
  });
});
