export type {
  DelegationSigningKeyCompartment,
  DeviceCredentialCompartment,
  Identity,
  JsonSafeByteEncoding,
  SeaDevicePairCompartment,
  VaultRecord,
  VaultV2
} from './types';
export {
  LEGACY_STORAGE_KEY,
  LEGACY_VAULT_VERSION,
  isValidIdentity,
  isVaultV2,
  VAULT_VERSION
} from './types';
export {
  clearIdentity,
  loadIdentity,
  loadVaultV2,
  saveIdentity,
  saveVaultV2,
  updateVaultV2
} from './vault';
export { migrateLegacyLocalStorage } from './migrate';
export {
  base64UrlToBytes,
  bytesToBase64Url,
  delegationSigningKey,
  deviceCredential,
  loadOrCreateDelegationSigningKey,
  loadOrCreateDeviceCredential,
  loadOrCreateSeaDevicePair,
  randomBase64Url,
  rotateDelegationSigningKey,
  rotateDeviceCredential,
  rotateSeaDevicePair,
  seaDevicePair,
  signWithDelegationSigningKey,
  utf8,
  validateDelegationSigningKey,
  validateDeviceCredential,
  validateSeaDevicePair,
  VaultCompartmentError,
  verifyWithDelegationSigningKey,
  type SeaDevicePairInput
} from './compartments';
