/* @vitest-environment jsdom */

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConstituencyProof } from '@vh/types';

const useIdentityMock = vi.hoisted(() => vi.fn());
const useRegionMock = vi.hoisted(() => vi.fn());

vi.mock('./useIdentity', () => ({
  useIdentity: () => useIdentityMock(),
}));

vi.mock('./useRegion', () => ({
  useRegion: () => useRegionMock(),
}));

import { useConstituencyProof } from './useConstituencyProof';

describe('useConstituencyProof', () => {
  beforeEach(() => {
    useIdentityMock.mockReset();
    useRegionMock.mockReset();
  });

  it('returns explicit error when identity nullifier is missing', () => {
    useIdentityMock.mockReturnValue({ identity: null });
    useRegionMock.mockReturnValue({ proof: null });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/nullifier unavailable/i);
  });

  it('returns explicit error when region proof is missing', () => {
    useIdentityMock.mockReturnValue({
      identity: { session: { nullifier: 'null-1' } },
    });
    useRegionMock.mockReturnValue({ proof: null });

    const { result } = renderHook(() => useConstituencyProof());

    expect(result.current.proof).toBeNull();
    expect(result.current.error).toMatch(/proof unavailable/i);
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
    expect(result.current.error).toMatch(/nullifier_mismatch/i);
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
    expect(result.current.error).toMatch(/stale_proof/i);
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
    expect(result.current.error).toMatch(/mock constituency proof/i);
  });

  it('returns verified proof when identity and region proof align', () => {
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
  });
});
