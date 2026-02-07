/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { ForumFeed } from './ForumFeed';

const loadThreadsMock = vi.fn(async () => []);
const voteMock = vi.fn();

vi.mock('../../../store/hermesForum', () => ({
  useForumStore: () => ({
    threads: new Map(),
    userVotes: new Map(),
    vote: voteMock,
    loadThreads: loadThreadsMock
  })
}));

vi.mock('./TrustGate', () => ({
  TrustGate: ({ children }: any) => <>{children}</>
}));

const newThreadFormPropsMock = vi.fn();

vi.mock('./NewThreadForm', () => ({
  NewThreadForm: (props: any) => {
    newThreadFormPropsMock(props);
    return (
      <div
        data-testid="new-thread-form-mock"
        data-source-url={props.sourceUrl ?? ''}
      />
    );
  }
}));

describe('ForumFeed', () => {
  beforeEach(() => {
    loadThreadsMock.mockClear();
    voteMock.mockClear();
    newThreadFormPropsMock.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('forwards sourceUrl to NewThreadForm', () => {
    render(
      <ForumFeed
        sourceAnalysisId="analysis-hash"
        defaultTitle="analysis summary"
        sourceUrl="https://example.com/headline"
      />
    );

    fireEvent.click(screen.getByTestId('new-thread-btn'));

    expect(screen.getByTestId('new-thread-form-mock')).toHaveAttribute(
      'data-source-url',
      'https://example.com/headline'
    );

    const lastProps = newThreadFormPropsMock.mock.calls.at(-1)?.[0];
    expect(lastProps).toMatchObject({
      sourceAnalysisId: 'analysis-hash',
      defaultTitle: 'analysis summary',
      sourceUrl: 'https://example.com/headline'
    });
  });

  it('forwards undefined sourceUrl when prop is absent', () => {
    render(<ForumFeed sourceAnalysisId="analysis-hash" defaultTitle="title" />);

    fireEvent.click(screen.getByTestId('new-thread-btn'));

    expect(screen.getByTestId('new-thread-form-mock')).toHaveAttribute(
      'data-source-url',
      ''
    );

    const lastProps = newThreadFormPropsMock.mock.calls.at(-1)?.[0];
    expect(lastProps.sourceUrl).toBeUndefined();
  });
});
