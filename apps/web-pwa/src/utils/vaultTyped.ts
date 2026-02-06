import type { Identity } from '@vh/identity-vault';
import type { IdentityRecord } from '@vh/types';
import { loadIdentity as vaultLoad, saveIdentity as vaultSave } from '@vh/identity-vault';

/**
 * Load from vault and narrow to the canonical identity record.
 *
 * The vault stores opaque blobs by design; runtime validation/migrations
 * should be added at this boundary when needed.
 */
function isIdentityRecordLike(value: unknown): value is IdentityRecord {
  return typeof value === 'object' && value !== null;
}

export async function loadIdentityRecord(): Promise<IdentityRecord | null> {
  const raw: Identity | null = await vaultLoad();
  if (!isIdentityRecordLike(raw)) return null;
  return raw;
}

/** Save canonical identity record to the opaque vault. */
export async function saveIdentityRecord(record: IdentityRecord): Promise<void> {
  await vaultSave(record as unknown as Identity);
}
