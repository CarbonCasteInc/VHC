/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { NewThreadForm } from './NewThreadForm';

const createdThread = {
  id: 'thread-1',
  schemaVersion: 'hermes-thread-v0',
  title: 'Thread title',
  content: 'Thread content',
  author: 'author-1',
  timestamp: 1,
  tags: [],
  upvotes: 0,
  downvotes: 0,
  score: 0,
};
const createThreadMock = vi.fn(async () => createdThread);

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
        sourceSynthesisId="synth-1"
        sourceEpoch={4}
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
      { sourceSynthesisId: 'synth-1', sourceEpoch: 4 },
      { sourceUrl, isHeadline: true }
    );
  });

  it('passes story topic and deterministic thread id through headline thread opts', async () => {
    const onSuccess = vi.fn();
    render(
      <NewThreadForm
        sourceSynthesisId="synth-1"
        sourceEpoch={4}
        defaultTitle="Default"
        sourceUrl="https://example.com/article"
        topicId="news-1"
        threadId="news-story:story-1"
        onSuccess={onSuccess}
      />,
    );

    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: 'Thread content' } });
    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    expect(createThreadMock).toHaveBeenCalledWith(
      'Default',
      'Thread content',
      [],
      { sourceSynthesisId: 'synth-1', sourceEpoch: 4 },
      {
        sourceUrl: 'https://example.com/article',
        topicId: 'news-1',
        threadId: 'news-story:story-1',
        isHeadline: true,
      },
    );
    expect(onSuccess).toHaveBeenCalledWith(createdThread);
  });

  it('calls createThread with opts undefined when sourceUrl is absent', async () => {
    render(<NewThreadForm sourceSynthesisId="synth-2" />);

    fireEvent.change(screen.getByTestId('thread-title'), { target: { value: ' Title ' } });
    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: ' Content ' } });

    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    expect(createThreadMock).toHaveBeenCalledWith(
      'Title',
      'Content',
      [],
      { sourceSynthesisId: 'synth-2', sourceEpoch: undefined },
      undefined,
    );
  });

  it('calls createThread with opts undefined when sourceUrl is empty string', async () => {
    render(<NewThreadForm sourceSynthesisId="synth-3" sourceUrl="" />);

    fireEvent.change(screen.getByTestId('thread-title'), { target: { value: 'Title' } });
    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: 'Content' } });

    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadMock).toHaveBeenCalledTimes(1));
    expect(createThreadMock).toHaveBeenCalledWith(
      'Title',
      'Content',
      [],
      { sourceSynthesisId: 'synth-3', sourceEpoch: undefined },
      undefined,
    );
  });

  it('surfaces createThread failures without clearing the draft', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createThreadMock.mockRejectedValueOnce(new Error('Gun client not ready'));
    render(<NewThreadForm sourceSynthesisId="synth-4" defaultTitle="Draft title" />);

    fireEvent.change(screen.getByTestId('thread-content'), { target: { value: 'Draft content' } });
    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    expect(await screen.findByTestId('thread-form-error')).toHaveTextContent('Gun client not ready');
    expect(screen.getByTestId('thread-title')).toHaveValue('Draft title');
    expect(screen.getByTestId('thread-content')).toHaveValue('Draft content');
    warnSpy.mockRestore();
  });
});
