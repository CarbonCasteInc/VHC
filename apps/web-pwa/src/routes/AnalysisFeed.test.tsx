/* @vitest-environment jsdom */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisFeed } from './AnalysisFeed';
import '@testing-library/jest-dom/vitest';
import { hashUrl } from '../../../../packages/ai-engine/src/analysis';
import * as AnalysisModule from '../../../../packages/ai-engine/src/analysis';

const mockUseAppStore = vi.fn();
const mockUseIdentity = vi.fn();

vi.mock('../store', () => ({
  useAppStore: (...args: unknown[]) => mockUseAppStore(...args)
}));

vi.mock('../hooks/useIdentity', () => ({
  useIdentity: (...args: unknown[]) => mockUseIdentity(...args)
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: any) => (
    <a href={typeof to === 'string' ? to : '#'} {...rest}>
      {children}
    </a>
  )
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

describe('AnalysisFeed', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUseAppStore.mockReturnValue({ client: null });
    mockUseIdentity.mockReturnValue({ identity: null });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('generates a local analysis and caches by url hash', async () => {
    render(<AnalysisFeed />);
    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() => expect(screen.getByText(/stored locally only/i)).toBeInTheDocument());
    expect(JSON.parse(localStorage.getItem('vh_canonical_analyses') ?? '[]')).toHaveLength(1);

    fireEvent.change(screen.getByTestId('analysis-url-input'), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByText('Analyze'));

    await waitFor(() =>
      expect(screen.getByText(/Analysis already exists/)).toBeInTheDocument()
    );
    expect(JSON.parse(localStorage.getItem('vh_canonical_analyses') ?? '[]')).toHaveLength(1);
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
    localStorage.setItem('vh_canonical_analyses', JSON.stringify(existing));
    render(<AnalysisFeed />);
    expect(screen.getByText('cached summary')).toBeInTheDocument();
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
});
