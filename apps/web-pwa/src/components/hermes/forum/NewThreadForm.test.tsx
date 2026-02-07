/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NewThreadForm } from './NewThreadForm';

const createThreadMock = vi.fn(async () => ({ id: 'thread-1' }));

vi.mock('../../../store/hermesForum', () => ({
  useForumStore: () => ({ createThread: createThreadMock })
}));

describe('NewThreadForm', () => {
  beforeEach(() => {
    createThreadMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('calls createThread with sourceUrl opts when sourceUrl is provided', async () => {
    const sourceUrl = 'https://example.com/article';
    render(
      <NewThreadForm
        sourceAnalysisId="analysis-hash-1"
        defaultTitle="Default"
        sourceUrl={sourceUrl}
      />
    );

    fireEvent.change(screen.getByTestId('thread-title'), { target: { value: '  Thread title  ' } });
    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: '  Thread content  ' } });
    fireEvent.change(screen.getByPlaceholderText('Tags (comma separated)'), {
      target: { value: 'news, policy, ,  civic  ' }
    });

    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    expect(createThreadMock).toHaveBeenCalledWith(
      'Thread title',
      'Thread content',
      ['news', 'policy', 'civic'],
      'analysis-hash-1',
      { sourceUrl, isHeadline: true }
    );
  });

  it('calls createThread with opts undefined when sourceUrl is absent', async () => {
    render(<NewThreadForm sourceAnalysisId="analysis-hash-2" />);

    fireEvent.change(screen.getByTestId('thread-title'), { target: { value: ' Title ' } });
    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: ' Content ' } });

    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    expect(createThreadMock).toHaveBeenCalledWith('Title', 'Content', [], 'analysis-hash-2', undefined);
  });

  it('calls createThread with opts undefined when sourceUrl is empty string', async () => {
    render(<NewThreadForm sourceAnalysisId="analysis-hash-3" sourceUrl="" />);

    fireEvent.change(screen.getByTestId('thread-title'), { target: { value: 'Title' } });
    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: 'Content' } });

    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    expect(createThreadMock).toHaveBeenCalledWith('Title', 'Content', [], 'analysis-hash-3', undefined);
  });
});
