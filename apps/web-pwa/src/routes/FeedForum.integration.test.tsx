/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { deriveUrlTopicId } from '@vh/data-model';
import { hashUrl } from '../../../../packages/ai-engine/src/analysis';
import { AnalysisFeed } from './AnalysisFeed';
import { NewThreadForm } from '../components/hermes/forum/NewThreadForm';
import { createForumStore } from '../store/forum';
import { clearPublishedIdentity, publishIdentity } from '../store/identityProvider';
import { useXpLedger } from '../store/xpLedger';

const { mockUseAppStore, mockUseIdentity, createThreadBridge, gunThreadPutMock } = vi.hoisted(() => ({
  mockUseAppStore: vi.fn(),
  mockUseIdentity: vi.fn(),
  createThreadBridge: vi.fn(),
  gunThreadPutMock: vi.fn((_value: any, cb?: (ack?: { err?: string }) => void) => cb?.({}))
}));

vi.mock('../store', () => {
  const useAppStore = (...args: unknown[]) => mockUseAppStore(...args);
  (useAppStore as { getState: () => { client: null } }).getState = () => ({ client: null });
  return { useAppStore };
});

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: (...args: unknown[]) => mockUseIdentity(...args)
}));

vi.mock('../store/hermesForum', () => ({
  useForumStore: () => ({
    createThread: (...args: unknown[]) => createThreadBridge(...args)
  })
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, search, children, ...rest }: any) => {
    const pathname = typeof to === 'string' ? to : '#';
    const params = new URLSearchParams();
    Object.entries(search ?? {}).forEach(([key, value]) => {
      if (value !== undefined) {
        params.set(key, String(value));
      }
    });
    const href = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  }
}));

vi.mock('@vh/gun-client', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getForumThreadChain: vi.fn(() => ({ put: gunThreadPutMock })),
    getForumCommentsChain: vi.fn(() => ({
      get: vi.fn(() => ({ put: vi.fn() })),
      map: vi.fn(() => ({ on: vi.fn() }))
    })),
    getForumDateIndexChain: vi.fn(() => ({
      get: vi.fn(() => ({ put: vi.fn() }))
    })),
    getForumTagIndexChain: vi.fn(() => ({
      get: vi.fn(() => ({ put: vi.fn() }))
    }))
  };
});

describe('Feed ↔ Forum integration', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPublishedIdentity();
    mockUseAppStore.mockReset();
    mockUseIdentity.mockReset();
    createThreadBridge.mockReset();
    gunThreadPutMock.mockClear();

    mockUseAppStore.mockReturnValue({ client: null });
    mockUseIdentity.mockReturnValue({ identity: null });
  });

  afterEach(() => {
    cleanup();
    clearPublishedIdentity();
    useXpLedger.getState().setActiveNullifier(null);
    localStorage.clear();
  });

  it('creates a thread from analysis feed context with sourceUrl/urlHash/topicId/isHeadline', async () => {
    const sourceUrl = 'https://example.com/news/story';
    const sourceAnalysisId = hashUrl(sourceUrl);
    const summary = 'Analysis summary headline';

    localStorage.setItem(
      'vh_canonical_analyses',
      JSON.stringify([
        {
          url: sourceUrl,
          urlHash: sourceAnalysisId,
          summary,
          biases: ['b'],
          counterpoints: ['c'],
          sentimentScore: 0,
          bias_claim_quote: [],
          justify_bias_claim: [],
          confidence: 0.8,
          timestamp: Date.now()
        }
      ])
    );

    const nullifier = 'feed-forum-integration-user';
    publishIdentity({
      session: {
        nullifier,
        trustScore: 1,
        scaledTrustScore: 10000
      }
    });
    useXpLedger.getState().setActiveNullifier(nullifier);

    // Stub budget + XP methods on the singleton so createThread doesn't throw
    // when canPerformAction/consumeAction/applyProjectXP check for active nullifier state.
    const realGetState = useXpLedger.getState;
    vi.spyOn(useXpLedger, 'getState').mockImplementation(() => ({
      ...realGetState(),
      canPerformAction: () => ({ allowed: true }),
      consumeAction: () => {},
      applyProjectXP: () => {},
      applyForumXP: () => {},
    }));

    const forumStore = createForumStore({
      resolveClient: () => ({} as any),
      randomId: () => 'thread-feed-forum',
      now: () => 1_700_000_000_000
    });

    createThreadBridge.mockImplementation((...args: any[]) => forumStore.getState().createThread(...args));

    const { unmount } = render(<AnalysisFeed />);
    const discussLink = screen.getByRole('link', { name: /discuss in forum/i });
    const linkSearch = new URL(discussLink.getAttribute('href') ?? '', 'https://venn.local').searchParams;

    expect(linkSearch.get('sourceAnalysisId')).toBe(sourceAnalysisId);
    expect(linkSearch.get('title')).toBe(summary);
    expect(linkSearch.get('sourceUrl')).toBe(sourceUrl);

    unmount();

    render(
      <NewThreadForm
        sourceAnalysisId={linkSearch.get('sourceAnalysisId') ?? undefined}
        defaultTitle={linkSearch.get('title') ?? undefined}
        sourceUrl={linkSearch.get('sourceUrl') ?? undefined}
      />
    );

    fireEvent.change(screen.getByTestId('thread-content'), {
      target: { value: 'Forum discussion content' }
    });
    fireEvent.change(screen.getByPlaceholderText('Tags (comma separated)'), {
      target: { value: 'news' }
    });
    fireEvent.click(screen.getByTestId('submit-thread-btn'));

    await waitFor(() => expect(createThreadBridge).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(forumStore.getState().threads.has('thread-feed-forum')).toBe(true));

    const createdThread = forumStore.getState().threads.get('thread-feed-forum');
    expect(createdThread).toBeDefined();

    const expectedHash = await deriveUrlTopicId(sourceUrl);
    expect(createdThread).toMatchObject({
      id: 'thread-feed-forum',
      sourceAnalysisId,
      sourceUrl,
      urlHash: expectedHash,
      topicId: expectedHash,
      isHeadline: true
    });
  });
});
