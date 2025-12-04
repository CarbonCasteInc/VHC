/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createSessionMock = vi.fn();
const pairMock = vi.fn();

vi.mock('@vh/gun-client', () => ({
  createSession: (...args: unknown[]) => createSessionMock(...(args as [])),
  SEA: {
    pair: (...args: unknown[]) => pairMock(...(args as []))
  }
}));

async function loadHook(e2eMode = false) {
  vi.resetModules();
  vi.stubGlobal('import.meta', {
    env: {
      VITE_E2E_MODE: e2eMode ? 'true' : 'false',
      VITE_ATTESTATION_URL: 'http://verifier'
    }
  });
  const mod = await import('./useIdentity');
  return mod.useIdentity;
}

describe('useIdentity', () => {
  beforeEach(() => {
    localStorage.clear();
    createSessionMock.mockReset();
    pairMock.mockReset();
    pairMock.mockResolvedValue({ pub: 'pub', priv: 'priv', epub: 'epub', epriv: 'epriv' });
  });

  it('persists nullifier and scaled trust score from verifier', async () => {
    createSessionMock.mockResolvedValue({
      token: 'srv-token',
      trustScore: 0.751,
      nullifier: 'stable-nullifier'
    });

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await act(async () => {
      await result.current.createIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    const session = result.current.identity?.session;
    expect(session?.nullifier).toBe('stable-nullifier');
    expect(session?.scaledTrustScore).toBe(7510);
    expect(result.current.identity?.devicePair?.epub).toBe('epub');

    const stored = JSON.parse(localStorage.getItem('vh_identity') ?? '{}');
    expect(stored.session.scaledTrustScore).toBe(7510);
    expect(stored.devicePair.epub).toBe('epub');
  });

  it('clamps scaled trust score to 10000 when verifier reports >1', async () => {
    createSessionMock.mockResolvedValue({
      token: 'srv-token',
      trustScore: 1.5,
      nullifier: 'n-high'
    });

    const useIdentity = await loadHook();
    const { result } = renderHook(() => useIdentity());

    await act(async () => {
      await result.current.createIdentity();
    });

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.identity?.session.scaledTrustScore).toBe(10000);
  });
});
