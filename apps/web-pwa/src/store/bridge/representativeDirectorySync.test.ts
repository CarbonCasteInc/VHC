import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepresentativeDirectory } from '@vh/data-model';

const readCivicRepresentativeSnapshotMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  readCivicRepresentativeSnapshot: (...args: unknown[]) =>
    readCivicRepresentativeSnapshotMock(...args),
}));

import { syncRepresentativeDirectory } from './representativeDirectorySync';
import {
  _resetDirectoryForTesting,
  getDirectory,
  loadDirectory,
} from './representativeDirectory';

const FAKE_CLIENT = {} as never;

function directory(version: string, repId: string): RepresentativeDirectory {
  return {
    version,
    lastUpdated: 1,
    updateSource: 'test',
    representatives: [
      {
        id: repId,
        name: 'Rep',
        title: 'Representative',
        office: 'house',
        country: 'US',
        districtHash: 'district-1',
        contactMethod: 'email',
        email: 'rep@example.test',
        lastVerified: 1,
      },
    ],
    byState: {},
    byDistrictHash: { 'district-1': [repId] },
  };
}

beforeEach(() => {
  readCivicRepresentativeSnapshotMock.mockReset();
  _resetDirectoryForTesting();
});

afterEach(() => {
  _resetDirectoryForTesting();
});

describe('syncRepresentativeDirectory', () => {
  it('loads a newer validated snapshot into the local store', async () => {
    readCivicRepresentativeSnapshotMock.mockResolvedValue(directory('1.0.0', 'rep-new'));

    const result = await syncRepresentativeDirectory(FAKE_CLIENT, 'jurisdiction-v1');

    expect(result.loaded).toBe(true);
    expect(getDirectory().version).toBe('1.0.0');
    expect(getDirectory().representatives[0]?.id).toBe('rep-new');
  });

  it('leaves the local directory unchanged when the adapter returns null (validation failed)', async () => {
    // Seed a known-good local directory first.
    expect(loadDirectory(directory('2.0.0', 'rep-known-good'))).toBe(true);
    readCivicRepresentativeSnapshotMock.mockResolvedValue(null);

    const result = await syncRepresentativeDirectory(FAKE_CLIENT, 'jurisdiction-v1');

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('validation-failed');
    // The known-good local directory is preserved.
    expect(getDirectory().version).toBe('2.0.0');
    expect(getDirectory().representatives[0]?.id).toBe('rep-known-good');
  });

  it('leaves the local directory unchanged when the adapter throws', async () => {
    expect(loadDirectory(directory('2.0.0', 'rep-known-good'))).toBe(true);
    readCivicRepresentativeSnapshotMock.mockRejectedValue(new Error('read failed'));

    const result = await syncRepresentativeDirectory(FAKE_CLIENT, 'jurisdiction-v1');

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('validation-failed');
    expect(getDirectory().version).toBe('2.0.0');
  });

  it('does nothing without a client', async () => {
    const result = await syncRepresentativeDirectory(null, 'jurisdiction-v1');
    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('no-client');
    expect(readCivicRepresentativeSnapshotMock).not.toHaveBeenCalled();
  });

  it('does not reload a non-newer snapshot', async () => {
    expect(loadDirectory(directory('3.0.0', 'rep-current'))).toBe(true);
    readCivicRepresentativeSnapshotMock.mockResolvedValue(directory('3.0.0', 'rep-current'));

    const result = await syncRepresentativeDirectory(FAKE_CLIENT, 'jurisdiction-v1');

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('not-newer');
  });
});
