export type PrincipalNullifier = string;
export type ForumAuthorId = string;
export type IdentityDirectoryKey = string;
export type VoterId = string;

export type LumaIdentifierDomainName =
  | 'forum-author-v1'
  | 'identity-directory-v1'
  | 'voter-v1';

export const LUMA_IDENTIFIER_INFO: Record<LumaIdentifierDomainName, string> = Object.freeze({
  'forum-author-v1': 'vh:forum-author:v1',
  'identity-directory-v1': 'vh:identity-directory:v1',
  'voter-v1': 'vh:voter:v1'
});

const HKDF_SHA256_OUTPUT_BYTES = 32;
const ZERO_HKDF_SHA256_SALT = new Uint8Array(HKDF_SHA256_OUTPUT_BYTES);
const textEncoder = new (globalThis as unknown as {
  TextEncoder: { new (): { encode(input?: string): Uint8Array } };
}).TextEncoder();

type HkdfHash = 'SHA-256';

interface HkdfParamsLike {
  name: 'HKDF';
  hash: HkdfHash;
  salt: Uint8Array;
  info: Uint8Array;
}

interface SubtleCryptoLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: 'HKDF',
    extractable: false,
    keyUsages: ['deriveBits']
  ): Promise<unknown>;
  deriveBits(params: HkdfParamsLike, baseKey: unknown, length: number): Promise<ArrayBuffer>;
}

interface CryptoLike {
  subtle?: SubtleCryptoLike;
}

export interface LumaIdentifierDerivationOptions {
  crypto?: CryptoLike;
}

export interface VoterIdScope {
  topicId: string;
  epoch: number;
}

export async function deriveForumAuthorId(
  principalNullifier: PrincipalNullifier,
  options: LumaIdentifierDerivationOptions = {}
): Promise<ForumAuthorId> {
  return derivePublicId(principalNullifier, LUMA_IDENTIFIER_INFO['forum-author-v1'], null, options);
}

export async function deriveIdentityDirectoryKey(
  principalNullifier: PrincipalNullifier,
  options: LumaIdentifierDerivationOptions = {}
): Promise<IdentityDirectoryKey> {
  return derivePublicId(principalNullifier, LUMA_IDENTIFIER_INFO['identity-directory-v1'], null, options);
}

export async function deriveVoterId(
  principalNullifier: PrincipalNullifier,
  scope: VoterIdScope,
  options: LumaIdentifierDerivationOptions = {}
): Promise<VoterId> {
  assertNonEmpty(scope.topicId, 'topicId');
  assertValidEpoch(scope.epoch);

  return derivePublicId(
    principalNullifier,
    LUMA_IDENTIFIER_INFO['voter-v1'],
    `${scope.topicId}:${scope.epoch}`,
    options
  );
}

async function derivePublicId(
  principalNullifier: PrincipalNullifier,
  info: string,
  scopeIdentifier: string | null,
  options: LumaIdentifierDerivationOptions
): Promise<string> {
  assertNonEmpty(principalNullifier, 'principalNullifier');

  const subtle = getSubtleCrypto(options);
  const key = await subtle.importKey(
    'raw',
    textEncoder.encode(principalNullifier),
    'HKDF',
    false,
    ['deriveBits']
  );
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: scopeIdentifier === null ? ZERO_HKDF_SHA256_SALT : textEncoder.encode(scopeIdentifier),
      info: textEncoder.encode(info)
    },
    key,
    HKDF_SHA256_OUTPUT_BYTES * 8
  );
  const derived = toLowerHex(new Uint8Array(bits));

  if (matchesRawNullifier(derived, principalNullifier)) {
    throw new Error('LUMA public id derivation collided with the raw principalNullifier');
  }

  return derived;
}

function getSubtleCrypto(options: LumaIdentifierDerivationOptions): SubtleCryptoLike {
  const provided = options.crypto?.subtle;
  if (provided) {
    return provided;
  }

  const globalCrypto = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (globalCrypto?.subtle) {
    return globalCrypto.subtle;
  }

  throw new Error('WebCrypto SubtleCrypto is required for LUMA public id derivation');
}

function toLowerHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function matchesRawNullifier(derived: string, principalNullifier: string): boolean {
  return derived === principalNullifier || derived === principalNullifier.toLowerCase();
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required for LUMA public id derivation`);
  }
}

function assertValidEpoch(epoch: number): void {
  if (typeof epoch !== 'number' || !Number.isInteger(epoch) || epoch < 0) {
    throw new Error('epoch must be a nonnegative integer for LUMA voter id derivation');
  }
}
