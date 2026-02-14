import { describe, expect, it, beforeEach } from 'vitest';
import {
  getDirectory,
  loadDirectory,
  isNewerVersion,
  findRepresentatives,
  findRepresentativesByState,
  _resetDirectoryForTesting,
} from './representativeDirectory';
import type { Representative } from '@vh/data-model';

const rep1: Representative = {
  id: 'us-house-ca-11',
  name: 'Jane Doe',
  title: 'Representative',
  office: 'house',
  country: 'US',
  state: 'CA',
  district: '11',
  districtHash: 'hash-ca-11',
  contactMethod: 'email',
  email: 'jane@house.gov',
  lastVerified: 1_700_000_000_000,
};

const rep2: Representative = {
  id: 'us-senate-ca',
  name: 'John Smith',
  title: 'Senator',
  office: 'senate',
  country: 'US',
  state: 'CA',
  districtHash: 'hash-ca-senate',
  contactMethod: 'both',
  email: 'john@senate.gov',
  phone: '+12025559876',
  lastVerified: 1_700_000_000_000,
};

const validDirectory = {
  version: '1.0.0',
  lastUpdated: 1_700_000_000_000,
  updateSource: 'test-bundle',
  representatives: [rep1, rep2],
  byState: { CA: ['us-house-ca-11', 'us-senate-ca'] },
  byDistrictHash: {
    'hash-ca-11': ['us-house-ca-11'],
    'hash-ca-senate': ['us-senate-ca'],
  },
};

beforeEach(() => {
  _resetDirectoryForTesting();
});

describe('getDirectory', () => {
  it('returns empty scaffold by default', () => {
    const dir = getDirectory();
    expect(dir.version).toBe('0.0.0');
    expect(dir.representatives).toEqual([]);
    expect(dir.byState).toEqual({});
    expect(dir.byDistrictHash).toEqual({});
  });
});

describe('loadDirectory', () => {
  it('loads a valid directory', () => {
    const ok = loadDirectory(validDirectory);
    expect(ok).toBe(true);
    expect(getDirectory().version).toBe('1.0.0');
    expect(getDirectory().representatives).toHaveLength(2);
  });

  it('rejects invalid directory data', () => {
    const ok = loadDirectory({ version: 123 });
    expect(ok).toBe(false);
    expect(getDirectory().version).toBe('0.0.0');
  });

  it('rejects null', () => {
    expect(loadDirectory(null)).toBe(false);
  });

  it('rejects directory with invalid representative', () => {
    const bad = { ...validDirectory, representatives: [{ id: 'bad' }] };
    expect(loadDirectory(bad)).toBe(false);
  });

  it('rejects directory with extra fields (.strict)', () => {
    const extra = { ...validDirectory, extraField: true };
    expect(loadDirectory(extra)).toBe(false);
  });
});

describe('isNewerVersion', () => {
  it('returns true when remote is newer', () => {
    expect(isNewerVersion('1.0.0')).toBe(true);
  });

  it('returns false when remote is same', () => {
    expect(isNewerVersion('0.0.0')).toBe(false);
  });

  it('compares with loaded version', () => {
    loadDirectory(validDirectory);
    expect(isNewerVersion('0.9.0')).toBe(false);
    expect(isNewerVersion('2.0.0')).toBe(true);
  });
});

describe('findRepresentatives', () => {
  beforeEach(() => {
    loadDirectory(validDirectory);
  });

  it('finds representatives by district hash', () => {
    const reps = findRepresentatives('hash-ca-11');
    expect(reps).toHaveLength(1);
    expect(reps[0].id).toBe('us-house-ca-11');
  });

  it('returns empty array for unknown district hash', () => {
    expect(findRepresentatives('nonexistent')).toEqual([]);
  });

  it('returns empty array on empty directory', () => {
    _resetDirectoryForTesting();
    expect(findRepresentatives('hash-ca-11')).toEqual([]);
  });

  it('handles dangling ID reference gracefully', () => {
    const withDangling = {
      ...validDirectory,
      byDistrictHash: { 'hash-ca-11': ['nonexistent-id'] },
    };
    loadDirectory(withDangling);
    expect(findRepresentatives('hash-ca-11')).toEqual([]);
  });
});

describe('findRepresentativesByState', () => {
  beforeEach(() => {
    loadDirectory(validDirectory);
  });

  it('finds representatives by state', () => {
    const reps = findRepresentativesByState('CA');
    expect(reps).toHaveLength(2);
  });

  it('returns empty array for unknown state', () => {
    expect(findRepresentativesByState('TX')).toEqual([]);
  });
});
