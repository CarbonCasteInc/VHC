// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  availableSignInProvidersMock,
  startSignInMock,
  completeSignInMock,
  bindSignInSessionMock,
  loadSignInSessionMock,
  matchesPrincipalMock,
  SignInErrorClass,
} = vi.hoisted(() => {
  class SignInErrorClass extends Error {
    reason: string;
    constructor(reason: string) {
      super(reason);
      this.reason = reason;
    }
  }
  return {
    availableSignInProvidersMock: vi.fn(() => ['mock']),
    startSignInMock: vi.fn(),
    completeSignInMock: vi.fn(),
    bindSignInSessionMock: vi.fn(),
    loadSignInSessionMock: vi.fn(),
    matchesPrincipalMock: vi.fn(),
    SignInErrorClass,
  };
});

vi.mock('../auth/signInFlow', () => ({
  SignInError: SignInErrorClass,
  availableSignInProviders: (...a: unknown[]) => availableSignInProvidersMock(...(a as [])),
  startSignIn: (...a: unknown[]) => startSignInMock(...(a as [])),
  completeSignIn: (...a: unknown[]) => completeSignInMock(...(a as [])),
}));

vi.mock('../auth/signInBinding', () => ({
  bindSignInSession: (...a: unknown[]) => bindSignInSessionMock(...(a as [])),
}));

vi.mock('@vh/identity-vault', () => ({
  loadSignInSession: (...a: unknown[]) => loadSignInSessionMock(...(a as [])),
  signInSessionMatchesPrincipal: (...a: unknown[]) => matchesPrincipalMock(...(a as [])),
}));

import { useSignIn, type SignInIdentityBridge } from './useSignIn';
import { clearSignInAccounts, getSignInAccount, getSignInAccounts } from '../store/signInAccount';
import { clearPublishedIdentity, publishIdentity } from '../store/identityProvider';

function bridge(overrides: Partial<SignInIdentityBridge> = {}): SignInIdentityBridge {
  return {
    status: 'ready',
    activeNullifier: null,
    ensureIdentity: vi.fn(async () => 'principal-1'),
    ...overrides,
  };
}

beforeEach(() => {
  clearSignInAccounts();
  clearPublishedIdentity();
  vi.clearAllMocks();
  availableSignInProvidersMock.mockReturnValue(['mock']);
  loadSignInSessionMock.mockResolvedValue(null);
  matchesPrincipalMock.mockReturnValue(false);
});

afterEach(() => {
  clearSignInAccounts();
  clearPublishedIdentity();
});

describe('useSignIn', () => {
  it('exposes available providers and current accounts', () => {
    const { result } = renderHook(() => useSignIn(bridge()));
    expect(result.current.providers).toEqual(['mock']);
    expect(result.current.accounts).toEqual([]);
  });

  it('beginSignIn returns the authorize URL', async () => {
    startSignInMock.mockResolvedValue({ authorizeUrl: '/auth/callback?x=1', state: 's', provider: 'mock' });
    const { result } = renderHook(() => useSignIn(bridge()));
    let url: string | null = null;
    await act(async () => {
      url = await result.current.beginSignIn('mock');
    });
    expect(url).toBe('/auth/callback?x=1');
    expect(result.current.phase).toBe('idle');
  });

  it('beginSignIn surfaces a SignInError reason', async () => {
    startSignInMock.mockRejectedValue(new SignInErrorClass('provider_unsupported'));
    const { result } = renderHook(() => useSignIn(bridge()));
    let url: string | null = 'x';
    await act(async () => {
      url = await result.current.beginSignIn('mock');
    });
    expect(url).toBeNull();
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('provider_unsupported');
  });

  it('beginSignIn surfaces a generic error message', async () => {
    startSignInMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSignIn(bridge()));
    await act(async () => {
      await result.current.beginSignIn('mock');
    });
    expect(result.current.error).toBe('sign-in failed to start');
  });

  it('completeFromCallback hydrates identity and binds the session', async () => {
    completeSignInMock.mockResolvedValue({ providerId: 'apple', providerSubject: 'sub' });
    bindSignInSessionMock.mockResolvedValue({ account: {}, boundPrincipalNullifier: 'principal-1' });
    const ensureIdentity = vi.fn(async () => 'principal-1');
    const { result } = renderHook(() => useSignIn(bridge({ ensureIdentity })));
    let ok = false;
    await act(async () => {
      ok = await result.current.completeFromCallback({ code: 'c', state: 's' });
    });
    expect(ok).toBe(true);
    expect(ensureIdentity).toHaveBeenCalled();
    expect(bindSignInSessionMock).toHaveBeenCalledWith({ providerId: 'apple', providerSubject: 'sub' }, 'principal-1');
    expect(result.current.phase).toBe('idle');
  });

  it('completeFromCallback fails cleanly when no identity is available', async () => {
    completeSignInMock.mockResolvedValue({ providerId: 'apple', providerSubject: 'sub' });
    const ensureIdentity = vi.fn(async () => null);
    const { result } = renderHook(() => useSignIn(bridge({ ensureIdentity })));
    let ok = true;
    await act(async () => {
      ok = await result.current.completeFromCallback({ code: 'c', state: 's' });
    });
    expect(ok).toBe(false);
    expect(result.current.phase).toBe('error');
    expect(result.current.error).toBe('no active identity to bind sign-in');
    expect(bindSignInSessionMock).not.toHaveBeenCalled();
  });

  it('completeFromCallback surfaces a SignInError reason from completeSignIn', async () => {
    completeSignInMock.mockRejectedValue(new SignInErrorClass('state_mismatch'));
    const { result } = renderHook(() => useSignIn(bridge()));
    await act(async () => {
      await result.current.completeFromCallback({ code: 'c', state: 's' });
    });
    expect(result.current.error).toBe('state_mismatch');
  });

  it('completeFromCallback surfaces a generic non-Error rejection', async () => {
    completeSignInMock.mockRejectedValue('weird');
    const { result } = renderHook(() => useSignIn(bridge()));
    await act(async () => {
      await result.current.completeFromCallback({ code: 'c', state: 's' });
    });
    expect(result.current.error).toBe('sign-in failed');
  });

  it('signOutProvider marks the account signed-out locally', async () => {
    completeSignInMock.mockResolvedValue({ providerId: 'apple', providerSubject: 'sub' });
    bindSignInSessionMock.mockResolvedValue({ account: {}, boundPrincipalNullifier: 'p' });
    const { result } = renderHook(() => useSignIn(bridge()));
    // Seed an account via the store directly through a completed flow.
    await act(async () => {
      await result.current.completeFromCallback({ code: 'c', state: 's' });
    });
    // bindSignInSession is mocked, so seed the store manually to sign out.
    act(() => {
      result.current.signOutProvider({
        schemaVersion: 'sign-in-account-v1',
        providerId: 'apple',
        displayLabel: 'a@b.com',
        status: 'signed-in',
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(getSignInAccount('apple')?.status).toBe('signed-out');
  });

  it('signOutProvider handles a record without a display label', () => {
    const { result } = renderHook(() => useSignIn(bridge()));
    act(() => {
      result.current.signOutProvider({
        schemaVersion: 'sign-in-account-v1',
        providerId: 'x',
        status: 'signed-in',
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(getSignInAccount('x')?.status).toBe('signed-out');
  });

  it('reflects a persisted vault binding matching the active principal', async () => {
    loadSignInSessionMock.mockResolvedValue({ providerId: 'google', displayLabel: 'g@e.com' });
    matchesPrincipalMock.mockReturnValue(true);
    renderHook(() => useSignIn(bridge({ activeNullifier: 'principal-1' })));
    await waitFor(() => expect(getSignInAccount('google')?.status).toBe('signed-in'));
    expect(getSignInAccount('google')?.displayLabel).toBe('g@e.com');
  });

  it('reflects a persisted binding via the published identity when no active nullifier is passed', async () => {
    publishIdentity({ session: { nullifier: 'pub-1', trustScore: 1, scaledTrustScore: 1, expiresAt: 0 } });
    loadSignInSessionMock.mockResolvedValue({ providerId: 'apple' });
    matchesPrincipalMock.mockReturnValue(true);
    renderHook(() => useSignIn(bridge({ activeNullifier: null })));
    await waitFor(() => expect(getSignInAccount('apple')?.status).toBe('signed-in'));
  });

  it('does nothing when there is no active or published principal', async () => {
    renderHook(() => useSignIn(bridge({ activeNullifier: null })));
    await Promise.resolve();
    expect(getSignInAccounts()).toEqual([]);
  });

  it('ignores a persisted binding that does not match the active principal', async () => {
    loadSignInSessionMock.mockResolvedValue({ providerId: 'google' });
    matchesPrincipalMock.mockReturnValue(false);
    renderHook(() => useSignIn(bridge({ activeNullifier: 'principal-1' })));
    await Promise.resolve();
    await Promise.resolve();
    expect(getSignInAccounts()).toEqual([]);
  });

  it('tolerates a vault load failure when reflecting bindings', async () => {
    loadSignInSessionMock.mockRejectedValue(new Error('vault locked'));
    const { unmount } = renderHook(() => useSignIn(bridge({ activeNullifier: 'principal-1' })));
    await Promise.resolve();
    expect(getSignInAccounts()).toEqual([]);
    unmount();
  });

  it('does not apply a binding after unmount (cancelled)', async () => {
    let resolveLoad: (value: unknown) => void = () => {};
    loadSignInSessionMock.mockReturnValue(new Promise((resolve) => {
      resolveLoad = resolve;
    }));
    matchesPrincipalMock.mockReturnValue(true);
    const { unmount } = renderHook(() => useSignIn(bridge({ activeNullifier: 'principal-1' })));
    unmount();
    resolveLoad({ providerId: 'apple' });
    await Promise.resolve();
    await Promise.resolve();
    expect(getSignInAccounts()).toEqual([]);
  });

  it('reflects a persisted binding with an undefined display label', async () => {
    loadSignInSessionMock.mockResolvedValue({ providerId: 'x' });
    matchesPrincipalMock.mockReturnValue(true);
    renderHook(() => useSignIn(bridge({ activeNullifier: 'principal-1' })));
    await waitFor(() => expect(getSignInAccount('x')?.status).toBe('signed-in'));
    expect(getSignInAccount('x')?.displayLabel).toBeUndefined();
  });
});
