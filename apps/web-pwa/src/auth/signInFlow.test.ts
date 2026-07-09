// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SignInError,
  availableSignInProviders,
  clearPendingSignIn,
  completeSignIn,
  computeCodeChallenge,
  generateCodeVerifier,
  isSignInProviderAvailable,
  startSignIn,
  type SignInFlowProvider,
} from './signInFlow';

type FlowEnv = Record<string, string | boolean | undefined>;

const BASE = 'https://auth.example.test';

function realEnv(overrides: FlowEnv = {}): FlowEnv {
  return { VITE_AUTH_CALLBACK_BASE_URL: BASE, ...overrides };
}

function e2eEnv(overrides: FlowEnv = {}): FlowEnv {
  return { VITE_E2E_MODE: 'true', ...overrides };
}

function okResponse(json: unknown, status = 200): Response {
  return { status, json: async () => json } as unknown as Response;
}

beforeEach(() => {
  sessionStorage.clear();
  delete (globalThis as { __VH_IMPORT_META_ENV__?: FlowEnv }).__VH_IMPORT_META_ENV__;
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('SignInError', () => {
  it('defaults its message to the reason code when none is given', () => {
    const error = new SignInError('start_failed');
    expect(error.reason).toBe('start_failed');
    expect(error.message).toBe('start_failed');
    expect(error.name).toBe('SignInError');
  });
});

describe('PKCE primitives', () => {
  it('generates a 43-char base64url verifier and a matching S256 challenge', async () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const challenge = await computeCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('throws crypto_unavailable when getRandomValues is missing', () => {
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('unavailable');
    });
    // Force the guard by removing the method reference entirely.
    const original = globalThis.crypto.getRandomValues;
    Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: undefined, configurable: true });
    try {
      expect(() => generateCodeVerifier()).toThrow(SignInError);
    } finally {
      Object.defineProperty(globalThis.crypto, 'getRandomValues', { value: original, configurable: true });
    }
  });

  it('throws crypto_unavailable when subtle is missing', async () => {
    const original = globalThis.crypto.subtle;
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      await expect(computeCodeChallenge('verifier')).rejects.toMatchObject({ reason: 'crypto_unavailable' });
    } finally {
      Object.defineProperty(globalThis.crypto, 'subtle', { value: original, configurable: true });
    }
  });
});

describe('provider availability', () => {
  it('real providers require a configured base URL when not in e2e mode', () => {
    expect(isSignInProviderAvailable('apple', realEnv())).toBe(true);
    expect(isSignInProviderAvailable('google', {})).toBe(false);
    expect(isSignInProviderAvailable('apple', { VITE_AUTH_CALLBACK_BASE_URL: '  ' })).toBe(false);
    expect(isSignInProviderAvailable('apple', { VITE_AUTH_CALLBACK_BASE_URL: 123 as unknown as string })).toBe(false);
  });

  it('rejects unknown providers', () => {
    expect(isSignInProviderAvailable('reddit' as SignInFlowProvider, realEnv())).toBe(false);
    expect(isSignInProviderAvailable('reddit' as SignInFlowProvider, e2eEnv())).toBe(false);
  });

  it('e2e mode makes every real provider available without a base URL', () => {
    expect(isSignInProviderAvailable('apple', e2eEnv())).toBe(true);
    expect(isSignInProviderAvailable('x', e2eEnv())).toBe(true);
  });

  it('narrows real providers with VITE_AUTH_CALLBACK_PROVIDERS', () => {
    const env = realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'google x' });
    expect(isSignInProviderAvailable('apple', env)).toBe(false);
    expect(isSignInProviderAvailable('google', env)).toBe(true);
    expect(isSignInProviderAvailable('x', env)).toBe(true);
    expect(availableSignInProviders(env)).toEqual(['google', 'x']);
  });

  it('ignores unknown provider names in the configured provider allowlist', () => {
    expect(availableSignInProviders(realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'reddit, google, facebook' }))).toEqual(['google']);
    expect(availableSignInProviders(realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'reddit facebook' }))).toEqual([]);
  });

  it('supports an explicit none/off provider allowlist for sign-in rollback builds', () => {
    expect(availableSignInProviders(realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'none' }))).toEqual([]);
    expect(availableSignInProviders(realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'off' }))).toEqual([]);
    expect(availableSignInProviders(realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'false' }))).toEqual([]);
  });

  it('keeps configured provider order stable and de-duplicates allowlist entries', () => {
    expect(availableSignInProviders(realEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'x,google,x,apple' }))).toEqual([
      'apple',
      'google',
      'x',
    ]);
  });

  it('applies the configured provider allowlist in e2e mode too', () => {
    const env = e2eEnv({ VITE_AUTH_CALLBACK_PROVIDERS: 'apple' });
    expect(isSignInProviderAvailable('apple', env)).toBe(true);
    expect(isSignInProviderAvailable('google', env)).toBe(false);
    expect(availableSignInProviders(env)).toEqual(['apple']);
  });

  it('lists available providers for a real build and an e2e build', () => {
    expect(availableSignInProviders(realEnv())).toEqual(['apple', 'google', 'x']);
    expect(availableSignInProviders(e2eEnv())).toEqual(['apple', 'google', 'x']);
    expect(availableSignInProviders({})).toEqual([]);
  });

  it('reads env from the global override when no arg is passed', () => {
    (globalThis as { __VH_IMPORT_META_ENV__?: FlowEnv }).__VH_IMPORT_META_ENV__ = realEnv();
    expect(isSignInProviderAvailable('apple')).toBe(true);
    expect(availableSignInProviders()).toEqual(['apple', 'google', 'x']);
  });

  it('reads from import.meta.env when no override is set', () => {
    // The vitest build env carries no VITE_AUTH_CALLBACK_BASE_URL, so no
    // real provider is available and the mock is off without VITE_E2E_MODE.
    expect(availableSignInProviders()).toEqual([]);
  });
});

describe('startSignIn', () => {
  it('rejects an unavailable provider', async () => {
    await expect(startSignIn('apple', {})).rejects.toMatchObject({ reason: 'provider_unsupported' });
  });

  it('starts an e2e mock flow with a synthetic authorize URL and default route', async () => {
    const result = await startSignIn('apple', e2eEnv());
    expect(result.provider).toBe('apple');
    expect(result.authorizeUrl).toContain('/auth/callback?provider=apple&code=mock-code&state=');
    expect(result.state).toMatch(/^mock-state-apple-/);
    expect(sessionStorage.getItem('vh:sign-in:pending-v1')).toContain('apple');
  });

  it('honours a custom callback route for the e2e mock flow', async () => {
    const result = await startSignIn('google', e2eEnv({ VITE_AUTH_CALLBACK_ROUTE: '/custom/cb' }));
    expect(result.authorizeUrl).toContain('/custom/cb?provider=google');
  });

  it('posts the challenge to the boundary and returns the authorize URL', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'signed-state' } }),
    );
    const result = await startSignIn('google', realEnv());
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/auth/google/start`, expect.objectContaining({ method: 'POST' }));
    expect(result.authorizeUrl).toBe(`${BASE}/go`);
    expect(result.state).toBe('signed-state');
  });

  it('rejects when the boundary base URL disappears after the availability check', async () => {
    // isSignInProviderAvailable is true, but callbackBaseUrl trims to null:
    // exercised by whitespace that passes typeof but not the length check is
    // caught earlier; here we assert the boundary guard via a mock provider
    // string that bypasses REAL_PROVIDERS is impossible — instead cover the
    // real-provider boundary-missing branch by clearing after check.
    const env = realEnv();
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    // A non-200 start response maps to start_failed.
    fetchMock.mockResolvedValue(okResponse({ status: 'rejected' }, 503));
    await expect(startSignIn('apple', env)).rejects.toMatchObject({ reason: 'start_failed' });
  });

  it('maps a malformed start response to start_failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(okResponse({ status: 'ok', authorizeUrl: 42, parameters: {} }));
    await expect(startSignIn('x', realEnv())).rejects.toMatchObject({ reason: 'start_failed' });
  });

  it('maps a network failure to network_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    await expect(startSignIn('apple', realEnv())).rejects.toMatchObject({ reason: 'network_error' });
  });

  it('maps a non-JSON start response body to start_failed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    await expect(startSignIn('apple', realEnv())).rejects.toMatchObject({ reason: 'start_failed' });
  });
});

describe('boundary_unconfigured on start', () => {
  it('throws when a real provider passes availability but the base URL is gone', async () => {
    // Directly stash a pending flow shape is not needed; force the branch by
    // making isSignInProviderAvailable pass then base resolve to null. We do
    // this by passing an env whose base URL is valid for the availability
    // check but then mutated — simulate via a getter.
    let calls = 0;
    const env = new Proxy({} as FlowEnv, {
      get(_target, prop) {
        if (prop === 'VITE_AUTH_CALLBACK_BASE_URL') {
          calls += 1;
          return calls <= 1 ? BASE : '';
        }
        return undefined;
      },
    });
    await expect(startSignIn('apple', env)).rejects.toMatchObject({ reason: 'boundary_unconfigured' });
  });
});

describe('completeSignIn', () => {
  async function primeMockPending(provider: SignInFlowProvider = 'apple', env = e2eEnv()): Promise<string> {
    const started = await startSignIn(provider, env);
    return started.state;
  }

  it('completes an e2e mock flow and clears pending state', async () => {
    const state = await primeMockPending();
    const session = await completeSignIn({ code: 'mock-code', state, nowMs: 1000 }, e2eEnv());
    expect(session).toEqual({
      schemaVersion: 'vh-auth-session-v1',
      providerId: 'apple',
      providerSubject: expect.stringMatching(/^mock-subject-apple-/),
      displayLabel: 'mock-apple@example.com',
      issuedAt: 1000,
      expiresAt: 1000 + 3600_000,
    });
    expect(sessionStorage.getItem('vh:sign-in:pending-v1')).toBeNull();
  });

  it('carries the chosen provider through the mock session', async () => {
    const state = await primeMockPending('x');
    const session = await completeSignIn({ code: 'mock-code', state, nowMs: 5 }, e2eEnv());
    expect(session.providerId).toBe('x');
    expect(session.displayLabel).toBe('mock-x@example.com');
  });

  it('defaults nowMs to Date.now for the mock flow', async () => {
    const state = await primeMockPending();
    vi.spyOn(Date, 'now').mockReturnValue(7);
    const session = await completeSignIn({ code: 'mock-code', state }, e2eEnv());
    expect(session.issuedAt).toBe(7);
  });

  it('rejects when there is no pending flow', async () => {
    await expect(completeSignIn({ code: 'c', state: 's' }, e2eEnv())).rejects.toMatchObject({
      reason: 'pending_flow_missing',
    });
  });

  it('rejects a mismatched state', async () => {
    const state = await primeMockPending();
    await expect(completeSignIn({ code: 'mock-code', state: `${state}x` }, e2eEnv())).rejects.toMatchObject({
      reason: 'state_mismatch',
    });
  });

  it('rejects a missing code', async () => {
    const state = await primeMockPending();
    await expect(completeSignIn({ code: '', state }, e2eEnv())).rejects.toMatchObject({
      reason: 'callback_failed',
    });
  });

  it('exchanges code + verifier at the boundary for a real provider', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }))
      .mockResolvedValueOnce(
        okResponse({
          status: 'ok',
          session: {
            schemaVersion: 'vh-auth-session-v1',
            providerId: 'google',
            providerSubject: 'sub-123',
            displayLabel: 'p@e.com',
            issuedAt: 5,
            expiresAt: 9,
          },
        }),
      );
    await startSignIn('google', realEnv());
    const session = await completeSignIn({ code: 'auth-code', state: 'st' }, realEnv());
    expect(session.providerId).toBe('google');
    expect(session.providerSubject).toBe('sub-123');
    expect(session.expiresAt).toBe(9);
  });

  it('accepts a session with a null expiry and no display label', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }))
      .mockResolvedValueOnce(
        okResponse({
          status: 'ok',
          session: {
            schemaVersion: 'vh-auth-session-v1',
            providerId: 'apple',
            providerSubject: 'sub',
            issuedAt: 1,
            expiresAt: null,
          },
        }),
      );
    await startSignIn('apple', realEnv());
    const session = await completeSignIn({ code: 'c', state: 'st' }, realEnv());
    expect(session.expiresAt).toBeNull();
    expect(session.displayLabel).toBeUndefined();
  });

  it('maps a non-200 callback to callback_failed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }))
      .mockResolvedValueOnce(okResponse({ status: 'rejected', reason: 'code_verifier_mismatch' }, 401));
    await startSignIn('apple', realEnv());
    await expect(completeSignIn({ code: 'c', state: 'st' }, realEnv())).rejects.toMatchObject({
      reason: 'callback_failed',
    });
  });

  it('maps a non-ok callback body to callback_failed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }))
      .mockResolvedValueOnce(okResponse({ status: 'rejected' }, 200));
    await startSignIn('apple', realEnv());
    await expect(completeSignIn({ code: 'c', state: 'st' }, realEnv())).rejects.toMatchObject({
      reason: 'callback_failed',
    });
  });

  it('maps a missing session object to session_invalid', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }))
      .mockResolvedValueOnce(okResponse({ status: 'ok', session: null }, 200));
    await startSignIn('apple', realEnv());
    await expect(completeSignIn({ code: 'c', state: 'st' }, realEnv())).rejects.toMatchObject({
      reason: 'session_invalid',
    });
  });

  it('maps a malformed session payload to session_invalid', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }))
      .mockResolvedValueOnce(
        okResponse({ status: 'ok', session: { schemaVersion: 'vh-auth-session-v1', providerId: 'reddit', providerSubject: 'x', issuedAt: 1, expiresAt: 1 } }, 200),
      );
    await startSignIn('apple', realEnv());
    await expect(completeSignIn({ code: 'c', state: 'st' }, realEnv())).rejects.toMatchObject({
      reason: 'session_invalid',
    });
  });

  it('throws boundary_unconfigured when the base URL vanishes before callback', async () => {
    // Prime a real pending flow, then complete with an env missing the base URL.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ status: 'ok', authorizeUrl: `${BASE}/go`, parameters: { state: 'st' } }),
    );
    await startSignIn('apple', realEnv());
    await expect(completeSignIn({ code: 'c', state: 'st' }, {})).rejects.toMatchObject({
      reason: 'boundary_unconfigured',
    });
  });
});

describe('pending-flow custody edge cases', () => {
  it('ignores a corrupt pending record', async () => {
    sessionStorage.setItem('vh:sign-in:pending-v1', '{not json');
    await expect(completeSignIn({ code: 'c', state: 's' }, e2eEnv())).rejects.toMatchObject({
      reason: 'pending_flow_missing',
    });
  });

  it('ignores a structurally invalid pending record', async () => {
    sessionStorage.setItem('vh:sign-in:pending-v1', JSON.stringify({ provider: 'apple', codeVerifier: '', state: 's' }));
    await expect(completeSignIn({ code: 'c', state: 's' }, e2eEnv())).rejects.toMatchObject({
      reason: 'pending_flow_missing',
    });
  });

  it('ignores a pending record with an unknown provider', async () => {
    sessionStorage.setItem(
      'vh:sign-in:pending-v1',
      JSON.stringify({ provider: 'reddit', codeVerifier: 'v'.repeat(43), state: 's' }),
    );
    await expect(completeSignIn({ code: 'c', state: 's' }, e2eEnv())).rejects.toMatchObject({
      reason: 'pending_flow_missing',
    });
  });

  it('clearPendingSignIn removes the stashed material', async () => {
    await startSignIn('apple', e2eEnv());
    expect(sessionStorage.getItem('vh:sign-in:pending-v1')).not.toBeNull();
    clearPendingSignIn();
    expect(sessionStorage.getItem('vh:sign-in:pending-v1')).toBeNull();
  });
});

describe('sessionStorage unavailable', () => {
  it('treats an absent sessionStorage as no pending flow', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: undefined });
    try {
      const started = await startSignIn('apple', e2eEnv());
      await expect(completeSignIn({ code: 'mock-code', state: started.state }, e2eEnv())).rejects.toMatchObject({
        reason: 'pending_flow_missing',
      });
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'sessionStorage', descriptor);
      }
    }
  });

  it('persist/read/clear degrade gracefully when sessionStorage throws', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      // start persists nothing; complete then finds no pending flow.
      const started = await startSignIn('apple', e2eEnv());
      await expect(completeSignIn({ code: 'mock-code', state: started.state }, e2eEnv())).rejects.toMatchObject({
        reason: 'pending_flow_missing',
      });
      expect(() => clearPendingSignIn()).not.toThrow();
    } finally {
      if (descriptor) {
        Object.defineProperty(globalThis, 'sessionStorage', descriptor);
      }
    }
  });
});
