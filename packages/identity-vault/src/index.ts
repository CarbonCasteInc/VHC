export type {
  DelegationSigningKeyCompartment,
  DelegationSigningPublicKey,
  DeviceCredentialCompartment,
  Identity,
  JsonSafeByteEncoding,
  SeaDevicePairCompartment,
  VaultRecord,
  VaultV2,
  WalletBindingCompartment,
  WalletProviderKind
} from './types';
export {
  LEGACY_STORAGE_KEY,
  LEGACY_VAULT_VERSION,
  isWalletBindingCompartment,
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
  clearWalletBinding,
  delegationSigningKey,
  deviceCredential,
  getDelegationSigningPublicKey,
  loadOrCreateDelegationSigningKey,
  loadOrCreateDeviceCredential,
  loadOrCreateSeaDevicePair,
  loadWalletBinding,
  normalizeWalletAddress,
  normalizeWalletChainId,
  publicDelegationSigningKey,
  randomBase64Url,
  rotateDelegationSigningKey,
  rotateDeviceCredential,
  rotateSeaDevicePair,
  rotateStoredDelegationSigningKey,
  saveWalletBinding,
  seaDevicePair,
  signWithDelegationSigningKey,
  signWithStoredDelegationSigningKey,
  utf8,
  validateDelegationSigningKey,
  validateDelegationSigningPublicKey,
  validateDeviceCredential,
  validateSeaDevicePair,
  validateWalletBinding,
  VaultCompartmentError,
  verifyWithDelegationSigningKey,
  verifyWithDelegationSigningPublicKey,
  walletBinding,
  walletBindingMatchesPrincipal,
  type SeaDevicePairInput,
  type WalletBindingInput
} from './compartments';
