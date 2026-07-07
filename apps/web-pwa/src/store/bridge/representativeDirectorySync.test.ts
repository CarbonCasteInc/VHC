/* @vitest-environment jsdom */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import type { RepresentativeDirectory } from '@vh/data-model';

const readCivicRepresentativeSnapshotMock = vi.hoisted(() => vi.fn());
const resolveClientFromAppStoreMock = vi.hoisted(() => vi.fn());

vi.mock('@vh/gun-client', () => ({
  readCivicRepresentativeSnapshot: (...args: unknown[]) =>
    readCivicRepresentativeSnapshotMock(...args),
}));

vi.mock('../clientResolver', () => ({
  resolveClientFromAppStore: () => resolveClientFromAppStoreMock(),
}));

import {
  getConfiguredJurisdictionVersion,
  syncRepresentativeDirectory,
  useRepresentativeDirectorySync,
} from './representativeDirectorySync';
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
  resolveClientFromAppStoreMock.mockReset();
  resolveClientFromAppStoreMock.mockReturnValue(FAKE_CLIENT);
  _resetDirectoryForTesting();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  _resetDirectoryForTesting();
});

describe('getConfiguredJurisdictionVersion', () => {
  it('returns the env value when VITE_CIVIC_REPS_JURISDICTION_VERSION is set', () => {
    vi.stubEnv('VITE_CIVIC_REPS_JURISDICTION_VERSION', 'jurisdiction-2027');
    expect(getConfiguredJurisdictionVersion()).toBe('jurisdiction-2027');
  });

  it('trims a padded env value', () => {
    vi.stubEnv('VITE_CIVIC_REPS_JURISDICTION_VERSION', '  jurisdiction-trim  ');
    expect(getConfiguredJurisdictionVersion()).toBe('jurisdiction-trim');
  });

  it('returns the season-0 default when the env value is unset', () => {
    expect(getConfiguredJurisdictionVersion()).toBe('season0-default-v1');
  });

  it('returns the season-0 default when the env value is blank', () => {
    vi.stubEnv('VITE_CIVIC_REPS_JURISDICTION_VERSION', '   ');
    expect(getConfiguredJurisdictionVersion()).toBe('season0-default-v1');
  });
});

describe('syncRepresentativeDirectory', () => {
  it('defaults the jurisdiction version from the configured env value', async () => {
    vi.stubEnv('VITE_CIVIC_REPS_JURISDICTION_VERSION', 'jurisdiction-default');
    readCivicRepresentativeSnapshotMock.mockResolvedValue(directory('1.0.0', 'rep-new'));

    await syncRepresentativeDirectory(FAKE_CLIENT);

    expect(readCivicRepresentativeSnapshotMock).toHaveBeenCalledWith(
      FAKE_CLIENT,
      'jurisdiction-default',
    );
  });

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

  it('reports load-rejected when a newer snapshot fails schema validation', async () => {
    expect(loadDirectory(directory('2.0.0', 'rep-known-good'))).toBe(true);
    // Newer version string, but a malformed shape that loadDirectory rejects.
    readCivicRepresentativeSnapshotMock.mockResolvedValue({
      version: '9.0.0',
      lastUpdated: 1,
      updateSource: 'test',
      representatives: [],
      byState: {},
      // byDistrictHash intentionally omitted -> RepresentativeDirectorySchema fails.
    } as unknown as RepresentativeDirectory);

    const result = await syncRepresentativeDirectory(FAKE_CLIENT, 'jurisdiction-v1');

    expect(result.loaded).toBe(false);
    expect(result.reason).toBe('load-rejected');
    // The known-good local directory is preserved.
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

function SyncHarness(): React.ReactElement {
  useRepresentativeDirectorySync();
  return React.createElement('div', { 'data-testid': 'sync-harness' });
}

describe('useRepresentativeDirectorySync', () => {
  it('syncs the directory once on mount using the resolved client', async () => {
    readCivicRepresentativeSnapshotMock.mockResolvedValue(directory('1.0.0', 'rep-mounted'));

    render(React.createElement(SyncHarness));

    await waitFor(() => {
      expect(readCivicRepresentativeSnapshotMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(getDirectory().version).toBe('1.0.0');
    });
  });

  it('swallows sync errors and leaves the local directory unchanged', async () => {
    expect(loadDirectory(directory('5.0.0', 'rep-known-good'))).toBe(true);
    readCivicRepresentativeSnapshotMock.mockRejectedValue(new Error('mount read failed'));

    render(React.createElement(SyncHarness));

    await waitFor(() => {
      expect(readCivicRepresentativeSnapshotMock).toHaveBeenCalled();
    });
    expect(getDirectory().version).toBe('5.0.0');
  });

  it('does not sync when no client resolves on mount', async () => {
    resolveClientFromAppStoreMock.mockReturnValue(null);

    render(React.createElement(SyncHarness));

    // Give the mount effect a chance to run; the sync short-circuits on no-client.
    await Promise.resolve();
    await Promise.resolve();
    expect(readCivicRepresentativeSnapshotMock).not.toHaveBeenCalled();
  });

  it('swallows a throw from client resolution (fail-closed catch)', async () => {
    expect(loadDirectory(directory('6.0.0', 'rep-known-good'))).toBe(true);
    resolveClientFromAppStoreMock.mockImplementation(() => {
      throw new Error('client resolver exploded');
    });

    expect(() => render(React.createElement(SyncHarness))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    // No snapshot read attempted, and the local directory is unchanged.
    expect(readCivicRepresentativeSnapshotMock).not.toHaveBeenCalled();
    expect(getDirectory().version).toBe('6.0.0');
  });

  it('short-circuits post-sync work when unmounted while the sync is in flight', async () => {
    let resolveSnapshot: (value: RepresentativeDirectory | null) => void = () => {};
    readCivicRepresentativeSnapshotMock.mockImplementation(
      () =>
        new Promise<RepresentativeDirectory | null>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    const { unmount } = render(React.createElement(SyncHarness));
    // Let the mount effect start the in-flight sync.
    await Promise.resolve();
    expect(readCivicRepresentativeSnapshotMock).toHaveBeenCalled();

    // Unmount while the snapshot read is still pending, then resolve it.
    unmount();
    resolveSnapshot(directory('1.0.0', 'rep-late'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // The cancelled guard runs after the sync completes; no throw occurs.
  });
});
