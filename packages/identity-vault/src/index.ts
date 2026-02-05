export type { Identity, VaultRecord } from './types';
export { LEGACY_STORAGE_KEY, isValidIdentity } from './types';
export { loadIdentity, saveIdentity, clearIdentity } from './vault';
export { migrateLegacyLocalStorage } from './migrate';
