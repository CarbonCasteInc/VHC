/* @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFamiliar } from '../../hooks/useFamiliar';
import { clearPublishedIdentity, publishIdentity } from '../identityProvider';
import { useDelegationStore } from './index';

const BASE_TIME = 1_700_000_100_000;

function publishPrincipal(nullifier = 'principal-1') {
  publishIdentity({
    session: {
      nullifier,
      trustScore: 0.95,
      scaledTrustScore: 9500
    }
  });
}

describe('useFamiliar', () => {
  beforeEach(() => {
    localStorage.clear();
    clearPublishedIdentity();
    useDelegationStore.getState().setActivePrincipal(null);
    vi.restoreAllMocks();
  });

  it('hydrates from identity event and sorts familiars + grants by timestamp', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { result, unmount } = renderHook(() => useFamiliar());

    expect(result.current.principalNullifier).toBeNull();
    expect(addSpy).toHaveBeenCalledWith('vh:identity-published', expect.any(Function));

    publishPrincipal('principal-1');
    act(() => {
      window.dispatchEvent(new CustomEvent('vh:identity-published'));
    });

    act(() => {
      result.current.registerFamiliar({ id: 'b', label: 'B', createdAt: BASE_TIME + 2, capabilityPreset: 'act' });
      result.current.registerFamiliar({ id: 'a', label: 'A', createdAt: BASE_TIME + 1, capabilityPreset: 'suggest' });
      result.current.createGrant({
        grantId: 'g2',
        familiarId: 'a',
        scopes: ['draft'],
        issuedAt: BASE_TIME + 3,
        expiresAt: BASE_TIME + 30,
        signature: 'sig-2'
      });
      result.current.createGrant({
        grantId: 'g1',
        familiarId: 'a',
        scopes: ['draft'],
        issuedAt: BASE_TIME + 2,
        expiresAt: BASE_TIME + 20,
        signature: 'sig-1'
      });
    });

    expect(result.current.activePrincipal).toBe('principal-1');
    expect(result.current.familiars.map((f) => f.id)).toEqual(['a', 'b']);
    expect(result.current.grants.map((g) => g.grantId)).toEqual(['g1', 'g2']);

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('vh:identity-published', expect.any(Function));
  });

  it('supports explicit principal override (including null)', () => {
    publishPrincipal('published-principal');
    const { result, rerender } = renderHook(
      ({ principal }: { principal?: string | null }) => useFamiliar(principal),
      { initialProps: { principal: 'override-principal' } }
    );

    expect(result.current.principalNullifier).toBe('override-principal');

    rerender({ principal: null });
    expect(result.current.principalNullifier).toBeNull();

    rerender({ principal: undefined });
    expect(result.current.principalNullifier).toBe('published-principal');
  });

  it('creates grants with generated defaults and fallback random id path', () => {
    publishPrincipal('principal-1');
    const originalCrypto = globalThis.crypto;

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID: () => 'abc' }
    });

    const { result } = renderHook(() => useFamiliar());

    act(() => {
      window.dispatchEvent(new CustomEvent('vh:identity-published'));
      result.current.registerFamiliar({
        id: 'fam-1',
        label: 'Fam',
        createdAt: BASE_TIME,
        capabilityPreset: 'suggest'
      });
    });

    let grantId = '';
    act(() => {
      const grant = result.current.createGrant({
        familiarId: 'fam-1',
        scopes: ['draft'],
        issuedAt: BASE_TIME + 1,
        expiresAt: BASE_TIME + 20
      });
      grantId = grant.grantId;
      expect(grant.signature).toContain('local-signature');
    });
    expect(grantId).toBe('grant-abc');

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined
    });

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(BASE_TIME + 2);
    act(() => {
      const grant = result.current.createGrant({
        familiarId: 'fam-1',
        scopes: ['draft'],
        expiresAt: BASE_TIME + 22
      });
      expect(grant.grantId).toMatch(/^grant-\d+-/);
      expect(grant.issuedAt).toBe(BASE_TIME + 2);
    });
    nowSpy.mockRestore();

    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto
    });
  });

  it('throws when creating grant without an active principal', () => {
    const { result } = renderHook(() => useFamiliar(null));

    expect(() =>
      result.current.createGrant({
        familiarId: 'fam-1',
        scopes: ['draft'],
        issuedAt: BASE_TIME,
        expiresAt: BASE_TIME + 10
      })
    ).toThrow('No active principal available for delegation grant creation');
  });

  it('throws when implicit principal resolution has no published identity', () => {
    const { result } = renderHook(() => useFamiliar());

    expect(() =>
      result.current.createGrant({
        familiarId: 'fam-1',
        scopes: ['draft'],
        issuedAt: BASE_TIME,
        expiresAt: BASE_TIME + 10
      })
    ).toThrow();
  });

  it('creates assertions and surfaces grant/status helpers', () => {
    publishPrincipal('principal-1');
    const { result } = renderHook(() => useFamiliar());

    act(() => {
      window.dispatchEvent(new CustomEvent('vh:identity-published'));
      result.current.registerFamiliar({ id: 'fam-1', label: 'Fam', createdAt: BASE_TIME, capabilityPreset: 'suggest' });
      result.current.createGrant({
        grantId: 'grant-1',
        familiarId: 'fam-1',
        scopes: ['draft'],
        issuedAt: BASE_TIME,
        expiresAt: BASE_TIME + 10,
        signature: 'sig-1'
      });
    });

    expect(() => result.current.createAssertion('')).toThrow('grantId must be a non-empty string');
    expect(() => result.current.createAssertion('missing')).toThrow('Grant "missing" not found');

    const assertion = result.current.createAssertion('grant-1', BASE_TIME + 1, 'assert-sig');
    expect(assertion).toEqual({
      principalNullifier: 'principal-1',
      familiarId: 'fam-1',
      grantId: 'grant-1',
      issuedAt: BASE_TIME + 1,
      signature: 'assert-sig'
    });

    const defaultSignatureAssertion = result.current.createAssertion('grant-1', BASE_TIME + 2);
    expect(defaultSignatureAssertion.signature).toBe('local-assertion:grant-1:1700000100002');

    const allowed = result.current.canPerform({
      grantId: 'grant-1',
      requiredScope: 'draft',
      now: BASE_TIME + 1
    });
    expect(allowed).toEqual({ allowed: true });

    expect(result.current.getGrantStatus('grant-1', BASE_TIME + 1)).toBe('active');

    act(() => {
      result.current.revokeGrant('grant-1', BASE_TIME + 2);
      result.current.revokeFamiliar('fam-1', BASE_TIME + 3);
    });

    expect(result.current.getGrantStatus('grant-1', BASE_TIME + 2)).toBe('revoked');
  });

  it('exposes reset passthrough', () => {
    publishPrincipal('principal-1');
    const { result } = renderHook(() => useFamiliar());

    act(() => {
      window.dispatchEvent(new CustomEvent('vh:identity-published'));
      result.current.registerFamiliar({ id: 'fam-1', label: 'Fam', createdAt: BASE_TIME, capabilityPreset: 'suggest' });
    });

    expect(result.current.familiars).toHaveLength(1);

    act(() => {
      useDelegationStore.setState((state) => ({ ...state, familiarsById: {} }));
    });

    expect(result.current.familiars).toHaveLength(0);

    act(() => {
      result.current.reset();
    });

    expect(result.current.familiars).toHaveLength(1);
  });
});
