import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindSignInSession } from './signInBinding';
import type { SignInSessionPayload } from './signInFlow';
import { clearSignInAccounts, getSignInAccount } from '../store/signInAccount';

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));

vi.mock('@vh/identity-vault', () => ({
  signInSession: {
    save: (...args: unknown[]) => saveMock(...(args as [])),
  },
}));

function session(overrides: Partial<SignInSessionPayload> = {}): SignInSessionPayload {
  return {
    schemaVersion: 'vh-auth-session-v1',
    providerId: 'apple',
    providerSubject: 'sub-123',
    displayLabel: 'a@b.com',
    issuedAt: 1000,
    expiresAt: 5000,
    ...overrides,
  };
}

afterEach(() => {
  clearSignInAccounts();
  saveMock.mockReset();
});

describe('bindSignInSession', () => {
  it('writes session material to the vault and records non-secret account metadata', async () => {
    saveMock.mockResolvedValue(undefined);
    const result = await bindSignInSession(session(), 'principal-1', 2000);

    expect(saveMock).toHaveBeenCalledWith({
      providerId: 'apple',
      providerSubject: 'sub-123',
      displayLabel: 'a@b.com',
      expiresAt: 5000,
      boundPrincipalNullifier: 'principal-1',
      now: 2000,
    });
    expect(result.boundPrincipalNullifier).toBe('principal-1');
    expect(result.account.providerId).toBe('apple');
    expect(result.account.status).toBe('signed-in');
    expect(getSignInAccount('apple')?.displayLabel).toBe('a@b.com');
  });

  it('omits optional fields when absent and defaults now to Date.now', async () => {
    saveMock.mockResolvedValue(undefined);
    vi.spyOn(Date, 'now').mockReturnValue(4242);
    await bindSignInSession(session({ displayLabel: undefined, expiresAt: null }), 'principal-2');

    expect(saveMock).toHaveBeenCalledWith({
      providerId: 'apple',
      providerSubject: 'sub-123',
      boundPrincipalNullifier: 'principal-2',
      now: 4242,
    });
    expect(getSignInAccount('apple')?.displayLabel).toBeUndefined();
  });

  it('throws without a principal nullifier and writes no binding', async () => {
    await expect(bindSignInSession(session(), '')).rejects.toThrow('active principal nullifier');
    expect(saveMock).not.toHaveBeenCalled();
    expect(getSignInAccount('apple')).toBeUndefined();
  });

  it('throws when the principal nullifier is not a string', async () => {
    await expect(
      bindSignInSession(session(), undefined as unknown as string),
    ).rejects.toThrow('active principal nullifier');
  });

  it('throws when the account record fails validation', async () => {
    saveMock.mockResolvedValue(undefined);
    await expect(
      bindSignInSession(session({ providerId: 'reddit' as unknown as 'apple' }), 'principal-3'),
    ).rejects.toThrow('account record failed validation');
  });
});
