/* @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConstituencyProof } from '@vh/types';

const useIdentityMock = vi.hoisted(() => vi.fn());
const getConfiguredDistrictMock = vi.hoisted(() => vi.fn());
const getProofSyncMock = vi.hoisted(() => vi.fn());

vi.mock('./useIdentity', () => ({
  useIdentity: () => useIdentityMock(),
}));

vi.mock('../store/bridge/districtConfig', () => ({
  getConfiguredDistrict: () => getConfiguredDistrictMock(),
}));

vi.mock('@vh/luma-sdk', () => ({
  betaLocalConstituencyProvider: {
    getProofSync: (...args: unknown[]) => getProofSyncMock(...args)
  }
}));

import { useRegion } from './useRegion';

describe('useRegion', () => {
  beforeEach(() => {
    useIdentityMock.mockReset();
    getConfiguredDistrictMock.mockReset();
    getProofSyncMock.mockReset();

    getConfiguredDistrictMock.mockReturnValue('season0-default-district');

    getProofSyncMock.mockImplementation(
      ({ nullifier, districtHash }: { nullifier: string; districtHash: string }): ConstituencyProof => ({
        district_hash: districtHash,
        nullifier,
        merkle_root: 's0-root-abcd1234',
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
    expect(getProofSyncMock).not.toHaveBeenCalled();
  });

  it('returns real proof when nullifier is available', () => {
    const expectedProof: ConstituencyProof = {
      district_hash: 'season0-default-district',
      nullifier: 'session-nullifier-1',
      merkle_root: 's0-root-abcd1234',
    };

    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'session-nullifier-1' } },
    });
    getProofSyncMock.mockReturnValue(expectedProof);

    const { result } = renderHook(() => useRegion());

    expect(getConfiguredDistrictMock).toHaveBeenCalledTimes(1);
    expect(getProofSyncMock).toHaveBeenCalledWith({
      nullifier: 'session-nullifier-1',
      districtHash: 'season0-default-district',
    });
    expect(result.current.proof).toEqual(expectedProof);
  });

  it('always calls the SDK beta-local provider with configured district', () => {
    getConfiguredDistrictMock.mockReturnValue('district-xyz');
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'nullifier-abc' } },
    });

    renderHook(() => useRegion());

    expect(getProofSyncMock).toHaveBeenCalledWith({
      nullifier: 'nullifier-abc',
      districtHash: 'district-xyz',
    });
    expect(getProofSyncMock).toHaveBeenCalledTimes(1);
  });
});
