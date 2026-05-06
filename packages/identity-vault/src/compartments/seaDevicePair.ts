import type { SeaDevicePairCompartment } from '../types';
import { loadVaultV2, saveVaultV2 } from '../vault';
import { VaultCompartmentError } from './encoding';

export type SeaDevicePairInput = Pick<
  SeaDevicePairCompartment,
  'pub' | 'priv' | 'epub' | 'epriv'
>;

export async function loadOrCreateSeaDevicePair(
  createPair: () => Promise<SeaDevicePairInput> | SeaDevicePairInput
): Promise<SeaDevicePairCompartment> {
  const vault = await loadVaultV2();
  const existing = vault?.seaDevicePair;
  if (existing) return validateSeaDevicePair(existing);

  const created = normalizeSeaDevicePair(await createPair());
  await saveVaultV2({
    schemaVersion: 2,
    ...(vault ?? {}),
    seaDevicePair: created
  });
  return created;
}

export async function rotateSeaDevicePair(
  createPair: () => Promise<SeaDevicePairInput> | SeaDevicePairInput
): Promise<SeaDevicePairCompartment> {
  const vault = await loadVaultV2();
  const rotated = normalizeSeaDevicePair(await createPair());
  await saveVaultV2({
    schemaVersion: 2,
    ...(vault ?? {}),
    seaDevicePair: rotated
  });
  return rotated;
}

export function validateSeaDevicePair(value: unknown): SeaDevicePairCompartment {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || !nonEmptyString((value as { pub?: unknown }).pub)
    || !nonEmptyString((value as { priv?: unknown }).priv)
    || !nonEmptyString((value as { epub?: unknown }).epub)
    || !nonEmptyString((value as { epriv?: unknown }).epriv)
    || typeof (value as { createdAt?: unknown }).createdAt !== 'number'
    || !Number.isSafeInteger((value as { createdAt: number }).createdAt)
    || (value as { createdAt: number }).createdAt < 0
  ) {
    throw new VaultCompartmentError('Invalid seaDevicePair compartment');
  }

  return value as SeaDevicePairCompartment;
}

function normalizeSeaDevicePair(pair: SeaDevicePairInput): SeaDevicePairCompartment {
  if (
    !nonEmptyString(pair.pub)
    || !nonEmptyString(pair.priv)
    || !nonEmptyString(pair.epub)
    || !nonEmptyString(pair.epriv)
  ) {
    throw new VaultCompartmentError('SEA device pair must contain all key fields');
  }

  return {
    schemaVersion: 1,
    pub: pair.pub,
    priv: pair.priv,
    epub: pair.epub,
    epriv: pair.epriv,
    createdAt: Date.now()
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export const seaDevicePair = Object.freeze({
  loadOrCreate: loadOrCreateSeaDevicePair,
  rotate: rotateSeaDevicePair
});
