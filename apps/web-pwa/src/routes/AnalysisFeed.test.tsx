/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisFeed, ANALYSIS_FEED_STORAGE_KEY, createBudgetDeniedResult } from './AnalysisFeed';
import '@testing-library/jest-dom/vitest';
import { hashUrl } from '../../../../packages/ai-engine/src/analysis';
import * as AnalysisModule from '../../../../packages/ai-engine/src/analysis';
import { createBudgetMock } from '../test-utils/budgetMock';

const mockUseAppStore = vi.fn();
const mockUseIdentity = vi.fn();

const mockSetActiveNullifier = vi.fn();
const mockCanPerformAction = vi.fn();
const mockConsumeAction = vi.fn();
const budgetMock = createBudgetMock({
  setActiveNullifier: mockSetActiveNullifier,
  canPerformAction: mockCanPerformAction,
  consumeAction: mockConsumeAction
});

vi.mock('../store', () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args)
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: (...args: unknown[]) => mockUseIdentity(...args)
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

function createFakeGunChain() {
  const map = new Map<string, any>();
  const chain: any = {
    get(key: string) {
      return {
        once(cb: (data: any) => void) {
          cb(map.get(key));
        },
        put(value: any, cb?: (ack?: { err?: string }) => void) {
          map.set(key, value);
          cb?.();
        },
        get: this.get.bind(this)
      };
    }
  };
  return { chain, map };
}

function submitUrl(targetUrl: string) {
  fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: targetUrl } });
  fireEvent.click(screen.getByText('Analyze'));
}

describe('AnalysisFeed', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseAppStore.mockReturnValue({ client: null });
    mockUseIdentity.mockReturnValue({ identity: null });

    mockSetActiveNullifier.mockReset();
    mockCanPerformAction.mockReset();
    mockConsumeAction.mockReset();
    mockCanPerformAction.mockReturnValue({ allowed: true });

    budgetMock.install();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    budgetMock.restore();
  });

  it('generates a local analysis and caches by url hash', async () => {
    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem(ANALYSIS_FEED_STORAGE_KEY) ?? '[]')).toHaveLength(1);

    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() =>
      expect(screen.getByText(/Analysis already exists/)).toBeInTheDocument()
    );
    expect(JSON.parse(localStorage.getItem(ANALYSIS_FEED_STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('hydrates feed from existing local storage entries', () => {
    const existing = [
      {
        url: 'https://cached.com',
        urlHash: hashUrl('https://cached.com'),
        summary: 'cached summary',
        biases: ['b'],
        counterpoints: ['c'],
        sentimentScore: 0,
        bias_claim_quote: [],
        justify_bias_claim: [],
        confidence: 0.9,
        timestamp: Date.now()
      }
    ];
    localStorage.setItem(ANALYSIS_FEED_STORAGE_KEY, JSON.stringify(existing));
    render(<AnalysisFeed />);
    expect(screen.getByText('cached summary')).toBeInTheDocument();
  });

  it('includes sourceUrl in the Discuss in Forum link search params', () => {
    const sourceUrl = 'https://source.example/story';
    const existing = [
      {
        url: sourceUrl,
        urlHash: hashUrl(sourceUrl),
        summary: 'summary title',
        biases: ['b'],
        counterpoints: ['c'],
        sentimentScore: 0,
        bias_claim_quote: [],
        justify_bias_claim: [],
        confidence: 0.9,
        timestamp: Date.now()
      }
    ];
    localStorage.setItem(ANALYSIS_FEED_STORAGE_KEY, JSON.stringify(existing));

    render(<AnalysisFeed />);

    const link = screen.getByRole('link', { name: /discuss in forum/i });
    const url = new URL(link.getAttribute('href') ?? '', 'https://venn.local');

    expect(url.pathname).toBe('/hermes');
    expect(url.searchParams.get('sourceAnalysisId')).toBe(existing[0].urlHash);
    expect(url.searchParams.get('title')).toBe(existing[0].summary);
    expect(url.searchParams.get('sourceUrl')).toBe(sourceUrl);
  });

  it('falls back gracefully when localStorage is unavailable', async () => {
    const originalStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('storage read blocked');
        },
        setItem: () => {
          throw new Error('storage write blocked');
        }
      },
      configurable: true
    });
    mockUseAppStore.mockReturnValue({ client: null });

    try {
      render(<AnalysisFeed />);
      fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://fallback.com' } });
      fireEvent.click(screen.getByText('Analyze'));

      await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
    } finally {
      Object.defineProperty(window, 'localStorage', { value: originalStorage, configurable: true });
    }
  });

  it('fetches from mesh when available', async () => {
    const { chain, map } = createFakeGunChain();
    const record = {
      url: 'https://example.com',
      urlHash: hashUrl('https://example.com'),
      summary: 'remote',
      biases: ['b'],
      counterpoints: ['c'],
      sentimentScore: 0,
      bias_claim_quote: [],
      justify_bias_claim: [],
      confidence: 0.5,
      timestamp: Date.now()
    };
    map.set(record.urlHash, record);
    mockUseAppStore.mockReturnValue({ client: { mesh: { get: chain.get.bind(chain) } } });

    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText(/fetched from mesh/i)).toBeInTheDocument());
    expect(screen.getByText('remote')).toBeInTheDocument();
  });

  it('uses gun fallback when mesh client is absent', async () => {
    const { chain, map } = createFakeGunChain();
    const record = {
      url: 'https://gun.com',
      urlHash: hashUrl('https://gun.com'),
      summary: 'from gun',
      biases: ['b'],
      counterpoints: ['c'],
      sentimentScore: 0,
      bias_claim_quote: [],
      justify_bias_claim: [],
      confidence: 0.5,
      timestamp: Date.now()
    };
    map.set(record.urlHash, record);
    mockUseAppStore.mockReturnValue({ client: { gun: { get: chain.get.bind(chain) } } });

    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://gun.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText(/fetched from mesh/i)).toBeInTheDocument());
    expect(screen.getByText('from gun')).toBeInTheDocument();
  });

  it('stores to mesh but warns when identity missing', async () => {
    const { chain } = createFakeGunChain();
    mockUseAppStore.mockReturnValue({ client: { mesh: { get: chain.get.bind(chain) } } });
    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://new.com' } });
    fireEvent.click(screen.getByText('Analyze'));
    await waitFor(() => expect(screen.getByText(/connect identity/)).toBeInTheDocument());
  });

  it('shows success message when mesh sync succeeds with identity present', async () => {
    const { chain } = createFakeGunChain();
    mockUseAppStore.mockReturnValue({ client: { mesh: { get: chain.get.bind(chain) } } });
    mockUseIdentity.mockReturnValue({ identity: { did: 'did:example' } });

    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://synced.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText(/Analysis ready for https:\/\/synced.com/)).toBeInTheDocument());
  });

  it('shows Analysis unavailable when analysis result is null without notice', async () => {
    const targetUrl = 'https://null-analysis.com';
    const { chain } = createFakeGunChain();
    mockUseAppStore.mockReturnValue({ client: { mesh: { get: chain.get.bind(chain) } } });
    mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-null-analysis' } } });
    const getOrGenerateSpy = vi.spyOn(AnalysisModule, 'getOrGenerate').mockResolvedValue({ analysis: null as any, reused: false });

    try {
      render(<AnalysisFeed />);
      submitUrl(targetUrl);

      await waitFor(() => expect(screen.getByText('Analysis unavailable')).toBeInTheDocument());
      expect(mockConsumeAction).toHaveBeenCalledWith('analyses/day', 1, hashUrl(targetUrl));
    } finally {
      getOrGenerateSpy.mockRestore();
    }
  });

  it('shows validation error on empty input', async () => {
    render(<AnalysisFeed />);
    fireEvent.click(screen.getByText('Analyze'));
    expect(screen.getByText('Enter a valid URL')).toBeInTheDocument();
  });

  it('surfaces errors from analysis generation', async () => {
    const { chain } = createFakeGunChain();
    mockUseAppStore.mockReturnValue({ client: { mesh: { get: chain.get.bind(chain) } } });
    const spy = vi.spyOn(AnalysisModule, 'getOrGenerate').mockRejectedValue(new Error('failed to generate'));

    try {
      render(<AnalysisFeed />);
      fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://fail.com' } });
      fireEvent.click(screen.getByText('Analyze'));

      await waitFor(() => expect(screen.getByText('failed to generate')).toBeInTheDocument());
    } finally {
      spy.mockRestore();
    }
  });

  it('propagates mesh write errors', async () => {
    const analyses = {
      get: () => analyses,
      once: (cb: (data: any) => void) => cb(undefined),
      put: (_value: any, cb?: (ack?: { err?: string }) => void) => cb?.({ err: 'mesh write failed' })
    };
    mockUseAppStore.mockReturnValue({ client: { mesh: { get: () => analyses } } });
    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://failmesh.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText('mesh write failed')).toBeInTheDocument());
  });

  it('ignores gun store when analyses chain is incomplete', async () => {
    mockUseAppStore.mockReturnValue({
      client: {
        mesh: {
          get: () => ({
            once: (cb: (data: any) => void) => cb(undefined)
          })
        }
      }
    });
    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://noget.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
  });

  describe('analyses/day budget enforcement', () => {
    it('T1: allowed path generates and consumes budget', async () => {
      const targetUrl = 'https://allowed.com';
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-abc' } } });

      render(<AnalysisFeed />);
      submitUrl(targetUrl);

      await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());

      expect(mockSetActiveNullifier).toHaveBeenCalledWith('nul-abc');
      expect(mockCanPerformAction).toHaveBeenCalledWith('analyses/day', 1, hashUrl(targetUrl));
      expect(mockConsumeAction).toHaveBeenCalledWith('analyses/day', 1, hashUrl(targetUrl));
    });

    it('T2: denied path blocks generation and shows reason', async () => {
      const targetUrl = 'https://blocked.com';
      const reason = 'Daily limit of 25 reached for analyses/day';
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-abc' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false, reason });
      const getOrGenerateSpy = vi
        .spyOn(AnalysisModule, 'getOrGenerate')
        .mockResolvedValue({ analysis: {} as any, reused: false });

      try {
        const result = createBudgetDeniedResult(reason);
        expect(result.analysis).toBeNull();
        expect(result.notice).toContain(reason);

        render(<AnalysisFeed />);
        submitUrl(targetUrl);
        await waitFor(() => expect(screen.getByText(reason)).toBeInTheDocument());

        expect(mockSetActiveNullifier).toHaveBeenCalledWith('nul-abc');
        expect(mockCanPerformAction).toHaveBeenCalledWith('analyses/day', 1, hashUrl(targetUrl));
        expect(getOrGenerateSpy).not.toHaveBeenCalled();
        expect(mockConsumeAction).not.toHaveBeenCalled();
      } finally {
        getOrGenerateSpy.mockRestore();
      }
    });

    it('T3: denied path does not consume budget', async () => {
      const targetUrl = 'https://denied-no-consume.com';
      const reason = 'Daily limit reached';
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-denied' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false, reason });

      const result = createBudgetDeniedResult(reason);
      expect(result.analysis).toBeNull();
      expect(result.notice).toContain(reason);

      render(<AnalysisFeed />);
      submitUrl(targetUrl);

      await waitFor(() => expect(screen.getByText(reason)).toBeInTheDocument());
      expect(mockConsumeAction).not.toHaveBeenCalled();
    });

    it('T4: reused/cached path does not consume budget', async () => {
      const targetUrl = 'https://cached-budget.com';
      const existing = {
        url: targetUrl,
        urlHash: hashUrl(targetUrl),
        summary: 'cached',
        biases: ['b'],
        counterpoints: ['c'],
        sentimentScore: 0,
        bias_claim_quote: [],
        justify_bias_claim: [],
        confidence: 0.9,
        timestamp: Date.now()
      };
      localStorage.setItem(ANALYSIS_FEED_STORAGE_KEY, JSON.stringify([existing]));
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-abc' } } });

      render(<AnalysisFeed />);
      submitUrl(targetUrl);

      await waitFor(() => expect(screen.getByText(/Analysis already exists/)).toBeInTheDocument());
      expect(mockCanPerformAction).toHaveBeenCalledWith('analyses/day', 1, hashUrl(targetUrl));
      expect(mockConsumeAction).not.toHaveBeenCalled();
    });

    it('T5: topicId is hashUrl(url) for check and consume', async () => {
      const targetUrl = 'https://specific-topic.com/article';
      const expectedTopicId = hashUrl(targetUrl);
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-topic' } } });

      render(<AnalysisFeed />);
      submitUrl(targetUrl);

      await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
      expect(mockCanPerformAction).toHaveBeenCalledWith('analyses/day', 1, expectedTopicId);
      expect(mockConsumeAction).toHaveBeenCalledWith('analyses/day', 1, expectedTopicId);
    });

    it('T6: no-identity path skips all budget APIs', async () => {
      mockUseIdentity.mockReturnValue({ identity: null });

      render(<AnalysisFeed />);
      submitUrl('https://anon.com');

      await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
      expect(mockSetActiveNullifier).not.toHaveBeenCalled();
      expect(mockCanPerformAction).not.toHaveBeenCalled();
      expect(mockConsumeAction).not.toHaveBeenCalled();
    });

    it('T7: identity with falsy nullifier skips budget APIs', async () => {
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: null } } });

      render(<AnalysisFeed />);
      submitUrl('https://no-nullifier.com');

      await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
      expect(mockSetActiveNullifier).not.toHaveBeenCalled();
      expect(mockCanPerformAction).not.toHaveBeenCalled();
      expect(mockConsumeAction).not.toHaveBeenCalled();
    });

    it('T8: per-topic cap denial displays per-topic reason', async () => {
      const targetUrl = 'https://topic-cap.com';
      const reason = 'Per-topic cap of 5 reached for analyses/day on topic abc123';
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-topic-cap' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false, reason });

      const result = createBudgetDeniedResult(reason);
      expect(result.analysis).toBeNull();
      expect(result.notice).toContain(reason);

      render(<AnalysisFeed />);
      submitUrl(targetUrl);

      await waitFor(() => expect(screen.getByText(reason)).toBeInTheDocument());
    });

    it('T9a: denied path emits console.warn', async () => {
      const reason = 'Budget exhausted for analyses';
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-warn' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false, reason });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        render(<AnalysisFeed />);
        submitUrl('https://warn-test.com');

        await waitFor(() => {
          expect(screen.getByText(reason)).toBeInTheDocument();
          expect(warnSpy).toHaveBeenCalledWith('[vh:analysis] Budget denied:', reason);
        });
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('T9b: denied path preserves URL in input', async () => {
      const targetUrl = 'https://preserved-url.com';
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-preserve' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false, reason: 'Denied' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        render(<AnalysisFeed />);
        const input = screen.getByTestId('analysis-url-input') as HTMLInputElement;
        fireEvent.change(input, { target: { value: targetUrl } });
        fireEvent.click(screen.getByText('Analyze'));

        await waitFor(() => {
          expect(screen.getByText('Denied')).toBeInTheDocument();
          expect(input.value).toBe(targetUrl);
        });
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('T9c: denied path with no reason uses fallback', async () => {
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-no-reason' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        render(<AnalysisFeed />);
        submitUrl('https://no-reason.com');

        await waitFor(() => {
          expect(screen.getByText('Daily limit reached for analyses/day')).toBeInTheDocument();
          expect(warnSpy).toHaveBeenCalledWith('[vh:analysis] Budget denied:', 'Daily limit reached for analyses/day');
        });
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('T9d: denied path with empty string reason uses fallback', async () => {
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-empty' } } });
      mockCanPerformAction.mockReturnValue({ allowed: false, reason: '' });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      try {
        render(<AnalysisFeed />);
        submitUrl('https://empty-reason.com');

        await waitFor(() => {
          expect(screen.getByText('Daily limit reached for analyses/day')).toBeInTheDocument();
          expect(warnSpy).toHaveBeenCalledWith('[vh:analysis] Budget denied:', 'Daily limit reached for analyses/day');
        });
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('T9e: createBudgetDeniedResult returns typed null analysis', () => {
      const result = createBudgetDeniedResult('test reason');
      expect(result.analysis).toBeNull();
      expect(result.notice).toBe('test reason');
    });

    it('T9: generation error does not consume budget', async () => {
      mockUseIdentity.mockReturnValue({ identity: { did: 'did:example', session: { nullifier: 'nul-error' } } });
      mockCanPerformAction.mockReturnValue({ allowed: true });
      const getOrGenerateSpy = vi.spyOn(AnalysisModule, 'getOrGenerate').mockRejectedValue(new Error('generation failed'));

      try {
        render(<AnalysisFeed />);
        submitUrl('https://error.com');

        await waitFor(() => expect(screen.getByText('generation failed')).toBeInTheDocument());
        expect(mockConsumeAction).not.toHaveBeenCalled();
      } finally {
        getOrGenerateSpy.mockRestore();
      }
    });
  });
});
