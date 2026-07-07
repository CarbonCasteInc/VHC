/**
 * Opaque vault blob — the vault encrypts any JSON-serializable object.
 * Shape validation is the consumer's responsibility.
 */
export type Identity = Record<string, unknown>;

export type JsonSafeByteEncoding = 'base64url';

export interface DeviceCredentialCompartment {
  schemaVersion: 1;
  material: string;
  createdAt: number;
  source: 'generated' | 'legacy-v1';
}

export interface SeaDevicePairCompartment {
  schemaVersion: 1;
  pub: string;
  priv: string;
  epub: string;
  epriv: string;
  createdAt: number;
}

export interface DelegationSigningKeyCompartment {
  schemaVersion: 1;
  signatureSuite: 'jcs-ed25519-sha256-v1';
  publicKey: {
    encoding: JsonSafeByteEncoding;
    material: string;
  };
  privateKey: {
    encoding: JsonSafeByteEncoding;
    material: string;
  };
  createdAt: number;
}

export interface DelegationSigningPublicKey {
  signatureSuite: 'jcs-ed25519-sha256-v1';
  publicKey: {
    encoding: JsonSafeByteEncoding;
    material: string;
  };
  createdAt: number;
}

export type WalletProviderKind = 'browser-injected' | 'e2e-mock';

export interface WalletBindingCompartment {
  schemaVersion: 1;
  address: string;
  chainId: string;
  providerKind: WalletProviderKind;
  boundPrincipalNullifier: string;
  boundAt: number;
  updatedAt: number;
}

export interface OperatorAuthorizationTokenCompartment {
  schemaVersion: 1;
  token: string;
  boundPrincipalNullifier: string;
  issuedAt: number;
  expiresAt?: number;
}

/**
 * Closed sign-in provider set (Lane C). Mirrors the data-model
 * SignInProviderId enum and is deliberately distinct from the
 * linked-social SocialProviderId.
 */
export type SignInProviderKind = 'apple' | 'google' | 'x';

/**
 * Sign-in session material (Slice C1). Vault-only: provider subjects,
 * display labels, and provider tokens are personal profile data
 * (spec-data-topology-privacy-v0 §3) and must never be written to
 * public mesh, logs, telemetry, support issues, or release evidence.
 */
export interface SignInSessionCompartment {
  schemaVersion: 1;
  providerId: SignInProviderKind;
  providerSubject: string;
  displayLabel?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  boundPrincipalNullifier: string;
  boundAt: number;
  updatedAt: number;
}

export interface VaultV2 {
  schemaVersion: 2;
  identityRecord?: Identity;
  deviceCredential?: DeviceCredentialCompartment;
  seaDevicePair?: SeaDevicePairCompartment;
  delegationSigningKey?: DelegationSigningKeyCompartment;
  walletBinding?: WalletBindingCompartment;
  operatorAuthorizationToken?: OperatorAuthorizationTokenCompartment;
  signInSession?: SignInSessionCompartment;
}

/**
 * Record stored in IndexedDB "vault" object store.
 */
export interface VaultRecord {
  version: number;
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

/** Database name for the identity vault. */
export const DB_NAME = 'vh-vault';

/** Object store for encrypted identity blobs. */
export const VAULT_STORE = 'vault';

/** Object store for CryptoKeys. */
export const KEYS_STORE = 'keys';

/** Key under which the identity record is stored. */
export const IDENTITY_KEY = 'identity';

/** Key under which the master CryptoKey is stored. */
export const MASTER_KEY = 'master';

/** Current vault record version. */
export const VAULT_VERSION = 2;

/** Legacy opaque identity vault record version. */
export const LEGACY_VAULT_VERSION = 1;

/** Legacy localStorage key consumed during migration. */
export const LEGACY_STORAGE_KEY = 'vh_identity';

/**
 * Runtime shape check for vault-stored objects.
 * Accepts any non-null, non-array object — the vault encrypts opaque blobs;
 * detailed shape validation belongs to the consumer.
 */
export function isValidIdentity(value: unknown): value is Identity {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWalletBindingCompartment(value: unknown): value is WalletBindingCompartment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  const allowedKeys = new Set([
    'schemaVersion',
    'address',
    'chainId',
    'providerKind',
    'boundPrincipalNullifier',
    'boundAt',
    'updatedAt'
  ]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    return false;
  }

  const record = value as WalletBindingCompartment;
  return (
    record.schemaVersion === 1
    && typeof record.address === 'string'
    && /^0x[0-9a-f]{40}$/.test(record.address)
    && typeof record.chainId === 'string'
    && /^(0|[1-9][0-9]*)$/.test(record.chainId)
    && (record.providerKind === 'browser-injected' || record.providerKind === 'e2e-mock')
    && typeof record.boundPrincipalNullifier === 'string'
    && record.boundPrincipalNullifier.length > 0
    && typeof record.boundAt === 'number'
    && Number.isSafeInteger(record.boundAt)
    && record.boundAt >= 0
    && typeof record.updatedAt === 'number'
    && Number.isSafeInteger(record.updatedAt)
    && record.updatedAt >= record.boundAt
  );
}

export function isOperatorAuthorizationTokenCompartment(
  value: unknown
): value is OperatorAuthorizationTokenCompartment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  const allowedKeys = new Set([
    'schemaVersion',
    'token',
    'boundPrincipalNullifier',
    'issuedAt',
    'expiresAt'
  ]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    return false;
  }

  const record = value as OperatorAuthorizationTokenCompartment;
  return (
    record.schemaVersion === 1
    && typeof record.token === 'string'
    && record.token.length > 0
    && typeof record.boundPrincipalNullifier === 'string'
    && record.boundPrincipalNullifier.length > 0
    && typeof record.issuedAt === 'number'
    && Number.isSafeInteger(record.issuedAt)
    && record.issuedAt >= 0
    && (
      record.expiresAt === undefined
      || (
        typeof record.expiresAt === 'number'
        && Number.isSafeInteger(record.expiresAt)
        && record.expiresAt >= record.issuedAt
      )
    )
  );
}

const SIGN_IN_PROVIDER_KINDS: readonly string[] = ['apple', 'google', 'x'];

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length > 0);
}

export function isSignInSessionCompartment(value: unknown): value is SignInSessionCompartment {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  const allowedKeys = new Set([
    'schemaVersion',
    'providerId',
    'providerSubject',
    'displayLabel',
    'accessToken',
    'refreshToken',
    'expiresAt',
    'boundPrincipalNullifier',
    'boundAt',
    'updatedAt'
  ]);
  if (keys.some((key) => !allowedKeys.has(key))) {
    return false;
  }

  const record = value as SignInSessionCompartment;
  return (
    record.schemaVersion === 1
    && SIGN_IN_PROVIDER_KINDS.includes(record.providerId)
    && typeof record.providerSubject === 'string'
    && record.providerSubject.length > 0
    && isOptionalNonEmptyString(record.displayLabel)
    && isOptionalNonEmptyString(record.accessToken)
    && isOptionalNonEmptyString(record.refreshToken)
    && (
      record.expiresAt === undefined
      || (
        typeof record.expiresAt === 'number'
        && Number.isSafeInteger(record.expiresAt)
        && record.expiresAt >= 0
      )
    )
    && typeof record.boundPrincipalNullifier === 'string'
    && record.boundPrincipalNullifier.length > 0
    && typeof record.boundAt === 'number'
    && Number.isSafeInteger(record.boundAt)
    && record.boundAt >= 0
    && typeof record.updatedAt === 'number'
    && Number.isSafeInteger(record.updatedAt)
    && record.updatedAt >= record.boundAt
  );
}

export function isVaultV2(value: unknown): value is VaultV2 {
  if (
    !isValidIdentity(value)
    || (value as { schemaVersion?: unknown }).schemaVersion !== VAULT_VERSION
  ) {
    return false;
  }

  const identityRecord = (value as { identityRecord?: unknown }).identityRecord;
  const walletBinding = (value as { walletBinding?: unknown }).walletBinding;
  const operatorToken = (value as { operatorAuthorizationToken?: unknown }).operatorAuthorizationToken;
  const signInSession = (value as { signInSession?: unknown }).signInSession;
  return (
    (identityRecord === undefined || isValidIdentity(identityRecord))
    && (walletBinding === undefined || isWalletBindingCompartment(walletBinding))
    && (operatorToken === undefined || isOperatorAuthorizationTokenCompartment(operatorToken))
    && (signInSession === undefined || isSignInSessionCompartment(signInSession))
  );
}
