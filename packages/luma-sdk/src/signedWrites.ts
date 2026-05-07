import canonicalize from 'canonicalize';

import {
  isRegisteredLinkabilityDomainName,
  type LinkabilityDomainName
} from './linkabilityDomains';
import type {
  AudienceTag,
  DeploymentProfile,
  SignatureSuite
} from './providers';

export const LUMA_SIGNED_WRITE_ENVELOPE_VERSION = 1;
export const LUMA_SIGNED_WRITE_PROTOCOL_VERSION = 'luma-write-v1';
export const CLIENT_SIGNED_WRITE_SIGNATURE_SUITE = 'jcs-ed25519-sha256-v1';

export const LUMA_SIGNED_WRITE_AUDIENCES = Object.freeze([
  'vh-directory-entry',
  'vh-forum-thread',
  'vh-forum-comment',
  'vh-aggregate-voter',
  'vh-stance-vote',
  'vh-stance-clear',
  'vh-civic-action-draft',
  'vh-civic-action-send',
  'vh-delegation-grant',
  'vh-delegation-revoke',
  'vh-budget-consume',
  'vh-onchain-bridge'
] as const satisfies readonly AudienceTag[]);

export const LUMA_SIGNED_WRITE_PROFILES = Object.freeze([
  'dev',
  'e2e',
  'public-beta',
  'production-attestation'
] as const satisfies readonly DeploymentProfile[]);

export const LUMA_SIGNED_WRITE_SIGNATURE_SUITES = Object.freeze([
  CLIENT_SIGNED_WRITE_SIGNATURE_SUITE
] as const satisfies readonly SignatureSuite[]);

export type ClientSignedWriteSignatureSuite = typeof CLIENT_SIGNED_WRITE_SIGNATURE_SUITE;

const PUBLIC_AUTHOR_KIND = 'luma-public-author-id';
const LOWERCASE_HEX_64 = /^[0-9a-f]{64}$/;
const LOWERCASE_HEX_32 = /^[0-9a-f]{32}$/;

export interface LumaPublicAuthorId {
  readonly kind: typeof PUBLIC_AUTHOR_KIND;
  readonly scheme: LinkabilityDomainName;
  readonly value: string;
}

export interface SignedWriteSessionRef {
  tokenHash: string;
  envelopeDigest: string;
}

export interface SignedWriteEnvelope<TPayload> {
  envelopeVersion: typeof LUMA_SIGNED_WRITE_ENVELOPE_VERSION;
  signatureSuite: ClientSignedWriteSignatureSuite;
  protocolVersion: typeof LUMA_SIGNED_WRITE_PROTOCOL_VERSION;
  profile: DeploymentProfile;
  audience: AudienceTag;
  origin: string;
  scheme: LinkabilityDomainName;
  publicAuthor: string;
  sessionRef: SignedWriteSessionRef;
  payload: TPayload;
  payloadDigest: string;
  sequence: number;
  nonce: string;
  idempotencyKey: string;
  issuedAt: number;
  signature: string;
}

export type UnsignedSignedWriteEnvelope<TPayload> = Omit<
  SignedWriteEnvelope<TPayload>,
  'signature'
>;

export interface SignedWriteSignHookInput<TPayload = unknown> {
  signatureSuite: ClientSignedWriteSignatureSuite;
  canonicalBytes: Uint8Array;
  canonicalEnvelope: string;
  envelope: UnsignedSignedWriteEnvelope<TPayload>;
}

export type SignedWriteSignHook<TPayload = unknown> = (
  input: SignedWriteSignHookInput<TPayload>
) => Promise<string> | string;

export interface SignedWriteVerifyHookInput<TPayload = unknown>
  extends SignedWriteSignHookInput<TPayload> {
  signature: string;
}

export type SignedWriteVerifyHook<TPayload = unknown> = (
  input: SignedWriteVerifyHookInput<TPayload>
) => Promise<boolean> | boolean;

export interface CreateSignedWriteEnvelopeInput<TPayload> {
  profile: DeploymentProfile;
  audience: AudienceTag;
  origin: string;
  scheme: string;
  publicAuthor: LumaPublicAuthorId;
  sessionRef: SignedWriteSessionRef;
  payload: TPayload;
  sequence: number;
  nonce: string;
  issuedAt: number;
  sign: SignedWriteSignHook<TPayload>;
  protocolVersion?: string;
  signatureSuite?: SignatureSuite;
}

export interface VerifySignedWriteEnvelopeInput<TPayload> {
  envelope: SignedWriteEnvelope<TPayload>;
  verify: SignedWriteVerifyHook<TPayload>;
}

export type SignedWriteVerificationFailureReason =
  | 'invalid_envelope_version'
  | 'unsupported_protocol_version'
  | 'unsupported_signature_suite'
  | 'unsupported_profile'
  | 'unsupported_audience'
  | 'unregistered_scheme'
  | 'invalid_public_author'
  | 'public_author_scheme_mismatch'
  | 'invalid_origin'
  | 'invalid_session_ref'
  | 'invalid_payload_digest'
  | 'payload_digest_mismatch'
  | 'invalid_idempotency_key'
  | 'idempotency_key_mismatch'
  | 'invalid_sequence'
  | 'invalid_nonce'
  | 'invalid_issued_at'
  | 'invalid_signature'
  | 'signature_verification_failed';

export type SignedWriteVerificationResult<TPayload = unknown> =
  | {
    valid: true;
    envelope: SignedWriteEnvelope<TPayload>;
    payloadDigest: string;
    idempotencyKey: string;
    canonicalEnvelope: string;
  }
  | {
    valid: false;
    reason: SignedWriteVerificationFailureReason;
    message: string;
  };

export class SignedWriteEnvelopeError extends Error {
  constructor(
    readonly reason: SignedWriteVerificationFailureReason,
    message: string
  ) {
    super(message);
    this.name = 'SignedWriteEnvelopeError';
  }
}

export function createLumaPublicAuthorId(
  value: string,
  scheme: string
): LumaPublicAuthorId {
  const registeredScheme = requireRegisteredScheme(scheme);
  requireLowercaseHex64(value, 'publicAuthor', 'invalid_public_author');

  return Object.freeze({
    kind: PUBLIC_AUTHOR_KIND,
    scheme: registeredScheme,
    value
  });
}

export function isLumaPublicAuthorId(value: unknown): value is LumaPublicAuthorId {
  return typeof value === 'object'
    && value !== null
    && (value as { kind?: unknown }).kind === PUBLIC_AUTHOR_KIND
    && typeof (value as { scheme?: unknown }).scheme === 'string'
    && typeof (value as { value?: unknown }).value === 'string'
    && isRegisteredLinkabilityDomainName((value as { scheme: string }).scheme)
    && LOWERCASE_HEX_64.test((value as { value: string }).value);
}

export function canonicalizeSignedWritePayload(payload: unknown): string {
  return requireCanonicalJson(payload, 'payload');
}

export async function digestSignedWritePayload(payload: unknown): Promise<string> {
  return sha256Hex(utf8(canonicalizeSignedWritePayload(payload)));
}

export function canonicalizeSignedWriteEnvelopeForSigning<TPayload>(
  envelope: UnsignedSignedWriteEnvelope<TPayload> | SignedWriteEnvelope<TPayload>
): string {
  return requireCanonicalJson(unsignedEnvelope(envelope), 'signed write envelope');
}

export function signedWriteEnvelopeSigningInput<TPayload>(
  envelope: UnsignedSignedWriteEnvelope<TPayload> | SignedWriteEnvelope<TPayload>
): Uint8Array {
  return utf8(canonicalizeSignedWriteEnvelopeForSigning(envelope));
}

export async function deriveSignedWriteIdempotencyKey(input: {
  payloadDigest: string;
  audience: AudienceTag;
  sequence: number;
}): Promise<string> {
  requireLowercaseHex64(input.payloadDigest, 'payloadDigest', 'invalid_payload_digest');
  requireAudience(input.audience);
  requireSequence(input.sequence);

  const material = `${input.payloadDigest}${input.audience}${input.sequence}`;
  return sha256Hex(utf8(requireCanonicalJson(material, 'idempotency basis')));
}

export async function createSignedWriteEnvelope<TPayload>(
  input: CreateSignedWriteEnvelopeInput<TPayload>
): Promise<SignedWriteEnvelope<TPayload>> {
  const signatureSuite = requireClientSignatureSuite(
    input.signatureSuite ?? CLIENT_SIGNED_WRITE_SIGNATURE_SUITE
  );
  const protocolVersion = requireProtocolVersion(
    input.protocolVersion ?? LUMA_SIGNED_WRITE_PROTOCOL_VERSION
  );
  const profile = requireProfile(input.profile);
  const audience = requireAudience(input.audience);
  const scheme = requireRegisteredScheme(input.scheme);
  const publicAuthor = requirePublicAuthor(input.publicAuthor, scheme);
  const origin = requireNonEmptyString(input.origin, 'origin', 'invalid_origin');
  const sessionRef = requireSessionRef(input.sessionRef);
  const sequence = requireSequence(input.sequence);
  const nonce = requireNonce(input.nonce);
  const issuedAt = requireIssuedAt(input.issuedAt);
  const payloadDigest = await digestSignedWritePayload(input.payload);
  const idempotencyKey = await deriveSignedWriteIdempotencyKey({
    payloadDigest,
    audience,
    sequence
  });

  const unsigned: UnsignedSignedWriteEnvelope<TPayload> = {
    envelopeVersion: LUMA_SIGNED_WRITE_ENVELOPE_VERSION,
    signatureSuite,
    protocolVersion,
    profile,
    audience,
    origin,
    scheme,
    publicAuthor,
    sessionRef,
    payload: input.payload,
    payloadDigest,
    sequence,
    nonce,
    idempotencyKey,
    issuedAt
  };

  const canonicalEnvelope = canonicalizeSignedWriteEnvelopeForSigning(unsigned);
  const signature = await input.sign({
    signatureSuite,
    canonicalBytes: utf8(canonicalEnvelope),
    canonicalEnvelope,
    envelope: unsigned
  });

  requireNonEmptyString(signature, 'signature', 'invalid_signature');

  return Object.freeze({
    ...unsigned,
    signature
  });
}

export async function verifySignedWriteEnvelope<TPayload>(
  input: VerifySignedWriteEnvelopeInput<TPayload>
): Promise<SignedWriteVerificationResult<TPayload>> {
  const validation = await validateSignedWriteEnvelope(input.envelope);
  if (!validation.valid) {
    return validation;
  }

  const canonicalEnvelope = canonicalizeSignedWriteEnvelopeForSigning(input.envelope);
  const verified = await input.verify({
    signatureSuite: input.envelope.signatureSuite,
    canonicalBytes: utf8(canonicalEnvelope),
    canonicalEnvelope,
    envelope: unsignedEnvelope(input.envelope),
    signature: input.envelope.signature
  });

  if (!verified) {
    return invalidResult<TPayload>(
      'signature_verification_failed',
      'Signed write envelope signature verification failed'
    );
  }

  return {
    valid: true,
    envelope: input.envelope,
    payloadDigest: validation.payloadDigest,
    idempotencyKey: validation.idempotencyKey,
    canonicalEnvelope
  };
}

async function validateSignedWriteEnvelope<TPayload>(
  envelope: SignedWriteEnvelope<TPayload>
): Promise<
  | {
    valid: true;
    payloadDigest: string;
    idempotencyKey: string;
  }
  | {
    valid: false;
    reason: SignedWriteVerificationFailureReason;
    message: string;
  }
> {
  try {
    requireEnvelopeVersion(envelope.envelopeVersion);
    requireClientSignatureSuite(envelope.signatureSuite);
    requireProtocolVersion(envelope.protocolVersion);
    requireProfile(envelope.profile);
    requireAudience(envelope.audience);
    requireRegisteredScheme(envelope.scheme);
    requireLowercaseHex64(envelope.publicAuthor, 'publicAuthor', 'invalid_public_author');
    requireNonEmptyString(envelope.origin, 'origin', 'invalid_origin');
    requireSessionRef(envelope.sessionRef);
    requireSequence(envelope.sequence);
    requireNonce(envelope.nonce);
    requireIssuedAt(envelope.issuedAt);
    requireNonEmptyString(envelope.signature, 'signature', 'invalid_signature');
    requireLowercaseHex64(envelope.payloadDigest, 'payloadDigest', 'invalid_payload_digest');
    requireLowercaseHex64(
      envelope.idempotencyKey,
      'idempotencyKey',
      'invalid_idempotency_key'
    );
  } catch (error) {
    return errorResult(error);
  }

  let payloadDigest: string;
  try {
    payloadDigest = await digestSignedWritePayload(envelope.payload);
  } catch (error) {
    return errorResult(error);
  }
  if (payloadDigest !== envelope.payloadDigest) {
    return invalidResult(
      'payload_digest_mismatch',
      'Signed write envelope payloadDigest does not match payload'
    );
  }

  const idempotencyKey = await deriveSignedWriteIdempotencyKey({
    payloadDigest,
    audience: envelope.audience,
    sequence: envelope.sequence
  });
  if (idempotencyKey !== envelope.idempotencyKey) {
    return invalidResult(
      'idempotency_key_mismatch',
      'Signed write envelope idempotencyKey does not match payloadDigest, audience, and sequence'
    );
  }

  return {
    valid: true,
    payloadDigest,
    idempotencyKey
  };
}

function requireCanonicalJson(value: unknown, label: string): string {
  try {
    assertJsonCanonicalizable(value, label);
    return canonicalize(value) as string;
  } catch (error) {
    if (error instanceof SignedWriteEnvelopeError) {
      throw error;
    }
    throw new SignedWriteEnvelopeError(
      'invalid_payload_digest',
      `${label} must be RFC 8785 JSON-canonicalizable: ${(error as Error).message}`
    );
  }
}

function assertJsonCanonicalizable(
  value: unknown,
  label: string,
  seen: WeakSet<object> = new WeakSet()
): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throwInvalidJsonValue(label);
    }
    return;
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throwInvalidJsonValue(label);
    }
    seen.add(value);

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throwInvalidJsonValue(label);
    }

    const descriptors = Object.fromEntries(
      Object.entries(Object.getOwnPropertyDescriptors(value))
        .filter(([key]) => key !== 'length')
    );

    for (const [key, descriptor] of Object.entries(descriptors)) {
      const index = Number(key);
      if (
        !Number.isInteger(index)
        || String(index) !== key
        || index < 0
        || index >= value.length
        || !descriptor.enumerable
        || !('value' in descriptor)
      ) {
        throwInvalidJsonValue(label);
      }
    }

    for (let index = 0; index < value.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (descriptor === undefined || !('value' in descriptor)) {
        throwInvalidJsonValue(label);
      }
      assertJsonCanonicalizable(descriptor.value, label, seen);
    }
    seen.delete(value);
    return;
  }

  if (typeof value === 'object' && value !== null) {
    if (seen.has(value)) {
      throwInvalidJsonValue(label);
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throwInvalidJsonValue(label);
    }

    seen.add(value);
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throwInvalidJsonValue(label);
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throwInvalidJsonValue(label);
      }
      assertJsonCanonicalizable(descriptor.value, label, seen);
    }
    seen.delete(value);
    return;
  }

  throwInvalidJsonValue(label);
}

function throwInvalidJsonValue(label: string): never {
  throw new SignedWriteEnvelopeError(
    'invalid_payload_digest',
    `${label} must be strict JSON data for RFC 8785 canonicalization`
  );
}

function requireEnvelopeVersion(value: unknown): typeof LUMA_SIGNED_WRITE_ENVELOPE_VERSION {
  if (value !== LUMA_SIGNED_WRITE_ENVELOPE_VERSION) {
    throw new SignedWriteEnvelopeError(
      'invalid_envelope_version',
      `Signed write envelopeVersion must be ${LUMA_SIGNED_WRITE_ENVELOPE_VERSION}`
    );
  }
  return value;
}

function requireProtocolVersion(value: unknown): typeof LUMA_SIGNED_WRITE_PROTOCOL_VERSION {
  if (value !== LUMA_SIGNED_WRITE_PROTOCOL_VERSION) {
    throw new SignedWriteEnvelopeError(
      'unsupported_protocol_version',
      `Signed write protocolVersion must be ${LUMA_SIGNED_WRITE_PROTOCOL_VERSION}`
    );
  }
  return value;
}

function requireClientSignatureSuite(value: unknown): ClientSignedWriteSignatureSuite {
  if (value !== CLIENT_SIGNED_WRITE_SIGNATURE_SUITE) {
    throw new SignedWriteEnvelopeError(
      'unsupported_signature_suite',
      `Signed write signatureSuite must be ${CLIENT_SIGNED_WRITE_SIGNATURE_SUITE}`
    );
  }
  return value;
}

function requireProfile(value: unknown): DeploymentProfile {
  if (!LUMA_SIGNED_WRITE_PROFILES.includes(value as DeploymentProfile)) {
    throw new SignedWriteEnvelopeError(
      'unsupported_profile',
      `Signed write profile is not supported: ${String(value)}`
    );
  }
  return value as DeploymentProfile;
}

function requireAudience(value: unknown): AudienceTag {
  if (!LUMA_SIGNED_WRITE_AUDIENCES.includes(value as AudienceTag)) {
    throw new SignedWriteEnvelopeError(
      'unsupported_audience',
      `Signed write audience is not supported: ${String(value)}`
    );
  }
  return value as AudienceTag;
}

function requireRegisteredScheme(value: unknown): LinkabilityDomainName {
  if (typeof value !== 'string' || !isRegisteredLinkabilityDomainName(value)) {
    throw new SignedWriteEnvelopeError(
      'unregistered_scheme',
      `Signed write scheme is not registered: ${String(value)}`
    );
  }
  return value;
}

function requirePublicAuthor(
  value: unknown,
  scheme: LinkabilityDomainName
): string {
  if (!isLumaPublicAuthorId(value)) {
    throw new SignedWriteEnvelopeError(
      'invalid_public_author',
      'Signed write publicAuthor must be a LUMA public author id'
    );
  }
  if (value.scheme !== scheme) {
    throw new SignedWriteEnvelopeError(
      'public_author_scheme_mismatch',
      'Signed write publicAuthor scheme must match the envelope scheme'
    );
  }
  return value.value;
}

function requireSessionRef(value: unknown): SignedWriteSessionRef {
  if (typeof value !== 'object' || value === null) {
    throw new SignedWriteEnvelopeError(
      'invalid_session_ref',
      'Signed write sessionRef must be an object'
    );
  }

  const tokenHash = requireNonEmptyString(
    (value as { tokenHash?: unknown }).tokenHash,
    'sessionRef.tokenHash',
    'invalid_session_ref'
  );
  const envelopeDigest = requireNonEmptyString(
    (value as { envelopeDigest?: unknown }).envelopeDigest,
    'sessionRef.envelopeDigest',
    'invalid_session_ref'
  );

  return Object.freeze({ tokenHash, envelopeDigest });
}

function requireSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SignedWriteEnvelopeError(
      'invalid_sequence',
      'Signed write sequence must be a nonnegative safe integer'
    );
  }
  return value;
}

function requireNonce(value: unknown): string {
  if (typeof value !== 'string' || !LOWERCASE_HEX_32.test(value)) {
    throw new SignedWriteEnvelopeError(
      'invalid_nonce',
      'Signed write nonce must be a lowercase 128-bit hex string'
    );
  }
  return value;
}

function requireIssuedAt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SignedWriteEnvelopeError(
      'invalid_issued_at',
      'Signed write issuedAt must be a nonnegative safe integer'
    );
  }
  return value;
}

function requireLowercaseHex64(
  value: unknown,
  label: string,
  reason: SignedWriteVerificationFailureReason
): string {
  if (typeof value !== 'string' || !LOWERCASE_HEX_64.test(value)) {
    throw new SignedWriteEnvelopeError(
      reason,
      `Signed write ${label} must be lowercase 64-character hex`
    );
  }
  return value;
}

function requireNonEmptyString(
  value: unknown,
  label: string,
  reason: SignedWriteVerificationFailureReason
): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SignedWriteEnvelopeError(
      reason,
      `Signed write ${label} must be a non-empty string`
    );
  }
  return value;
}

function unsignedEnvelope<TPayload>(
  envelope: UnsignedSignedWriteEnvelope<TPayload> | SignedWriteEnvelope<TPayload>
): UnsignedSignedWriteEnvelope<TPayload> {
  const {
    envelopeVersion,
    signatureSuite,
    protocolVersion,
    profile,
    audience,
    origin,
    scheme,
    publicAuthor,
    sessionRef,
    payload,
    payloadDigest,
    sequence,
    nonce,
    idempotencyKey,
    issuedAt
  } = envelope;

  return {
    envelopeVersion,
    signatureSuite,
    protocolVersion,
    profile,
    audience,
    origin,
    scheme,
    publicAuthor,
    sessionRef,
    payload,
    payloadDigest,
    sequence,
    nonce,
    idempotencyKey,
    issuedAt
  };
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new SignedWriteEnvelopeError(
      'invalid_payload_digest',
      'WebCrypto SHA-256 is unavailable'
    );
  }

  const nodeBuffer = (globalThis as typeof globalThis & {
    Buffer?: { from(input: Uint8Array): Uint8Array };
  }).Buffer;
  let digestInput: BufferSource;
  if (nodeBuffer) {
    digestInput = nodeBuffer.from(bytes) as unknown as BufferSource;
  } else {
    digestInput = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(digestInput).set(bytes);
  }
  const digest = await subtle.digest('SHA-256', digestInput);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function invalidResult<TPayload = unknown>(
  reason: SignedWriteVerificationFailureReason,
  message: string
): SignedWriteVerificationResult<TPayload> {
  return {
    valid: false,
    reason,
    message
  };
}

function errorResult<TPayload = unknown>(error: unknown): SignedWriteVerificationResult<TPayload> {
  if (error instanceof SignedWriteEnvelopeError) {
    return invalidResult(error.reason, error.message);
  }
  throw error;
}
