/* @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConstituencyProof } from '@vh/types';

const useIdentityMock = vi.hoisted(() => vi.fn());
const isProofVerificationEnabledMock = vi.hoisted(() => vi.fn());
const getTransitionalConstituencyProofMock = vi.hoisted(() => vi.fn());

vi.mock('./useIdentity', () => ({
  useIdentity: () => useIdentityMock(),
}));

vi.mock('../store/bridge/constituencyProof', () => ({
  isProofVerificationEnabled: () => isProofVerificationEnabledMock(),
}));

vi.mock('../store/bridge/transitionalConstituencyProof', () => ({
  getTransitionalConstituencyProof: (...args: unknown[]) =>
    getTransitionalConstituencyProofMock(...(args as [string])),
}));

import { useRegion } from './useRegion';

describe('useRegion', () => {
  beforeEach(() => {
    useIdentityMock.mockReset();
    isProofVerificationEnabledMock.mockReset();
    getTransitionalConstituencyProofMock.mockReset();

    isProofVerificationEnabledMock.mockReturnValue(false);
    getTransitionalConstituencyProofMock.mockImplementation(
      (nullifier: string): ConstituencyProof => ({
        district_hash: 't9n-district-a',
        nullifier,
        merkle_root: 't9n-root-a',
      }),
    );
  });

  it.each([
    { identity: null },
    { identity: {} },
    { identity: { session: {} } },
  ])('returns null proof when nullifier is unavailable (%j)', ({ identity }) => {
    useIdentityMock.mockReturnValue({ identity });

    const { result } = renderHook(() => useRegion());

    expect(result.current.proof).toBeNull();
    expect(getTransitionalConstituencyProofMock).not.toHaveBeenCalled();
  });

  it('returns null when production proof verification is enabled', () => {
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'session-nullifier-1' } },
    });
    isProofVerificationEnabledMock.mockReturnValue(true);

    const { result } = renderHook(() => useRegion());

    expect(result.current.proof).toBeNull();
    expect(getTransitionalConstituencyProofMock).not.toHaveBeenCalled();
  });

  it('uses transitional proof builder with identity session nullifier', () => {
    const expectedProof: ConstituencyProof = {
      district_hash: 't9n-district-x',
      nullifier: 'session-nullifier-1',
      merkle_root: 't9n-root-x',
    };

    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'session-nullifier-1' } },
    });
    getTransitionalConstituencyProofMock.mockReturnValue(expectedProof);

    const { result } = renderHook(() => useRegion());

    expect(getTransitionalConstituencyProofMock).toHaveBeenCalledWith('session-nullifier-1');
    expect(result.current.proof).toEqual(expectedProof);
  });
});
