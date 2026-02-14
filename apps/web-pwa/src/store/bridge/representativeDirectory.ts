/**
 * Representative directory — local store for constituency matching.
 *
 * Bundles an empty directory scaffold for offline startup.
 * Validates directory data with Zod before replacing local cache.
 *
 * Spec: spec-civic-action-kit-v0.md §3.1, §3.2, §3.3
 */

import type { Representative, RepresentativeDirectory } from '@vh/data-model';
import { RepresentativeDirectorySchema } from '@vh/data-model';

/* ── Empty scaffold for offline startup ─────────────────────── */

const EMPTY_DIRECTORY: RepresentativeDirectory = {
  version: '0.0.0',
  lastUpdated: 0,
  updateSource: 'empty-scaffold',
  representatives: [],
  byState: {},
  byDistrictHash: {},
};

/* ── In-memory store ────────────────────────────────────────── */

let _directory: RepresentativeDirectory = { ...EMPTY_DIRECTORY };

/**
 * Get the current directory snapshot.
 */
export function getDirectory(): RepresentativeDirectory {
  return _directory;
}

/**
 * Load and validate a directory payload, replacing the local cache.
 * Returns true on success, false if validation fails.
 * Spec: spec-civic-action-kit-v0.md §3.3
 */
export function loadDirectory(data: unknown): boolean {
  const result = RepresentativeDirectorySchema.safeParse(data);
  if (!result.success) return false;
  _directory = result.data;
  return true;
}

/**
 * Check if a remote directory version is newer than local.
 */
export function isNewerVersion(remoteVersion: string): boolean {
  return remoteVersion > _directory.version;
}

/**
 * Find representatives matching a district hash.
 * Spec: spec-civic-action-kit-v0.md §3.2
 */
export function findRepresentatives(districtHash: string): Representative[] {
  const ids = _directory.byDistrictHash[districtHash] ?? [];
  return ids
    .map((id) => _directory.representatives.find((rep) => rep.id === id))
    .filter((rep): rep is Representative => rep !== undefined);
}

/**
 * Find representatives by state.
 */
export function findRepresentativesByState(state: string): Representative[] {
  const ids = _directory.byState[state] ?? [];
  return ids
    .map((id) => _directory.representatives.find((rep) => rep.id === id))
    .filter((rep): rep is Representative => rep !== undefined);
}

/**
 * Reset directory to empty scaffold. For testing only.
 */
export function _resetDirectoryForTesting(): void {
  _directory = { ...EMPTY_DIRECTORY };
}
