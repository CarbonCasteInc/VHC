export type {
  DelegationSigningKeyCompartment,
  DelegationSigningPublicKey,
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
  getDelegationSigningPublicKey,
  loadOrCreateDelegationSigningKey,
  loadOrCreateDeviceCredential,
  loadOrCreateSeaDevicePair,
  publicDelegationSigningKey,
  randomBase64Url,
  rotateDelegationSigningKey,
  rotateDeviceCredential,
  rotateSeaDevicePair,
  rotateStoredDelegationSigningKey,
  seaDevicePair,
  signWithDelegationSigningKey,
  signWithStoredDelegationSigningKey,
  utf8,
  validateDelegationSigningKey,
  validateDelegationSigningPublicKey,
  validateDeviceCredential,
  validateSeaDevicePair,
  VaultCompartmentError,
  verifyWithDelegationSigningKey,
  verifyWithDelegationSigningPublicKey,
  type SeaDevicePairInput
} from './compartments';
