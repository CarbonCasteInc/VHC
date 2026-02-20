/* @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConstituencyProof } from '@vh/types';

const useIdentityMock = vi.hoisted(() => vi.fn());
const getConfiguredDistrictMock = vi.hoisted(() => vi.fn());
const getRealConstituencyProofMock = vi.hoisted(() => vi.fn());

vi.mock('./useIdentity', () => ({
  useIdentity: () => useIdentityMock(),
}));

vi.mock('../store/bridge/districtConfig', () => ({
  getConfiguredDistrict: () => getConfiguredDistrictMock(),
}));

vi.mock('../store/bridge/realConstituencyProof', () => ({
  getRealConstituencyProof: (...args: unknown[]) =>
    getRealConstituencyProofMock(...(args as [string, string])),
}));

import { useRegion } from './useRegion';

describe('useRegion', () => {
  beforeEach(() => {
    useIdentityMock.mockReset();
    getConfiguredDistrictMock.mockReset();
    getRealConstituencyProofMock.mockReset();

    getConfiguredDistrictMock.mockReturnValue('season0-default-district');

    getRealConstituencyProofMock.mockImplementation(
      (nullifier: string, districtHash: string): ConstituencyProof => ({
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
    expect(getRealConstituencyProofMock).not.toHaveBeenCalled();
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
    getRealConstituencyProofMock.mockReturnValue(expectedProof);

    const { result } = renderHook(() => useRegion());

    expect(getConfiguredDistrictMock).toHaveBeenCalledTimes(1);
    expect(getRealConstituencyProofMock).toHaveBeenCalledWith(
      'session-nullifier-1',
      'season0-default-district',
    );
    expect(result.current.proof).toEqual(expectedProof);
  });

  it('always calls getRealConstituencyProof with configured district', () => {
    getConfiguredDistrictMock.mockReturnValue('district-xyz');
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'nullifier-abc' } },
    });

    renderHook(() => useRegion());

    expect(getRealConstituencyProofMock).toHaveBeenCalledWith('nullifier-abc', 'district-xyz');
    expect(getRealConstituencyProofMock).toHaveBeenCalledTimes(1);
  });
});
