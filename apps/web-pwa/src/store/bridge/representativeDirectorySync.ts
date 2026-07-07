/**
 * Representative directory sync — pull the system-writer-validated directory
 * snapshot from the mesh into the local store.
 *
 * `readCivicRepresentativeSnapshot` returns a directory only when the record is
 * a valid system-writer record (or a compatible legacy record) at
 * `vh/civic/reps/<jurisdictionVersion>`; a validation failure returns null. When
 * that happens we leave the existing local directory untouched (fail-closed) so
 * a tampered or unverifiable snapshot can never replace known-good local data.
 *
 * Spec: spec-civic-action-kit-v0.md §3.3 (directory validation); the
 * system-writer readback surface is check:luma-civic-reps-system-v1.
 */

import { useEffect } from 'react';
import { readCivicRepresentativeSnapshot, type VennClient } from '@vh/gun-client';
import type { RepresentativeDirectory } from '@vh/data-model';
import { resolveClientFromAppStore } from '../clientResolver';
import {
  getDirectory,
  isNewerVersion,
  loadDirectory,
} from './representativeDirectory';

const SEASON_0_DEFAULT_JURISDICTION_VERSION = 'season0-default-v1';

export function getConfiguredJurisdictionVersion(): string {
  const importMetaEnv = (import.meta as { env?: { VITE_CIVIC_REPS_JURISDICTION_VERSION?: unknown } })
    .env;
  const processEnv = (globalThis as {
    process?: { env?: { VITE_CIVIC_REPS_JURISDICTION_VERSION?: unknown } };
  }).process?.env;
  const envValue =
    importMetaEnv?.VITE_CIVIC_REPS_JURISDICTION_VERSION
    ?? processEnv?.VITE_CIVIC_REPS_JURISDICTION_VERSION;

  if (typeof envValue === 'string' && envValue.trim().length > 0) {
    return envValue.trim();
  }

  return SEASON_0_DEFAULT_JURISDICTION_VERSION;
}

export interface SyncRepresentativeDirectoryResult {
  /** Whether the local directory was replaced with a validated snapshot. */
  readonly loaded: boolean;
  /** Reason a validated snapshot was not applied, when `loaded` is false. */
  readonly reason?: 'no-client' | 'validation-failed' | 'not-newer' | 'load-rejected';
}

/**
 * Read the validated snapshot for the given jurisdiction and load it into the
 * local store when it is newer than the current directory. A null adapter
 * result (system-writer validation failure) leaves the local directory
 * unchanged.
 */
export async function syncRepresentativeDirectory(
  client: VennClient | null,
  jurisdictionVersion: string = getConfiguredJurisdictionVersion(),
): Promise<SyncRepresentativeDirectoryResult> {
  if (!client) {
    return { loaded: false, reason: 'no-client' };
  }

  let snapshot: RepresentativeDirectory | null;
  try {
    snapshot = await readCivicRepresentativeSnapshot(client, jurisdictionVersion);
  } catch {
    // A read/validation error is treated exactly like a validation failure:
    // never mutate the local directory on an unverifiable snapshot.
    return { loaded: false, reason: 'validation-failed' };
  }

  if (!snapshot) {
    return { loaded: false, reason: 'validation-failed' };
  }

  if (!isNewerVersion(snapshot.version) && snapshot.version === getDirectory().version) {
    return { loaded: false, reason: 'not-newer' };
  }

  return loadDirectory(snapshot)
    ? { loaded: true }
    : { loaded: false, reason: 'load-rejected' };
}

/**
 * Bridge-surface mount hook: sync the representative directory once when the
 * civic surface mounts. Failures are swallowed — the local scaffold or the
 * previously loaded directory remains in place.
 */
export function useRepresentativeDirectorySync(): void {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = resolveClientFromAppStore();
        await syncRepresentativeDirectory(client);
      } catch {
        // Fail-closed: leave the local directory unchanged on any error.
      }
      if (cancelled) {
        // Component unmounted while the sync was in flight; nothing else to do.
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
}
