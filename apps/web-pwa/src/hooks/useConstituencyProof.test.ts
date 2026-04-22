/* @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConstituencyProof } from '@vh/types';

const useIdentityMock = vi.hoisted(() => vi.fn());
const useRegionMock = vi.hoisted(() => vi.fn());
const isProofVerificationEnabledMock = vi.hoisted(() => vi.fn());
const getConfiguredDistrictMock = vi.hoisted(() => vi.fn());

vi.mock('./useIdentity', () => ({
  useIdentity: () => useIdentityMock(),
}));

vi.mock('./useRegion', () => ({
  useRegion: () => useRegionMock(),
}));

vi.mock('../store/bridge/constituencyProof', () => ({
  isProofVerificationEnabled: () => isProofVerificationEnabledMock(),
}));

vi.mock('../store/bridge/districtConfig', () => ({
  getConfiguredDistrict: () => getConfiguredDistrictMock(),
}));

import { useConstituencyProof } from './useConstituencyProof';

describe('useConstituencyProof', () => {
  beforeEach(() => {
    useIdentityMock.mockReset();
    useRegionMock.mockReset();
    isProofVerificationEnabledMock.mockReset();
    getConfiguredDistrictMock.mockReset();

    isProofVerificationEnabledMock.mockReturnValue(false);
    getConfiguredDistrictMock.mockReturnValue('district-expected');
  });

  it('returns explicit error when identity nullifier is missing', () => {
    useIdentityMock.mockReturnValue({ identity: null });
    useRegionMock.mockReturnValue({ proof: null });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/create or sign in to save your stance/i);
    expect(result.current.assurance).toBe('none');
    expect(result.current.canClaimVerifiedHuman).toBe(false);
    expect(result.current.canClaimDistrictProof).toBe(false);
    expect(result.current.canClaimSybilResistance).toBe(false);
  });

  it('returns explicit error when region proof is missing', () => {
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof: null });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/beta-local identity proof unavailable/i);
    expect(result.current.assurance).toBe('none');
  });

  it('returns explicit error when proof nullifier mismatches identity', () => {
    const proof: ConstituencyProof = {
      district_hash: 'district-1',
      nullifier: 'null-2',
      merkle_root: 'root-1',
    };

    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/invalid beta-local proof: nullifier_mismatch/i);
    expect(result.current.assurance).toBe('none');
  });

  it('returns explicit error when proof is stale', () => {
    const proof: ConstituencyProof = {
      district_hash: 'district-1',
      nullifier: 'null-1',
      merkle_root: '   ',
    };

    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/invalid beta-local proof: stale_proof/i);
    expect(result.current.assurance).toBe('none');
  });

  it('hard-stops when proof source is mock-backed', () => {
    const proof: ConstituencyProof = {
      district_hash: 'mock-district-hash',
      nullifier: 'null-1',
      merkle_root: 'mock-root',
    };

    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/mock proof detected/i);
    expect(result.current.assurance).toBe('none');
  });

  it('rejects transitional proof when real mode is enabled', () => {
    const proof: ConstituencyProof = {
      district_hash: 't9n-district-1',
      nullifier: 'null-1',
      merkle_root: 't9n-root-1',
    };

    isProofVerificationEnabledMock.mockReturnValue(true);
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/transitional proof rejected/i);
    expect(result.current.assurance).toBe('none');
  });

  it('validates real mode against configured district (not proof district self-reference)', () => {
    const proof: ConstituencyProof = {
      district_hash: 'district-other',
      nullifier: 'null-1',
      merkle_root: 's0-root-1',
    };

    isProofVerificationEnabledMock.mockReturnValue(true);
    getConfiguredDistrictMock.mockReturnValue('district-expected');
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/invalid beta-local proof: district_mismatch/i);
    expect(result.current.assurance).toBe('none');
  });

  it('accepts strict-mode proof as beta-local when configured district matches', () => {
    const proof: ConstituencyProof = {
      district_hash: 'district-expected',
      nullifier: 'null-1',
      merkle_root: 's0-root-1',
    };

    isProofVerificationEnabledMock.mockReturnValue(true);
    getConfiguredDistrictMock.mockReturnValue('district-expected');
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.error).toBeNull();
    expect(result.current.proof).toEqual(proof);
    expect(result.current.assurance).toBe('beta_local');
    expect(result.current.canClaimVerifiedHuman).toBe(false);
    expect(result.current.canClaimDistrictProof).toBe(false);
    expect(result.current.canClaimSybilResistance).toBe(false);
  });

  it('accepts transitional proof as beta-local when strict mode is disabled', () => {
    const proof: ConstituencyProof = {
      district_hash: 't9n-district-1',
      nullifier: 'null-1',
      merkle_root: 't9n-root-1',
    };

    isProofVerificationEnabledMock.mockReturnValue(false);
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.error).toBeNull();
    expect(result.current.proof).toEqual(proof);
    expect(result.current.assurance).toBe('beta_local');
    expect(result.current.canClaimVerifiedHuman).toBe(false);
  });

  it('returns beta-local proof when identity and region proof align', () => {
    const proof: ConstituencyProof = {
      district_hash: 'district-1',
      nullifier: 'null-1',
      merkle_root: 'root-1',
    };

    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.error).toBeNull();
    expect(result.current.proof).toEqual(proof);
    expect(result.current.assurance).toBe('beta_local');
    expect(result.current.canClaimVerifiedHuman).toBe(false);
  });
});
