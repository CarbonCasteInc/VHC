import type { DeviceCredentialCompartment } from '../types';
import { loadVaultV2, saveVaultV2 } from '../vault';
import { randomBase64Url, VaultCompartmentError } from './encoding';

const DEVICE_CREDENTIAL_BYTES = 32;

export async function loadOrCreateDeviceCredential(): Promise<DeviceCredentialCompartment> {
  const vault = await loadVaultV2();
  const existing = vault?.deviceCredential;
  if (existing) return validateDeviceCredential(existing);

  const created = createDeviceCredential('generated');
  await saveVaultV2({
    schemaVersion: 2,
    ...(vault ?? {}),
    deviceCredential: created
  });
  return created;
}

export async function rotateDeviceCredential(): Promise<DeviceCredentialCompartment> {
  const vault = await loadVaultV2();
  const rotated = createDeviceCredential('generated');
  await saveVaultV2({
    schemaVersion: 2,
    ...(vault ?? {}),
    deviceCredential: rotated
  });
  return rotated;
}

export function validateDeviceCredential(
  value: unknown
): DeviceCredentialCompartment {
  if (
    typeof value !== 'object'
    || value === null
    || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || typeof (value as { material?: unknown }).material !== 'string'
    || (value as { material: string }).material.length === 0
    || typeof (value as { createdAt?: unknown }).createdAt !== 'number'
    || !Number.isSafeInteger((value as { createdAt: number }).createdAt)
    || (value as { createdAt: number }).createdAt < 0
    || !['generated', 'legacy-v1'].includes((value as { source?: string }).source ?? '')
  ) {
    throw new VaultCompartmentError('Invalid deviceCredential compartment');
  }

  return value as DeviceCredentialCompartment;
}

function createDeviceCredential(
  source: DeviceCredentialCompartment['source']
): DeviceCredentialCompartment {
  return {
    schemaVersion: 1,
    material: randomBase64Url(DEVICE_CREDENTIAL_BYTES),
    createdAt: Date.now(),
    source
  };
}

export const deviceCredential = Object.freeze({
  loadOrCreate: loadOrCreateDeviceCredential,
  rotate: rotateDeviceCredential
});
